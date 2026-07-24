import datetime as dt
import os
import secrets

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query

from app.data.prediction_universe import MARKET_KOSDAQ, MARKET_KOSPI, MARKET_NASDAQ
from app.services import prediction_batch, prediction_grader, prediction_store
from app.services import trading_calendar as cal

router = APIRouter()

# Shared secret for the cron trigger. No default: an unset token disables the endpoint
# outright rather than leaving a publicly-callable batch trigger behind a guessable
# value — anyone could otherwise make the server run ~34 stocks' worth of scraping on
# demand.
BATCH_TOKEN = os.environ.get("PREDICTION_BATCH_TOKEN")

# Fixed order so the page's tab strip and the API agree without the frontend
# re-sorting; also the order a Korean-market audience reads them in.
MARKET_ORDER = (MARKET_KOSPI, MARKET_KOSDAQ, MARKET_NASDAQ)

MARKET_LABELS = {
    MARKET_KOSPI: "코스피",
    MARKET_KOSDAQ: "코스닥",
    MARKET_NASDAQ: "나스닥",
}


def _require_batch_token(authorization: str | None) -> None:
    if not BATCH_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="PREDICTION_BATCH_TOKEN이 설정되지 않아 배치 트리거가 비활성화되어 있습니다.",
        )
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[len("Bearer ") :]
    # compare_digest over ==: the token is a shared secret compared on every cron
    # firing, and a timing-variable comparison is the one avoidable leak here.
    if not supplied or not secrets.compare_digest(supplied, BATCH_TOKEN):
        raise HTTPException(status_code=401, detail="배치 토큰이 올바르지 않습니다.")


def _decorate(date_key: str) -> dict:
    """Adds the weekday the page prints next to the date. Done here rather than in the
    frontend so the Korean weekday comes from the same calendar the batch used, not
    from whatever timezone the visitor's browser happens to be in — a KST-evening
    reader in New York would otherwise see yesterday's label."""
    date = cal.from_key(date_key)
    return {
        "date": date_key,
        "iso": date.isoformat(),
        "weekday": cal.korean_weekday(date),
        "label": f"{date.month}월 {date.day}일 ({cal.korean_weekday(date)})",
    }


@router.get("/dates")
def dates(limit: int = Query(30, ge=1, le=120)):
    """Trading days that actually have predictions, newest first — the date
    navigator's options.

    Each entry also carries which markets have rows on that day. The KR and US batches
    land on different 예측일자 for most of the day (the New York close for a session
    arrives the following morning KST), so without this the page can only show one
    region at a time with no way to say where the other one went.
    """
    by_date = prediction_store.predict_date_markets(limit)
    return {
        "items": [
            {**_decorate(key), "markets": [m for m in MARKET_ORDER if m in markets]}
            for key, markets in by_date.items()
        ]
    }


@router.get("")
def predictions(
    date: str | None = Query(None, pattern=r"^\d{8}$"),
    market: str | None = Query(None),
):
    """Every prediction targeting one trading day, grouped by market.

    `date` is the 예측일자 (the day being predicted), not the 수집일자 — that's the
    date the page's navigator moves through, since a reader is choosing which
    session's forecast to look at.
    """
    target = date or prediction_store.latest_predict_date()
    if not target:
        return {"date": None, "groups": [], "count": 0, "generated_at": None}

    rows = prediction_store.list_by_predict_date(target, market)
    if not rows:
        return {**_decorate(target), "groups": [], "count": 0, "generated_at": None,
                "collect_dates": [], "scoreboard": [], "previous_session": None}

    # One accuracy read for every code on the page, rather than one request per card.
    # The track record is the reason to trust a call, so it has to arrive with the call.
    accuracy = prediction_grader.accuracy_summary(tuple({r["code"] for r in rows}))
    for row in rows:
        row["accuracy"] = accuracy.get(row["code"])

    by_market: dict[str, list[dict]] = {}
    for row in rows:
        by_market.setdefault(row["market"], []).append(row)

    groups = [
        {
            "market": m,
            "label": MARKET_LABELS.get(m, m),
            "items": by_market[m],
            "summary": _summarize(by_market[m]),
        }
        for m in MARKET_ORDER
        if m in by_market
    ]

    scoreboard = prediction_store.session_scoreboard(limit=20)
    return {
        **_decorate(target),
        "groups": groups,
        "count": len(rows),
        # The newest write across the whole day's rows — the two regions' batches
        # finish ~14 hours apart, so a single "collected at" would be wrong for one
        # of them.
        "generated_at": max((r["updated_at"] for r in rows), default=None),
        "collect_dates": sorted({r["collect_date"] for r in rows}),
        # Recent graded sessions, newest first — the page's "예측이 실제로 맞았는가" strip.
        "scoreboard": scoreboard,
        # The most recent session that has been graded and is strictly older than the
        # one on screen. Today's own predictions are ungraded by definition, so the
        # honest headline result is the last one that has actually been checked.
        "previous_session": next(
            (
                {**s, **_decorate(s["predict_date"])}
                for s in scoreboard
                if s["predict_date"] < target
            ),
            None,
        ),
    }


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _summarize(items: list[dict]) -> dict:
    """Per-market tally the page renders as its headline stat row."""
    up = sum(1 for it in items if it["result"] == "상승")
    down = sum(1 for it in items if it["result"] == "하락")
    flat = len(items) - up - down
    avg = sum(it["change_rate"] for it in items) / len(items) if items else 0.0
    graded = [it for it in items if it["hit"] is not None]
    reliabilities = [it["reliability"] for it in items if it["reliability"] is not None]
    return {
        "up": up,
        "down": down,
        "flat": flat,
        "avg_change_rate": round(avg, 2),
        "strong": sum(1 for it in items if it["confidence"] == "강"),
        "avg_reliability": _avg(reliabilities),
        "low_reliability": sum(1 for it in items if it["reliability_grade"] == "낮음"),
        # Present only once this day has been graded, which is what lets the page show a
        # verdict strip on a past date and omit it on today's still-open forecast.
        "graded": len(graded),
        "hit": sum(1 for it in graded if it["hit"]),
    }


