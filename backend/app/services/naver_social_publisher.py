"""Publishes the Naver blog twin of every automated SNS edition, at the SNS time.

The web server records scheduled editions even when publishing is unavailable. Workers
with an authorized Naver session share one ledger and must claim a post before delivering it.

Per edition (naver_social_content.EDITIONS):
  * due from its SNS post time until its window closes (3–6 hours);
  * skipped on days its market does not trade;
  * built from the same public data the SNS post used — if that data is not out yet the
    attempt is handed back without using up a retry, and tried again on the next tick;
  * published once: the ledger's claim() is the guard, shared with any other worker;
  * the category is verified after publishing from the blog's own post list.

All Naver writes in this process and the closing-brief publisher share one lease
(naver_publish_store.acquire_batch_lock), so two posts are never typed at once.
"""

from __future__ import annotations

from app.services import browser_guard

import datetime as dt
from email.utils import parsedate_to_datetime
import logging
import os
import random
import time
from urllib.parse import urlsplit
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

from app.services import (
    naver_blog_client,
    naver_document_model,
    naver_publish_store,
    naver_session_store,
    naver_social_content as content,
    naver_social_store as store,
    naver_social_tuning as tuning,
    trading_calendar,
)

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)
GAP = (int(os.environ.get("NAVER_SOCIAL_GAP_MIN", "45")), int(os.environ.get("NAVER_SOCIAL_GAP_MAX", "100")))
# The first day these posts exist; earlier slots are not owed.
START = dt.datetime(2026, 11, 26, 6, 30, tzinfo=KST)


def slot_time(day: dt.date, edition: str) -> dt.datetime:
    hh, mm = map(int, content.EDITIONS[edition][0].split(":"))
    return dt.datetime(day.year, day.month, day.day, hh, mm, tzinfo=KST)


def applies(day: dt.date, edition: str) -> bool:
    rule = content.EDITIONS[edition][3]
    if rule == "saturday":
        return day.weekday() == 5
    if rule == "kr":
        return trading_calendar.is_trading_day(day, "KR")
    if rule == "us-prev":
        return trading_calendar.is_trading_day(day - dt.timedelta(days=1), "US")
    if rule == "us-12h":
        return trading_calendar.is_trading_day((slot_time(day, edition) - dt.timedelta(hours=12)).date(), "US")
    return True


def window(day: dt.date, edition: str) -> tuple[dt.datetime, dt.datetime]:
    start = slot_time(day, edition)
    return start, start + dt.timedelta(hours=content.EDITIONS[edition][1])


def public_weekly_post(day: dt.date) -> dict | None:
    """Find a recap already published in the official editor, including manual releases."""
    blog = naver_blog_client.BLOG_ID
    period = f"{day - dt.timedelta(days=5):%m/%d}~{day - dt.timedelta(days=1):%m/%d}"
    try:
        feed = ElementTree.fromstring(content._get(f"https://rss.blog.naver.com/{blog}.xml", raw=True, timeout=5))
    except (OSError, content.NotReady, ElementTree.ParseError):
        return None
    for item in feed.findall("./channel/item"):
        title = item.findtext("title", "")
        if not all(part in title for part in (period, "주간", "코스피·코스닥·나스닥")):
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", "")).astimezone(KST).date()
            url = urlsplit(item.findtext("link", ""))
        except (TypeError, ValueError):
            continue
        path = url.path.split("/")
        if (day <= published <= day + dt.timedelta(days=1) and url.netloc == "blog.naver.com"
                and len(path) == 3 and path[1] == blog and path[2].isascii() and path[2].isdigit()):
            return {"title": title, "url": f"https://blog.naver.com/{blog}/{path[2]}"}
    return None


def delivery_deadline(day: dt.date, edition: str) -> dt.datetime:
    _, end = window(day, edition)
    # These builders read editions by date and slot. The heatmap and world builders
    # use live snapshots, so those keep their original deadlines.
    if content.EDITIONS[edition][4] in ("hot", "movers"):
        end += dt.timedelta(hours=12)
    return end


