"""Orchestrates the daily 장마감 리포트 -> 네이버 블로그 발행 batch.

Chained off the existing market brief batch: market_brief._loop() finishes run_all()
around 16:10-16:15 KST and calls schedule_publish_after_brief(), which fires this run
exactly 10 minutes later.

Ordering guarantees, in the order they matter:

1. Nothing publishes twice. naver_publish_store's (report_date, market) primary key and
   its claim() UPDATE are the boundary — not a check in this module. This function can
   be run twice concurrently and the second run will simply find nothing to claim.

2. A dead session stops the whole run immediately. Repeatedly bouncing off the Naver
   login page is what turns "cookies expired" into "account flagged", so the first
   NaverSessionExpired aborts the remaining targets and alerts instead.

3. Posts are spaced out. Seven posts landing inside a minute is the shape Naver's
   anti-abuse tooling looks for; PUBLISH_GAP puts a randomized 60-180s between them, so
   a full run takes roughly 7-20 minutes.
"""

import datetime as dt
import logging
import os
import random
import threading
import time
from zoneinfo import ZoneInfo

from app.services import (
    kakao_notify,
    market_brief_store,
    naver_blog_client,
    naver_brief_charts,
    naver_document_model,
    naver_publish_store,
    naver_session_store,
)
from app.services.naver_blog_exporter import TARGET_CONFIG

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)

# The requirement is "+10분 뒤". The brief batch's own chain used 300s for the HTML
# exporter; publishing gets the full 600.
PUBLISH_DELAY_SECONDS = int(os.environ.get("NAVER_PUBLISH_DELAY_SECONDS", "600"))

# Randomized inter-post gap (seconds).
PUBLISH_GAP = (
    int(os.environ.get("NAVER_PUBLISH_GAP_MIN", "60")),
    int(os.environ.get("NAVER_PUBLISH_GAP_MAX", "180")),
)

SITE_URL = "https://kospi-predictor.onrender.com"

# Chart images in the post body (app/services/naver_brief_charts.py).
#
# OFF by default, deliberately. The images render correctly and a manual probe proved
# the editor's upload path works, but driving that path from inside the publish flow is
# not yet reliable — set_input_files reports success and no image component ever appears.
# Until that is understood, the daily batch should not spend ~3 extra minutes per post
# retrying an upload that fails. Set NAVER_PUBLISH_CHARTS=1 to exercise it.
#
# The post is complete without charts, and resolve_image_slots drops unfilled slots, so
# this switch changes decoration only.
CHARTS_ENABLED = os.environ.get("NAVER_PUBLISH_CHARTS", "0") != "0"

# One run at a time in this process, mirroring market_brief._lock. The store's claim()
# is the real cross-process guard; this just avoids two threads spinning up two
# Chromium instances on a 1-CPU container.
_lock = threading.Lock()

_last_run: dict | None = None


def get_last_run() -> dict | None:
    return _last_run


def is_configured() -> bool:
    return naver_session_store.is_configured()


def _meta_for(market: str) -> dict | None:
    for cfg in TARGET_CONFIG:
        if cfg["market"] == market:
            return cfg
    return None


def _alert(text: str) -> None:
    """Admin notification. Never allowed to break the batch — an unconfigured or
    rate-limited Kakao app must not turn a publishing problem into a crash."""
    try:
        kakao_notify.send_message(text)
    except Exception:
        log.exception("failed to send admin alert")


def enqueue_for_date(report_date: str) -> list[str]:
    """Registers every target that has a brief stored for this date.

    Driven off market_close_briefs rather than off TARGET_CONFIG alone: if the brief
    batch only managed five of seven, the two missing ones should not be queued as
    publishable work.
    """
    queued = []
    for cfg in TARGET_CONFIG:
        market = cfg["market"]
        if market_brief_store.get(report_date, market) is None:
            continue
        if naver_publish_store.enqueue(report_date, market):
            queued.append(market)
    return queued


