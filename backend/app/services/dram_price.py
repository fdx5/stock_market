"""Daily DRAM spot-price batch: scrape TrendForce's public table, store today's
snapshot, and record the outcome for the admin panel — same status-tracking shape as
prediction_batch.py, sized down for a single daily run instead of two per-region ones.

Idempotent per price_date: dram_price_store.record_prices does INSERT OR REPLACE, so a
same-day re-run (a manual admin re-run, a cron retry) overwrites that day's rows rather
than duplicating them.
"""

import datetime as dt
import logging
import threading
import time

from app.data.dram_price_fetcher import fetch_dram_spot_prices
from app.services import dram_price_store as store
from app.services import kakao_notify

logger = logging.getLogger(__name__)

# Serializes runs process-wide — the in-process scheduler and an inbound manual/cron
# request can otherwise race to scrape and write the same date concurrently.
_run_lock = threading.Lock()

# Last-run record, for the admin panel. Volatile like prediction_batch's _last_runs:
# holds this process's own outcome (status, elapsed, who triggered it) and resets on
# restart. The admin panel falls back to store.latest_snapshot() (DB-backed, survives
# a restart) for the plain "what's the latest stored date" question.
_status_lock = threading.Lock()
_last_run: dict | None = None
_running = False


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def is_running() -> bool:
    with _status_lock:
        return _running


def get_status() -> dict:
    """Everything the admin panel needs to render this batch's health in one call."""
    with _status_lock:
        running = _running
        last_run = dict(_last_run) if _last_run else None
    snapshot = store.latest_snapshot()
    return {
        "running": running,
        "last_run": last_run,
        "latest_price_date": snapshot["price_date"],
        "item_count": len(snapshot["items"]),
    }


def _run_impl(triggered_by: str) -> dict:
    started = time.time()
    if not _run_lock.acquire(blocking=False):
        logger.info("dram_price: another run is in flight, refusing")
        return {"status": "skipped", "reason": "already_running", "triggered_by": triggered_by}

    try:
        result = fetch_dram_spot_prices()
        scraped_at = _now_iso()
        store.record_prices(result["price_date"], result["items"], scraped_at)
        elapsed = round(time.time() - started, 1)
        logger.info(
            "dram_price: saved %d items for %s in %ss", len(result["items"]), result["price_date"], elapsed
        )
        return {
            "status": "ok",
            "price_date": result["price_date"],
            "item_count": len(result["items"]),
            "items": result["items"],
            "elapsed_seconds": elapsed,
            "triggered_by": triggered_by,
        }
    finally:
        _run_lock.release()


def _record(summary: dict) -> dict:
    """Trims a run's outcome down to what the admin panel/KakaoTalk message need —
    mirrors prediction_batch._record. `items` (the full per-SKU list) rides along since
    the admin panel's message wants it, unlike prediction_batch's per-stock debug blob."""
    recorded = {
        "status": summary.get("status"),
        "reason": summary.get("reason"),
        "price_date": summary.get("price_date"),
        "item_count": summary.get("item_count", 0),
        "items": summary.get("items", []),
        "elapsed_seconds": summary.get("elapsed_seconds"),
        "triggered_by": summary.get("triggered_by"),
        "error": summary.get("error"),
        "finished_at": _now_iso(),
    }
    global _last_run
    with _status_lock:
        _last_run = recorded
    return recorded


def run_batch(triggered_by: str = "system") -> dict:
    """Public entry point: runs the batch and records its outcome. `triggered_by`
    distinguishes cron ('cron'), the in-process scheduler fallback ('in_process'), and
    a hand-pressed admin re-run ('admin'), which the panel surfaces.

    Marks the batch 'running' for the whole call so the panel can show an in-flight
    state, and records the outcome (including a failure) before any exception
    propagates, so a crashed run still shows up as failed rather than stale success.
    """
    global _running
    with _status_lock:
        _running = True
    try:
        summary = _run_impl(triggered_by)
    except Exception as exc:  # noqa: BLE001 - record then re-raise, don't swallow
        recorded = _record({"status": "error", "error": str(exc), "triggered_by": triggered_by})
        kakao_notify.schedule_dram_price_result(recorded)
        raise
    else:
        recorded = _record(summary)
        # "D램 현물가격 배치 실행결과" KakaoTalk notification — fires ~10 minutes from now,
        # independent of this call returning immediately. Scheduled on every outcome
        # (ok, skipped, or error), same reasoning as prediction_batch's own schedule.
        kakao_notify.schedule_dram_price_result(recorded)
        return summary
    finally:
        with _status_lock:
            _running = False


def get_latest() -> dict:
    """The most recently recorded day's items — what the dashboard's DRAM price panel
    renders. Always reads whatever the daily batch last stored; never scrapes inline,
    so a stock-detail page view never pays for (or waits on) a live TrendForce fetch."""
    return store.latest_snapshot()


def get_history(item_name: str, limit_days: int = 90) -> list[dict]:
    """One item's daily series — unused until enough days have accumulated for a
    trend chart to be worth drawing (see dram_price_store.history's docstring)."""
    return store.history(item_name, limit_days)


# ---------------------------------------------------------------------------
# In-process scheduler (secondary trigger)
# ---------------------------------------------------------------------------
#
# GitHub Actions cron (.github/workflows/dram-price-refresh.yml) is the primary
# trigger — it survives Render restarts and leaves a run log. This thread is the
# safety net for the window where Render's free-tier instance is asleep when that
# cron fires, same dual-trigger shape as prediction_batch/global_top100.
#
# TrendForce's own "Last Update" for the DRAM spot table lands ~18:10 GMT+8 (~19:10
# KST), so 20:00 KST leaves a comfortable hour of buffer for that day's print to have
# actually landed before this scrapes it.
RUN_AFTER_KST_HOUR = 20
_SCHEDULER_POLL_SECONDS = 300


def _seconds_until_kst_hour(target_kst_hour: int) -> float:
    now = dt.datetime.now(dt.timezone.utc)
    kst_now = now + dt.timedelta(hours=9)
    target_kst = kst_now.replace(hour=target_kst_hour, minute=0, second=0, microsecond=0)
    if target_kst <= kst_now:
        target_kst += dt.timedelta(days=1)
    return (target_kst - kst_now).total_seconds()


def _scheduler_loop() -> None:
    time.sleep(_seconds_until_kst_hour(RUN_AFTER_KST_HOUR))
    while True:
        try:
            run_batch(triggered_by="in_process")
        except Exception:
            # A missed evening just means the panel keeps showing yesterday's snapshot
            # (or the GitHub Actions cron covering the same job succeeds instead) until
            # the next tick — not worth taking the process down over.
            logger.exception("dram_price: scheduled run failed")
        time.sleep(24 * 3600)


def start_scheduler() -> None:
    threading.Thread(target=_scheduler_loop, daemon=True, name="dram-price-batch").start()
