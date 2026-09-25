"""Persistent cache of MOLIT apartment trade months, one row per (시군구, 계약년월).

A month of one 시군구's trades is what the 국토교통부 실거래가 API returns for one
LAWD_CD + DEAL_YMD query, so that is the unit stored. Rows are gzip-compressed JSON,
because the page needs two years of every district it shows and the raw XML would be
tens of megabytes per region. Same Turso-with-local-fallback shape as
dram_price_store.py.
"""

import base64
import gzip
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()

# The 부동산 data can live in a database of its own (REALESTATE_TURSO_*): its months
# are large and its collectors busy, and on the database the rest of the site shares
# they slow everything else's queries. Unset, it shares that database.
TURSO_DATABASE_URL = os.environ.get("REALESTATE_TURSO_DATABASE_URL") or os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = (
    os.environ.get("REALESTATE_TURSO_AUTH_TOKEN")
    if os.environ.get("REALESTATE_TURSO_DATABASE_URL")
    else os.environ.get("TURSO_AUTH_TOKEN")
)
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "realestate.db"

_gate = libsql_gate.Gate("realestate_store")
_conn = None
# A second connection for what a reader's complex card waits on — a district's older
# sales and its leases. The first is shared by the collector, the map builder and the
# region summaries, and a card queued behind them timed out at the gate.
_card_gate = libsql_gate.Gate("realestate_store_cards")
_card_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS re_trade_months (
    lawd_cd TEXT NOT NULL,
    deal_ym TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    deal_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (lawd_cd, deal_ym)
)
"""

# 공동주택관리정보 lookups (a 시군구's 단지 list, one 단지's 세대수·주차), JSON as fetched.
_FACTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS re_complex_facts (
    key TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    payload TEXT NOT NULL
)
"""

# Finished 시·도 maps (the /map response), so a restart answers the large regions at
# once instead of re-reading every district first. gzip + base64 JSON.
_MAP_SCHEMA = """
CREATE TABLE IF NOT EXISTS re_map_cache (
    key TEXT PRIMARY KEY,
    built_at TEXT NOT NULL,
    payload TEXT NOT NULL
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
    conn.execute(_FACTS_SCHEMA)
    conn.execute(_MAP_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
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


def _with_card_connection(fn):
    """_with_connection on the cards' own connection."""
    global _card_conn
    with _card_gate.hold():
        if _card_conn is None:
            _card_conn = _new_ready_connection()
        try:
            return fn(_card_conn)
        except Exception:
            try:
                _card_conn.close()
            except Exception:
                pass
            _card_conn = _new_ready_connection()
            return fn(_card_conn)


