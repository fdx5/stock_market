"""Pre-open revision of the KRX forecasts with the KOSPI200 night futures session.

## Why

The KR batch runs at 23:00 KST and scores tomorrow's close from today's close. Between
those two closes sits the whole overnight session — the US market, FX, and every
headline that lands after 15:30 — and the KOSPI200 night futures (18:00–06:00 KST)
price all of it into one number before Korea opens. The evening batch could not see
it: the session is only a third of the way in at 23:00, and the US cash market has
not even opened.

Most of a KRX stock's next-day move is the market's move, so a forecast that ignores
the market's overnight repricing is right or wrong mostly by whether the market
happened to go its way. The published hit rate showed exactly that: sessions swung
between 15% and 77% with the index, not with anything stock-specific.

## How

After the night session closes (06:00 KST) and before the open, every still-ungraded
KRX row for today's session is revised once:

    move = ENGINE_KEEP * (evening_move - DRIFT) + DRIFT + NIGHT_COEF * beta_s * night_pct

where `night_pct` is the night close against the day-session futures close and
`beta_s` is the stock's 120-session KOSPI200 beta shrunk halfway toward 1. The call is
then re-decided against the row's own unchanged 보합 band, so grading measures the
revised call by exactly the rule the evening call would have been measured by.

## Measured (2026-11-23, see docs/prediction-night-futures-2026-11-23.md)

No free archive of the night session exists, so the coefficient was set with the
KOSPI200 next-day opening gap standing in for it (the night close is the market's
price for that gap) and checked against a noisier version of it:

  * 3-year panel, 80 KRX names, held-out 2025-07~: 35.8% → 43.0% three-way hit rate
  * the live published rows of the last 29 sessions replayed: 30.8% → 49.0%

The gain is concentrated on days the market moves; on a flat night the revision
barely changes anything, which is the right behaviour. Every session captured here is
recorded in night_futures_sessions so NIGHT_COEF can be re-measured on the real thing.
"""

import datetime as dt
import logging
import re
import threading

from app.data.prediction_universe import KR_MARKETS, snap_to_tick
from app.services import ai_analyst, kospi_night, prediction_quality, prediction_store
from app.services import trading_calendar as cal
from app.services.prediction_engine import DRIFT_PCT, MAX_MOVE_PCT, RESULT_DOWN, RESULT_FLAT, RESULT_UP

logger = logging.getLogger(__name__)

# Weight of the night move per unit of (shrunk) beta. The proxy backtest preferred
# 1.4–1.8 against the opening gap; the night close tends to overshoot the open (on
# 2026-11-20 night -6.8% vs open gap -4.4%), so the low end of that range is used.
NIGHT_COEF = 1.4
# Share of the evening engine's own deviation from drift kept once the night session
# is known. Halving it measured better than keeping it whole in both the train and
# held-out splits: the reversal signal is partly a bet on tomorrow's market that the
# night session now answers directly.
ENGINE_KEEP = 0.5
# Beta shrinkage toward 1 — a 120-session beta is noisy, and the pooled estimate beat
# the raw one out of sample.
BETA_SHRINK = 0.5
DEFAULT_BETA = 1.0
# Beyond this the quote is treated as a feed error rather than a session — the
# largest night moves on record are well inside it.
MAX_NIGHT_PCT = 10.0

# Revision window in KST: after the night close settles, before the open.
WINDOW_START = dt.time(6, 5)
WINDOW_END = dt.time(8, 50)

_VERDICT_RE = re.compile(r"\s*\[익일 전망: [^\]]*\]\s*$")
_lock = threading.Lock()
_last: dict = {}


def completed_night_session(collect_date: dt.date, quote: dict | None = None) -> dict | None:
    """The finished night session that followed `collect_date`'s day session, or None.

    Requires the feed's own session date to match, the session to be over, the quote
    to be measured against the day futures close (not the spot close the raw feed
    carries), and the last tick to be from the closing hour.
    """
    quote = quote if quote is not None else kospi_night.get_quote()
    if not quote or quote.get("close") is None or quote.get("change_pct") is None:
        return None
    if quote.get("session_date") != collect_date.isoformat():
        return None
    if quote.get("source_live") or quote.get("base_source") != "day_futures_close":
        return None
    stamp = quote.get("quote_time")
    if not stamp:
        return None
    last_tick = dt.datetime.fromtimestamp(stamp, cal.KST)
    if last_tick.date() <= collect_date or last_tick.hour < 5:
        return None
    change = float(quote["change_pct"])
    if abs(change) > MAX_NIGHT_PCT:
        return None
    return {
        "session_date": quote["session_date"],
        "close": float(quote["close"]),
        "prev_close": float(quote["prev_close"]),
        "change_pct": round(change, 2),
        "quote_time": int(stamp),
    }


def _previous_trading_day(day: dt.date) -> dt.date:
    candidate = day - dt.timedelta(days=1)
    for _ in range(30):
        if cal.is_trading_day(candidate, "KR"):
            return candidate
        candidate -= dt.timedelta(days=1)
    raise ValueError(f"No KR trading day within 30 days before {day}")


