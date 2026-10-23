import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
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

# Turso bills every row a statement scans. COUNT(*) over visitor_sessions (tens of
# thousands of rows) on every 20-second heartbeat of every open tab was the bulk of
# the database's reads. The cumulative total is now the stored total through
# yesterday (one row of visitor_totals_daily) plus today's new sessions; today's
# count is advanced in memory by each inserted session and re-counted from the
# first_seen index only every TODAY_RECOUNT_SECONDS. The small active-presence count
# and its expiry run at most every few seconds.
KST = timezone(timedelta(hours=9))
TODAY_RECOUNT_SECONDS = 600
ACTIVE_RECOUNT_SECONDS = 15
EXPIRE_SECONDS = 60
_cache_lock = threading.Lock()
_base_day: str | None = None   # KST day the cached base belongs to
_base = 0                      # cumulative sessions before that day
_today: int | None = None
_today_at = 0.0
_active: int | None = None
_active_at = 0.0
_expired_at = 0.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS visitor_sessions (
    session_id TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL
)
"""

# Additive: cumulative distinct sessions through the end of each KST day, written once
# per day (INSERT OR IGNORE, never updated), plus an index so today's new sessions are
# counted from today's rows only.
_DAILY_SCHEMA = """
CREATE TABLE IF NOT EXISTS visitor_totals_daily (
    day TEXT PRIMARY KEY,
    cumulative INTEGER NOT NULL
)
"""
_FIRST_SEEN_INDEX = "CREATE INDEX IF NOT EXISTS idx_visitor_sessions_first_seen ON visitor_sessions (first_seen)"

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
    conn.execute(_DAILY_SCHEMA)
    conn.execute(_FIRST_SEEN_INDEX)
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


def _day_start(day: date) -> str:
    """UTC ISO bound of a KST day, in the same format first_seen is written."""
    return datetime(day.year, day.month, day.day, tzinfo=KST).astimezone(timezone.utc).isoformat()


def _base_before(conn, today: date) -> int:
    """Cumulative sessions before `today` (KST), from the daily aggregate.

    Reads one aggregate row when yesterday's is stored. Otherwise it extends the
    latest stored day with the days in between (index range), or — once, before any
    aggregate exists — counts everything before today, and stores yesterday's row.
    """
    yesterday = today - timedelta(days=1)
    row = conn.execute("SELECT cumulative FROM visitor_totals_daily WHERE day = ?", (yesterday.isoformat(),)).fetchone()
    if row:
        return int(row[0])
    latest = conn.execute(
        "SELECT day, cumulative FROM visitor_totals_daily WHERE day < ? ORDER BY day DESC LIMIT 1", (yesterday.isoformat(),)
    ).fetchone()
    if latest:
        since = date.fromisoformat(latest[0]) + timedelta(days=1)
        base = int(latest[1]) + conn.execute(
            "SELECT COUNT(*) FROM visitor_sessions WHERE first_seen >= ? AND first_seen < ?", (_day_start(since), _day_start(today))
        ).fetchone()[0]
    else:
        base = conn.execute("SELECT COUNT(*) FROM visitor_sessions WHERE first_seen < ?", (_day_start(today),)).fetchone()[0]
    conn.execute("INSERT OR IGNORE INTO visitor_totals_daily (day, cumulative) VALUES (?, ?)", (yesterday.isoformat(), base))
    conn.commit()
    return base


def _cached_total(conn) -> int:
    """Stored total through yesterday + today's new sessions."""
    global _base_day, _base, _today, _today_at
    now = time.monotonic()
    today = datetime.now(KST).date()
    with _cache_lock:
        fresh_day = _base_day == today.isoformat()
        if fresh_day and _today is not None and now - _today_at < TODAY_RECOUNT_SECONDS:
            return _base + _today
    base = _base if fresh_day else _base_before(conn, today)
    count = conn.execute("SELECT COUNT(*) FROM visitor_sessions WHERE first_seen >= ?", (_day_start(today),)).fetchone()[0]
    with _cache_lock:
        _base_day, _base, _today, _today_at = today.isoformat(), base, count, now
    return base + count


def _register(conn, session_id: str, seen_at: str) -> None:
    cursor = conn.execute(
        "INSERT OR IGNORE INTO visitor_sessions (session_id, first_seen) VALUES (?, ?)",
        (session_id, seen_at),
    )
    global _today
    if getattr(cursor, "rowcount", 0) == 1:
        with _cache_lock:
            if _today is not None and _base_day == datetime.now(KST).date().isoformat():
                _today += 1


def record_and_total(session_id: str, seen_at: str) -> int:
    """Registers a session the first time it's seen and returns the cumulative
    count of distinct sessions ever recorded."""

    def _run(conn):
        _register(conn, session_id, seen_at)
        conn.commit()
        return _cached_total(conn)

    return _with_connection(_run)


def total_count() -> int:
    """Read-only total, for the admin dashboard — unlike record_and_total(), doesn't
    register a session of its own."""

    return _with_connection(_cached_total)


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
        global _active, _active_at, _expired_at
        if register_session:
            _register(conn, session_id, seen_at)
        conn.execute(
            "INSERT INTO active_visitor_sessions (session_id, last_seen) VALUES (?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen",
            (session_id, seen_at),
        )
        now = time.monotonic()
        # Existing presence expiry, now run at most once a minute instead of per heartbeat.
        if now - _expired_at >= EXPIRE_SECONDS:
            conn.execute("DELETE FROM active_visitor_sessions WHERE last_seen < ?", (active_since,))
            _expired_at = now
        conn.commit()
        with _cache_lock:
            current = _active if _active is not None and now - _active_at < ACTIVE_RECOUNT_SECONDS else None
        if current is None:
            current = conn.execute(
                "SELECT COUNT(*) FROM active_visitor_sessions WHERE last_seen >= ?", (active_since,)
            ).fetchone()[0]
            with _cache_lock:
                _active, _active_at = current, now
        return current, _cached_total(conn)

    return _with_connection(_run)


def active_count(active_since: str) -> int:
    """Read the shared active-session count without registering the caller."""

    def _run(conn):
        global _active, _active_at
        now = time.monotonic()
        with _cache_lock:
            if _active is not None and now - _active_at < ACTIVE_RECOUNT_SECONDS:
                return _active
        current = conn.execute(
            "SELECT COUNT(*) FROM active_visitor_sessions WHERE last_seen >= ?", (active_since,)
        ).fetchone()[0]
        with _cache_lock:
            _active, _active_at = current, now
        return current

    return _with_connection(_run)