def publish_one(report_date: str, market: str, cookies: list[dict], *, dry_run: bool = False) -> dict:
    """Publishes a single (date, market). Assumes the claim is already held."""
    brief = market_brief_store.get(report_date, market)
    if brief is None:
        raise naver_blog_client.NaverPublishError(f"no brief stored for {report_date}/{market}")

    meta = _meta_for(market)
    if meta is None:
        raise naver_blog_client.NaverPublishError(f"no TARGET_CONFIG entry for {market}")

    title_paragraphs = naver_document_model.build_title_paragraphs(
        naver_document_model.build_title(brief, meta)
    )
    body = naver_document_model.build_body_components(brief, meta, site_url=SITE_URL)
    tags = naver_document_model.build_tags(brief, meta)

    # Charts are optional decoration on top of a post that is complete without them, so
    # a rendering failure is logged and dropped rather than allowed to block publishing.
    charts: list[tuple[str, bytes]] = []
    if CHARTS_ENABLED:
        try:
            charts = naver_brief_charts.render_all(brief, meta)
        except Exception:
            log.exception("chart rendering failed for %s; publishing without charts", market)

    return naver_blog_client.publish(
        brief, meta, title_paragraphs, body, tags, cookies, charts=charts, dry_run=dry_run
    )


def run(
    report_date: str | None = None,
    *,
    dry_run: bool = False,
    triggered_by: str = "chain",
    only: list[str] | None = None,
) -> dict:
    """Publishes every outstanding post for `report_date` (default: today KST).

    `only` restricts the run to specific markets — for iterating on one target during a
    dry run without walking all seven.
    """
    global _last_run

    if not _lock.acquire(blocking=False):
        return {"status": "already_running"}

    try:
        report_date = report_date or dt.datetime.now(KST).date().isoformat()
        started = dt.datetime.now(KST)
        result = {
            "status": "ok",
            "report_date": report_date,
            "triggered_by": triggered_by,
            "dry_run": dry_run,
            "published": [],
            "verified": [],   # dry-run only: content confirmed inside the editor
            "failed": [],
            "skipped": [],
            "started_at": started.isoformat(timespec="seconds"),
        }

        if not naver_session_store.is_configured():
            result["status"] = "not_configured"
            log.warning("NAVER_SESSION_KEY unset — publishing disabled")
            _last_run = result
            return result

        session = naver_session_store.get()
        if not session:
            result["status"] = "no_session"
            _alert(
                "📕 네이버 블로그 자동발행 중단\n\n"
                "저장된 로그인 세션이 없습니다.\n"
                "scripts/naver_login_setup.py 를 1회 실행해 재연동해주세요."
            )
            _last_run = result
            return result

        # A redeploy mid-run leaves rows claimed forever; hand them back first.
        released = naver_publish_store.release_stale()
        if released:
            log.info("released %s stale publish claims", released)

        enqueue_for_date(report_date)
        targets = naver_publish_store.pending(report_date)
        if only:
            wanted = {m.upper() for m in only}
            targets = [t for t in targets if t["market"] in wanted]
        if not targets:
            result["status"] = "nothing_to_do"
            _last_run = result
            return result

        cookies = session["cookies"]
        blog_id = session.get("blog_id") or naver_blog_client.BLOG_ID

        for i, row in enumerate(targets):
            market = row["market"]

            # A dry run verifies; it does not attempt. Claiming would burn one of the
            # three real retries and mark the row failed, so a few rounds of iterating on
            # the document model would leave every target permanently unclaimable — which
            # is exactly what happened the first time this was exercised.
            if not dry_run and not naver_publish_store.claim(report_date, market):
                result["skipped"].append(market)
                continue

            # The gap exists to avoid looking like a burst poster to Naver's anti-abuse
            # tooling. A dry run never posts, so it only makes iteration painful — a
            # seven-target dry run was taking over ten minutes, almost all of it asleep.
            if i and not dry_run:
                gap = random.randint(*PUBLISH_GAP)
                log.info("waiting %ss before publishing %s", gap, market)
                time.sleep(gap)

            try:
                outcome = publish_one(report_date, market, cookies, dry_run=dry_run)
            except naver_blog_client.NaverSessionExpired as exc:
                naver_publish_store.mark_failed(report_date, market, f"session expired: {exc}")
                result["status"] = "session_expired"
                result["failed"].append({"market": market, "error": str(exc)})
                _alert(
                    "📕 네이버 블로그 자동발행 중단 (세션 만료)\n\n"
                    f"날짜: {report_date}\n"
                    f"중단 지점: {market}\n\n"
                    "scripts/naver_login_setup.py 를 1회 실행해 재로그인해주세요.\n"
                    "미발행 건은 큐에 남아 다음 실행 때 자동으로 이어서 발행됩니다."
                )
                # Stop the whole run — see module docstring, point 2.
                break
            except Exception as exc:
                log.exception("publish failed for %s/%s", report_date, market)
                naver_publish_store.mark_failed(report_date, market, str(exc))
                result["failed"].append({"market": market, "error": str(exc)[:200]})
                continue

            # Cookies rotate as the session is used; persist the newest jar so the next
            # run starts from the freshest state rather than the seeded one.
            fresh = outcome.get("cookies")
            if fresh:
                cookies = fresh
                try:
                    naver_session_store.save(fresh, blog_id)
                except Exception:
                    log.exception("could not persist refreshed cookies")

            if dry_run:
                # Ledger deliberately untouched — see the claim() guard above. Reported
                # in its own bucket: lumping it into `skipped` made a verified dry run
                # look identical to a row that could not be claimed.
                result["verified"].append(
                    {
                        "market": market,
                        "components": outcome.get("components"),
                        "chars": outcome.get("chars"),
                        "title": outcome.get("title"),
                    }
                )
                continue

            naver_publish_store.mark_published(
                report_date, market, outcome["log_no"], outcome["post_url"]
            )
            naver_session_store.mark_ok()
            result["published"].append({"market": market, "url": outcome["post_url"]})
            log.info("published %s/%s -> %s", report_date, market, outcome["post_url"])

        result["finished_at"] = dt.datetime.now(KST).isoformat(timespec="seconds")

        if result["failed"] and result["status"] == "ok":
            result["status"] = "partial"

        _notify_summary(result)
        _last_run = result
        return result
    finally:
        _lock.release()


