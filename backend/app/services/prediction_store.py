"""Persistent storage for the AI 종목예측 batch results.

Unlike the rest of this app's data (price/indicator/news caches that live only in
the in-process TTL cache and are re-derived on demand), a prediction is a claim
made at a specific point in time that must still be readable tomorrow — both to
show it on the page and to let anyone check it against what actually happened.
That means a real table, so this follows comment_store.py's Turso-with-local-
fallback pattern rather than the cache.
"""

import json
import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "predictions.db"

_lock = threading.Lock()
_conn = None

# The columns the spec asks for are collect_date/predict_date/stock_code/stock_name/
# predict_result/predict_price/change_rate/detail/created_at/updated_at. Four more are
# carried alongside them because the page can't be built without them: `market` (the
# page groups by KOSPI/KOSDAQ/NASDAQ and the two batches write on different schedules),
# `base_price` (an absolute 예측시세 means nothing without the close it moved from),
# and `score`/`confidence` (the 40/60 weighted total and its strength — what the UI
# renders as the conviction gauge).
#
# The rest of the table is the prediction's account of itself: the three direction
# probabilities and the 보합 band they were measured against, the reliability score with
# the reasons behind it, the close explanation and its evidence list — and the five
# grading columns, which stay NULL until the predicted session has actually traded and
# prediction_grader fills them in.
#
# UNIQUE(collect_date, stock_code) is what makes a re-run an update instead of a
# duplicate: the GitHub Actions cron can fire twice (a retry, a manual dispatch after
# a failure) and the second run must overwrite the first day's row, not append to it.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS stock_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collect_date TEXT NOT NULL,
    predict_date TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    market TEXT NOT NULL,
    predict_result TEXT NOT NULL,
    base_price REAL NOT NULL,
    predict_price REAL NOT NULL,
    change_rate REAL NOT NULL,
    score REAL NOT NULL,
    confidence TEXT NOT NULL,
    detail TEXT NOT NULL,
    prob_up REAL,
    prob_flat REAL,
    prob_down REAL,
    flat_band REAL,
    reliability REAL,
    reliability_grade TEXT,
    reliability_notes TEXT,
    close_change_rate REAL,
    close_summary TEXT,
    evidence TEXT,
    market_cap REAL,
    actual_price REAL,
    actual_change_rate REAL,
    actual_result TEXT,
    hit INTEGER,
    graded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (collect_date, stock_code)
)
"""

# Columns added after the table first shipped. A deployed database (Turso, or a local
# predictions.db from an earlier run) already has the original 14 columns and rows in
# them, so CREATE TABLE IF NOT EXISTS is a no-op there and these have to be introduced
# by ALTER. Every one is nullable with no default: an existing row genuinely has no
# probability or grade, and backfilling a zero would be indistinguishable from a real
# 0% that some later query would then average in.
_ADDED_COLUMNS = (
    ("prob_up", "REAL"),
    ("prob_flat", "REAL"),
    ("prob_down", "REAL"),
    ("flat_band", "REAL"),
    ("reliability", "REAL"),
    ("reliability_grade", "TEXT"),
    ("reliability_notes", "TEXT"),
    ("close_change_rate", "REAL"),
    ("close_summary", "TEXT"),
    ("evidence", "TEXT"),
    # Snapshotted per row rather than read from the live roster: market-cap rank shifts
    # daily, and a past session's page has to order its names the way they ranked *that
    # day*, not the way they rank now.
    ("market_cap", "REAL"),
    ("actual_price", "REAL"),
    ("actual_change_rate", "REAL"),
    ("actual_result", "TEXT"),
    ("hit", "INTEGER"),
    ("graded_at", "TEXT"),
)

# The page's hot queries are "everything predicted for date X" (the date navigator),
# "this stock's prediction history" (the accuracy strip on a card), and "which rows are
# still waiting to be graded" (the grader, which runs at the head of every batch). All
# three scan the whole table without these.
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_predictions_predict_date ON stock_predictions (predict_date)",
    "CREATE INDEX IF NOT EXISTS idx_predictions_code_date ON stock_predictions (stock_code, predict_date)",
    "CREATE INDEX IF NOT EXISTS idx_predictions_market_predict ON stock_predictions (market, predict_date)",
)

# (db column, row-dict key). One list drives the INSERT, the UPDATE-on-conflict, the
# SELECT and the row->dict mapping, so adding a field is a single edit and the four
# statements can't drift out of alignment — which they did silently the first time a
# column was added by hand.
_WRITE_FIELDS = (
    ("collect_date", "collect_date"),
    ("predict_date", "predict_date"),
    ("stock_code", "code"),
    ("stock_name", "name"),
    ("market", "market"),
    ("predict_result", "result"),
    ("base_price", "base_price"),
    ("predict_price", "predict_price"),
    ("change_rate", "change_rate"),
    ("score", "score"),
    ("confidence", "confidence"),
    ("detail", "detail"),
    ("prob_up", "prob_up"),
    ("prob_flat", "prob_flat"),
    ("prob_down", "prob_down"),
    ("flat_band", "flat_band"),
    ("reliability", "reliability"),
    ("reliability_grade", "reliability_grade"),
    ("reliability_notes", "reliability_notes"),
    ("close_change_rate", "close_change_rate"),
    ("close_summary", "close_summary"),
    ("evidence", "evidence"),
    ("market_cap", "market_cap"),
    ("created_at", "created_at"),
    ("updated_at", "updated_at"),
)

# Stored as JSON text. SQLite has no array type and these are read whole or not at all
# (the reliability reasons list, the evidence rows) — nothing queries inside them.
_JSON_FIELDS = frozenset({"reliability_notes", "evidence"})

# Written by the grader, never by the batch, which is why they are not in _WRITE_FIELDS.
_GRADE_COLUMNS = ("actual_price", "actual_change_rate", "actual_result", "hit", "graded_at")

_WRITE_COLUMNS = tuple(col for col, _ in _WRITE_FIELDS)
_SELECT_COLUMNS = _WRITE_COLUMNS + _GRADE_COLUMNS
_SELECT_SQL = ", ".join(_SELECT_COLUMNS)
_PLACEHOLDERS = ", ".join("?" for _ in _WRITE_COLUMNS)


def _encode(key: str, row: dict):
    value = row.get(key)
    if key in _JSON_FIELDS:
        return json.dumps(value, ensure_ascii=False) if value else None
    return value


def _write_values(row: dict) -> tuple:
    return tuple(_encode(key, row) for _, key in _WRITE_FIELDS)


def _connect():
    if TURSO_DATABASE_URL:
        return libsql.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return libsql.connect(database=str(LOCAL_DB_PATH))


def _migrate(conn) -> None:
    """Adds any column this build expects that the live table doesn't have yet.

    Runs on every connection rather than behind a version flag: it's one PRAGMA on a
    table with a few thousand rows, and the alternative — a migration number kept in
    sync by hand across a local file and a Turso database — is the thing that actually
    breaks. ADD COLUMN is the only DDL used, so this can never destroy data; a column
    that already exists is simply skipped.
    """
    existing = {row[1] for row in conn.execute("PRAGMA table_info(stock_predictions)").fetchall()}
    for name, sql_type in _ADDED_COLUMNS:
        if name not in existing:
            conn.execute(f"ALTER TABLE stock_predictions ADD COLUMN {name} {sql_type}")


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    _migrate(conn)
    for statement in _INDEXES:
        conn.execute(statement)
    conn.commit()
    return conn


def _with_connection(fn):
    """One lazily-created process-wide connection serialized behind `_lock`, with a
    single retry on a fresh connection if the existing one turns out to be dead —
    same reasoning as comment_store._with_connection (concurrent open/close cycles
    race in the libsql client and Turso closes idle streams server-side)."""
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


def _decode(key: str, value):
    if key not in _JSON_FIELDS:
        return value
    if not value:
        return []
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        # A row written before the column existed, or by a build that stored something
        # else there. An empty list renders as "no evidence recorded", which is true and
        # harmless; raising would take the whole page down over one bad row.
        return []


def _row_to_prediction(row: tuple) -> dict:
    values = dict(zip(_SELECT_COLUMNS, row))
    out = {key: _decode(col, values[col]) for col, key in _WRITE_FIELDS}
    for col in _GRADE_COLUMNS:
        out[col] = values[col]
    # Rows predating the grader have no `hit` at all, which is a different state from
    # "predicted and got it wrong" — the page shows 미채점 for the first and ✗ for the
    # second, so the null has to survive the trip rather than being coerced to False.
    out["hit"] = None if values["hit"] is None else bool(values["hit"])
    return out


def upsert_predictions(rows: list[dict]) -> int:
    """Writes a batch run's rows, replacing any existing row for the same
    (collect_date, stock_code). `created_at` is preserved from the original insert on
    a re-run — only `updated_at` moves — so the row still records when that trading
    day's prediction was first published, which is the whole point of storing it.
    """
    if not rows:
        return 0

    # Everything except the keys and created_at is overwritten; the grading columns are
    # additionally cleared. A re-run that changes the call invalidates any grade already
    # attached to it — keeping the old 적중 flag beside a new prediction would score a
    # forecast against an outcome it never made.
    updates = ", ".join(
        f"{col} = excluded.{col}"
        for col in _WRITE_COLUMNS
        if col not in ("collect_date", "stock_code", "created_at")
    )
    updates += ", " + ", ".join(f"{col} = NULL" for col in _GRADE_COLUMNS)
    sql = (
        f"INSERT INTO stock_predictions ({', '.join(_WRITE_COLUMNS)}) "
        f"VALUES ({_PLACEHOLDERS}) "
        f"ON CONFLICT (collect_date, stock_code) DO UPDATE SET {updates}"
    )

    def _run(conn):
        for row in rows:
            conn.execute(sql, _write_values(row))
        conn.commit()
        return len(rows)

    return _with_connection(_run)


def _insert(conn, row: dict) -> None:
    conn.execute(
        f"INSERT INTO stock_predictions ({', '.join(_WRITE_COLUMNS)}) VALUES ({_PLACEHOLDERS})",
        _write_values(row),
    )


def replace_predictions(rows: list[dict]) -> int:
    """Deletes every existing row for the (수집일자, 시장) pairs this run produced, then
    inserts the new rows — a clean regenerate rather than the field-by-field overwrite
    upsert_predictions does.

    This is the manual-rerun path. It matters because the roster isn't fixed across a
    day: market-cap rank shifts intraday and the Nasdaq list is index-weight-derived,
    so a rerun can legitimately drop a name that the first run stored. upsert only
    *updates* codes present in the new batch — a dropped name's row would linger as a
    stale prediction for that session. Deleting the whole (수집일자, 시장) slice first
    guarantees the stored day reflects exactly this run's roster, nothing left over.

    Scoped to the pairs actually in `rows`, so a US rerun never touches KRX rows, and a
    market whose collection failed entirely (no rows) keeps its previous data rather
    than being wiped by a run that produced nothing for it. Delete + insert share one
    transaction, so a failure can't leave the day half-deleted.
    """
    if not rows:
        return 0

    def _run(conn):
        pairs = {(row["collect_date"], row["market"]) for row in rows}
        for collect_date, market in pairs:
            conn.execute(
                "DELETE FROM stock_predictions WHERE collect_date = ? AND market = ?",
                (collect_date, market),
            )
        for row in rows:
            _insert(conn, row)
        conn.commit()
        return len(rows)

    return _with_connection(_run)


def list_by_predict_date(predict_date: str, market: str | None = None) -> list[dict]:
    """Every prediction targeting one trading day, which is exactly what the page
    renders. Ordered by market then descending score so the strongest calls in each
    group lead."""

    def _run(conn):
        if market:
            return conn.execute(
                f"SELECT {_SELECT_SQL} FROM stock_predictions "
                "WHERE predict_date = ? AND market = ? "
                "ORDER BY market, score DESC",
                (predict_date, market),
            ).fetchall()
        return conn.execute(
            f"SELECT {_SELECT_SQL} FROM stock_predictions "
            "WHERE predict_date = ? ORDER BY market, score DESC",
            (predict_date,),
        ).fetchall()

    return [_row_to_prediction(row) for row in _with_connection(_run)]


def list_predict_dates(limit: int = 30) -> list[str]:
    """Distinct 예측일자 values, newest first — the date navigator's options. Only
    dates that actually have rows are offered, so a day the batch never ran for
    can't be selected into an empty page."""

    def _run(conn):
        return conn.execute(
            "SELECT DISTINCT predict_date FROM stock_predictions "
            "ORDER BY predict_date DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return [row[0] for row in _with_connection(_run)]


def predict_date_markets(limit: int = 30) -> dict[str, list[str]]:
    """Which markets have rows on each of the most recent 예측일자, newest first.

    The two regions' batches target *different* 예측일자 most of the time — the NYSE
    close for a given session lands the next morning KST, so on a Friday evening in
    Korea the newest KR prediction targets Monday while the newest US one targets
    Friday. A page that shows one 예측일자 at a time therefore hides one region unless
    it can say where that region's rows actually are, which is what this answers.
    """

    def _run(conn):
        return conn.execute(
            "SELECT predict_date, market FROM stock_predictions "
            "GROUP BY predict_date, market ORDER BY predict_date DESC"
        ).fetchall()

    out: dict[str, list[str]] = {}
    for predict_date, market in _with_connection(_run):
        if predict_date not in out and len(out) >= limit:
            continue
        out.setdefault(predict_date, []).append(market)
    return out


def latest_predict_date() -> str | None:
    dates = list_predict_dates(limit=1)
    return dates[0] if dates else None


def list_by_code(code: str, limit: int = 30) -> list[dict]:
    """One stock's prediction history, newest first — backs the per-card track record."""

    def _run(conn):
        return conn.execute(
            f"SELECT {_SELECT_SQL} FROM stock_predictions "
            "WHERE stock_code = ? ORDER BY predict_date DESC LIMIT ?",
            (code, limit),
        ).fetchall()

    return [_row_to_prediction(row) for row in _with_connection(_run)]


def list_ungraded(markets: tuple[str, ...], upto_date: str, limit: int = 400) -> list[dict]:
    """Predictions whose target session has already traded but which nobody has scored
    yet, oldest first.

    Oldest first because a backlog (the grader's first run, or a stretch where the
    batch was down) should be worked through in order — if the limit truncates it, the
    rows left behind are the recent ones the next run will reach anyway.

    Deliberately keyed on `graded_at IS NULL` rather than on a date window: a row that
    couldn't be graded on the day (the price feed hadn't published the close yet)
    stays in this set and is picked up by a later run instead of being permanently
    skipped by a window that has moved past it.
    """
    if not markets:
        return []
    placeholders = ", ".join("?" for _ in markets)

    def _run(conn):
        return conn.execute(
            f"SELECT {_SELECT_SQL} FROM stock_predictions "
            f"WHERE market IN ({placeholders}) AND predict_date <= ? AND graded_at IS NULL "
            "ORDER BY predict_date ASC LIMIT ?",
            (*markets, upto_date, limit),
        ).fetchall()

    return [_row_to_prediction(row) for row in _with_connection(_run)]


def apply_grades(grades: list[dict]) -> int:
    """Writes the outcome of predictions whose session has closed.

    Keyed on (collect_date, stock_code) — the table's own unique key — so a grade can
    only ever land on the exact row that made the call.
    """
    if not grades:
        return 0

    def _run(conn):
        for g in grades:
            conn.execute(
                "UPDATE stock_predictions SET "
                "actual_price = ?, actual_change_rate = ?, actual_result = ?, "
                "hit = ?, graded_at = ? "
                "WHERE collect_date = ? AND stock_code = ?",
                (
                    g["actual_price"],
                    g["actual_change_rate"],
                    g["actual_result"],
                    1 if g["hit"] else 0,
                    g["graded_at"],
                    g["collect_date"],
                    g["code"],
                ),
            )
        conn.commit()
        return len(grades)

    return _with_connection(_run)


def graded_history(codes: tuple[str, ...] | None = None, limit: int = 4000) -> list[tuple]:
    """(stock_code, market, predict_date, hit) for every scored prediction, newest
    first. The windowing into 20일/60일/전체 is done in Python by
    `accuracy_summary` — three correlated subqueries per stock would be a far heavier
    way to answer a question this dataset is small enough to answer in memory."""

    def _run(conn):
        if codes:
            placeholders = ", ".join("?" for _ in codes)
            return conn.execute(
                "SELECT stock_code, market, predict_date, hit FROM stock_predictions "
                f"WHERE hit IS NOT NULL AND stock_code IN ({placeholders}) "
                "ORDER BY predict_date DESC LIMIT ?",
                (*codes, limit),
            ).fetchall()
        return conn.execute(
            "SELECT stock_code, market, predict_date, hit FROM stock_predictions "
            "WHERE hit IS NOT NULL ORDER BY predict_date DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return _with_connection(_run)


def session_scoreboard(limit: int = 20) -> list[dict]:
    """Per-session hit tallies, newest first — how each graded 예측일자 turned out.

    Grouped in SQL rather than by pulling the rows because this powers a header strip
    that renders on every page load, and the answer is a handful of integers.
    """

    def _run(conn):
        return conn.execute(
            "SELECT predict_date, COUNT(*) AS total, SUM(hit) AS hits "
            "FROM stock_predictions WHERE hit IS NOT NULL "
            "GROUP BY predict_date ORDER BY predict_date DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return [
        {
            "predict_date": predict_date,
            "total": int(total or 0),
            "hit": int(hits or 0),
            "rate": round((hits or 0) / total * 100) if total else None,
        }
        for predict_date, total, hits in _with_connection(_run)
    ]


def has_run(collect_date: str, market: str) -> bool:
    """Whether this market's batch already produced rows for this 수집일자. The
    batch checks this before doing any scraping so a duplicate cron firing costs
    one query instead of ~34 stocks' worth of upstream fetches."""

    def _run(conn):
        return conn.execute(
            "SELECT 1 FROM stock_predictions WHERE collect_date = ? AND market = ? LIMIT 1",
            (collect_date, market),
        ).fetchone()

    return _with_connection(_run) is not None


def latest_run_by_market() -> dict[str, dict]:
    """Per-market snapshot of the most recent batch output, straight from the stored
    rows. This is the admin panel's source of truth for '각 배치별 실행 여부': it survives
    a process restart (unlike the in-memory run log in prediction_batch), because it
    reads what was actually written rather than what a still-running process remembers.

    For each market: its newest 수집일자, the day that run predicted, how many rows it
    saved for that 수집일자, and the last time any of those rows was written — the
    latter is the honest '최근 실행시간' since it's when the data physically landed.
    """

    def _run(conn):
        # The latest collect_date per market, then that day's row count and newest
        # write. GROUP BY market with MAX(collect_date) alone would let the COUNT/MAX
        # aggregate across *all* dates, so the count is scoped in a correlated subquery
        # to the market's own latest date.
        return conn.execute(
            """
            SELECT
                p.market,
                p.collect_date,
                MAX(p.predict_date) AS predict_date,
                COUNT(*) AS row_count,
                MAX(p.updated_at) AS last_updated
            FROM stock_predictions p
            JOIN (
                SELECT market, MAX(collect_date) AS latest
                FROM stock_predictions
                GROUP BY market
            ) latest ON latest.market = p.market AND latest.latest = p.collect_date
            GROUP BY p.market, p.collect_date
            """
        ).fetchall()

    result: dict[str, dict] = {}
    for market, collect_date, predict_date, row_count, last_updated in _with_connection(_run):
        result[market] = {
            "collect_date": collect_date,
            "predict_date": predict_date,
            "count": row_count,
            "updated_at": last_updated,
        }
    return result
