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

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "realestate.db"

_gate = libsql_gate.Gate("realestate_store")
_conn = None

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
    for deal_ym, fetched_at, payload in _with_connection(_run):
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
