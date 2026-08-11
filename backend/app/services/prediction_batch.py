"""The batch itself: collect → score → judge → persist, once per market close.

Two independent runs, because the two markets close ~14 hours apart and neither
should wait on the other:

  region="KR"  runs 23:00 KST on a KRX session day, covers KOSPI + KOSDAQ
  region="US"  runs 23:00 ET on a NYSE/Nasdaq session day, covers NASDAQ

plus a 22:00-local Sunday slot per region that always re-runs the Friday session,
forced (see the scheduler section at the bottom). Saturday never runs.

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
    kakao_notify,
    prediction_engine,
    prediction_features,
    prediction_grader,
    prediction_mail,
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


def last_run_or_snapshot(region: str) -> dict | None:
    """This region's last run as a summary, falling back to one rebuilt from the stored
    rows when `_last_runs` has no memory of it.

    `_last_runs` only covers runs this process performed, and a region runs roughly once
    a day while the service restarts on every deploy — so for most of any given day
    there is a perfectly good batch result in the database and nothing in memory
    describing it. Callers that only want to *describe* the last run (the admin panel's
    manual KakaoTalk resend) should use this rather than `get_status()["last_runs"]`,
    which would tell them no run ever happened.

    The rebuilt summary is marked `source: "db_snapshot"` and carries only what the rows
    can prove — how many were saved, for which 예측일, and when they landed. Fields that
    exist solely in a live run's memory (elapsed time, per-market analyst path, warnings)
    are absent rather than guessed. Returns None when the region has no stored rows at
    all, which is the one case that genuinely has nothing to report.
    """
    with _status_lock:
        recorded = _last_runs.get(region)
        if recorded is not None:
            return dict(recorded)

    markets = REGION_MARKETS.get(region)
    if not markets:
        return None

    by_market = prediction_store.latest_run_by_market()
    present = {market: by_market[market] for market in markets if market in by_market}
    if not present:
        return None

    return {
        "status": "ok",
        "source": "db_snapshot",
        "collect_date": max(s["collect_date"] for s in present.values()),
        "predict_date": max(s["predict_date"] for s in present.values()),
        "saved": sum(s["count"] for s in present.values()),
        "markets": {market: {"count": s["count"]} for market, s in present.items()},
        "finished_at": max(s["updated_at"] for s in present.values()),
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

        features = prediction_features.collect_all(roster, session)
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
            judgements, source, ai_error = ai_analyst.analyze(market, payloads, market_ctx)

            # Falling back to the heuristic is correct when no key is configured, but
            # falling back *with* a key set means the Claude call failed — a wrong
            # model name, an expired key, an SDK too old for `output_config`. That
            # path is caught inside analyze() so the batch still produces rows, which
            # is the right behaviour and also why it went unnoticed for a full day of
            # runs: every batch reported success while every rationale came from the
            # fallback. The exception text rides along in the warning so the cron
            # output and the admin panel name the actual cause, instead of pointing
            # at a server log the operator has to go read on the host.
            if ai_error:
                warnings.append(f"{market}: Claude 분석 실패로 휴리스틱 폴백 — {ai_error}")

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


def _record(region: str, summary: dict) -> dict:
    """Stores a trimmed copy of a run's outcome for the admin panel, and returns that
    same trimmed copy — the run_batch caller hands it straight to
    kakao_notify.schedule_prediction_result rather than the raw (much larger)
    summary, so the KakaoTalk message describes exactly what the admin panel shows.

    The full summary carries every stock's per-factor debug — far more than a status
    widget needs and not worth holding in memory indefinitely — so only the headline
    fields are kept.
    """
    recorded = {
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
    with _status_lock:
        _last_runs[region] = recorded
    return recorded


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
        recorded = _record(region, {"status": "error", "error": str(exc), "triggered_by": triggered_by})
        kakao_notify.schedule_prediction_result(region, recorded)
        raise
    else:
        recorded = _record(region, summary)
        # "AI 예측 배치 실행결과" KakaoTalk notification — fires ~10 minutes from now,
        # independent of this call returning immediately. Scheduled for every
        # completion (ok, skipped, or error above), since a skip is itself a fact
        # worth knowing ("이미 실행됨" vs the batch silently never having fired at all).
        kakao_notify.schedule_prediction_result(region, recorded)
        # 예측 메일 — the same ten-minute delay, and deliberately driven from here
        # rather than from a clock. The mail's subject line is a specific 예측일자 for
        # a specific stock, so the only moment it can be sent is once that row exists;
        # a fixed daily time would have to guess, and would guess wrong for whichever
        # region hadn't run yet. Handed `summary` rather than `recorded` because only
        # the full summary carries the per-stock rows this run produced, which is what
        # keeps a KR run from mailing NASDAQ names (and vice versa).
        prediction_mail.schedule_after_batch(summary)
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
# does the work and the other skips. The two slots below mirror the cron expressions in
# ai-prediction.yml; changing one without the other makes the safety net fire at a
# different time than the thing it is backing up.

# Each slot is in the market's *own* local time (KST for KR, ET for US), so the two
# regions share these clock times while running ~14 hours apart in absolute terms.
#
# Weekday: 23:00, long after both bells (15:30 KST / 16:00 ET). The gap is deliberate
# headroom, not a bell offset — Naver's end-of-session figures (final close, full-day
# investor flows) are settled many hours by then, and a same-evening slot still leaves
# the whole night for a failure to be noticed before the next open.
WEEKDAY_RUN_AFTER = dt.time(23, 0)
# Sunday: 22:00, and it always runs — forced. Friday's is still the most recent closed
# session, so an unforced Sunday run would hit `has_run` and skip every week; forcing
# re-collects and re-scores that session (an upsert, so Friday's rows are refreshed
# rather than duplicated) and covers a Friday run that never landed. Saturday has no
# slot in either region.
WEEKEND_RUN_AFTER = dt.time(22, 0)

_SCHEDULER_POLL_SECONDS = 300

# Slots this process has already completed, region -> slot key. The weekday slot is
# self-limiting (once it saves rows, `has_run` stops the next poll), but a forced
# Sunday run has no such guard and would otherwise restart every 5 minutes until
# midnight. Recorded only on success, so a failed run is retried by the next poll.
# In-process and volatile: a restart inside the Sunday window costs one repeat run,
# which is an upsert of the same session.
_slots_done: dict[str, str] = {}


def _due_slot(region: str) -> tuple[str, bool] | None:
    """The slot this region owes right now as (slot_key, force), or None.

    Mirrors the cron slots in ai-prediction.yml: 23:00 local on a session day, 22:00
    local on Sunday. A holiday or Saturday matches neither and returns None.
    """
    now = cal.now_kst() if region == REGION_KR else cal.now_et()
    if cal.is_trading_day(now.date(), region):
        if now.time() < WEEKDAY_RUN_AFTER:
            return None
        slot, force = "weekday", False
    elif now.weekday() == 6:  # Sunday
        if now.time() < WEEKEND_RUN_AFTER:
            return None
        slot, force = "sunday", True
    else:
        return None

    key = f"{cal.to_key(now.date())}:{slot}"
    if _slots_done.get(region) == key:
        return None
    if not force:
        # Keyed on the session being reported, not on today's date — after a holiday the
        # two differ, and run_batch resolves the session the same way.
        session = cal.to_key(cal.session_date(region))
        if prediction_store.has_run(session, REGION_MARKETS[region][0]):
            return None
    return key, force


def _scheduler_loop() -> None:
    while True:
        for region in (REGION_KR, REGION_US):
            try:
                due = _due_slot(region)
                if due is None:
                    continue
                key, force = due
                logger.info(
                    "prediction_batch: in-process scheduler triggering %s (%s, force=%s)",
                    region,
                    key,
                    force,
                )
                run_batch(region, force=force)
                _slots_done[region] = key
            except Exception:
                # A failed run must not kill the loop — the next poll retries, since the
                # slot is only marked done above on success.
                logger.exception("prediction_batch: scheduled run failed for %s", region)
        time.sleep(_SCHEDULER_POLL_SECONDS)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="prediction-batch").start()