def _shrunk_beta(beta) -> float:
    try:
        b = float(beta)
    except (TypeError, ValueError):
        b = DEFAULT_BETA
    if b != b:
        b = DEFAULT_BETA
    return b * (1 - BETA_SHRINK) + BETA_SHRINK


def _volatility(row: dict) -> float:
    vol = row.get("volatility_pct")
    if vol:
        return float(vol)
    # Rows written before volatility_pct existed: the band is 0.35x volatility unless
    # it sat at its 0.4% floor, so this recovers it (or a floor-consistent value).
    band = float(row.get("flat_band") or prediction_quality.FLAT_BAND_MIN_PCT)
    return band / prediction_quality.FLAT_BAND_VOL_RATIO


def revise_row(row: dict, night: dict, now_iso: str) -> dict:
    """The revised fields for one stored row. Pure; never writes."""
    evening_move = float(row["change_rate"])
    beta = _shrunk_beta(row.get("night_beta"))
    night_pct = float(night["change_pct"])
    night_term = NIGHT_COEF * beta * night_pct

    move = ENGINE_KEEP * (evening_move - DRIFT_PCT) + DRIFT_PCT + night_term
    move = max(-MAX_MOVE_PCT, min(MAX_MOVE_PCT, move))

    base = float(row["base_price"])
    predict_price = float(snap_to_tick(base * (1 + move / 100), row["market"]))
    if base:
        move = round((predict_price / base - 1) * 100, 2)

    band = float(row.get("flat_band") or prediction_quality.flat_band(_volatility(row)))
    if abs(move) < band:
        result = RESULT_FLAT
    else:
        result = RESULT_UP if move > 0 else RESULT_DOWN

    probs = prediction_quality.direction_probabilities(
        move, _volatility(row), band, float(row.get("reliability") or 100.0)
    )

    note = (
        f" [야간선물 반영: 코스피200 야간 {night_pct:+.2f}%, 베타 {beta:.2f}"
        f" → 전일 전망 {row['result']} {evening_move:+.2f}% 수정]"
    )
    verdict = f" [익일 전망: {result} {move:+.2f}%]"
    base_text = _VERDICT_RE.sub("", (row.get("detail") or "").strip())
    room = max(0, ai_analyst.DETAIL_MAX_CHARS - len(note) - len(verdict))
    detail = f"{ai_analyst._truncate(base_text, room)}{note}{verdict}"

    evidence = [e for e in (row.get("evidence") or []) if e.get("category") != "야간선물"]
    evidence.insert(
        0,
        {
            "category": "야간선물",
            "label": "코스피200 야간선물",
            "value": f"{night_pct:+.2f}% (베타 {beta:.2f} → {night_term:+.2f}%p 반영)",
            "impact": "positive" if night_term > 0 else ("negative" if night_term < 0 else "neutral"),
        },
    )

    return {
        "collect_date": row["collect_date"],
        "code": row["code"],
        "result": result,
        "predict_price": predict_price,
        "change_rate": move,
        "prob_up": probs["up"],
        "prob_flat": probs["flat"],
        "prob_down": probs["down"],
        "detail": detail,
        "evidence": evidence,
        "night_fut_pct": night_pct,
        "night_applied_at": now_iso,
        "updated_at": now_iso,
    }


def run_revision(now: dt.datetime | None = None, quote: dict | None = None) -> dict:
    """Revises today's KRX rows once the night session is complete. Idempotent."""
    now = now or cal.now_kst()
    today = now.date()
    if not cal.is_trading_day(today, "KR"):
        return {"status": "skipped", "reason": "not a KR session day"}
    if not (WINDOW_START <= now.time() <= WINDOW_END):
        return {"status": "skipped", "reason": "outside 06:05–08:50 KST"}
    collect_day = _previous_trading_day(today)
    collect_key = cal.to_key(collect_day)

    with _lock:
        rows = prediction_store.list_night_candidates(collect_key, KR_MARKETS)
        if not rows:
            return {"status": "skipped", "reason": "nothing to revise", "collect_date": collect_key}
        night = completed_night_session(collect_day, quote)
        if night is None:
            return {"status": "waiting", "reason": "night session not complete", "collect_date": collect_key}
        now_iso = now.astimezone(dt.timezone.utc).isoformat(timespec="seconds")
        try:
            prediction_store.record_night_session(night, now_iso)
        except Exception:  # noqa: BLE001 - the record is for calibration; never block the revision
            logger.exception("prediction_night: could not record night session")
        targets = [r for r in rows if r.get("predict_date") == cal.to_key(today)]
        revisions = [revise_row(r, night, now_iso) for r in targets]
        written = prediction_store.apply_night_revisions(revisions)
        flips = sum(1 for r, v in zip(targets, revisions) if r["result"] != v["result"])
        summary = {
            "status": "ok",
            "collect_date": collect_key,
            "night_pct": night["change_pct"],
            "revised": written,
            "flipped": flips,
            "finished_at": now_iso,
        }
        _last.clear()
        _last.update(summary)
        logger.info("prediction_night: %s", summary)
        return summary


def last_run() -> dict:
    return dict(_last)
