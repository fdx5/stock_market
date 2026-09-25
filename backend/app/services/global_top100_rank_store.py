import json
import os
import threading
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same Turso-with-local-fallback shape as notify_stats_store.py / visitor_store.py.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "global_top100_rank.db"

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("global_top100_rank_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS global_top100_rank (
    snapshot_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    rank INTEGER NOT NULL,
    market_cap REAL,
    PRIMARY KEY (snapshot_date, symbol)
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_global_top100_rank_date ON global_top100_rank (snapshot_date)"

# The page's last good data, kept where a restart cannot lose it. The snapshot and
# the live quotes used to live only in process memory, so every deploy served an
# empty page for the minutes a full rebuild takes, and a rebuild that failed left
# nothing at all. `key` is "snapshot" (the merged 100 rows) or "live" (the last
# quotes); a new value replaces the old one only once it has been built in full.
_STATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS global_top100_state (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""
# Per-symbol fundamentals (sector, PER, the company profile and its translation).
# They change quarterly at most, and their only source is Yahoo's crumb-guarded
# quoteSummary — refused for long stretches on the server — so each symbol keeps the
# last values that ever came back, and a failed night fills nothing with None.
_FUNDAMENTALS_SCHEMA = """
CREATE TABLE IF NOT EXISTS global_top100_fundamentals (
    symbol TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

# The only lookup this store ever does is "yesterday's rank", so a handful of days of
# headroom is plenty to survive a missed nightly refresh without the table growing
# unbounded — purged on the same daily timer as notify_stats_store, see main.py's
# _admin_retention_loop. 100 rows/day makes this table trivially small regardless.
RETENTION_DAYS = 30


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_INDEX)
    conn.execute(_STATE_SCHEMA)
    conn.execute(_FUNDAMENTALS_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same retry-once-on-a-fresh-connection shape as notify_stats_store.py."""
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


def record_snapshot(snapshot_date: str, rows: list[dict]) -> None:
    """Bulk-writes one day's {symbol, rank, market_cap} rows. INSERT OR REPLACE so a
    same-day re-run (e.g. a manual force-refresh after the nightly job already ran)
    overwrites rather than duplicating that date's rows."""

    def _run(conn):
        conn.executemany(
            "INSERT OR REPLACE INTO global_top100_rank (snapshot_date, symbol, rank, market_cap) "
            "VALUES (?, ?, ?, ?)",
            [(snapshot_date, r["symbol"], r["rank"], r.get("market_cap")) for r in rows],
        )
        conn.commit()

    _with_connection(_run)


def ranks_for_date(snapshot_date: str) -> dict[str, int]:
    def _run(conn):
        return conn.execute(
            "SELECT symbol, rank FROM global_top100_rank WHERE snapshot_date = ?", (snapshot_date,)
        ).fetchall()

    rows = _with_connection(_run)
    return {symbol: rank for symbol, rank in rows}


def latest_snapshot_date() -> str | None:
    def _run(conn):
        return conn.execute("SELECT MAX(snapshot_date) FROM global_top100_rank").fetchone()

    row = _with_connection(_run)
    return row[0] if row else None


def previous_snapshot_date(before_date: str) -> str | None:
    """The most recent recorded date strictly before `before_date` — the "yesterday"
    a fresh snapshot's ranks get compared against. None on the very first run (or after
    a gap longer than RETENTION_DAYS), which callers should read as "no rank history
    yet" rather than an error."""

    def _run(conn):
        return conn.execute(
            "SELECT MAX(snapshot_date) FROM global_top100_rank WHERE snapshot_date < ?", (before_date,)
        ).fetchone()

    row = _with_connection(_run)
    return row[0] if row and row[0] else None


def purge_older_than(cutoff_date: str) -> int:
    def _run(conn):
        cursor = conn.execute("DELETE FROM global_top100_rank WHERE snapshot_date < ?", (cutoff_date,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run)


def save_state(key: str, payload, updated_at: str) -> None:
    def _run(conn):
        conn.execute(
            "INSERT OR REPLACE INTO global_top100_state (key, payload, updated_at) VALUES (?, ?, ?)",
            (key, json.dumps(payload, ensure_ascii=False), updated_at),
        )
        conn.commit()

    _with_connection(_run)


def load_state(key: str):
    """(payload, updated_at) for `key`, or None if it was never saved."""

    def _run(conn):
        return conn.execute("SELECT payload, updated_at FROM global_top100_state WHERE key = ?", (key,)).fetchone()

    row = _with_connection(_run)
    return (json.loads(row[0]), row[1]) if row else None


def save_fundamentals(rows: dict[str, dict], updated_at: str) -> None:
    if not rows:
        return

    def _run(conn):
        conn.executemany(
            "INSERT OR REPLACE INTO global_top100_fundamentals (symbol, payload, updated_at) VALUES (?, ?, ?)",
            [(symbol, json.dumps(fields, ensure_ascii=False), updated_at) for symbol, fields in rows.items()],
        )
        conn.commit()

    _with_connection(_run)


def load_fundamentals() -> dict[str, dict]:
    def _run(conn):
        return conn.execute("SELECT symbol, payload FROM global_top100_fundamentals").fetchall()

    return {symbol: json.loads(payload) for symbol, payload in _with_connection(_run)}