def _notify_summary(result: dict) -> None:
    """One summary message per run. Silent on a fully clean dry run, and silent when
    there was nothing to do — the point is to hear about problems, not to get a Kakao
    ping every weekday for a batch that worked."""
    if result.get("dry_run"):
        return
    published = result.get("published") or []
    failed = result.get("failed") or []
    if result.get("status") == "session_expired":
        return  # already alerted, with actionable detail
    if not failed:
        return

    lines = [
        "📕 네이버 블로그 자동발행 결과",
        "",
        f"날짜: {result.get('report_date')}",
        f"성공: {len(published)}건 / 실패: {len(failed)}건",
        "",
    ]
    for item in failed[:5]:
        lines.append(f"· {item['market']}: {item['error'][:80]}")
    lines.append("")
    lines.append(f"재시도는 최대 {naver_publish_store.MAX_ATTEMPTS}회까지 자동 수행됩니다.")
    _alert("\n".join(lines))


def _delayed_run(report_date: str) -> None:
    time.sleep(PUBLISH_DELAY_SECONDS)
    try:
        run(report_date, triggered_by="chain")
    except Exception:
        log.exception("naver blog publish batch failed")


def schedule_publish_after_brief(report_date: str | None = None) -> None:
    """Called from market_brief._loop() right after run_all() commits the seven briefs.

    Same daemon-thread + sleep shape as naver_blog_exporter.schedule_blog_export_after_brief,
    which this sits alongside. The date is captured at schedule time rather than read
    inside the thread: the export helper reads the calendar date 5 minutes later, which
    silently produces nothing whenever the brief was keyed to the previous trading day.
    """
    report_date = report_date or dt.datetime.now(KST).date().isoformat()
    threading.Thread(
        target=_delayed_run,
        args=(report_date,),
        daemon=True,
        name="naver-blog-publisher",
    ).start()


