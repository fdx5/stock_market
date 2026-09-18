import datetime as dt
import html
import re

import requests

from app.services.cache import cache

TTL_NEWS_SECONDS = 15 * 60

# finance.naver.com/item/news_news.naver (the old HTML scrape target) now 410s —
# Naver retired it the same way it retired sise_market_sum.naver (see
# naver_price_fetcher.py). The mobile Next.js app it replaced loads its per-code news
# tab from this JSON API instead.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}


def _normalize_title(title: str) -> str:
    """Loose dedup key for spotting the same story reprinted under a different press
    office with a near-identical headline (common for wire-service stories on
    finance.naver's page1) — punctuation stripped, whitespace collapsed, capped to
    the leading 40 chars so two headlines that only diverge after that point still
    collide. Same approach as company_news_fetcher._normalize_title, kept local here
    rather than shared since this module and that one are otherwise independent."""
    cleaned = re.sub(r"[^\w\s]", "", title.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:40]


_OLDEST_DATE = dt.datetime.min


def _parse_api_datetime(raw: str) -> dt.datetime:
    """Parse the JSON API's 'YYYYMMDDHHMM' timestamp for recency sorting. Anything
    unparseable sorts as oldest so it never displaces a genuinely dated article at the
    top of the list."""
    try:
        return dt.datetime.strptime((raw or "").strip(), "%Y%m%d%H%M")
    except ValueError:
        return _OLDEST_DATE


def _fetch_news(code: str, limit: int) -> list[dict]:
    # pageSize asks for more than `limit`: the feed repeats the same wire story under
    # several article ids as it gets updated through the afternoon (see dedup below),
    # so a request capped at exactly `limit` can come back with fewer distinct stories
    # than asked for.
    url = f"https://m.stock.naver.com/api/news/stock/{code}"
    resp = requests.get(url, headers=HEADERS, params={"pageSize": max(limit * 2, 20), "page": 1}, timeout=5)
    resp.raise_for_status()
    groups = resp.json()

    items: list[dict] = []
    seen_links: set[str] = set()
    seen_titles: set[str] = set()
    for group in groups:
        for entry in group.get("items", []):
            link = entry.get("mobileNewsUrl") or ""
            title = html.unescape(entry.get("titleFull") or entry.get("title") or "")
            if not link or not title:
                continue
            title_key = _normalize_title(title)
            if link in seen_links or (title_key and title_key in seen_titles):
                continue
            seen_links.add(link)
            if title_key:
                seen_titles.add(title_key)

            raw_dt = entry.get("datetime") or ""
            parsed = _parse_api_datetime(raw_dt)
            date_text = parsed.strftime("%Y.%m.%d %H:%M") if parsed != _OLDEST_DATE else ""

            items.append(
                {
                    "title": title,
                    "link": link,
                    "press": entry.get("officeName") or "",
                    "date": date_text,
                    "_sort": parsed,
                }
            )

    items.sort(key=lambda it: it["_sort"], reverse=True)
    for it in items:
        del it["_sort"]
    return items[:limit]


def get_news(code: str, limit: int = 15) -> list[dict]:
    # limit is part of the cache key: a caller asking for more rows than an earlier
    # caller already cached for this code (e.g. the NEWS page's larger pool request
    # after the dashboard's news tab warmed the cache with fewer) must not be served
    # back that smaller cached list.
    key = f"news:{code}:{limit}"
    try:
        return cache.get_or_set(key, TTL_NEWS_SECONDS, lambda: _fetch_news(code, limit))
    except Exception:
        return []
