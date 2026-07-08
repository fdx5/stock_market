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
_schema_ready = False

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


def _ensure_schema(conn) -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _lock:
        conn.execute(_SCHEMA)
        conn.commit()
        _schema_ready = True


def record_and_total(session_id: str, seen_at: str) -> int:
    """Registers a session the first time it's seen and returns the cumulative
    count of distinct sessions ever recorded."""
    conn = _connect()
    _ensure_schema(conn)
    conn.execute(
        "INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)",
        (session_id, seen_at),
    )
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM visitor_sessions").fetchone()[0]
    conn.close()
    return total
