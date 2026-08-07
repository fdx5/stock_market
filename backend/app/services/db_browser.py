"""Read-only schema/query access behind the admin dashboard's DB 조회 page.

Everything here is deliberately one-way: the console exists to *look at* what the app
has stored, so the only statements it will run are a single SELECT (or a WITH ... SELECT).
That guard lives in `assert_read_only` and is not decoration. The transport does reject
"SELECT 1; DROP TABLE x" on its own — both Hrana and sqlite3 refuse more than one
statement per execute — but a single destructive statement is still just a statement to
them, so this is the only layer that distinguishes looking from mutating.

Connections mirror the stores (page_view_store, comment_store, ...): one Turso database
when TURSO_DATABASE_URL is set, otherwise the local .db files those stores fall back to.
On Turso every table lives in one database, so there is a single source; locally each
store keeps its own file, so each file is offered as its own source.
"""

import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

LOCAL_STORE_DIR = Path(__file__).resolve().parent.parent / "data" / "store"

TURSO_SOURCE_ID = "turso"

# Caps on a single result page. The grid is for eyeballing data, not for pulling a table
# down whole — and an unbounded SELECT * against a Turso table would be paid for twice,
# once in egress and once in the browser trying to render it.
DEFAULT_ROW_LIMIT = 200
MAX_ROW_LIMIT = 2000

# A single cell is sent in full so the row-detail popup has something to show, but a
# runaway BLOB/JSON column would otherwise dominate the response.
MAX_CELL_CHARS = 100_000

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("db_browser")
_connections: dict[str, object] = {}


class QueryError(Exception):
    """A query the console refuses to run, phrased for the admin reading it."""


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------


def _local_sources() -> list[dict]:
    if not LOCAL_STORE_DIR.exists():
        return []
    return [
        {"id": path.stem, "label": path.name, "kind": "local"}
        for path in sorted(LOCAL_STORE_DIR.glob("*.db"))
    ]


def list_sources() -> list[dict]:
    if TURSO_DATABASE_URL:
        host = urlparse(TURSO_DATABASE_URL).hostname or "Turso"
        return [{"id": TURSO_SOURCE_ID, "label": host, "kind": "turso"}]
    return _local_sources()


def _source_or_raise(source_id: str | None) -> dict:
    sources = list_sources()
    if not sources:
        raise QueryError("조회할 수 있는 데이터베이스가 없습니다.")
    if source_id is None:
        return sources[0]
    for source in sources:
        if source["id"] == source_id:
            return source
    raise QueryError(f"알 수 없는 데이터베이스입니다: {source_id}")


def _open(source: dict):
    if source["kind"] == "turso":
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    return turso.connect(database=str(LOCAL_STORE_DIR / f"{source['id']}.db"))


def _with_connection(source: dict, fn):
    """Same one-connection-per-target, retry-once-on-a-fresh-one shape the stores use
    (see comment_store._with_connection for why the connection is reused rather than
    reopened per call)."""
    source_id = source["id"]
    with _gate.hold():
        conn = _connections.get(source_id)
        if conn is None:
            conn = _connections[source_id] = _open(source)
        try:
            return fn(conn)
        except QueryError:
            # The query itself was bad — the connection is fine, and retrying would
            # just raise the same thing again on a needlessly reopened connection.
            raise
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            conn = _connections[source_id] = _open(source)
            return fn(conn)


# ---------------------------------------------------------------------------
# read-only guard
# ---------------------------------------------------------------------------

# Anything that writes, changes the schema, reaches another file, or opens a transaction.
# PRAGMA is here too: some pragmas are harmless, others rewrite the database, and telling
# them apart is not worth it when the console has no reason to run any of them.
#
# Deliberately absent: END and REPLACE, which are ordinary parts of a SELECT (CASE ... END,
# REPLACE(text, a, b)) and would reject valid queries; RENAME and the GRANT/REVOKE family,
# which can only follow a keyword that is already blocked. Anything that can merely *begin*
# a statement needs no entry here either — the first-keyword check below already stops it.
_FORBIDDEN_KEYWORDS = {
    "ALTER", "ANALYZE", "ATTACH", "BEGIN", "COMMIT", "CREATE", "DELETE", "DETACH",
    "DROP", "INSERT", "PRAGMA", "REINDEX", "ROLLBACK", "SAVEPOINT", "TRIGGER",
    "TRUNCATE", "UPDATE", "VACUUM",
}

