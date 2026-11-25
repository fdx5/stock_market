"""Measures how the Naver posts are doing, once a day, for naver_social_tuning.

Per published post (last 7 days):
    visits / visitors   page views on kospimap.com that arrived through the post's links
                        (utm_source=naver_blog, utm_campaign=nb_<edition>-<YYYYMMDD>)
    likes / comments    from the blog's public post list
    search_rank         position of the post among Naver blog-search results for its own
                        title words (checked once, the day after publishing; None = not in
                        the first page)

All reads. The only writes are the one perf row per post per day
(naver_social_store.record_perf, insert-only).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import random
import re
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from app.services import naver_social_store

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
BLOG_ID = "kospi-predictor"


def campaign_visits(since_iso: str) -> dict[str, dict]:
    """{utm_campaign: {"visits", "visitors"}} for visits that came through blog links."""
    from app.services import page_view_store

    def read(conn):
        return conn.execute(
            "SELECT utm_campaign, COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE created_at >= ? AND {page_view_store.HUMAN} AND event_type = 'page_view' "
            "AND utm_source = 'naver_blog' AND utm_campaign IS NOT NULL GROUP BY utm_campaign",
            (since_iso,)).fetchall()

    return {c: {"visits": int(v or 0), "visitors": int(u or 0)} for c, v, u in page_view_store._with_connection(read)}


def blog_inflow_by_day(since_iso: str) -> list[dict]:
    """Daily sessions that arrived from the blog at all (utm or blog.naver.com referrer)."""
    from app.services import page_view_store

    def read(conn):
        return conn.execute(
            "SELECT strftime('%Y-%m-%d', created_at, '+9 hours'), COUNT(*), COUNT(DISTINCT session_id) FROM page_views "
            f"WHERE created_at >= ? AND {page_view_store.HUMAN} AND event_type = 'page_view' "
            "AND (utm_source = 'naver_blog' OR referrer LIKE '%blog.naver.com%') GROUP BY 1 ORDER BY 1",
            (since_iso,)).fetchall()

    return [{"day": d, "views": int(v or 0), "sessions": int(s or 0)} for d, v, s in page_view_store._with_connection(read)]


def blog_items(categories=(6, 7, 8, 9, 10), pages: int = 2) -> dict[str, dict]:
    out = {}
    for cat in categories:
        for page in range(1, pages + 1):
            url = f"https://m.blog.naver.com/api/blogs/{BLOG_ID}/post-list?categoryNo={cat}&itemCount=30&page={page}"
            try:
                req = Request(url, headers={"User-Agent": UA, "Referer": f"https://m.blog.naver.com/{BLOG_ID}"})
                with urlopen(req, timeout=15) as resp:
                    items = (json.loads(resp.read()).get("result") or {}).get("items") or []
            except Exception:
                log.warning("blog post list unavailable for category %s", cat)
                break
            for it in items:
                out[str(it.get("logNo"))] = {"likes": it.get("sympathyCnt"), "comments": it.get("commentCnt"),
                                             "read_count": it.get("readCount")}
            if len(items) < 30:
                break
    return out


def search_query(title: str) -> str:
    words = re.sub(r"\[[^\]]*\]|[|,()·…?!+\-%0-9.:/]", " ", title).split()
    return " ".join(w for w in words if len(w) >= 2)[:40]


def search_rank(query: str, log_no: str) -> int | None:
    """Position of our post among Naver blog-search results (first page), or None."""
    url = f"https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query={quote(query)}"
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    with urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", "replace")
    seen = []
    for blog, no in re.findall(r"blog\.naver\.com/([A-Za-z0-9_\-]+)/(\d{9,})", html):
        k = f"{blog}/{no}"
        if k not in seen:
            seen.append(k)
    target = f"{BLOG_ID}/{log_no}"
    return seen.index(target) + 1 if target in seen else None


def collect(today: dt.date | None = None, *, search: bool = True) -> dict:
    today = today or dt.datetime.now(KST).date()
    since_day = (today - dt.timedelta(days=7)).isoformat()
    posts = naver_social_store.published_since(since_day)
    done = naver_social_store.perf_measured(today.isoformat())
    visits = campaign_visits((today - dt.timedelta(days=9)).isoformat())
    items = blog_items()
    written, checked = 0, 0
    for post in posts:
        if post["post_key"] in done or not post.get("log_no"):
            continue
        age = (today - dt.date.fromisoformat(post["day"])).days
        v = visits.get(post.get("campaign") or "", {})
        it = items.get(str(post["log_no"]), {})
        rank, query = None, None
        if search and age == 1 and post.get("title"):
            query = search_query(post["title"])
            try:
                rank = search_rank(query, post["log_no"])
                checked += 1
            except Exception:
                log.warning("search check failed for %s", post["post_key"])
            time.sleep(random.uniform(4, 9))
        if naver_social_store.record_perf(post["post_key"], today.isoformat(), age_days=age,
                                          visits=v.get("visits", 0), visitors=v.get("visitors", 0),
                                          likes=it.get("likes"), comments=it.get("comments"),
                                          read_count=it.get("read_count"), search_rank=rank, search_query=query):
            written += 1
    return {"day": today.isoformat(), "posts": len(posts), "written": written, "search_checked": checked}
