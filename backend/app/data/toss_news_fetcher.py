"""Korean-language coverage of a US listing, from Toss Securities' news feed.

Why this exists alongside naver_news_search_fetcher: for a US company, Naver has no
per-code news tab, so that fetcher searches Naver News for the company's Korean name
and takes what comes back. It works, but it is a search — a query for "애플" returns
articles about the fruit company's suppliers, its rivals, and occasionally the fruit.
Toss publishes an actual per-company feed, already translated into Korean, and the
articles are attributed to the outlet that wrote them.

It also carries the article body, as an ordered list of blocks, in the detail
response. That is the part worth having: the Naver path has to fetch the outlet's page
and run Readability over it, which is slow, fails on paywalls and script-built pages,
and is the reason `paragraphs` can come back null. Here the body arrives as data.
"""

from app.data.toss_session import INFO_API, resolve_company_code, session
from app.services.cache import cache

TTL_NEWS_SECONDS = 5 * 60
TTL_ARTICLE_SECONDS = 60 * 60


def _item(news: dict) -> dict:
    source = news.get("source") or {}
    return {
        # Toss articles are addressed by this opaque id rather than by URL, so it is
        # what the body request below is keyed on. `link` stays the outlet's own URL
        # (filled in by the detail call) for the "원문 보기" affordance.
        "id": str(news.get("id") or ""),
        "title": str(news.get("title") or news.get("titleV2") or "").strip(),
        "press": source.get("name") or "",
        "press_logo": source.get("faviconUrl") or "",
        "date": news.get("createdAt") or "",
        "summary": str(news.get("summary") or "").strip(),
        "image_url": next(iter(news.get("imageUrls") or []), None),
    }


def _fetch_news(symbol: str, limit: int, page: int) -> dict:
    company_code = resolve_company_code(symbol)
    if not company_code:
        return {"items": [], "has_next": False}
    response = session.get(
        f"{INFO_API}/api/v2/news/companies/{company_code}",
        params={"size": limit, "number": page},
        timeout=5,
    )
    response.raise_for_status()
    result = response.json().get("result") or {}
    items = [_item(news) for news in (result.get("body") or []) if news.get("title")]
    return {"items": items, "has_next": not result.get("lastPage", True)}


def get_toss_news(symbol: str, limit: int = 12, page: int = 1) -> dict:
    symbol = symbol.upper()
    try:
        return cache.get_or_set(
            f"toss_news:{symbol}:{limit}:{page}",
            TTL_NEWS_SECONDS,
            lambda: _fetch_news(symbol, limit, page),
        )
    except Exception:
        return {"items": [], "has_next": False}


def _fetch_article(news_id: str) -> dict:
    response = session.get(f"{INFO_API}/api/v1/news/{news_id}", timeout=5)
    response.raise_for_status()
    result = response.json().get("result") or {}
    # `content` is a list of typed blocks; only the text ones carry the article. Image
    # and embed blocks are dropped rather than rendered, because the panel that shows
    # this is a reading column, not a reproduction of the outlet's page.
    paragraphs = [
        text
        for block in (result.get("content") or [])
        if block.get("type") == "text" and (text := str(block.get("content") or "").strip())
    ]
    source = result.get("source") or {}
    return {
        "title": str(result.get("title") or "").strip(),
        "press": source.get("name") or "",
        "date": result.get("createdAt") or "",
        # Toss's own three-line digest of the article. Shown above the body, because it
        # is the one thing here that a summary-by-truncation cannot give.
        "summary_sentences": [
            line for s in (result.get("summarySentences") or []) if (line := str(s).strip())
        ],
        "paragraphs": paragraphs or None,
        "link": result.get("linkUrl") or "",
    }


def get_toss_news_article(news_id: str) -> dict:
    try:
        return cache.get_or_set(
            f"toss_news_article:{news_id}",
            TTL_ARTICLE_SECONDS,
            lambda: _fetch_article(news_id),
        )
    except Exception:
        return {"title": "", "press": "", "date": "", "summary_sentences": [], "paragraphs": None, "link": ""}
