import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring comment_store.py so the cumulative visitor total survives
# backend restarts instead of resetting like the in-memory "currently online" count.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "visitors.db"

_lock = threading.Lock()
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS visitor_sessions (
    session_id TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return libsql.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return libsql.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Runs `fn(conn)` against a single lazily-created, process-wide connection,
    serialized behind `_lock` — opening a fresh remote Hrana connection per call was
    the previous approach, but concurrent open/close cycles from multiple request
    threads raced against each other in the libsql client's stream handling and
    surfaced as `stream not found` errors. Reusing one connection also skips the
    remote handshake on every heartbeat. If the connection turns out to be dead
    (e.g. Turso closed an idle stream server-side), drop it and retry once on a
    fresh one instead of failing the request."""
    global _conn
    with _lock:
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