# --- session keep-alive -------------------------------------------------------------
#
# The publish batch touches Naver once per weekday. A session that is only exercised
# that rarely, from a datacenter IP, is a session that expires early. This walks the
# blog every few hours purely to let Naver rotate NID_SES.

KEEPALIVE_INTERVAL_SECONDS = int(os.environ.get("NAVER_KEEPALIVE_SECONDS", str(6 * 3600)))


def keep_alive_once() -> bool:
    if not naver_session_store.is_configured():
        return False
    session = naver_session_store.get()
    if not session:
        return False
    try:
        fresh = naver_blog_client.keep_alive(session["cookies"])
    except naver_blog_client.NaverSessionExpired:
        log.warning("keep-alive found the Naver session expired")
        _alert(
            "📕 네이버 블로그 세션 만료 감지\n\n"
            "정기 점검에서 로그인이 풀린 것을 확인했습니다.\n"
            "scripts/naver_login_setup.py 를 1회 실행해 재연동해주세요."
        )
        return False
    except Exception:
        log.exception("keep-alive failed")
        return False

    if fresh:
        try:
            naver_session_store.save(fresh, session.get("blog_id") or naver_blog_client.BLOG_ID)
        except Exception:
            log.exception("could not persist keep-alive cookies")
    return True


# Catch-up window (KST hours, half-open). The +10분 chain lives in a daemon thread, so a
# redeploy between 16:10 and 16:25 — which is a perfectly ordinary time to ship — kills
# it and nothing else would ever publish that day's briefs. The keep-alive loop is
# already awake and already holds a working session, so it doubles as the recovery path.
# Bounded to afternoon/evening because the alternative is discovering the gap at 4am and
# posting seven market reports in the middle of the night.
_CATCHUP_HOURS = range(16, 23)


def catch_up_if_needed() -> dict | None:
    """Publishes anything still outstanding for today. No-op outside the window."""
    now = dt.datetime.now(KST)
    if now.weekday() >= 5 or now.hour not in _CATCHUP_HOURS:
        return None

    # Queried without a date filter on purpose. Rows are enqueued under the brief's
    # TRADING date, which is not today's calendar date on a market holiday, so asking
    # for "today" is exactly the mistake that makes a recovery path quietly find
    # nothing. Take the newest outstanding date instead.
    outstanding = naver_publish_store.pending()
    if not outstanding:
        return None

    report_date = max(row["report_date"] for row in outstanding)
    log.info("catch-up: %s post(s) still unpublished, newest date %s", len(outstanding), report_date)
    return run(report_date, triggered_by="catchup")


def _keepalive_loop() -> None:
    # Stagger the first touch so a redeploy storm doesn't hit Naver from every restart.
    time.sleep(random.randint(120, 600))
    while True:
        try:
            keep_alive_once()
        except Exception:
            log.exception("keep-alive loop iteration failed")
        try:
            catch_up_if_needed()
        except Exception:
            log.exception("catch-up run failed")
        time.sleep(KEEPALIVE_INTERVAL_SECONDS + random.randint(-600, 600))


def start_keepalive_scheduler() -> None:
    if not naver_session_store.is_configured():
        log.info("NAVER_SESSION_KEY unset — skipping Naver session keep-alive")
        return
    threading.Thread(target=_keepalive_loop, daemon=True, name="naver-session-keepalive").start()
