"""DB-API-shaped connections for the libSQL-backed stores.

Replaces the `libsql` package as the transport. That package (every 0.1.x we
tried) talks to Turso through the streaming cursor endpoint, and Turso's AWS
edge stopped serving it:

    POST /v3/cursor    -> 502 {"error":"upstream forward failed"}
    POST /v2/pipeline  -> 200
    wss:// upgrade     -> 400 "protocol upgrade not supported (websocket)"

The database itself was never the problem — the same URL and token read every
table fine over `/v2/pipeline`. So this module speaks that endpoint directly
and exposes the small slice of DB-API the stores actually use: `execute`,
`executemany`, `commit`, `close`, and cursors with `fetchall`/`fetchone`/
`fetchmany`/`description`/`rowcount`/`lastrowid`.

Two things worth knowing:

**Every statement commits on its own.** The pipeline endpoint hands back a
closed stream (`baton: null`), so a transaction cannot span HTTP round trips
and `commit()` is a no-op for remote connections. That matches how the stores
are written — each one runs a single statement and then commits — and
`executemany` still gets real atomicity because its whole batch, BEGIN and
COMMIT included, goes in one request.

**Calls are bounded.** A hung request here would hold its store's lock and
recreate exactly the outage `libsql_gate` exists to prevent, so the HTTP
timeout is deliberately short — shorter than the gate's own lock wait.

Local development without Turso credentials keeps using a file, now through
`sqlite3` directly: the files are ordinary SQLite and `sqlite3.Connection`
already is the DB-API this module imitates.
"""

from __future__ import annotations

import base64
import os
import re
import sqlite3
import threading
import time
from typing import Any, Iterable, Sequence

import requests

# A healthy round trip to Turso measures in the low hundreds of milliseconds.
# The gate gives a queued caller 4s to acquire the store lock, so anything much
# beyond this would just hand it a lock it holds past that budget.
DEFAULT_TIMEOUT = float(os.environ.get("TURSO_HTTP_TIMEOUT", "6.0"))
CONNECT_TIMEOUT = 3.0

# Bulk writes legitimately take longer than a single statement, and they are
# batch jobs rather than request-path work.
BATCH_TIMEOUT_MULTIPLIER = 4


# Statements a retry cannot apply twice.
_READ_ONLY = ("SELECT", "WITH", "PRAGMA", "EXPLAIN")


class TursoError(RuntimeError):
    """A statement failed, or the database could not be reached."""


class TursoUnreachable(TursoError):
    """The database could not be reached or answered with a server error: a timeout,
    a refused connection, an HTTP 5xx from Turso's edge. Worth a retry later, and what
    a store's breaker counts. A plain `TursoError` is the statement itself failing
    (bad SQL, a constraint) — the database is fine and retrying cannot help."""

    #: True when the request died at the connection (refused, reset, never opened)
    #: rather than timing out mid-answer or getting a 5xx back — the one case where a
    #: store resending it on a fresh session is both useful and unlikely to apply twice.
    reconnect = False


def should_retry(exc: BaseException) -> bool:
    """Whether a store should rerun the failed call on a fresh connection.

    Not for a statement the database rejected: it fails the same way again, and each
    rerun holds the store's lock while every other caller queues. Not for a timeout:
    reads were already retried once inside `_pipeline`, and a write that timed out may
    have landed, so resending it could apply it twice. Errors from a local SQLite file
    (development) keep the old retry-once behaviour.
    """
    if isinstance(exc, TursoUnreachable):
        return exc.reconnect
    return not isinstance(exc, TursoError)


# Idempotent schema statements every store re-sends on each (re)connect. Over HTTP a
# "connection" is only a session object, so a reconnect after one failed statement
# used to replay a store's whole schema - 10 to 30 round trips - while holding its
# lock: a single slow query turned into seconds of every other caller of that store
# queueing past the gate's wait and failing. Once one of these has succeeded against a
# database in this process, it is answered locally.
_IDEMPOTENT_DDL = re.compile(
    r"^\s*CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+IF\s+NOT\s+EXISTS\b", re.I
)
_TABLE_INFO = re.compile(r"^\s*PRAGMA\s+table_info\s*\(", re.I)
_SCHEMA_CHANGE = re.compile(r"^\s*(ALTER|DROP|CREATE)\b", re.I)
_schema_lock = threading.Lock()
_ddl_done: set[tuple[str, str]] = set()
_table_info: dict[tuple[str, str, tuple], tuple[list[str], list[tuple]]] = {}