def due(now: dt.datetime, *, recover: bool = False) -> list[tuple[dt.date, str]]:
    out = []
    for day in (now.date() - dt.timedelta(days=1), now.date()):
        for edition in content.EDITIONS:
            start, end = window(day, edition)
            if recover:
                end = delivery_deadline(day, edition)
            if start >= START and start <= now < end and applies(day, edition):
                out.append((day, edition))
    return sorted(out, key=lambda de: (now >= window(*de)[1], slot_time(*de)))


def expired(now: dt.datetime) -> list[tuple[dt.date, str]]:
    """Recently closed windows, including slots missed while the server was down."""
    out = []
    for offset in (2, 1, 0):
        day = now.date() - dt.timedelta(days=offset)
        for edition in content.EDITIONS:
            start = slot_time(day, edition)
            end = delivery_deadline(day, edition)
            if start >= START and end <= now < end + dt.timedelta(days=2) and applies(day, edition):
                out.append((day, edition))
    return out


def reconcile_schedule(now: dt.datetime) -> tuple[int, int]:
    """Record due and missed slots without requiring a browser or a Naver session."""
    active, closed = due(now, recover=True), expired(now)
    days = sorted({day.isoformat() for day, _ in active + closed})
    rows = {row["post_key"]: row for row in store.for_days(days)}
    missing = [(day.isoformat(), edition, content.EDITIONS[edition][2])
               for day, edition in active if store.key(day, edition) not in rows]
    missed = [(day.isoformat(), edition, content.EDITIONS[edition][2])
              for day, edition in closed if store.key(day, edition) not in rows]
    store.enqueue_many(missing)
    store.enqueue_many(missed, missed=True)
    for day, edition in closed:
        post_key = store.key(day, edition)
        row = rows.get(post_key)
        if row and row["status"] in ("pending", "failed") and row["attempts"] < store.MAX_ATTEMPTS:
            store.mark_skipped(post_key, "publication window closed without a confirmed post")
    return len(missing), len(missed)


def _transient(exc: BaseException) -> bool:
    """A source that is down for the moment (5xx, connection error, timeout) — not a bad post."""
    import socket
    import urllib.error

    import requests

    if isinstance(exc, urllib.error.HTTPError):
        return exc.code >= 500 or exc.code == 429
    if isinstance(exc, requests.HTTPError):
        code = getattr(exc.response, "status_code", 0) or 0
        return code >= 500 or code == 429
    return isinstance(exc, (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError,
                            requests.ConnectionError, requests.Timeout))


def _publish(post: content.Post, cookies: list[dict], *, dry_run: bool) -> dict:
    title_paragraphs = naver_document_model.build_title_paragraphs(post.title)
    meta = {"market": post.edition}
    return naver_blog_client.publish({}, meta, title_paragraphs, post.body, post.tags, cookies, charts=post.images,
                                     require_charts=post.edition == "weekly_market",
                                     dry_run=dry_run, category_no=post.category_no, category_name=post.category_name)


@browser_guard.uses_browser("naver social edition")
def publish_edition(day: dt.date, edition: str, cookies: list[dict], *, dry_run: bool = False,
                    variant: str | None = None) -> dict:
    """Builds and publishes one edition. Assumes the claim is held (unless dry_run)."""
    variant = variant or tuning.choose(day, edition)
    post = content.build(day, edition, variant)
    outcome = _publish(post, cookies, dry_run=dry_run)
    outcome["post"] = post
    return outcome


