import os
import threading
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same Turso-with-local-fallback shape as global_top100_rank_store.py / page_view_store.py.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "dram_prices.db"

# Bounded + breakered, so a sick Turso cannot drain the worker threadpool and
# take the whole site down with it. See services/libsql_gate.py.
_gate = libsql_gate.Gate("dram_price_store")
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS dram_prices (
    price_date TEXT NOT NULL,
    item_name TEXT NOT NULL,
    price REAL NOT NULL,
    daily_high REAL,
    daily_low REAL,
    change_pct REAL,
    -- Position in TrendForce's own table (DDR5 -> DDR4 -> DDR3), so the list renders
    -- in that order instead of alphabetically once read back from SQL.
    sort_order INTEGER NOT NULL,
    scraped_at TEXT NOT NULL,
    PRIMARY KEY (price_date, item_name)
)
"""
_INDEX = "CREATE INDEX IF NOT EXISTS idx_dram_prices_item ON dram_prices (item_name, price_date)"


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_INDEX)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same retry-once-on-a-fresh-connection shape as the other store modules — see
    comment_store.py's docstring for why a single process-wide connection (rather than
    one per call) is used here."""
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


def record_prices(price_date: str, items: list[dict], scraped_at: str) -> None:
    """Bulk-writes one day's items. INSERT OR REPLACE so a same-day re-run (a manual
    refresh after the scheduled batch already ran) overwrites rather than duplicating
    that date's rows."""

    def _run(conn):
        conn.executemany(
            "INSERT OR REPLACE INTO dram_prices "
            "(price_date, item_name, price, daily_high, daily_low, change_pct, sort_order, scraped_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    price_date,
                    it["item_name"],
                    it["price"],
                    it.get("daily_high"),
                    it.get("daily_low"),
                    it.get("change_pct"),
                    idx,
                    scraped_at,
                )
                for idx, it in enumerate(items)
            ],
        )
        conn.commit()

    _with_connection(_run)


def latest_date() -> str | None:
    def _run(conn):
        return conn.execute("SELECT MAX(price_date) FROM dram_prices").fetchone()

    row = _with_connection(_run)
    return row[0] if row and row[0] else None


def latest_snapshot() -> dict:
    """The most recently recorded day's items, in TrendForce's own table order. Empty
    items list (with `price_date` None) before the very first batch has ever run."""
    price_date = latest_date()
    if price_date is None:
        return {"price_date": None, "items": []}

    def _run(conn):
        return conn.execute(
            "SELECT item_name, price, daily_high, daily_low, change_pct "
            "FROM dram_prices WHERE price_date = ? ORDER BY sort_order",
            (price_date,),
        ).fetchall()

    rows = _with_connection(_run)
    items = [
        {
            "item_name": item_name,
            "price": price,
            "daily_high": daily_high,
            "daily_low": daily_low,
            "change_pct": change_pct,
        }
        for item_name, price, daily_high, daily_low, change_pct in rows
    ]
    return {"price_date": price_date, "items": items}


def history(item_name: str, limit_days: int = 90) -> list[dict]:
    """One item's daily prices, oldest first — the series a future trend chart draws
    once enough days have accumulated (see dram_price.py)."""

    def _run(conn):
        return conn.execute(
            "SELECT price_date, price, change_pct FROM dram_prices "
            "WHERE item_name = ? ORDER BY price_date DESC LIMIT ?",
            (item_name, limit_days),
        ).fetchall()

    rows = _with_connection(_run)
    return [
        {"price_date": price_date, "price": price, "change_pct": change_pct}
        for price_date, price, change_pct in reversed(rows)
    ]
