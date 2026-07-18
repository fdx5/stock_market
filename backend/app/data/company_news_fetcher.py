from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from app.data import news_fetcher

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search"

# Google News RSS aggregates from every outlet it indexes, including low-quality
# aggregators/blogs — items whose <source> matches one of these well-known finance
# outlets are sorted first so credible coverage surfaces before the rest, without
# hard-filtering everything else out (a smaller company might have no results at all
# from this list, and something is better than an empty popup).
PREFERRED_SOURCES = {
    "reuters",
    "bloomberg",
    "cnbc",
    "marketwatch",
    "the wall street journal",
    "wsj",
    "yahoo finance",
    "financial times",
    "barron's",
    "barrons",
    "forbes",
    "business insider",
    "associated press",
    "ap news",
    "investor's business daily",
    "axios",
}


def _is_preferred(source: str) -> bool:
    return source.strip().lower() in PREFERRED_SOURCES


def fetch_google_news(query: str, limit: int) -> list[dict]:
    """Google News RSS search — no API key needed. Returns Google's own redirect-
    wrapper link for each item; enrich_with_og_image resolves it to the real
    publisher URL when it fetches the page for its thumbnail."""
    url = f"{GOOGLE_NEWS_RSS_URL}?q={quote(query)}&hl=en-US&gl=US&ceid=US:en"
    resp = requests.get(url, headers=HEADERS, timeout=6)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.content, "xml")

    items: list[dict] = []
    for entry in soup.select("item"):
        title_tag = entry.find("title")
        link_tag = entry.find("link")
        source_tag = entry.find("source")
        date_tag = entry.find("pubDate")
        if not title_tag or not link_tag:
            continue
        items.append(
            {
                "title": title_tag.get_text(strip=True),
                "link": link_tag.get_text(strip=True),
                "source": source_tag.get_text(strip=True) if source_tag else "",
                "published": date_tag.get_text(strip=True) if date_tag else "",
            }
        )

    # Stable sort: RSS already returns newest-first, so preferred-source items keep
    # their relative recency order within their own group.
    items.sort(key=lambda it: 0 if _is_preferred(it["source"]) else 1)
    return items[:limit]


def fetch_naver_news_for_fight(krx_code: str, limit: int) -> list[dict]:
    """Reuses the existing Naver-based fetcher (already used by the per-stock
    dashboard news tab) and reshapes its {title, link, press, date} into this
    feature's {title, link, source, published} shape.

    news_fetcher.get_news caches under a key that doesn't encode `limit`, so a
    caller elsewhere requesting a different count (e.g. the dashboard's default-
    stock startup warmup, which shares this exact Samsung code) can leave more
    items in that cache entry than this feature asked for — sliced back down to
    `limit` here so the popup's item count stays predictable regardless of who
    warmed the cache first."""
    raw_items = news_fetcher.get_news(krx_code, limit)[:limit]
    return [
        {
            "title": it["title"],
            "link": it["link"],
            "source": it["press"],
            "published": it["date"],
        }
        for it in raw_items
    ]


def enrich_with_og_image(item: dict) -> dict:
    """Neither Google News RSS nor Naver's news list carries a thumbnail, so this
    opens the article's own page and reads its Open Graph tags — the same
    lightweight, best-effort scrape pattern used elsewhere in this codebase
    (global_marketcap_fetcher's get_company_detail). Also swaps in the redirect-
    resolved real article URL (resp.url) in place of Google's wrapper link, so the
    "원문 보기" link the user clicks goes straight to the actual publisher. Any
    failure here (timeout, non-HTML response, no og tags) just leaves the item
    without an image/snippet rather than breaking the whole list."""
    try:
        resp = requests.get(item["link"], headers=HEADERS, timeout=4, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        image_tag = soup.select_one('meta[property="og:image"]')
        desc_tag = soup.select_one('meta[property="og:description"]')

        return {
            **item,
            "link": resp.url,
            "image_url": image_tag["content"] if image_tag and image_tag.get("content") else None,
            "snippet": desc_tag["content"] if desc_tag and desc_tag.get("content") else None,
        }
    except Exception:
        return {**item, "image_url": None, "snippet": None}


def get_company_news(code: str, company_name: str, limit: int = 6) -> list[dict]:
    if code.endswith(".KS"):
        items = fetch_naver_news_for_fight(code[: -len(".KS")], limit)
        if not items:
            return []
        # Naver's links are direct, stable article URLs (see _resolve_article_link),
        # so fetching each one for its own og:image/og:description works as intended.
        with ThreadPoolExecutor(max_workers=min(6, len(items))) as pool:
            futures = [pool.submit(enrich_with_og_image, it) for it in items]
            return [f.result() for f in futures]

    items = fetch_google_news(f'"{company_name}" stock', limit)
    # Google News RSS <link> values are all a news.google.com/rss/articles/... wrapper
    # that only reaches the real publisher via client-side JS on that page (confirmed:
    # requests with allow_redirects=True gets a 302 that just adds query params and
    # stays on news.google.com) — a real browser follows it to the actual article
    # fine, but a bare GET here can't. Fetching it anyway would just scrape Google's
    # own generic "News" placeholder image and boilerplate description on every
    # single item, which is worse than showing no image at all — so these items are
    # returned title/source/date/link only, no enrichment attempt.
    return [{**it, "image_url": None, "snippet": None} for it in items]