def run_due(now: dt.datetime | None = None, *, dry_run: bool = False, only: list[str] | None = None,
            force_day: dt.date | None = None, source: str = "pc") -> dict:
    """Publishes everything currently due. `force_day`+`only` publishes those editions
    for that day regardless of the clock (manual tests and recoveries)."""
    now = now or dt.datetime.now(KST)
    result = {"at": now.isoformat(timespec="seconds"), "published": [], "waiting": [], "failed": [],
              "verified": [], "status": "ok"}
    if force_day:
        targets = [(force_day, e) for e in (only or content.EDITIONS)]
    else:
        targets = [(d, e) for d, e in due(now, recover=True) if not only or e in only]
    if not targets:
        result["status"] = "nothing_due"
        return result

    open_targets = []
    for day, edition in targets:
        k = store.key(day, edition)
        if not dry_run:
            if edition == "weekly_market":
                public_post = public_weekly_post(day)
                if public_post:
                    result["verified"].append({"key": k, **public_post})
                    continue
            store.enqueue(day.isoformat(), edition, content.EDITIONS[edition][2])
            row = store.get(k)
            if not row or row["status"] in ("published", "skipped"):
                continue
            if row["status"] != "publishing" and row["attempts"] >= store.MAX_ATTEMPTS:
                continue
        open_targets.append((day, edition))
    if not open_targets:
        result["status"] = "all_done"
        return result

    session = naver_session_store.get() if naver_session_store.is_configured() else None
    if not session:
        result["status"] = "no_session"
        return result
    owner = naver_publish_store.acquire_batch_lock(lease_minutes=40)
    if not owner:
        result["status"] = "busy"
        return result
    cookies = session["cookies"]
    blog_id = session.get("blog_id") or naver_blog_client.BLOG_ID
    try:
        store.release_stale()
        posted = 0
        for day, edition in open_targets:
            k = store.key(day, edition)
            if not dry_run and not store.claim(k):
                continue
            if posted and not dry_run:
                time.sleep(random.randint(*GAP))
            started = time.monotonic()
            try:
                outcome = publish_edition(day, edition, cookies, dry_run=dry_run)
            except content.NotReady as exc:
                if not dry_run:
                    store.release(k, f"not ready: {exc}", refund=True)
                result["waiting"].append({"key": k, "why": str(exc)[:160]})
                continue
            except browser_guard.BrowserUnavailable as exc:
                # Not here / not now (web server, low memory, busy): hand it back untouched.
                if not dry_run:
                    store.release(k, f"deferred: {exc}", refund=True)
                result["waiting"].append({"key": k, "why": str(exc)[:160]})
                result["status"] = "deferred"
                break
            except naver_blog_client.NaverSessionExpired as exc:
                if not dry_run:
                    store.release(k, f"session refused: {exc}", refund=True)
                    store.log_run(k, "session_refused", f"[{source}] {str(exc)[:400]}")
                result["failed"].append({"key": k, "error": str(exc)[:200]})
                result["status"] = "session_refused"
                break
            except Exception as exc:
                if _transient(exc):
                    # Our own site or a data source answered 5xx / timed out: the data is not
                    # reachable yet, which is not this post's fault — retry later for free.
                    # (On 11-26 three 502s used up three of the midday post's four attempts.)
                    if not dry_run:
                        store.release(k, f"source unavailable: {type(exc).__name__}: {str(exc)[:120]}", refund=True)
                        store.log_run(k, "waiting", f"[{source}] source unavailable: {type(exc).__name__}")
                    result["waiting"].append({"key": k, "why": f"source unavailable: {type(exc).__name__}"})
                    continue
                log.exception("naver social publish failed for %s", k)
                if not dry_run:
                    store.release(k, f"{type(exc).__name__}: {exc}", refund=False)
                    store.log_run(k, "failed", f"[{source}] {type(exc).__name__}: {exc}")
                result["failed"].append({"key": k, "error": f"{type(exc).__name__}: {str(exc)[:180]}"})
                continue
            post = outcome["post"]
            fresh = outcome.get("cookies")
            if fresh:
                cookies = fresh
                try:
                    naver_session_store.save(fresh, blog_id)
                except Exception:
                    log.exception("could not persist refreshed cookies")
            if dry_run:
                result["verified"].append({"key": k, "title": post.title, "chars": outcome.get("chars"),
                                           "components": outcome.get("components"), "tags": post.tags,
                                           "images": len(post.images), "variant": post.variant})
                continue
            seen = None
            for _ in range(4):
                time.sleep(5)
                seen = naver_blog_client.post_category(blog_id, outcome["log_no"])
                if seen is not None:
                    break
            store.mark_published(k, log_no=outcome["log_no"], post_url=outcome["post_url"], title=post.title,
                                 tags=post.tags, variant=post.variant, campaign=post.campaign, category_seen=seen,
                                 chars=len(post.text()), images=len(post.images))
            store.log_run(k, "published", f"[{source}] {outcome['post_url']} · {post.variant} · 카테고리 {seen} · "
                                          f"{int(time.monotonic() - started)}초")
            naver_session_store.mark_ok()
            posted += 1
            result["published"].append({"key": k, "url": outcome["post_url"], "title": post.title,
                                        "category": seen, "expected_category": post.category_no})
    finally:
        naver_publish_store.release_batch_lock(owner)
    if result["failed"] and result["status"] == "ok":
        result["status"] = "partial"
    return result