def _http_base(url: str) -> str:
    """Turso publishes one host that serves both schemes; only `https` reaches
    the pipeline endpoint."""
    scheme, _, rest = url.partition("://")
    if scheme in ("libsql", "wss", "ws"):
        scheme = "https"
    return f"{scheme}://{rest}".rstrip("/")


def _encode(value: Any) -> dict:
    if value is None:
        return {"type": "null"}
    # bool before int: it is a subclass, and Hrana has no boolean type.
    if isinstance(value, bool):
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        # Hrana BLOBs use `base64`, unlike scalar types' `value` field.
        return {"type": "blob", "base64": base64.b64encode(bytes(value)).decode("ascii")}
    return {"type": "text", "value": str(value)}


def _decode(value: dict) -> Any:
    kind = value.get("type")
    if kind == "null":
        return None
    if kind == "integer":
        return int(value["value"])
    if kind == "float":
        return float(value["value"])
    if kind == "text":
        return value["value"]
    if kind == "blob":
        # Hrana omits padding from its base64.
        raw = value["base64"]
        return base64.b64decode(raw + "=" * (-len(raw) % 4))
    raise TursoError(f"unknown value type from Turso: {kind!r}")


class Cursor:
    """The read side of one executed statement, already fully materialized.

    The pipeline endpoint returns whole result sets, so there is nothing to
    stream and `fetchmany` is just a window onto rows already in hand.
    """

    def __init__(
        self,
        columns: Sequence[str],
        rows: Sequence[tuple],
        rowcount: int,
        lastrowid: int | None,
    ) -> None:
        # DB-API shape: 7 fields per column, only the name is knowable here.
        self.description = (
            tuple((name, None, None, None, None, None, None) for name in columns)
            if columns
            else None
        )
        self.rowcount = rowcount
        self.lastrowid = lastrowid
        self._rows = list(rows)
        self._pos = 0

    def fetchall(self) -> list[tuple]:
        rest = self._rows[self._pos :]
        self._pos = len(self._rows)
        return rest

    def fetchone(self) -> tuple | None:
        if self._pos >= len(self._rows):
            return None
        row = self._rows[self._pos]
        self._pos += 1
        return row

    def fetchmany(self, size: int = 1) -> list[tuple]:
        chunk = self._rows[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk

    def __iter__(self):
        while (row := self.fetchone()) is not None:
            yield row


class Connection:
    """A remote libSQL database, reached over Hrana's HTTP pipeline.

    Not thread-safe on its own — each store already serializes its calls behind
    `libsql_gate.Gate`, and this keeps a `requests.Session` so those serialized
    calls reuse one TLS connection instead of handshaking per statement.
    """

    def __init__(self, url: str, auth_token: str | None, timeout: float = DEFAULT_TIMEOUT) -> None:
        self._endpoint = f"{_http_base(url)}/v2/pipeline"
        self._timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        if auth_token:
            self._session.headers["Authorization"] = f"Bearer {auth_token}"

    def _pipeline(self, statements: Sequence[tuple[str, Sequence[Any]]], timeout: float) -> list[Cursor]:
        requests_body = [
            {"type": "execute", "stmt": {"sql": sql, "args": [_encode(a) for a in args]}}
            for sql, args in statements
        ]
        requests_body.append({"type": "close"})

        # A read that times out, or a connection that never opened, is tried once more:
        # the shared database stalls for a few seconds now and then, and one retry turns
        # most of those stalls into a slow answer instead of an error page. A write that
        # timed out waiting for its answer is not resent — it may already have landed.
        read_only = all((sql.split(None, 1) or [""])[0].upper() in _READ_ONLY for sql, _ in statements)
        for attempt in (1, 2):
            last = attempt == 2
            try:
                response = self._session.post(
                    self._endpoint,
                    json={"requests": requests_body},
                    timeout=(CONNECT_TIMEOUT, timeout),
                )
            except (requests.ConnectionError, requests.Timeout) as exc:
                never_sent = isinstance(exc, requests.ConnectTimeout)
                if not last and (read_only or never_sent):
                    time.sleep(0.3)
                    continue
                error = TursoUnreachable(f"could not reach the database: {exc}")
                error.reconnect = isinstance(exc, requests.ConnectionError)
                raise error from exc
            except requests.RequestException as exc:
                raise TursoUnreachable(f"could not reach the database: {exc}") from exc

            status = response.status_code
            if status == 200:
                break
            # Turso's edge answers 502 "upstream forward failed" (and now and then 503 or
            # 429) for a few seconds at a time. Those never reached the database, so any
            # request may be sent again; a 500 or 504 may have run, so only a read is.
            unforwarded = status in (429, 502, 503)
            if not last and (unforwarded or (status >= 500 and read_only)):
                time.sleep(0.5)
                continue
            # 4xx is our request (bad token, malformed body); 5xx and 429 are Turso's side.
            kind = TursoUnreachable if status >= 500 or status == 429 else TursoError
            error = kind(f"database returned HTTP {status}: {response.text[:200]}")
            # A fast refusal, not a stall: one more read by the store costs little.
            error.reconnect = read_only and kind is TursoUnreachable
            raise error

        try:
            payload = response.json()
        except ValueError as exc:
            raise TursoUnreachable(f"unreadable response from the database: {exc}") from exc

        cursors: list[Cursor] = []
        for entry in payload.get("results", []):
            if entry.get("type") == "error":
                message = (entry.get("error") or {}).get("message", "unknown error")
                raise TursoError(message)
            response_body = entry.get("response") or {}
            if response_body.get("type") != "execute":
                continue
            cursors.append(_to_cursor(response_body["result"]))
        return cursors

    def execute(self, sql: str, parameters: Sequence[Any] = ()) -> Cursor:
        params = tuple(parameters)
        ddl = bool(_IDEMPOTENT_DDL.match(sql))
        info = not ddl and bool(_TABLE_INFO.match(sql))
        key = (self._endpoint, sql.strip())
        with _schema_lock:
            if ddl and key in _ddl_done:
                return Cursor((), (), 0, None)
            if info and (key + (params,)) in _table_info:
                columns, rows = _table_info[key + (params,)]
                return Cursor(columns, rows, 0, None)
        if not ddl and not info and _SCHEMA_CHANGE.match(sql):
            # The schema is changing: what was learned about it before is stale.
            with _schema_lock:
                for cached in [k for k in _table_info if k[0] == self._endpoint]:
                    del _table_info[cached]
                if sql.lstrip()[:4].upper() == "DROP":
                    _ddl_done.difference_update([k for k in _ddl_done if k[0] == self._endpoint])
        cursors = self._pipeline([(sql, params)], self._timeout)
        if not cursors:
            raise TursoError("database returned no result for the statement")
        cursor = cursors[0]
        if ddl or info:
            with _schema_lock:
                if ddl:
                    _ddl_done.add(key)
                else:
                    columns = [d[0] for d in cursor.description or ()]
                    _table_info[key + (params,)] = (columns, list(cursor._rows))
        return cursor

    def executemany(self, sql: str, seq_of_parameters: Iterable[Sequence[Any]]) -> Cursor:
        rows = [tuple(p) for p in seq_of_parameters]
        if not rows:
            return Cursor((), (), 0, None)
        # One round trip, and the stream lives for the whole of it — so unlike
        # separate statements, this batch is genuinely all-or-nothing.
        batch = [("BEGIN", ())] + [(sql, p) for p in rows] + [("COMMIT", ())]
        cursors = self._pipeline(batch, self._timeout * BATCH_TIMEOUT_MULTIPLIER)
        affected = sum(c.rowcount for c in cursors if c.rowcount > 0)
        return Cursor((), (), affected, cursors[-2].lastrowid if len(cursors) > 1 else None)

    def commit(self) -> None:
        """No-op: the pipeline endpoint closes its stream per request, so every
        statement has already committed by the time it returns."""

    def rollback(self) -> None:
        """No-op, for the same reason `commit` is."""

    def close(self) -> None:
        self._session.close()


def _to_cursor(result: dict) -> Cursor:
    columns = [col.get("name") or "" for col in result.get("cols", [])]
    rows = [tuple(_decode(value) for value in row) for row in result.get("rows", [])]
    last = result.get("last_insert_rowid")
    return Cursor(
        columns,
        rows,
        int(result.get("affected_row_count") or 0),
        int(last) if last is not None else None,
    )


def connect(database: str, auth_token: str | None = None, **_ignored: Any):
    """Opens `database`, remote or local, with a DB-API-shaped connection.

    Keeps `libsql.connect`'s signature so the stores can swap the import and
    leave their call sites alone.
    """
    if "://" in database:
        return Connection(database, auth_token)
    # Local file: sqlite3 already provides this interface. `check_same_thread`
    # is off because the stores hold one connection for the whole process and
    # reach it from FastAPI's worker threads, serialized by their gate.
    return sqlite3.connect(database, check_same_thread=False)
