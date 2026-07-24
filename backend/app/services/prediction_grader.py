"""Scores past predictions against what the market actually did.

A forecast nobody checks is a claim, not a service. This is the half of the feature
that turns the stored predictions into a record: once the predicted session has
traded, every row gets the real close, the real move, whether the direction was right,
and a timestamp saying when that was established.

Runs at the head of each batch rather than on its own schedule. That ordering is the
point — the KR batch fires after the KRX close, which is exactly when yesterday's
prediction for today became checkable, so grading and predicting are the same event
seen from two days. It also means the accuracy numbers a reader sees are never older
than the predictions printed beside them.

Nothing here re-derives a threshold. Each row was made under a 보합 band computed from
that stock's own volatility (prediction_quality.flat_band) and stored on the row; the
grade uses that stored band, so a call is judged by the definition it was made under
and not by one chosen after the outcome was known.
"""

import datetime as dt
import logging

from app.data import price_fetcher
from app.services import prediction_store
from app.services import trading_calendar as cal

logger = logging.getLogger(__name__)

RESULT_UP = "상승"
RESULT_DOWN = "하락"
RESULT_FLAT = "보합"

# Used only for rows written before flat_band existed. Matches the engine's original
# fixed 보합 threshold, so those rows are graded on the rule that was actually in force
# when they were made.
LEGACY_FLAT_BAND_PCT = 0.4

# Accuracy windows the page reports. 20 sessions is about a trading month — recent
# enough to reflect the current regime; 60 is a quarter, long enough that a lucky week
# can't carry it.
WINDOW_SHORT = 20
WINDOW_LONG = 60

# A row whose session traded but whose close still isn't in the feed after this many
# days is not going to arrive — the ticker was suspended, delisted, or renamed. It is
# graded as unresolvable rather than retried forever on every batch run.
ABANDON_AFTER_DAYS = 10


def classify(change_pct: float, band: float) -> str:
    if change_pct > band:
        return RESULT_UP
    if change_pct < -band:
        return RESULT_DOWN
    return RESULT_FLAT


def grade_pending(markets: tuple[str, ...], today: dt.date, now_iso: str) -> dict:
    """Grades every ungraded prediction in `markets` whose target session is over.

    `today` is the region's own session date, so a KR run grades against the KRX
    calendar day and a US run against the ET one — the two are different dates for
    ~14 hours out of every 24, and grading a US row against the Korean date would
    reach for a close that hasn't printed.
    """
    pending = prediction_store.list_ungraded(markets, cal.to_key(today))
    if not pending:
        return {"checked": 0, "graded": 0, "pending": 0, "hits": 0}

    # One price fetch per stock, not per row: a backlog holds several sessions of the
    # same name, and the frame fetched for the oldest already contains every later one.
    by_code: dict[str, list[dict]] = {}
    for row in pending:
        by_code.setdefault(row["code"], []).append(row)

    grades: list[dict] = []
    unresolved = 0
    for code, rows in by_code.items():
        try:
            df = price_fetcher.get_history(code, 1)
        except Exception as exc:  # noqa: BLE001 - one dead ticker must not stop the rest
            logger.warning("prediction_grader: price history failed for %s (%s)", code, exc)
            unresolved += len(rows)
            continue

        closes = dict(zip(df["date"], df["close"]))
        for row in rows:
            iso = cal.from_key(row["predict_date"]).isoformat()
            close = closes.get(iso)
            if close is None:
                age = (today - cal.from_key(row["predict_date"])).days
                if age <= ABANDON_AFTER_DAYS:
                    unresolved += 1
                    continue
                # Past the point where the close is going to show up. Recorded with a
                # null price and hit=False so it stops being retried; it counts against
                # the accuracy rate, which is the honest treatment of a prediction whose
                # outcome can no longer be established.
                logger.warning(
                    "prediction_grader: no close for %s on %s after %d days; marking unresolvable",
                    code,
                    row["predict_date"],
                    age,
                )
                grades.append(
                    {
                        "collect_date": row["collect_date"],
                        "code": code,
                        "actual_price": None,
                        "actual_change_rate": None,
                        "actual_result": None,
                        "hit": False,
                        "graded_at": now_iso,
                    }
                )
                continue

            base = float(row["base_price"] or 0)
            if base <= 0:
                continue
            actual_change = round((float(close) / base - 1) * 100, 2)
            band = float(row["flat_band"] or LEGACY_FLAT_BAND_PCT)
            actual_result = classify(actual_change, band)
            grades.append(
                {
                    "collect_date": row["collect_date"],
                    "code": code,
                    "actual_price": round(float(close), 4),
                    "actual_change_rate": actual_change,
                    "actual_result": actual_result,
                    "hit": actual_result == row["result"],
                    "graded_at": now_iso,
                }
            )

    written = prediction_store.apply_grades(grades)
    hits = sum(1 for g in grades if g["hit"])
    logger.info(
        "prediction_grader: %d pending, %d graded (%d hit), %d still unresolved",
        len(pending),
        written,
        hits,
        unresolved,
    )
    return {"checked": len(pending), "graded": written, "pending": unresolved, "hits": hits}


def _window(entries: list[tuple[str, bool]], sessions: int | None) -> dict:
    """Hit rate over the most recent `sessions` trading days' worth of entries.

    Windowed by *session*, not by row count. For one stock the two are the same thing
    (one prediction per day), but a market window has ten-odd rows per session — cutting
    at 20 rows there would report "최근 20일" from the last two days. Taking the 20 most
    recent distinct 예측일자 and counting every row inside them is the same window the
    label promises in both cases.
    """
    if sessions is not None:
        seen: list[str] = []
        for date, _hit in entries:
            if date not in seen:
                seen.append(date)
                if len(seen) > sessions:
                    break
        kept = set(seen[:sessions])
        entries = [e for e in entries if e[0] in kept]

    total = len(entries)
    hit = sum(1 for _date, flag in entries if flag)
    return {
        "total": total,
        "hit": hit,
        # None rather than 0 for an empty window: "no record yet" and "never right" are
        # opposite facts, and a page showing 0% for a stock predicted twice would be
        # reporting the second one.
        "rate": round(hit / total * 100) if total else None,
    }


def _windows(entries: list[tuple[str, bool]]) -> dict:
    return {
        "recent20": _window(entries, WINDOW_SHORT),
        "recent60": _window(entries, WINDOW_LONG),
        "all": _window(entries, None),
    }


def accuracy_summary(codes: tuple[str, ...] | None = None) -> dict[str, dict]:
    """Per-stock hit rate over the recent 20 sessions, the recent 60, and all of it.

    Keyed by stock code. Only graded rows count — an ungraded prediction is not a miss,
    it's a prediction whose session hasn't been checked yet.
    """
    rows = prediction_store.graded_history(codes)
    entries: dict[str, list[tuple[str, bool]]] = {}
    for code, _market, date, hit in rows:
        entries.setdefault(code, []).append((date, bool(hit)))
    return {code: _windows(values) for code, values in entries.items()}


def market_accuracy() -> dict[str, dict]:
    """The same windows aggregated per market, for the page's header stats."""
    rows = prediction_store.graded_history()
    entries: dict[str, list[tuple[str, bool]]] = {}
    for _code, market, date, hit in rows:
        entries.setdefault(market, []).append((date, bool(hit)))
    return {market: _windows(values) for market, values in entries.items()}