# --- server scheduler ---------------------------------------------------------------

SERVER_PAUSE_SECONDS = int(os.environ.get("NAVER_SERVER_PAUSE_SECONDS", "3600"))
_server = {"paused_until": 0.0, "briefs_at": 0.0, "briefs_done": "", "last": None,
           "refused_at": None, "queue_checked_at": None}


def _delivery_mode() -> str:
    if os.environ.get("NAVER_PUBLISH_ON_SERVER") != "1":
        return "disabled"
    if not browser_guard.allowed():
        return "browser_blocked"
    if not naver_session_store.is_configured():
        return "unconfigured"
    return "enabled"


def server_status() -> dict:
    return {"paused_until": _server["paused_until"], "last": _server["last"],
            "refused_at": _server["refused_at"], "queue_checked_at": _server["queue_checked_at"],
            "delivery_mode": _delivery_mode()}


def _server_tick() -> None:
    from app.services import naver_publisher

    now = dt.datetime.now(KST)
    queued, missed = reconcile_schedule(now)
    _server["queue_checked_at"] = now.isoformat(timespec="seconds")
    if queued or missed:
        log.info("Naver blog schedule recorded: queued=%s missed=%s", queued, missed)
    if _delivery_mode() != "enabled" or time.time() < _server["paused_until"]:
        return
    result = run_due(now, source="server")
    _server["last"] = {k: v for k, v in result.items() if v}
    if result["status"] in ("session_refused", "deferred"):
        _server["paused_until"] = time.time() + SERVER_PAUSE_SECONDS
        if result["status"] == "session_refused":
            _server["refused_at"] = now.isoformat(timespec="seconds")
        log.warning("Naver server publishing paused for %ss (%s)", SERVER_PAUSE_SECONDS, result["status"])
        return
    if (trading_calendar.is_trading_day(now.date(), "KR") and dt.time(16, 20) <= now.time() < dt.time(23, 0)
            and _server["briefs_done"] != now.date().isoformat() and time.time() - _server["briefs_at"] >= 600):
        _server["briefs_at"] = time.time()
        result = naver_publisher.run(now.date().isoformat(), triggered_by="server")
        if result.get("status") == "session_expired":
            _server["paused_until"] = time.time() + SERVER_PAUSE_SECONDS
            _server["refused_at"] = now.isoformat(timespec="seconds")
        elif result.get("status") == "nothing_to_do":
            rows = [r for r in naver_publish_store.recent(10) if r["report_date"] == now.date().isoformat()]
            if len(rows) >= 7 and all(r["status"] == "published" for r in rows):
                _server["briefs_done"] = now.date().isoformat()


def _server_loop() -> None:
    time.sleep(random.randint(60, 180))
    while True:
        try:
            _server_tick()
        except Exception:
            log.exception("server naver tick failed")
        time.sleep(120)


def start_server_scheduler() -> None:
    import threading
    log.info("Naver blog scheduling started (web delivery: %s)", _delivery_mode())
    threading.Thread(target=_server_loop, daemon=True, name="naver-social-server").start()
