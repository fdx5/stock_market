import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring visitor_store.py / comment_store.py so page-view history
# survives backend restarts.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "page_views.db"

_lock = threading.Lock()
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at)"


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
    """Same retry-once-on-a-fresh-connection shape as visitor_store.py /
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


def record_page_view(session_id: str, path: str, created_at: str) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO page_views (session_id, path, created_at) VALUES (?, ?, ?)",
            (session_id, path, created_at),
        )
        conn.commit()

    _with_connection(_run)


def counts_by_page(since_iso: str) -> list[dict]:
    """Total views per page since `since_iso`, most-viewed first."""

    def _run(conn):
        return conn.execute(
            "SELECT path, COUNT(*) FROM page_views WHERE created_at >= ? "
            "GROUP BY path ORDER BY COUNT(*) DESC",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"path": path, "count": count} for path, count in rows]


def counts_by_bucket(since_iso: str, bucket_chars: int) -> list[dict]:
    """Views per page per time bucket since `since_iso`. `bucket_chars` slices the
    ISO timestamp to bucket by hour (13 -> "...T12") or by day (10 -> "...12-25")."""

    def _run(conn):
        return conn.execute(
            f"SELECT substr(created_at, 1, {bucket_chars}) AS bucket, path, COUNT(*) "
            "FROM page_views WHERE created_at >= ? GROUP BY bucket, path ORDER BY bucket",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"bucket": bucket, "path": path, "count": count} for bucket, path, count in rows]


def count_today(since_iso: str) -> int:
    def _run(conn):
        return conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE created_at >= ?", (since_iso,)
        ).fetchone()[0]

    return _with_connection(_run)