_ALLOWED_FIRST_KEYWORDS = {"SELECT", "WITH"}


def _blank_literals_and_comments(sql: str) -> str:
    """Replaces string literals, quoted identifiers and comments with a space, so the
    checks below read only actual SQL syntax. Without this a value like 'delete me' or
    a `-- ; drop` comment would either trip the guard or slip a statement past it."""
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            while i < n:
                if sql[i] == quote:
                    if i + 1 < n and sql[i + 1] == quote:  # '' escapes a quote
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            out.append(" ")
            continue
        if ch == "[":  # SQLite's bracketed identifier form
            while i < n and sql[i] != "]":
                i += 1
            i += 1
            out.append(" ")
            continue
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            while i < n and sql[i] != "\n":
                i += 1
            out.append(" ")
            continue
        if ch == "/" and i + 1 < n and sql[i + 1] == "*":
            i += 2
            while i + 1 < n and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i += 2
            out.append(" ")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def assert_read_only(sql: str) -> None:
    """Raises QueryError unless `sql` is exactly one SELECT/WITH statement.

    Three separate checks, because each one alone has a hole: the leading-keyword check
    misses "WITH x AS (...) DELETE ...", the keyword scan misses a second statement made
    entirely of allowed words, and the semicolon check misses a bare "DROP TABLE x".
    """
    stripped = _blank_literals_and_comments(sql).strip()
    if not stripped:
        raise QueryError("실행할 SQL을 입력해 주세요.")

    body = stripped.rstrip().rstrip(";").rstrip()
    if ";" in body:
        raise QueryError("한 번에 하나의 SELECT 문만 실행할 수 있습니다.")

    words = re.findall(r"[A-Za-z_]+", body)
    if not words:
        raise QueryError("실행할 SQL을 입력해 주세요.")

    first = words[0].upper()
    if first not in _ALLOWED_FIRST_KEYWORDS:
        raise QueryError(f"조회 전용 콘솔입니다. SELECT 문만 실행할 수 있습니다. (입력: {first})")

    for word in words:
        upper = word.upper()
        if upper in _FORBIDDEN_KEYWORDS:
            raise QueryError(f"조회 전용 콘솔에서는 사용할 수 없는 키워드입니다: {upper}")


# ---------------------------------------------------------------------------
# schema
# ---------------------------------------------------------------------------

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _quote_identifier(name: str) -> str:
    if not _IDENTIFIER_RE.match(name):
        raise QueryError(f"사용할 수 없는 테이블명입니다: {name}")
    return f'"{name}"'


def list_tables(source_id: str | None = None) -> list[dict]:
    """Every table and view in the source, with its row count and column count.

    Row counts are per-table COUNT(*) queries; a table whose count fails (a view over a
    missing table, say) still shows up with `rows: None` rather than failing the whole
    listing — a broken object is exactly the kind of thing this page should surface.
    """
    source = _source_or_raise(source_id)

    def _run(conn):
        objects = conn.execute(
            "SELECT name, type, sql FROM sqlite_master "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type, name"
        ).fetchall()
        result = []
        for name, obj_type, ddl in objects:
            try:
                columns = conn.execute(f"PRAGMA table_info({_quote_identifier(name)})").fetchall()
                column_count = len(columns)
            except Exception:
                column_count = 0
            try:
                rows = conn.execute(f"SELECT COUNT(*) FROM {_quote_identifier(name)}").fetchone()[0]
            except Exception:
                rows = None
            result.append(
                {
                    "name": name,
                    "type": obj_type,
                    "rows": rows,
                    "columns": column_count,
                    "ddl": ddl,
                }
            )
        return result

    return _with_connection(source, _run)


