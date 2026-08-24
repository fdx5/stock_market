import os
import threading
from datetime import datetime, timedelta, timezone
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
    ,label TEXT
    ,stock_code TEXT
    ,stock_name TEXT
    ,object_key TEXT
    ,user_agent TEXT
    ,is_bot INTEGER NOT NULL DEFAULT 0
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at)"
_EVENT_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_event_created ON page_views (event_type, created_at)"
# Every admin-facing read carries the HUMAN predicate below, so that column leads
# the index: without it each of those queries scans the crawler rows too, and
# crawlers are the majority of the table on a busy crawl day.
_BOT_INDEX = "CREATE INDEX IF NOT EXISTS idx_page_views_human_created ON page_views (is_bot, created_at)"
_GOAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS traffic_growth_goal (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    started_at TEXT NOT NULL,
    baseline_daily_visitors REAL NOT NULL,
    target_multiplier INTEGER NOT NULL DEFAULT 100
)
"""

# One row per closed KST calendar day - a day's totals never change once that day is
# over, so growth_overview() reads this instead of re-scanning raw page_views for
# every request. Kept indefinitely (it's at most ~730 tiny rows even over the growth
# page's max range): unlike page_views itself, this table is never purged, so the
# daily trend survives raw-row retention pruning too.
_DAILY_SCHEMA = """
CREATE TABLE IF NOT EXISTS page_views_daily (
    day TEXT PRIMARY KEY,
    pageviews INTEGER NOT NULL,
    visitors INTEGER NOT NULL,
    search INTEGER NOT NULL,
    email INTEGER NOT NULL,
    social INTEGER NOT NULL,
    referral INTEGER NOT NULL,
    direct INTEGER NOT NULL,
    computed_at TEXT NOT NULL
)
"""

KST = timezone(timedelta(hours=9))

# The trend chart only ever queries the last 30 days (see admin.py's pages_trend),
# so rows older than that are pure dead weight on the table — purged on a timer in
# main.py's startup thread to keep it bounded regardless of traffic volume, rather
# than growing forever.
RETENTION_DAYS = 730

# Every read behind the admin dashboard carries this. The panels answer "how many
# people came and what did they look at", and a JS-rendering crawler answers that
# question wrongly in the most misleading direction available: it renders each URL in
# a fresh browser context, so one crawl of N pages arrives as N first-time sessions
# rather than as one busy one.
#
# Rows written before the column existed take DEFAULT 0 from the ALTER TABLE, so they
# keep counting as people until something says otherwise — right, because they are a
# month of genuine history that no User-Agent was ever recorded for, and
# scripts/backfill_bot_page_views.py is the deliberate, reviewed way to reclassify
# them rather than a silent default here. `IS NOT 1` rather than `= 0` only so a NULL
# arriving from anywhere (a hand-written row, a future migration that omits the
# default) fails toward counting a visitor rather than silently dropping one.
HUMAN = "is_bot IS NOT 1"


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
        "label": "TEXT",
        "stock_code": "TEXT",
        "stock_name": "TEXT",
        "object_key": "TEXT",
        "user_agent": "TEXT",
        "is_bot": "INTEGER NOT NULL DEFAULT 0",
    }
    added = [name for name in migrations if name not in columns]
    for name in added:
        conn.execute(f"ALTER TABLE page_views ADD COLUMN {name} {migrations[name]}")
    conn.execute(_INDEX)
    conn.execute(_EVENT_INDEX)
    conn.execute(_BOT_INDEX)
    conn.execute(_GOAL_SCHEMA)
    conn.execute(_DAILY_SCHEMA)
    # page_views_daily caches one row per closed day and is never recomputed once
    # written - which is right while the definition of a day's totals is stable, and
    # wrong exactly once: the moment bot rows stop counting toward them. Dropping the
    # cache when the is_bot column first appears makes every day recompute on next
    # request under the new definition, instead of leaving the trend chart showing
    # crawler-inflated history forever beside freshly filtered days.
    if "is_bot" in added:
        conn.execute("DELETE FROM page_views_daily")
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
    label: str | None = None,
    stock_code: str | None = None,
    stock_name: str | None = None,
    object_key: str | None = None,
    user_agent: str | None = None,
    is_bot: bool = False,
) -> None:
    """Crawler rows are written, not dropped.

    They are excluded from every figure the admin dashboard reports (see HUMAN), but
    keeping them is what makes "which crawler, how often, over which URLs" answerable
    at all — the question this column was added to answer. bot_overview() reads them.
    """
    def _run(conn):
        conn.execute(
            "INSERT INTO page_views (session_id, path, created_at, event_type, referrer, "
            "source_channel, source_name, utm_source, utm_medium, utm_campaign, label, stock_code, stock_name, object_key, "
            "user_agent, is_bot) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, path, created_at, event_type, referrer, source_channel,
             source_name, utm_source, utm_medium, utm_campaign, label, stock_code, stock_name, object_key,
             user_agent, 1 if is_bot else 0),
        )
        conn.commit()

    _with_connection(_run)


def bubble_stats(since_iso: str) -> dict:
    """Persistent interaction totals for the market-bubbles page."""
    def _run(conn):
        totals = conn.execute(
            "SELECT object_key, COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE created_at >= ? AND {HUMAN} AND path='/market-bubbles' AND event_type='click' "
            "AND object_key LIKE 'bubble:%' GROUP BY object_key ORDER BY COUNT(*) DESC",
            (since_iso,),
        ).fetchall()
        stocks = conn.execute(
            "SELECT stock_code, MAX(stock_name), COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE created_at >= ? AND {HUMAN} AND path='/market-bubbles' AND event_type='click' "
            "AND stock_code IS NOT NULL GROUP BY stock_code ORDER BY COUNT(*) DESC LIMIT 100",
            (since_iso,),
        ).fetchall()
        return totals, stocks

    totals, stocks = _with_connection(_run)
    actions: dict[str, dict] = {}
    markets: dict[str, int] = {}
    for key, count, sessions in totals:
        parts = (key or "").split(":")
        if len(parts) < 4:
            continue
        action, market = parts[1], parts[2]
        row = actions.setdefault(action, {"action": action, "count": 0, "sessions": 0})
        row["count"] += count
        row["sessions"] += sessions
        markets[market] = markets.get(market, 0) + count
    return {
        "actions": sorted(actions.values(), key=lambda row: row["count"], reverse=True),
        "markets": [{"market": key, "count": value} for key, value in sorted(markets.items(), key=lambda row: row[1], reverse=True)],
        "stocks": [{"code": code, "name": name or code, "count": count, "sessions": sessions} for code, name, count, sessions in stocks],
    }


def counts_by_page(since_iso: str) -> list[dict]:
    """Total views per page since `since_iso`, most-viewed first."""

    def _run(conn):
        return conn.execute(
            f"SELECT path, COUNT(*) FROM page_views WHERE created_at >= ? AND {HUMAN} "
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
            f"FROM page_views WHERE created_at >= ? AND {HUMAN} GROUP BY bucket, path ORDER BY bucket",
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
            f"FROM page_views WHERE created_at >= ? AND {HUMAN} GROUP BY bucket ORDER BY bucket",
            (since_iso,),
        ).fetchall()

    rows = _with_connection(_run)
    return [{"bucket": bucket, "count": count} for bucket, count in rows]


def count_today(since_iso: str) -> int:
    def _run(conn):
        return conn.execute(
            f"SELECT COUNT(*) FROM page_views WHERE created_at >= ? AND {HUMAN}", (since_iso,)
        ).fetchone()[0]

    return _with_connection(_run)


def bot_overview(since_iso: str, limit: int = 15) -> dict:
    """The other side of HUMAN: what the crawlers did, kept visible rather than hidden.

    Filtering bots out of the visitor numbers without showing them anywhere would
    trade one wrong picture for a blind spot - a crawl surge is worth knowing about
    (it is how this column came to exist), and the agent breakdown is what names the
    crawler. `agents` groups by the stored User-Agent; a row whose agent is NULL is
    one written before this instrumentation existed, or a beacon that sent no
    User-Agent header at all.
    """

    def _run(conn):
        totals = conn.execute(
            "SELECT COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            "WHERE created_at >= ? AND is_bot = 1",
            (since_iso,),
        ).fetchone()
        agents = conn.execute(
            "SELECT user_agent, COUNT(*), COUNT(DISTINCT session_id), MAX(created_at) "
            "FROM page_views WHERE created_at >= ? AND is_bot = 1 "
            "GROUP BY user_agent ORDER BY 2 DESC LIMIT ?",
            (since_iso, limit),
        ).fetchall()
        return totals, agents

    totals, agents = _with_connection(_run)
    return {
        "pageviews": (totals[0] if totals else 0) or 0,
        "sessions": (totals[1] if totals else 0) or 0,
        "agents": [
            {"user_agent": row[0] or "(미기록)", "pageviews": row[1], "sessions": row[2], "last_seen": row[3]}
            for row in agents
        ],
    }


def purge_older_than(cutoff_iso: str) -> int:
    def _run(conn):
        cursor = conn.execute("DELETE FROM page_views WHERE created_at < ?", (cutoff_iso,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)


def _kst_day_bounds(day: str) -> tuple[str, str]:
    """UTC-ISO [start, end) for one KST calendar day ('YYYY-MM-DD')."""
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=KST)
    return start.astimezone(timezone.utc).isoformat(), (start + timedelta(days=1)).astimezone(timezone.utc).isoformat()


def _to_kst_date(iso_str: str):
    parsed = datetime.fromisoformat(iso_str)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(KST).date()


def _compute_daily_row(conn, day: str) -> dict:
    """One day's totals via a raw-table scan bounded to just that day."""
    start_iso, end_iso = _kst_day_bounds(day)
    row = conn.execute(
        "SELECT COUNT(*), COUNT(DISTINCT session_id), "
        "SUM(CASE WHEN source_channel='search' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN source_channel='email' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN source_channel='social' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN source_channel='referral' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN source_channel='direct' OR source_channel IS NULL THEN 1 ELSE 0 END) "
        f"FROM page_views WHERE created_at >= ? AND created_at < ? AND event_type = 'page_view' AND {HUMAN}",
        (start_iso, end_iso),
    ).fetchone()
    return {
        "date": day, "pageviews": row[0] or 0, "visitors": row[1] or 0,
        "search": row[2] or 0, "email": row[3] or 0, "social": row[4] or 0,
        "referral": row[5] or 0, "direct": row[6] or 0,
    }


