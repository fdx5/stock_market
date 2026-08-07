import os
import threading
from pathlib import Path

import libsql

from app.services import libsql_gate
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same Turso-with-local-fallback shape as visitor_store.py / page_view_store.py.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "notify_stats.db"

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("notify_stats_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notify_stats_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    online_now INTEGER NOT NULL,
    total_visits INTEGER NOT NULL,
    views_24h INTEGER NOT NULL
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_notify_stats_created_at ON notify_stats_snapshots (created_at)"

# The "전일 대비" comparison only ever looks back 24h (see closest_to), so a handful of
# days of headroom is plenty to survive a missed run or two without the table growing
# unbounded — purged on the same daily timer as page_view_store/stock_search_store, see
# main.py's _admin_retention_loop.
RETENTION_DAYS = 8


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
    """Same retry-once-on-a-fresh-connection shape as visitor_store.py."""
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


def record(created_at: str, online_now: int, total_visits: int, views_24h: int) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO notify_stats_snapshots (created_at, online_now, total_visits, views_24h) "
            "VALUES (?, ?, ?, ?)",
            (created_at, online_now, total_visits, views_24h),
        )
        conn.commit()

    _with_connection(_run)


def closest_to(target_iso: str, tolerance_hours: float = 1.5) -> dict | None:
    """The snapshot nearest `target_iso` (used with target = now - 24h for the
    day-over-day comparison), or None if nothing was recorded within
    `tolerance_hours` of it — e.g. the first day this ever runs, or after a gap in
    the hourly cron longer than the tolerance window."""

    def _run(conn):
        return conn.execute(
            """
            SELECT created_at, online_now, total_visits, views_24h, diff_days FROM (
                SELECT created_at, online_now, total_visits, views_24h,
                       ABS(julianday(created_at) - julianday(?)) AS diff_days
                FROM notify_stats_snapshots
            )
            WHERE diff_days <= ?
            ORDER BY diff_days ASC
            LIMIT 1
            """,
            (target_iso, tolerance_hours / 24.0),
        ).fetchone()

    row = _with_connection(_run)
    if row is None:
        return None
    created_at, online_now, total_visits, views_24h, _diff_days = row
    return {
        "created_at": created_at,
        "online_now": online_now,
        "total_visits": total_visits,
        "views_24h": views_24h,
    }


def latest() -> dict | None:
    """The most recently recorded snapshot, regardless of age — used by kakao_notify
    to skip a run that fired too soon after the last one (e.g. both the GitHub Actions
    cron and main.py's in-process fallback landing in the same hour) rather than
    sending a duplicate KakaoTalk message."""

    def _run(conn):
        return conn.execute(
            "SELECT created_at, online_now, total_visits, views_24h "
            "FROM notify_stats_snapshots ORDER BY created_at DESC LIMIT 1"
        ).fetchone()

    row = _with_connection(_run)
    if row is None:
        return None
    created_at, online_now, total_visits, views_24h = row
    return {
        "created_at": created_at,
        "online_now": online_now,
        "total_visits": total_visits,
        "views_24h": views_24h,
    }


def purge_older_than(cutoff_iso: str) -> int:
    def _run(conn):
        cursor = conn.execute(
            "DELETE FROM notify_stats_snapshots WHERE created_at < ?", (cutoff_iso,)
        )
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)
