import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring page_view_store.py / visitor_store.py.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "stock_searches.db"

_lock = threading.Lock()
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stock_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    created_at TEXT NOT NULL
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_stock_searches_created_at ON stock_searches (created_at)"

# Same window as page_view_store.RETENTION_DAYS — purged by the same daily
# background thread (see main.py), so this table stays bounded regardless of
# traffic instead of growing forever.
RETENTION_DAYS = 30


def _connect():
    if TURSO_DATABASE_URL:
        return libsql.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return libsql.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_INDEX)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same retry-once-on-a-fresh-connection shape as page_view_store.py /
    comment_store.py — see comment_store.py's docstring for why a single
    process-wide connection (rather than one per call) is used here."""
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


def record_search(session_id: str, stock_code: str, stock_name: str, created_at: str) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO stock_searches (session_id, stock_code, stock_name, created_at) VALUES (?, ?, ?, ?)",
            (session_id, stock_code, stock_name, created_at),
        )
        conn.commit()

    _with_connection(_run)


def top_searches(since_iso: str, limit: int = 10) -> list[dict]:
    """Most-searched stocks since `since_iso`, most-searched first. Grouped by
    (code, name) together rather than code alone — a code's name is effectively
    constant, so this never splits one stock's count, but avoids a second query
    or an arbitrary MAX(name) pick to attach a display name to each code."""

    def _run(conn):
        return conn.execute(
            "SELECT stock_code, stock_name, COUNT(*) FROM stock_searches WHERE created_at >= ? "
            "GROUP BY stock_code, stock_name ORDER BY COUNT(*) DESC LIMIT ?",
            (since_iso, limit),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"code": code, "name": name, "count": count} for code, name, count in rows]


def purge_older_than(cutoff_iso: str) -> int:
    def _run(conn):
        cursor = conn.execute("DELETE FROM stock_searches WHERE created_at < ?", (cutoff_iso,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)
