"""Publishes the Naver blog twin of every automated SNS edition, at the SNS time.

Runs on the owner's Windows PC (backend/scripts/naver_blog_worker.py, every 2 minutes
from Task Scheduler). Not on Render: Naver refuses blog writes from the Render IP
("no privilege") while the same session writes fine from a Korean residential line —
see docs/naver-blog-auto-publish-design.md and the brief publisher's history.

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

import datetime as dt
import logging
import os
import random
import time
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


def due(now: dt.datetime) -> list[tuple[dt.date, str]]:
    out = []
    for day in (now.date() - dt.timedelta(days=1), now.date()):
        for edition in content.EDITIONS:
            start, end = window(day, edition)
            if start >= START and start <= now < end and applies(day, edition):
                out.append((day, edition))
    return sorted(out, key=lambda de: slot_time(*de))


def expired(now: dt.datetime) -> list[tuple[dt.date, str]]:
    """Editions whose window closed in the last day — still unpublished ones become 'skipped'."""
    out = []
    for day in (now.date() - dt.timedelta(days=1), now.date()):
        for edition in content.EDITIONS:
            start, end = window(day, edition)
            if start >= START and end <= now < end + dt.timedelta(hours=20) and applies(day, edition):
                out.append((day, edition))
    return out


def _publish(post: content.Post, cookies: list[dict], *, dry_run: bool) -> dict:
    title_paragraphs = naver_document_model.build_title_paragraphs(post.title)
    meta = {"market": post.edition}
    return naver_blog_client.publish({}, meta, title_paragraphs, post.body, post.tags, cookies, charts=post.images,
                                     dry_run=dry_run, category_no=post.category_no, category_name=post.category_name)


def publish_edition(day: dt.date, edition: str, cookies: list[dict], *, dry_run: bool = False,
                    variant: str | None = None) -> dict:
    """Builds and publishes one edition. Assumes the claim is held (unless dry_run)."""
    variant = variant or tuning.choose(day, edition)
    post = content.build(day, edition, variant)
    outcome = _publish(post, cookies, dry_run=dry_run)
    outcome["post"] = post
    return outcome


def run_due(now: dt.datetime | None = None, *, dry_run: bool = False, only: list[str] | None = None,
            force_day: dt.date | None = None) -> dict:
    """Publishes everything currently due. `force_day`+`only` publishes those editions
    for that day regardless of the clock (manual tests and recoveries)."""
    now = now or dt.datetime.now(KST)
    result = {"at": now.isoformat(timespec="seconds"), "published": [], "waiting": [], "failed": [], "skipped": [],
              "verified": [], "status": "ok"}
    if force_day:
        targets = [(force_day, e) for e in (only or content.EDITIONS)]
    else:
        targets = [(d, e) for d, e in due(now) if not only or e in only]
        for day, edition in expired(now):
            row = store.get(store.key(day, edition))
            if row and row["status"] in ("pending", "failed"):
                store.mark_skipped(row["post_key"], f"window closed: {row.get('last_error') or 'data never ready'}")
                store.log_run(row["post_key"], "skipped", row.get("last_error") or "")
                result["skipped"].append(row["post_key"])
    if not targets:
        result["status"] = "nothing_due"
        return result

    open_targets = []
    for day, edition in targets:
        k = store.key(day, edition)
        if not dry_run:
            store.enqueue(day.isoformat(), edition, content.EDITIONS[edition][2])
            row = store.get(k)
            if not row or row["status"] not in ("pending", "failed") or row["attempts"] >= store.MAX_ATTEMPTS:
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
            except naver_blog_client.NaverSessionExpired as exc:
                if not dry_run:
                    store.release(k, f"session refused: {exc}", refund=True)
                    store.log_run(k, "session_refused", str(exc)[:400])
                result["failed"].append({"key": k, "error": str(exc)[:200]})
                result["status"] = "session_refused"
                break
            except Exception as exc:
                log.exception("naver social publish failed for %s", k)
                if not dry_run:
                    store.release(k, f"{type(exc).__name__}: {exc}", refund=False)
                    store.log_run(k, "failed", f"{type(exc).__name__}: {exc}")
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
            store.log_run(k, "published", f"{outcome['post_url']} · {post.variant} · 카테고리 {seen} · "
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
