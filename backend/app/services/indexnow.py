"""IndexNow: tell Bing (and Naver, Yandex, Seznam — they share submissions) about new
and changed pages the moment they exist, instead of waiting for the next crawl.

Bing indexes kospimap.com slowly from the sitemap alone; most of what the site writes
(hot-issue editions, movers editions, closing briefs) is news that is worth most in its
first hours. So:

  * notify(paths)        — called when a new edition is stored (hot issues, movers, briefs)
  * daily loop           — 07:40 and 16:45 KST: the pages whose content changes every day
  * weekly full submit   — every URL in the sitemaps once a week (claimed in Turso so a
                           restart does not resubmit)

The key is public by design: Bing reads it back from https://kospimap.com/<key>.txt to
confirm the submitter owns the host. Never raises into the caller.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import re
import threading
import time
from zoneinfo import ZoneInfo

import requests

log = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")
HOST = "kospimap.com"
SITE = f"https://{HOST}"
KEY = os.environ.get("INDEXNOW_KEY", "0ea2d0c3462664f25b0c41624bd76ef0")
ENDPOINT = "https://api.indexnow.org/indexnow"
ENABLED = os.environ.get("INDEXNOW_ENABLED", "1" if os.environ.get("RENDER") else "0") == "1"

# Pages whose content is rewritten every trading day.
DAILY = ["/", "/today", "/map", "/kosdaq-map", "/nasdaq100-map", "/sp500-map", "/kospi", "/kosdaq", "/nasdaq",
         "/world-markets", "/hot-issues", "/movers", "/movers/us", "/market-brief", "/desk", "/stocks"]

_sent: dict[str, float] = {}
_lock = threading.Lock()
last: dict = {}


def _submit(urls: list[str]) -> int | None:
    if not urls:
        return None
    try:
        r = requests.post(ENDPOINT, json={"host": HOST, "key": KEY, "keyLocation": f"{SITE}/{KEY}.txt",
                                          "urlList": urls[:10000]}, timeout=20,
                          headers={"Content-Type": "application/json; charset=utf-8"})
        last.update({"at": dt.datetime.now(KST).isoformat(timespec="seconds"), "count": len(urls), "status": r.status_code})
        if r.status_code not in (200, 202):
            log.warning("IndexNow answered %s for %s urls", r.status_code, len(urls))
        return r.status_code
    except Exception as exc:
        last.update({"at": dt.datetime.now(KST).isoformat(timespec="seconds"), "count": len(urls), "status": f"error {type(exc).__name__}"})
        log.warning("IndexNow submit failed: %s", type(exc).__name__)
        return None


def notify(paths: list[str], *, min_gap_hours: float = 6) -> None:
    """Fire-and-forget submit of site paths not sent in the last `min_gap_hours`."""
    if not ENABLED:
        return
    now = time.time()
    with _lock:
        fresh = [p for p in dict.fromkeys(paths) if now - _sent.get(p, 0) >= min_gap_hours * 3600]
        for p in fresh:
            _sent[p] = now
    if fresh:
        threading.Thread(target=_submit, args=([SITE + p for p in fresh],), daemon=True, name="indexnow").start()


def edition_path(kind: str, slot: str) -> str | None:
    """Site path of a stored hot-issue / movers edition key ("2026-11-26T07:00+09:00", "us:…", "…~r1")."""
    m = re.search(r"(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})", slot or "")
    if not m:
        return None
    day, hhmm = m.group(1), m.group(2) + m.group(3)
    if kind == "hot":
        return f"/hot-issues/{day}/{hhmm}"
    return f"/movers/us/{day}/{hhmm}" if slot.startswith("us:") else f"/movers/{day}/{hhmm}"


def _sitemap_urls() -> list[str]:
    urls = []
    for name in ("pages", "stocks", "etf", "us"):
        try:
            xml = requests.get(f"{SITE}/sitemap-{name}.xml", timeout=30).text
            urls += re.findall(r"<loc>([^<]+)</loc>", xml)
        except Exception:
            log.warning("sitemap %s unavailable for IndexNow", name)
    return [u for u in dict.fromkeys(urls) if u.startswith(SITE)]


def _claim_week(week: str) -> bool:
    """One full submit per ISO week across restarts (insert-only marker row)."""
    try:
        from app.services import turso
        url, token = os.environ.get("TURSO_DATABASE_URL"), os.environ.get("TURSO_AUTH_TOKEN")
        if not url:
            return True
        conn = turso.connect(database=url, auth_token=token)
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS indexnow_weekly (week TEXT PRIMARY KEY, submitted_at TEXT NOT NULL)")
            cur = conn.execute("INSERT INTO indexnow_weekly (week, submitted_at) VALUES (?, ?) ON CONFLICT(week) DO NOTHING",
                               (week, dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")))
            conn.commit()
            return (getattr(cur, "rowcount", 0) or 0) == 1
        finally:
            conn.close()
    except Exception:
        log.exception("IndexNow weekly claim failed")
        return False


def _loop() -> None:
    time.sleep(180)
    done_slots: set[str] = set()
    while True:
        try:
            now = dt.datetime.now(KST)
            iso = now.isocalendar()
            week = f"{iso[0]}-W{iso[1]:02d}"
            if f"full:{week}" not in done_slots:
                done_slots.add(f"full:{week}")
                if _claim_week(week):
                    urls = _sitemap_urls()
                    for i in range(0, len(urls), 9000):
                        _submit(urls[i:i + 9000])
                    log.info("IndexNow weekly submit: %s urls", len(urls))
            for hhmm in ("07:40", "16:45"):
                slot = f"{now.date()} {hhmm}"
                h, m = map(int, hhmm.split(":"))
                if slot not in done_slots and now >= now.replace(hour=h, minute=m, second=0) \
                        and now < now.replace(hour=h, minute=m, second=0) + dt.timedelta(hours=2):
                    done_slots.add(slot)
                    notify(DAILY, min_gap_hours=4)
        except Exception:
            log.exception("IndexNow loop failed")
        time.sleep(300)


def start_scheduler() -> None:
    if ENABLED:
        threading.Thread(target=_loop, daemon=True, name="indexnow-scheduler").start()
