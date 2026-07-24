"""The batch itself: collect → score → judge → persist, once per market close.

Two independent runs, because the two markets close ~14 hours apart and neither
should wait on the other:

  region="KR"  fires after the KRX close (15:30 KST) and covers KOSPI + KOSDAQ
  region="US"  fires after the NYSE/Nasdaq close (16:00 ET) and covers NASDAQ

They share every stage below and differ only in roster, calendar, and trigger time,
so they are one function parameterized by region rather than two pipelines that would
drift apart.

Idempotent by (수집일자, market): a second firing on the same session — a cron retry,
a manual dispatch after a partial failure — updates that day's rows rather than
appending a second set, and skips the work entirely unless `force` is passed.
"""

import datetime as dt
import logging
import threading
import time

from app.data import exchange_fetcher
from app.data.prediction_universe import KR_MARKETS, US_MARKETS, get_roster
from app.services import (
    ai_analyst,
    prediction_engine,
    prediction_features,
    prediction_grader,
    prediction_quality,
    prediction_store,
)
from app.services import trading_calendar as cal

logger = logging.getLogger(__name__)

REGION_KR = "KR"
REGION_US = "US"

REGION_MARKETS = {REGION_KR: KR_MARKETS, REGION_US: US_MARKETS}

# Serializes runs process-wide. The in-process scheduler and an inbound /run request
# can otherwise start the same region concurrently, and two runs racing on the same
# (collect_date, stock_code) would both scrape everything to write the same rows.
_run_lock = threading.Lock()

# Last-run record per region, for the admin panel. Volatile on purpose: it holds the
# rich outcome of the last run *this process* did (status, elapsed, warnings, which
# analyst path ran, who triggered it), which no query can reconstruct. It resets on
# restart — the admin panel pairs it with prediction_store.latest_run_by_market(),
# which is DB-backed and does survive a restart, so a restarted process still shows
# "최근 실행시간" from the data even before the next run repopulates this.
#
# Every trigger — cron HTTP call, in-process scheduler, admin button — runs in this
# same web process and goes through run_batch, so this captures all of them.
_status_lock = threading.Lock()
_last_runs: dict[str, dict] = {}
_running: set[str] = set()


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def is_running(region: str) -> bool:
    with _status_lock:
        return region in _running


def get_status() -> dict:
    """Everything the admin panel needs to render batch health, in one call.

    `running` is the live in-flight set; `last_runs` is this process's per-region
    outcome memory; `markets` is the DB-derived per-market snapshot (restart-proof).
    The panel prefers `last_runs` for detail and falls back to `markets` for the
    plain "when did each batch last produce data" after a restart wipes `last_runs`.
    """
    with _status_lock:
        running = sorted(_running)
        last_runs = {region: dict(summary) for region, summary in _last_runs.items()}
    return {
        "running": running,
        "last_runs": last_runs,
        "markets": prediction_store.latest_run_by_market(),
        "regions": {region: list(markets) for region, markets in REGION_MARKETS.items()},
    }


