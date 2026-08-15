import os
import threading
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring visitor_store.py / comment_store.py so page-view history
# survives backend restarts.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "page_views.db"

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("page_view_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'page_view',
    referrer TEXT,
    source_channel TEXT,
    source_name TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at)"
_EVENT_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_event_created ON page_views (event_type, created_at)"
_GOAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS traffic_growth_goal (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    started_at TEXT NOT NULL,
    baseline_daily_visitors REAL NOT NULL,
    target_multiplier INTEGER NOT NULL DEFAULT 100
)
"""

# The trend chart only ever queries the last 30 days (see admin.py's pages_trend),
# so rows older than that are pure dead weight on the table — purged on a timer in
# main.py's startup thread to keep it bounded regardless of traffic volume, rather
# than growing forever.
RETENTION_DAYS = 730


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(page_views)").fetchall()}
    migrations = {
        "event_type": "TEXT NOT NULL DEFAULT 'page_view'",
        "referrer": "TEXT",
        "source_channel": "TEXT",
        "source_name": "TEXT",
        "utm_source": "TEXT",
        "utm_medium": "TEXT",
        "utm_campaign": "TEXT",
    }
    for name, definition in migrations.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE page_views ADD COLUMN {name} {definition}")
    conn.execute(_INDEX)
    conn.execute(_EVENT_INDEX)
    conn.execute(_GOAL_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same retry-once-on-a-fresh-connection shape as visitor_store.py /
    comment_store.py — see comment_store.py's docstring for why a single
    process-wide connection (rather than one per call) is used here."""
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


def record_page_view(
    session_id: str,
    path: str,
    created_at: str,
    event_type: str = "page_view",
    referrer: str | None = None,
    source_channel: str | None = None,
    source_name: str | None = None,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
) -> None:
    def _run(conn):
        conn.execute(
            "INSERT INTO page_views (session_id, path, created_at, event_type, referrer, "
            "source_channel, source_name, utm_source, utm_medium, utm_campaign) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, path, created_at, event_type, referrer, source_channel,
             source_name, utm_source, utm_medium, utm_campaign),
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


_BUCKET_FORMAT = {"minute": "%Y-%m-%dT%H:%M", "day": "%Y-%m-%d"}


def counts_by_bucket(since_iso: str, granularity: str) -> list[dict]:
    """Views per page per time bucket since `since_iso`, bucketed in KST (UTC+9) —
    `created_at` is stored in UTC, but the admin dashboard is read in Korea, so the
    bucket keys are shifted here rather than left as raw UTC (which read 9 hours
    behind Korean wall-clock time). `granularity` is "minute" or "day"."""

    fmt = _BUCKET_FORMAT[granularity]

    def _run(conn):
        return conn.execute(
            f"SELECT strftime('{fmt}', created_at, '+9 hours') AS bucket, path, COUNT(*) "
            "FROM page_views WHERE created_at >= ? GROUP BY bucket, path ORDER BY bucket",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"bucket": bucket, "path": path, "count": count} for bucket, path, count in rows]


def unique_visitors_by_bucket(since_iso: str, granularity: str) -> list[dict]:
    """Distinct sessions per time bucket since `since_iso` — the same table and KST
    bucketing counts_by_bucket uses, just COUNT(DISTINCT session_id) instead of
    COUNT(*) per (bucket, path): a page-view trend answers "how much traffic", this
    answers "how many people", and a visitor loading three pages in one bucket should
    only count once for the second question."""

    fmt = _BUCKET_FORMAT[granularity]

    def _run(conn):
        return conn.execute(
            f"SELECT strftime('{fmt}', created_at, '+9 hours') AS bucket, COUNT(DISTINCT session_id) "
            "FROM page_views WHERE created_at >= ? GROUP BY bucket ORDER BY bucket",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"bucket": bucket, "count": count} for bucket, count in rows]


def count_today(since_iso: str) -> int:
    def _run(conn):
        return conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE created_at >= ?", (since_iso,)
        ).fetchone()[0]

    return _with_connection(_run)


