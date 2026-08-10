"""Who gets a prediction mail, and for which stocks.

The mail batch started life with the watchlist and the recipient hard-coded in the
module and in the environment. That works for exactly one subscriber and one list, and
stops working the moment a second address or a per-address list is wanted — which is
what this table exists for.

## Grain

One row per (email, stock_code). Not a row per address carrying a list: the list is
the thing that gets edited, and a JSON column turns "stop sending me 현대차" into a
read-modify-write race between two callers. At this grain it is a DELETE, and the
UNIQUE constraint is what makes a double subscribe idempotent rather than a duplicate
mail.

## The address is personal data

It is stored because a mail cannot be delivered without it, and that is the only
reason. Nothing in this module logs an address in the clear, and every function that
hands data outward returns it already masked unless the caller explicitly asks for the
sending form — see `list_targets` (masked, for reports and endpoints) against
`resolve_targets` (clear, for the SMTP call). Keeping those as two functions rather
than one with a flag means a caller has to name which one it wants, and the one it
gets by reflex is the safe one.
"""

import datetime as dt
import logging
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()

logger = logging.getLogger(__name__)

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "mail_subscriptions.db"

_gate = libsql_gate.Gate("mail_subscription_store")
_conn = None
_RECONNECT_ATTEMPTS = 3
_RECONNECT_DELAY_SECONDS = 1.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mail_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (email, stock_code)
)
"""

_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_mail_subs_email ON mail_subscriptions (email)",
    "CREATE INDEX IF NOT EXISTS idx_mail_subs_active ON mail_subscriptions (active)",
)

_SELECT = "id, email, stock_code, stock_name, active, created_at, updated_at"

# Deliberately permissive: this guards against a typo or a stray shell quote reaching
# the SMTP layer, not against a hostile address. Full RFC 5322 validation rejects
# addresses that real mailboxes actually use.
_EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


class InvalidSubscription(ValueError):
    """Bad address or empty code list — raised before anything touches the table."""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def normalize_email(email: str) -> str:
    """Lowercased and trimmed, because that is what the UNIQUE constraint compares.
    Without it `A@x.com` and `a@x.com` are two subscriptions and one reader gets two
    copies of every mail."""
    cleaned = (email or "").strip().lower()
    if not _EMAIL_RE.match(cleaned):
        raise InvalidSubscription(f"메일 주소 형식이 올바르지 않습니다: {mask(cleaned)}")
    return cleaned


def mask(addr: str | None) -> str:
    """`someone@example.com` -> `s*****e@example.com`. See the module docstring."""
    if not addr or "@" not in addr:
        return "(미설정)"
    local, _, domain = addr.partition("@")
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    for statement in _INDEXES:
        conn.execute(statement)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same lazily-created, reconnect-on-dead-socket pattern as prediction_store —
    see its comment for why a single retry isn't enough against Turso's idle stream
    reclaim."""
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception as first_exc:
            try:
                _conn.close()
            except Exception:
                pass
            last_exc = first_exc
            for attempt in range(_RECONNECT_ATTEMPTS):
                if attempt:
                    time.sleep(_RECONNECT_DELAY_SECONDS)
                try:
                    _conn = _new_ready_connection()
                    return fn(_conn)
                except Exception as exc:
                    logger.warning(
                        "mail_subscription_store: reconnect %d/%d failed (%s)",
                        attempt + 1,
                        _RECONNECT_ATTEMPTS,
                        exc,
                    )
                    last_exc = exc
                    try:
                        _conn.close()
                    except Exception:
                        pass
            raise last_exc


def _row(r) -> dict:
    return {
        "id": r[0],
        "email": r[1],
        "stock_code": r[2],
        "stock_name": r[3],
        "active": bool(r[4]),
        "created_at": r[5],
        "updated_at": r[6],
    }


# ---------------------------------------------------------------------------
# writes
# ---------------------------------------------------------------------------

