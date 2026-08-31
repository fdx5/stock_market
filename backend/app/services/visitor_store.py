import os
import threading
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring comment_store.py so the cumulative visitor total survives
# backend restarts instead of resetting like the in-memory "currently online" count.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "visitors.db"

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("visitor_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS visitor_sessions (
    session_id TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL
)
"""

_ACTIVE_SCHEMA = """
CREATE TABLE IF NOT EXISTS active_visitor_sessions (
    session_id TEXT PRIMARY KEY,
    last_seen TEXT NOT NULL
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_ACTIVE_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Runs `fn(conn)` against a single lazily-created, process-wide connection,
    serialized behind its gate — connecting per call would mean a fresh TLS handshake
    to Turso on every heartbeat, where a reused connection keeps the socket alive and
    answers in a single round trip. If the connection turns out to be dead (an idle
    keep-alive socket the far end has since dropped), drop it and retry once on a
    fresh one instead of failing the request."""
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = _new_ready_connection()
            return fn(_conn)


def record_and_total(session_id: str, seen_at: str) -> int:
    """Registers a session the first time it's seen and returns the cumulative
    count of distinct sessions ever recorded."""

    def _run(conn):
        conn.execute(
            "INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)",
            (session_id, seen_at),
        )
        conn.commit()
        return conn.execute("SELECT COUNT(*) FROM visitor_sessions").fetchone()[0]

    return _with_connection(_run)


def total_count() -> int:
    """Read-only total, for the admin dashboard — unlike record_and_total(), doesn't
    register a session of its own."""

    def _run(conn):
        return conn.execute("SELECT COUNT(*) FROM visitor_sessions").fetchone()[0]

    return _with_connection(_run)


def heartbeat_and_counts(
    session_id: str,
    seen_at: str,
    active_since: str,
    register_session: bool = True,
) -> tuple[int, int]:
    """Persist presence and return site-wide active/cumulative counts.

    Active presence must live in the shared store: an in-process dictionary is
    emptied by every deploy and sees only one instance during a rolling restart.
    """

    def _run(conn):
        if register_session:
            conn.execute(
                "INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)",
                (session_id, seen_at),
            )
        conn.execute(
            "INSERT INTO active_visitor_sessions (session_id, last_seen) VALUES (?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen",
            (session_id, seen_at),
        )
        conn.execute("DELETE FROM active_visitor_sessions WHERE last_seen < ?", (active_since,))
        conn.commit()
        current = conn.execute(
            "SELECT COUNT(*) FROM active_visitor_sessions WHERE last_seen >= ?", (active_since,)
        ).fetchone()[0]
        total = conn.execute("SELECT COUNT(*) FROM visitor_sessions").fetchone()[0]
        return current, total

    return _with_connection(_run)


def active_count(active_since: str) -> int:
    """Read the shared active-session count without registering the caller."""

    def _run(conn):
        return conn.execute(
            "SELECT COUNT(*) FROM active_visitor_sessions WHERE last_seen >= ?", (active_since,)
        ).fetchone()[0]

    return _with_connection(_run)