def _pack(deals: list) -> str:
    raw = json.dumps(deals, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(gzip.compress(raw, compresslevel=6)).decode("ascii")


def _unpack(payload: str) -> list:
    return json.loads(gzip.decompress(base64.b64decode(payload)).decode("utf-8"))


def save_month(lawd_cd: str, deal_ym: str, deals: list, fetched_at: str) -> None:
    payload = _pack(deals)

    def _run(conn):
        conn.execute(
            "INSERT OR REPLACE INTO re_trade_months (lawd_cd, deal_ym, fetched_at, deal_count, payload) "
            "VALUES (?, ?, ?, ?, ?)",
            (lawd_cd, deal_ym, fetched_at, len(deals), payload),
        )
        conn.commit()

    _with_connection(_run)


def load_district(lawd_cd: str, since: str = "", before: str = "") -> dict[str, tuple[str, list]]:
    """Stored months of one 시군구: {deal_ym: (fetched_at, deals)}. `since` keeps the
    months from it on (what the maps read), `before` the months before it (the older
    history a complex's card reads); both empty is every month."""

    def _run(conn):
        cur = conn.execute(
            "SELECT deal_ym, fetched_at, payload FROM re_trade_months WHERE lawd_cd = ? AND deal_ym >= ? "
            "AND (? = '' OR deal_ym < ?)",
            (lawd_cd, since, before, before),
        )
        return cur.fetchall()

    out: dict[str, tuple[str, list]] = {}
    for deal_ym, fetched_at, payload in (_with_card_connection if before else _with_connection)(_run):
        try:
            out[str(deal_ym)] = (str(fetched_at), _unpack(payload))
        except Exception:
            continue
    return out


def fetched_index() -> dict[tuple[str, str], str]:
    """(lawd_cd, deal_ym) -> fetched_at for every stored month, without the payloads —
    what the collector reads to decide what is missing or stale."""

    def _run(conn):
        return conn.execute("SELECT lawd_cd, deal_ym, fetched_at FROM re_trade_months").fetchall()

    return {(str(a), str(b)): str(c) for a, b, c in _with_connection(_run)}


def save_facts(key: str, payload, fetched_at: str) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def _run(conn):
        conn.execute(
            "INSERT OR REPLACE INTO re_complex_facts (key, fetched_at, payload) VALUES (?, ?, ?)",
            (key, fetched_at, body),
        )
        conn.commit()

    _with_connection(_run)


def load_facts(key: str) -> tuple[str, object] | None:
    """(fetched_at, payload) of one stored lookup, or None."""

    def _run(conn):
        return conn.execute("SELECT fetched_at, payload FROM re_complex_facts WHERE key = ?", (key,)).fetchall()

    rows = _with_connection(_run)
    if not rows:
        return None
    try:
        return str(rows[0][0]), json.loads(rows[0][1])
    except Exception:
        return None


LOAD_BATCH = 8


def load_call_count(api: str, day: str) -> int:
    """Today's API calls as last saved — so a restart does not start the day at zero."""

    def _run(conn):
        conn.execute(_META_SCHEMA)
        return conn.execute("SELECT value FROM re_meta WHERE key = ?", (f"calls:{api}:{day}",)).fetchall()

    rows = _with_connection(_run)
    try:
        return int(rows[0][0]) if rows else 0
    except (TypeError, ValueError):
        return 0


def save_call_count(api: str, day: str, count: int) -> None:
    def _run(conn):
        conn.execute(_META_SCHEMA)
        conn.execute("INSERT OR REPLACE INTO re_meta (key, value) VALUES (?, ?)", (f"calls:{api}:{day}", str(count)))
        conn.commit()

    _with_connection(_run)


def load_districts(lawd_cds: list[str], since: str = "") -> dict[str, dict[str, tuple[str, list]]]:
    """Every stored month of several 시군구 in one query: {lawd_cd: {deal_ym:
    (fetched_at, deals)}}. A 시·도 map needs dozens of districts, and one round trip
    to the store is several times faster than one per district."""
    out: dict[str, dict[str, tuple[str, list]]] = {code: {} for code in lawd_cds}
    rows = []
    # A few districts per query: the whole of 경기도 at once is ~5 MB, past the
    # client's read timeout.
    for i in range(0, len(lawd_cds), LOAD_BATCH):
        chunk = list(lawd_cds[i : i + LOAD_BATCH])

        def _run(conn, chunk=chunk):
            marks = ",".join("?" * len(chunk))
            cur = conn.execute(
                f"SELECT lawd_cd, deal_ym, fetched_at, payload FROM re_trade_months "
                f"WHERE lawd_cd IN ({marks}) AND deal_ym >= ?",
                [*chunk, since],
            )
            return cur.fetchall()

        rows.extend(_with_connection(_run))
    for lawd_cd, deal_ym, fetched_at, payload in rows:
        try:
            out[str(lawd_cd)][str(deal_ym)] = (str(fetched_at), _unpack(payload))
        except Exception:
            continue
    return out


def save_map(key: str, body: str, built_at: str) -> None:
    """A finished map, as the JSON text it is served as."""
    payload = base64.b64encode(gzip.compress(body.encode("utf-8"), compresslevel=6)).decode("ascii")

    def _run(conn):
        conn.execute(
            "INSERT OR REPLACE INTO re_map_cache (key, built_at, payload) VALUES (?, ?, ?)",
            (key, built_at, payload),
        )
        conn.commit()

    _with_connection(_run)


def load_map(key: str) -> tuple[str, str] | None:
    """(built_at, JSON text) of a stored map, or None."""

    def _run(conn):
        return conn.execute("SELECT built_at, payload FROM re_map_cache WHERE key = ?", (key,)).fetchall()

    rows = _with_connection(_run)
    if not rows:
        return None
    try:
        return str(rows[0][0]), gzip.decompress(base64.b64decode(rows[0][1])).decode("utf-8")
    except Exception:
        return None


# ── 전월세 (apartment leases), one row per (시군구, 계약년월), like the sales ──────

_RENT_SCHEMA = """
CREATE TABLE IF NOT EXISTS re_rent_months (
    lawd_cd TEXT NOT NULL,
    deal_ym TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    deal_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (lawd_cd, deal_ym)
)
"""


def save_rent_month(lawd_cd: str, deal_ym: str, deals: list, fetched_at: str) -> None:
    payload = _pack(deals)

    def _run(conn):
        conn.execute(_RENT_SCHEMA)
        conn.execute(
            "INSERT OR REPLACE INTO re_rent_months (lawd_cd, deal_ym, fetched_at, deal_count, payload) "
            "VALUES (?, ?, ?, ?, ?)",
            (lawd_cd, deal_ym, fetched_at, len(deals), payload),
        )
        conn.commit()

    _with_card_connection(_run)


def load_rent_district(lawd_cd: str, since: str = "") -> dict[str, tuple[str, list]]:
    """Stored lease months of one 시군구 from `since` on: {deal_ym: (fetched_at, deals)}."""

    def _run(conn):
        conn.execute(_RENT_SCHEMA)
        cur = conn.execute(
            "SELECT deal_ym, fetched_at, payload FROM re_rent_months WHERE lawd_cd = ? AND deal_ym >= ?",
            (lawd_cd, since),
        )
        return cur.fetchall()

    out: dict[str, tuple[str, list]] = {}
    for deal_ym, fetched_at, payload in _with_card_connection(_run):
        try:
            out[str(deal_ym)] = (str(fetched_at), _unpack(payload))
        except Exception:
            continue
    return out


# ── moving the 부동산 data to a database of its own ─────────────────────────────
#
# With REALESTATE_TURSO_DATABASE_URL set, the tables above live in that database. Its
# first start finds it empty, so the rows are copied over from the shared database
# (still TURSO_DATABASE_URL) in the background — oldest rowid first, a few at a time,
# INSERT OR IGNORE so anything the new database already holds is kept — and marked
# done in re_meta. Until then `migrated` stays unset, and the collectors, the map
# builder and the summaries wait on it instead of refilling an empty database from the
# API.

import datetime as _dt
import threading as _threading
import time as _time

SHARED_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
SHARED_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
SEPARATE = bool(os.environ.get("REALESTATE_TURSO_DATABASE_URL")) and os.environ.get(
    "REALESTATE_TURSO_DATABASE_URL"
) != SHARED_DATABASE_URL

migrated = _threading.Event()
if not SEPARATE:
    migrated.set()

migration_state: dict = {"needed": SEPARATE, "running": False, "table": None, "rows": 0, "done": not SEPARATE, "error": None}

_META_SCHEMA = "CREATE TABLE IF NOT EXISTS re_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
# (table, columns, rows per round trip). The finished-map cache is not copied: it is
# rebuilt in minutes, and whatever a build before this code wrote to the new database
# came from an empty one — so it is cleared once the copy is done.
_MOVE = (
    ("re_trade_months", "lawd_cd, deal_ym, fetched_at, deal_count, payload", 40),
    ("re_rent_months", "lawd_cd, deal_ym, fetched_at, deal_count, payload", 20),
    ("re_complex_facts", "key, fetched_at, payload", 200),
)


def _open(url: str, token: str | None):
    """A connection of the copy's own, with a longer read timeout than the stores'."""
    from app.services.turso import Connection

    if url and "://" in url:
        return Connection(url, token, timeout=30)
    return turso.connect(database=url)


def _retry(fn, attempts: int = 4):
    for i in range(attempts):
        try:
            return fn()
        except Exception:
            if i == attempts - 1:
                raise
            _time.sleep(2 * (i + 1))


_moved_upto: dict[str, int] = {}  # table -> last rowid copied, so a retry resumes


def _migrate() -> None:
    """Copies until done: a failure waits half a minute and carries on from the last
    row copied, so the collectors are never left waiting on a copy that gave up."""
    while not migrated.is_set():
        _migrate_once()
        if not migrated.is_set():
            _time.sleep(30)


def _migrate_once() -> None:
    migration_state["running"] = True
    migration_state["error"] = None
    try:
        target = _open(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN)
        for schema in (_SCHEMA, _FACTS_SCHEMA, _MAP_SCHEMA, _RENT_SCHEMA, _META_SCHEMA):
            _retry(lambda s=schema: target.execute(s))
        done = _retry(lambda: target.execute("SELECT value FROM re_meta WHERE key = 'migrated_from_shared'").fetchall())
        if done:
            migration_state.update(done=True, running=False)
            migrated.set()
            return
        source = _open(SHARED_DATABASE_URL, SHARED_AUTH_TOKEN)
        for table, cols, batch in _MOVE:
            migration_state["table"] = table
            try:
                source.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchall()
            except Exception:
                continue  # never created on the shared database
            marks = ", ".join("?" * len(cols.split(",")))
            last = _moved_upto.get(table, 0)
            while True:
                rows = _retry(
                    lambda: source.execute(
                        f"SELECT rowid, {cols} FROM {table} WHERE rowid > ? ORDER BY rowid LIMIT ?", (last, batch)
                    ).fetchall()
                )
                if not rows:
                    break
                _retry(lambda: target.executemany(f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({marks})", [r[1:] for r in rows]))
                if hasattr(target, "commit"):
                    target.commit()
                last = rows[-1][0]
                _moved_upto[table] = last
                migration_state["rows"] += len(rows)
        stamp = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
        _retry(lambda: target.execute("DELETE FROM re_map_cache"))
        _retry(lambda: target.execute("INSERT OR REPLACE INTO re_meta (key, value) VALUES ('migrated_from_shared', ?)", (stamp,)))
        if hasattr(target, "commit"):
            target.commit()
        migration_state.update(done=True, table=None)
        migrated.set()
    except Exception as exc:  # noqa: BLE001 — tried again on the next start
        migration_state["error"] = f"{type(exc).__name__}: {exc}"[:300]
        import logging

        logging.getLogger(__name__).error("realestate: moving to its own database failed (%s)", exc)
    finally:
        migration_state["running"] = False


_migration_started = False


def start_migration() -> None:
    """Copies the 부동산 tables into their own database, once, in the background."""
    global _migration_started
    if not SEPARATE or _migration_started:
        return
    _migration_started = True
    _threading.Thread(target=_migrate, name="realestate-migrate", daemon=True).start()