@router.get("/accuracy")
def accuracy():
    """Hit rates over the recent 20 sessions, the recent 60, and everything on record —
    per market and per graded session. Only graded rows count: a prediction whose
    session hasn't closed yet is not a miss."""
    return {
        "markets": prediction_grader.market_accuracy(),
        "sessions": prediction_store.session_scoreboard(limit=60),
        "windows": {"short": prediction_grader.WINDOW_SHORT, "long": prediction_grader.WINDOW_LONG},
    }


@router.get("/stock/{code}")
def stock_history(code: str, limit: int = Query(20, ge=1, le=90)):
    """One stock's past predictions, newest first — the per-card track record, with
    the graded outcome attached to each row so 예측 vs 실제 reads off one table."""
    items = prediction_store.list_by_code(code, limit)
    if not items:
        raise HTTPException(status_code=404, detail=f"'{code}' 종목의 예측 이력이 없습니다.")
    return {
        "code": code,
        "name": items[0]["name"],
        "items": items,
        "accuracy": prediction_grader.accuracy_summary((code,)).get(code),
    }


@router.get("/run/status")
def run_status(
    region: str = Query(..., pattern=r"^(KR|US)$"),
    authorization: str | None = Header(None),
):
    """Whether that region's batch is in flight, and how the last one ended.

    Exists so the cron can trigger the batch and then *poll*, rather than holding one
    HTTP connection open for the whole run. Once Claude is actually in the loop a
    region takes minutes, and a request that long dies at the edge proxy (Cloudflare
    returns 522 to the caller) long before the batch finishes — the run itself is fine,
    but the trigger reports a failure and the step never sees the result.

    Behind the same batch token as /run: it exposes operational detail (timings,
    warnings, error strings) that has no reason to be public.
    """
    _require_batch_token(authorization)
    status = prediction_batch.get_status()
    return {
        "region": region,
        "running": region in status["running"],
        # Volatile — this is the web process's own memory of its last run, so it is
        # empty after a restart until the next run. The poller compares finished_at
        # against the value it read before triggering, which is what distinguishes
        # "this run finished" from "a previous run's record is still sitting here".
        "last_run": status["last_runs"].get(region),
    }


@router.post("/run")
def run(
    background: BackgroundTasks,
    region: str = Query(..., pattern=r"^(KR|US)$"),
    force: bool = Query(False),
    wait: bool = Query(False),
    authorization: str | None = Header(None),
):
    """Batch trigger for the GitHub Actions cron.

    Defaults to returning immediately and running in the background, because a full
    region takes minutes and a cron step that holds an HTTP connection that long is
    one network blip away from a false failure. `wait=true` runs it inline and returns
    the full per-stock summary — that's the mode to use when triggering it by hand and
    actually wanting to see what it decided.
    """
    _require_batch_token(authorization)

    if wait:
        return prediction_batch.run_batch(region, force=force)

    background.add_task(prediction_batch.run_batch, region, force)
    return {
        "region": region,
        "status": "accepted",
        "force": force,
        "queued_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