def _cache_daily_row(conn, row: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO page_views_daily "
        "(day, pageviews, visitors, search, email, social, referral, direct, computed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (row["date"], row["pageviews"], row["visitors"], row["search"], row["email"],
         row["social"], row["referral"], row["direct"], datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def _daily_rows(conn, since_date, until_date_exclusive, today) -> list[dict]:
    """The trend series for [since_date, until_date_exclusive) in KST days.

    Closed days (before `today`) are read from page_views_daily in one query, and
    only whichever of those are missing (first time that day is ever requested) fall
    back to a single-day raw scan - cached immediately after, so every day is scanned
    at most once, ever. Today is still accumulating and is always computed live,
    never cached.
    """
    closed_end = min(today, until_date_exclusive)
    result: dict[str, dict] = {}

    if since_date < closed_end:
        cached = conn.execute(
            "SELECT day, pageviews, visitors, search, email, social, referral, direct "
            "FROM page_views_daily WHERE day >= ? AND day < ? ORDER BY day",
            (since_date.isoformat(), closed_end.isoformat()),
        ).fetchall()
        for r in cached:
            result[r[0]] = {"date": r[0], "pageviews": r[1], "visitors": r[2], "search": r[3] or 0,
                             "email": r[4] or 0, "social": r[5] or 0, "referral": r[6] or 0, "direct": r[7] or 0}

        d = since_date
        while d < closed_end:
            day_str = d.isoformat()
            if day_str not in result:
                row = _compute_daily_row(conn, day_str)
                _cache_daily_row(conn, row)
                result[day_str] = row
            d += timedelta(days=1)

    if since_date <= today < until_date_exclusive:
        result[today.isoformat()] = _compute_daily_row(conn, today.isoformat())

    return [result[k] for k in sorted(result)]


def growth_overview(since_iso: str, until_iso: str | None = None) -> dict:
    """Acquisition and growth metrics based only on real navigations.

    The day-by-day trend (`daily`) is requested on every load - twice per load, once
    more for the admin panel's period-over-period comparison - so it is the one piece
    sourced from page_views_daily instead of re-scanning raw page_views for the whole
    range each time (see _daily_rows). The four breakdown queries below are only ever
    meaningful as a total over the whole selected range, not per day, so they still
    scan page_views directly.
    """
    where = f"created_at >= ? AND event_type = 'page_view' AND {HUMAN}"
    params: tuple[str, ...] = (since_iso,)
    if until_iso is not None:
        where += " AND created_at < ?"
        params = (since_iso, until_iso)

    since_date = _to_kst_date(since_iso)
    today = datetime.now(timezone.utc).astimezone(KST).date()
    until_date_exclusive = _to_kst_date(until_iso) if until_iso is not None else today + timedelta(days=1)

    def _run(conn):
        daily = _daily_rows(conn, since_date, until_date_exclusive, today)
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
        "daily": daily,
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
                f"SELECT COUNT(DISTINCT session_id) FROM page_views WHERE event_type='page_view' AND {HUMAN} "
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
