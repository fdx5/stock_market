from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

TTL_NEWS_SECONDS = 15 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def _resolve_article_link(href: str) -> str:
    """news_read.naver is just a client-side redirect stub (`top.location.href = ...`)
    that only works when the browser sends a finance.naver.com Referer — it breaks
    (blank/broken page) for rel="noreferrer" links or in-app browsers. Link straight
    to the stable n.news.naver.com article URL instead, using the office/article id
    from the query string.
    """
    query = parse_qs(urlparse(href).query)
    office_id = query.get("office_id", [None])[0]
    article_id = query.get("article_id", [None])[0]
    if office_id and article_id:
        return f"https://n.news.naver.com/mnews/article/{office_id}/{article_id}"
    return f"https://finance.naver.com{href}" if href.startswith("/") else href


def _fetch_news(code: str, limit: int) -> list[dict]:
    url = f"https://finance.naver.com/item/news_news.naver?code={code}&page=1"
    resp = requests.get(url, headers=HEADERS, timeout=5)
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    items: list[dict] = []
    seen_links: set[str] = set()
    for row in soup.select("table.type5 tr"):
        title_tag = row.select_one("td.title a")
        if not title_tag:
            continue

        href = title_tag.get("href", "")
        link = _resolve_article_link(href)
        if link in seen_links:
            continue
        seen_links.add(link)

        press_tag = row.select_one("td.info")
        date_tag = row.select_one("td.date")

        items.append(
            {
                "title": title_tag.get_text(strip=True),
                "link": link,
                "press": press_tag.get_text(strip=True) if press_tag else "",
                "date": date_tag.get_text(strip=True) if date_tag else "",
            }
        )
        if len(items) >= limit:
            break

    return items


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