def _group_by_market(features: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for f in features:
        grouped.setdefault(f["item"]["market"], []).append(f)
    return grouped


def _run_batch_impl(region: str, force: bool, triggered_by: str) -> dict:
    """Runs one region's batch and returns a summary of what it did.

    The summary is the operator's only view into a run that otherwise happens
    unattended, so it reports per-market counts, which analyst path produced the 60%,
    and any stock that was skipped — a run that quietly covered 28 of 34 names should
    be visible as such in the cron log, not just in the page's gaps.
    """
    markets = REGION_MARKETS.get(region)
    if not markets:
        raise ValueError(f"Unknown region: {region!r}")

    started = time.time()
    session = cal.session_date(region)
    collect_date = cal.to_key(session)
    predict_day = cal.next_trading_day(session, region)
    predict_date = cal.to_key(predict_day)

    warnings: list[str] = []
    if not cal.has_calendar_for(predict_day, region):
        # The holiday table is hand-maintained; once it runs out, next_trading_day
        # still returns the next weekday but can no longer skip a closure. Say so
        # rather than publishing a confident prediction for a day the market is shut.
        warnings.append(
            f"휴장일 테이블에 {predict_day.year}년 데이터가 없어 예측일자가 부정확할 수 있음"
        )

    if not force:
        already = [m for m in markets if prediction_store.has_run(collect_date, m)]
        if len(already) == len(markets):
            logger.info("prediction_batch: %s already ran for %s, skipping", region, collect_date)
            return {
                "region": region,
                "status": "skipped",
                "reason": "already_ran",
                "collect_date": collect_date,
                "predict_date": predict_date,
                "saved": 0,
                "warnings": warnings,
                "triggered_by": triggered_by,
            }

    if not _run_lock.acquire(blocking=False):
        logger.info("prediction_batch: another run is in flight, refusing %s", region)
        return {
            "region": region,
            "status": "skipped",
            "reason": "already_running",
            "collect_date": collect_date,
            "predict_date": predict_date,
            "saved": 0,
            "warnings": warnings,
            "triggered_by": triggered_by,
        }

    try:
        roster = get_roster(markets)
        logger.info(
            "prediction_batch: %s roster=%d collect=%s predict=%s",
            region,
            len(roster),
            collect_date,
            predict_date,
        )

        # Grading first, and outside the try/except that guards the rest: the session
        # that just closed is the one yesterday's predictions were made *for*, so this
        # is the moment they become checkable. Doing it here rather than on its own
        # schedule also means the accuracy figures the page shows are never staler than
        # the predictions printed next to them.
        #
        # A failure here must not cost the day's predictions, so it degrades to a
        # warning — the rows stay ungraded and the next run picks them up.
        try:
            grading = prediction_grader.grade_pending(markets, session, _now_iso())
        except Exception as exc:  # noqa: BLE001 - grading is not worth losing a run over
            logger.exception("prediction_batch: grading pass failed for %s", region)
            warnings.append(f"이전 예측 채점 실패: {exc}")
            grading = {"checked": 0, "graded": 0, "pending": 0, "hits": 0}

        features = prediction_features.collect_all(roster)
        collected_codes = {f["item"]["code"] for f in features}
        skipped = [it["code"] for it in roster if it["code"] not in collected_codes]
        if skipped:
            warnings.append(f"시세 이력 부족으로 제외된 종목: {', '.join(skipped)}")

        now_iso = _now_iso()
        rows: list[dict] = []
        per_market: dict[str, dict] = {}

        # One FX read for the whole run. It's the same notice rate for every stock, and
        # it feeds the close explanation rather than any score, so a failure here costs
        # one line of narrative and nothing else.
        try:
            fx = exchange_fetcher.get_usd_krw()
        except Exception:  # noqa: BLE001
            fx = None

        for market, group in _group_by_market(features).items():
            # The technical block is computed first and handed to the analyst, so the
            # 60% judgement is made in full view of what the 40% already concluded
            # rather than in isolation from it.
            payloads = []
            for f in group:
                technical = prediction_engine.compute_technical(f, session)
                note = prediction_engine.stale_note(session, technical["as_of"])
                if note:
                    warnings.append(f"{f['item']['code']}: {note}")
                payloads.append({**f, "technical": technical})

            index = prediction_features.get_index_context(market)
            # Built after every stock's technical block exists, because the peer and
            # sector averages inside it are a property of the whole group — the thing
            # that lets a single row say whether the stock moved or the market did.
            market_ctx = prediction_quality.build_market_context(market, payloads, index, fx)
            judgements, source = ai_analyst.analyze(market, payloads, market_ctx)

            # Falling back to the heuristic is correct when no key is configured, but
            # falling back *with* a key set means the Claude call failed — a wrong
            # model name, an expired key, an SDK too old for `output_config`. That
            # path is caught inside analyze() so the batch still produces rows, which
            # is the right behaviour and also why it went unnoticed for a full day of
            # runs: every batch reported success while every rationale came from the
            # fallback. Surfacing it as a warning puts it in the cron log and the
            # admin panel, where the next occurrence is visible in seconds.
            if source != ai_analyst.SOURCE_CLAUDE and ai_analyst.ANTHROPIC_API_KEY:
                warnings.append(
                    f"{market}: ANTHROPIC_API_KEY가 설정되어 있으나 Claude 분석에 실패해 "
                    "휴리스틱으로 폴백함 (원인은 서버 로그의 'ai_analyst' 항목 참조)"
                )

            for payload in payloads:
                code = payload["item"]["code"]
                judgement = judgements.get(code)
                if judgement is None:
                    # analyze() backfills omissions itself, so reaching here means an
                    # unexpected shape. Skip the row rather than storing a prediction
                    # with a silently-zeroed 60%.
                    warnings.append(f"{code}: AI 판단 누락으로 제외")
                    continue
                rows.append(
                    prediction_engine.build_prediction(
                        payload,
                        payload["technical"],
                        judgement,
                        collect_date,
                        predict_date,
                        now_iso,
                        market_ctx,
                    )
                )

            per_market[market] = {"count": len(payloads), "ai_source": source}

        # A manual rerun (force=True) regenerates the day: delete this run's
        # (수집일자, 시장) slice, then insert fresh — so a roster that shifted since the
        # first run can't leave a dropped name's row lingering (see
        # prediction_store.replace_predictions). The normal cron path upserts instead,
        # which preserves each row's original created_at and lets a partial re-run
        # (one market failed the first time) fill in the gap without touching the
        # market that already succeeded.
        if force:
            saved = prediction_store.replace_predictions(rows)
        else:
            saved = prediction_store.upsert_predictions(rows)
        elapsed = round(time.time() - started, 1)
        logger.info("prediction_batch: %s saved=%d in %ss", region, saved, elapsed)

        return {
            "region": region,
            "status": "ok",
            "collect_date": collect_date,
            "predict_date": predict_date,
            "predict_weekday": cal.korean_weekday(predict_day),
            "saved": saved,
            "markets": per_market,
            "grading": grading,
            "elapsed_seconds": elapsed,
            "warnings": warnings,
            "triggered_by": triggered_by,
            "results": [
                {
                    "code": r["code"],
                    "name": r["name"],
                    "market": r["market"],
                    "result": r["result"],
                    "change_rate": r["change_rate"],
                    "confidence": r["confidence"],
                    **r["_debug"],
                }
                for r in rows
            ],
        }
    finally:
        _run_lock.release()


def _record(region: str, summary: dict) -> None:
    """Stores a trimmed copy of a run's outcome for the admin panel. The full summary
    carries every stock's per-factor debug — far more than a status widget needs and
    not worth holding in memory indefinitely — so only the headline fields are kept.
    """
    with _status_lock:
        _last_runs[region] = {
            "status": summary.get("status"),
            "reason": summary.get("reason"),
            "collect_date": summary.get("collect_date"),
            "predict_date": summary.get("predict_date"),
            "predict_weekday": summary.get("predict_weekday"),
            "saved": summary.get("saved", 0),
            "markets": summary.get("markets", {}),
            "grading": summary.get("grading"),
            "elapsed_seconds": summary.get("elapsed_seconds"),
            "warnings": summary.get("warnings", []),
            "triggered_by": summary.get("triggered_by"),
            "error": summary.get("error"),
            "finished_at": _now_iso(),
        }


def run_batch(region: str, force: bool = False, triggered_by: str = "system") -> dict:
    """Public entry point: runs the region's batch and records its outcome for the
    admin panel. `triggered_by` distinguishes a cron/scheduler run ('system') from a
    hand-pressed admin re-run ('admin'), which the panel surfaces.

    Marks the region 'running' for the whole call so the panel can show an in-flight
    state, and records the outcome — including a failure — before the exception (if
    any) propagates, so a crashed run still shows up as failed rather than as stale
    success. The exception is re-raised so the caller's own error handling (a cron's
    HTTP 500, the scheduler's logged catch) is unchanged.
    """
    with _status_lock:
        _running.add(region)
    try:
        summary = _run_batch_impl(region, force, triggered_by)
    except Exception as exc:  # noqa: BLE001 - record then re-raise, don't swallow
        _record(region, {"status": "error", "error": str(exc), "triggered_by": triggered_by})
        raise
    else:
        _record(region, summary)
        return summary
    finally:
        with _status_lock:
            _running.discard(region)


# ---------------------------------------------------------------------------
# In-process scheduler (secondary trigger)
# ---------------------------------------------------------------------------
#
# GitHub Actions cron is the primary trigger — it survives Render restarts and leaves
# a run log. This thread is the safety net for the case that cron can't cover: GitHub
# disables scheduled workflows after 60 days without a commit (the same caveat already
# documented in keep-alive.yml), and cron firing can be delayed under GitHub-wide
# load. Both triggers hit the same idempotent run_batch, so whichever arrives first
# does the work and the other skips.

# Minutes after each close before running. The delay is not cosmetic: Naver's
# end-of-session figures (final close, full-day investor flows) settle over the few
# minutes after the bell, and scraping at the bell reliably picks up a partial day.
KR_RUN_AFTER = dt.time(15, 45)
US_RUN_AFTER = dt.time(16, 15)

_SCHEDULER_POLL_SECONDS = 300


def _should_run_now(region: str) -> bool:
    now = cal.now_kst() if region == REGION_KR else cal.now_et()
    threshold = KR_RUN_AFTER if region == REGION_KR else US_RUN_AFTER
    if not cal.is_trading_day(now.date(), region):
        return False
    if now.time() < threshold:
        return False
    return not prediction_store.has_run(cal.to_key(now.date()), REGION_MARKETS[region][0])


def _scheduler_loop() -> None:
    while True:
        for region in (REGION_KR, REGION_US):
            try:
                if _should_run_now(region):
                    logger.info("prediction_batch: in-process scheduler triggering %s", region)
                    run_batch(region)
            except Exception:
                # A failed run must not kill the loop — the next poll retries, and the
                # `has_run` guard means a run that did succeed isn't repeated.
                logger.exception("prediction_batch: scheduled run failed for %s", region)
        time.sleep(_SCHEDULER_POLL_SECONDS)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="prediction-batch").start()