def subscribe(email: str, codes: list[str] | tuple[str, ...], names: dict[str, str] | None = None) -> dict:
    """Registers one address against one or more stock codes.

    Idempotent by (email, stock_code): re-subscribing an existing pair reactivates it
    and refreshes the name rather than inserting a second row, so a batch that re-runs
    its own seed list can't turn into duplicate mail.
    """
    addr = normalize_email(email)
    wanted = [c.strip().upper() if not c.strip().isdigit() else c.strip() for c in codes if c and c.strip()]
    if not wanted:
        raise InvalidSubscription("종목코드가 비어 있습니다.")
    names = names or {}
    now = _now()

    def _run(conn):
        for code in wanted:
            conn.execute(
                "INSERT INTO mail_subscriptions "
                "(email, stock_code, stock_name, active, created_at, updated_at) "
                "VALUES (?, ?, ?, 1, ?, ?) "
                "ON CONFLICT(email, stock_code) DO UPDATE SET "
                "  active = 1, "
                "  stock_name = COALESCE(excluded.stock_name, mail_subscriptions.stock_name), "
                "  updated_at = excluded.updated_at",
                (addr, code, names.get(code), now, now),
            )
        conn.commit()
        return len(wanted)

    written = _with_connection(_run)
    logger.info("mail_subscription_store: subscribed %s to %d codes", mask(addr), written)
    return {"email": mask(addr), "codes": wanted, "count": written}


def unsubscribe(email: str, codes: list[str] | tuple[str, ...] | None = None) -> dict:
    """Removes some codes for an address, or the address entirely when `codes` is None.

    A real DELETE rather than active=0: an unsubscribe that leaves the address in the
    table is not an unsubscribe, and there is nothing here worth keeping for history.
    """
    addr = normalize_email(email)

    def _run(conn):
        if codes:
            marks = ", ".join("?" for _ in codes)
            cur = conn.execute(
                f"DELETE FROM mail_subscriptions WHERE email = ? AND stock_code IN ({marks})",
                (addr, *codes),
            )
        else:
            cur = conn.execute("DELETE FROM mail_subscriptions WHERE email = ?", (addr,))
        conn.commit()
        return getattr(cur, "rowcount", 0) or 0

    removed = _with_connection(_run)
    logger.info("mail_subscription_store: removed %d rows for %s", removed, mask(addr))
    return {"email": mask(addr), "removed": removed}


def set_active(email: str, active: bool) -> dict:
    """Pauses or resumes every subscription for one address without losing the list."""
    addr = normalize_email(email)

    def _run(conn):
        cur = conn.execute(
            "UPDATE mail_subscriptions SET active = ?, updated_at = ? WHERE email = ?",
            (1 if active else 0, _now(), addr),
        )
        conn.commit()
        return getattr(cur, "rowcount", 0) or 0

    changed = _with_connection(_run)
    return {"email": mask(addr), "active": active, "changed": changed}


# ---------------------------------------------------------------------------
# reads
# ---------------------------------------------------------------------------

def resolve_targets(active_only: bool = True) -> dict[str, list[str]]:
    """{address in the clear: [stock codes]} — the sending form.

    The only function here that returns a readable address, and it exists solely to be
    handed to the SMTP layer. Anything that renders, logs or serves the result wants
    `list_targets` instead.
    """
    def _run(conn):
        sql = f"SELECT {_SELECT} FROM mail_subscriptions"
        if active_only:
            sql += " WHERE active = 1"
        return conn.execute(sql + " ORDER BY email, stock_code").fetchall()

    out: dict[str, list[str]] = {}
    for raw in _with_connection(_run):
        row = _row(raw)
        out.setdefault(row["email"], []).append(row["stock_code"])
    return out


def list_targets(active_only: bool = False) -> list[dict]:
    """The same picture with every address masked — for CLI output, admin views and
    anything else a person or a log will read."""
    def _run(conn):
        sql = f"SELECT {_SELECT} FROM mail_subscriptions"
        if active_only:
            sql += " WHERE active = 1"
        return conn.execute(sql + " ORDER BY email, stock_code").fetchall()

    grouped: dict[str, dict] = {}
    for raw in _with_connection(_run):
        row = _row(raw)
        entry = grouped.setdefault(
            row["email"],
            {"email": mask(row["email"]), "active": row["active"], "stocks": []},
        )
        entry["stocks"].append(
            {"code": row["stock_code"], "name": row["stock_name"], "active": row["active"]}
        )
        entry["active"] = entry["active"] or row["active"]
    return list(grouped.values())


def count() -> int:
    def _run(conn):
        return conn.execute("SELECT COUNT(*) FROM mail_subscriptions").fetchone()[0]

    return int(_with_connection(_run))