def table_columns(table: str, source_id: str | None = None) -> list[dict]:
    source = _source_or_raise(source_id)
    quoted = _quote_identifier(table)

    def _run(conn):
        rows = conn.execute(f"PRAGMA table_info({quoted})").fetchall()
        return [
            {
                "name": row[1],
                "type": row[2] or "",
                "not_null": bool(row[3]),
                "default": row[4],
                "primary_key": bool(row[5]),
            }
            for row in rows
        ]

    return _with_connection(source, _run)


# Column names that stand in for insertion order when the table has no integer key —
# checked in this order, so an explicit creation timestamp wins over a generic one.
_TIMESTAMP_COLUMN_PREFERENCE = (
    "created_at", "createdat", "created", "inserted_at", "recorded_at",
    "collected_at", "updated_at", "timestamp", "datetime", "date", "ts",
)


def default_query(table: str, source_id: str | None = None, limit: int = DEFAULT_ROW_LIMIT) -> str:
    """The query a double-click on a table runs: newest row first.

    "입력순 DESC" has no single answer in SQLite, so this picks the best available proxy —
    an INTEGER PRIMARY KEY (which *is* the rowid, and therefore insertion order), else a
    timestamp-looking column, else the implicit rowid. A WITHOUT ROWID table with neither
    has no insertion order to sort by at all, and gets an unordered query.
    """
    source = _source_or_raise(source_id)
    quoted = _quote_identifier(table)
    limit = max(1, min(limit, MAX_ROW_LIMIT))

    def _run(conn):
        info = conn.execute(f"PRAGMA table_info({quoted})").fetchall()
        row = conn.execute(
            "SELECT type, sql FROM sqlite_master WHERE name = ?", (table,)
        ).fetchone()
        return info, (row[0] if row else "table"), (row[1] or "" if row else "")

    info, obj_type, ddl = _with_connection(source, _run)

    order_by: str | None = None
    for column in info:
        name, decl_type, is_pk = column[1], (column[2] or "").upper(), column[5]
        if is_pk and decl_type == "INTEGER":
            order_by = f'"{name}" DESC'
            break
    if order_by is None:
        lowered = {column[1].lower(): column[1] for column in info}
        for candidate in _TIMESTAMP_COLUMN_PREFERENCE:
            if candidate in lowered:
                order_by = f'"{lowered[candidate]}" DESC'
                break
    if order_by is None and obj_type == "table" and "WITHOUT ROWID" not in ddl.upper():
        order_by = "rowid DESC"

    clause = f"\nORDER BY {order_by}" if order_by else ""
    return f"SELECT *\nFROM {quoted}{clause}\nLIMIT {limit};"


# ---------------------------------------------------------------------------
# query execution
# ---------------------------------------------------------------------------


def _serialize(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<BLOB {len(bytes(value))} bytes>"
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[:MAX_CELL_CHARS] + f"... (총 {len(value):,}자, 잘림)"
    return value


def run_query(sql: str, source_id: str | None = None, limit: int = DEFAULT_ROW_LIMIT) -> dict:
    """Runs one validated SELECT and returns at most `limit` rows.

    One extra row is fetched beyond the limit purely to tell "exactly this many" from
    "there is more" — the grid says so rather than silently implying the table ends there.
    """
    source = _source_or_raise(source_id)
    assert_read_only(sql)
    limit = max(1, min(limit, MAX_ROW_LIMIT))

    def _run(conn):
        started = time.perf_counter()
        cursor = conn.execute(sql)
        fetched = cursor.fetchmany(limit + 1)
        elapsed_ms = (time.perf_counter() - started) * 1000
        columns = [d[0] for d in (cursor.description or [])]
        return columns, fetched, elapsed_ms

    try:
        columns, fetched, elapsed_ms = _with_connection(source, _run)
    except QueryError:
        raise
    except Exception as exc:
        # SQLite's own message ("no such column: foo") is the most useful thing we can
        # put in front of someone writing SQL, so it is passed through rather than
        # flattened into a generic failure.
        raise QueryError(str(exc)) from exc

    truncated = len(fetched) > limit
    rows = [[_serialize(value) for value in row] for row in fetched[:limit]]
    return {
        "source": source["id"],
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "truncated": truncated,
        "limit": limit,
        "elapsed_ms": round(elapsed_ms, 1),
        "sql": sql,
    }