def purge_older_than(cutoff_iso: str) -> int:
    def _run(conn):
        cursor = conn.execute("DELETE FROM page_views WHERE created_at < ?", (cutoff_iso,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)


def growth_overview(since_iso: str, until_iso: str | None = None) -> dict:
    """Acquisition and growth metrics based only on real navigations."""
    where = "created_at >= ? AND event_type = 'page_view'"
    params: tuple[str, ...] = (since_iso,)
    if until_iso is not None:
        where += " AND created_at < ?"
        params = (since_iso, until_iso)

    def _run(conn):
        daily = conn.execute(
            "SELECT strftime('%Y-%m-%d', created_at, '+9 hours') day, "
            "COUNT(*), COUNT(DISTINCT session_id), "
            "SUM(CASE WHEN source_channel='search' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN source_channel='email' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN source_channel='social' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN source_channel='referral' THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN source_channel='direct' OR source_channel IS NULL THEN 1 ELSE 0 END) "
            f"FROM page_views WHERE {where} GROUP BY day ORDER BY day", params
        ).fetchall()
        channels = conn.execute(
            "SELECT COALESCE(source_channel, 'direct'), COUNT(*), COUNT(DISTINCT session_id) "
            f"FROM page_views WHERE {where} GROUP BY 1 ORDER BY 2 DESC", params
        ).fetchall()
        pages = conn.execute(
            "SELECT path, COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE {where} GROUP BY path ORDER BY 3 DESC, 2 DESC LIMIT 50", params
        ).fetchall()
        sources = conn.execute(
            "SELECT COALESCE(source_name, 'unknown'), COUNT(*), COUNT(DISTINCT session_id) "
            f"FROM page_views WHERE {where} AND source_channel='search' GROUP BY 1 ORDER BY 2 DESC", params
        ).fetchall()
        campaigns = conn.execute(
            "SELECT COALESCE(utm_campaign, '(미지정)'), COALESCE(utm_source, source_name, 'unknown'), "
            "COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE {where} AND (utm_campaign IS NOT NULL OR source_channel='email') "
            "GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30", params
        ).fetchall()
        return daily, channels, pages, sources, campaigns

    daily, channels, pages, sources, campaigns = _with_connection(_run)
    return {
        "daily": [{"date": r[0], "pageviews": r[1], "visitors": r[2], "search": r[3] or 0,
                   "email": r[4] or 0, "social": r[5] or 0, "referral": r[6] or 0,
                   "direct": r[7] or 0} for r in daily],
        "channels": [{"channel": r[0], "pageviews": r[1], "visitors": r[2]} for r in channels],
        "pages": [{"path": r[0], "pageviews": r[1], "visitors": r[2]} for r in pages],
        "search_sources": [{"source": r[0], "pageviews": r[1], "visitors": r[2]} for r in sources],
        "campaigns": [{"campaign": r[0], "source": r[1], "pageviews": r[2], "visitors": r[3]} for r in campaigns],
    }


def growth_goal(now_iso: str) -> dict:
    """Create the shared 100x goal once, then keep its baseline stable."""
    def _run(conn):
        row = conn.execute(
            "SELECT started_at, baseline_daily_visitors, target_multiplier FROM traffic_growth_goal WHERE id=1"
        ).fetchone()
        if row is None:
            # A non-zero baseline keeps the target meaningful on a brand-new install.
            today = now_iso[:10]
            count = conn.execute(
                "SELECT COUNT(DISTINCT session_id) FROM page_views WHERE event_type='page_view' "
                "AND strftime('%Y-%m-%d', created_at, '+9 hours')=?", (today,)
            ).fetchone()[0]
            baseline = float(max(1, count))
            conn.execute(
                "INSERT INTO traffic_growth_goal (id, started_at, baseline_daily_visitors, target_multiplier) VALUES (1, ?, ?, 100)",
                (now_iso, baseline),
            )
            conn.commit()
            return {"started_at": now_iso, "baseline_daily_visitors": baseline, "target_multiplier": 100}
        return {"started_at": row[0], "baseline_daily_visitors": row[1], "target_multiplier": row[2]}
    return _with_connection(_run)
