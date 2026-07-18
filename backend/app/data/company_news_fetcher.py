from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, quote, urlparse

import requests
from bs4 import BeautifulSoup
from readability import Document

from app.data import news_fetcher

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

BING_NEWS_RSS_URL = "https://www.bing.com/news/search"

# Both Google News RSS and Bing News RSS aggregate from every outlet they index,
# including low-quality aggregators/blogs — items whose source matches one of these
# well-known finance outlets are sorted first so credible coverage surfaces before
# the rest, without hard-filtering everything else out (a smaller company might have
# no results at all from this list, and something is better than an empty popup).
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
    "the motley fool",
    "motley fool",
    "thestreet",
    "24/7 wall st.",
    "seeking alpha",
}

# An article is considered successfully extracted only past this length — shorter
# than this is almost always a readability mis-extraction (nav/cookie-notice text)
# rather than real article body, so the caller falls back to the list snippet.
MIN_ARTICLE_CHARS = 200
MAX_ARTICLE_PARAGRAPHS = 12


def _is_preferred(source: str) -> bool:
    # Substring, not exact match: Bing sometimes appends a syndication suffix (e.g.
    # "The Motley Fool on MSN") that wouldn't equal the plain outlet name.
    normalized = source.strip().lower()
    return any(preferred in normalized for preferred in PREFERRED_SOURCES)


def _resolve_bing_real_url(apiclick_link: str) -> str:
    """Bing's <link> is a bing.com/news/apiclick.aspx tracking wrapper, but — unlike
    Google News RSS's wrapper, which only resolves via client-side JS — the real
    publisher URL is right there in the `url` query parameter, so it can be read
    directly with no extra request."""
    query = parse_qs(urlparse(apiclick_link).query)
    real_url = query.get("url", [None])[0]
    return real_url or apiclick_link


def fetch_bing_news(query: str, limit: int) -> list[dict]:
    """Bing News RSS search — no API key needed. Unlike Google News RSS, the feed
    already carries a real (non-wrapper) article URL, a genuine summary, and a
    thumbnail per item, so no extra per-article scrape is needed to enrich these.

    Without an explicit market, Bing infers one from the request's origin (this
    server's own region), which surfaced Korean English-language outlets (SBS News,
    Maeil Business) instead of major US financial press even for US companies —
    forcing en-US/US here reliably returns outlets like Forbes, Yahoo Finance, and
    The Motley Fool instead (confirmed by direct comparison during development)."""
    url = f"{BING_NEWS_RSS_URL}?q={quote(query)}&format=RSS&mkt=en-US&setmkt=en-US&cc=US"
    resp = requests.get(url, headers=HEADERS, timeout=6)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.content, "xml")

    items: list[dict] = []
    for entry in soup.select("item"):
        title_tag = entry.find("title")
        link_tag = entry.find("link")
        # bs4's XML parser strips the "News:" namespace prefix but keeps the local
        # name's original casing (confirmed: <News:Source> -> tag.name == "Source",
        # not "source") — case-sensitive .find() needs the exact casing to match.
        source_tag = entry.find("Source")
        date_tag = entry.find("pubDate")
        desc_tag = entry.find("description")
        image_tag = entry.find("Image")
        if not title_tag or not link_tag:
            continue

        items.append(
            {
                "title": title_tag.get_text(strip=True),
                "link": _resolve_bing_real_url(link_tag.get_text(strip=True)),
                "source": source_tag.get_text(strip=True) if source_tag else "",
                "published": date_tag.get_text(strip=True) if date_tag else "",
                "snippet": desc_tag.get_text(strip=True) if desc_tag else None,
                "image_url": image_tag.get_text(strip=True) if image_tag else None,
            }
        )

    # Stable sort: RSS already returns newest-first, so preferred-source items keep
    # their relative recency order within their own group.
    items.sort(key=lambda it: 0 if _is_preferred(it["source"]) else 1)
    return items[:limit]


def fetch_naver_news_for_fight(krx_code: str, limit: int) -> list[dict]:
    """Reuses the existing Naver-based fetcher (already used by the per-stock
    dashboard news tab) and reshapes its {title, link, press, date} into this
    feature's shape.

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
            "snippet": None,
            "image_url": None,
        }
        for it in raw_items
    ]


def enrich_with_og_image(item: dict) -> dict:
    """Naver's news list doesn't carry a thumbnail/snippet in the list view itself,
    so this opens the article's own page and reads its Open Graph tags — the same
    lightweight, best-effort scrape pattern used elsewhere in this codebase
    (global_marketcap_fetcher's get_company_detail). Naver's links are direct,
    stable article URLs (see news_fetcher._resolve_article_link), so — unlike a
    Google News RSS wrapper link — this reaches the real page with a plain GET.
    Any failure here (timeout, non-HTML response, no og tags) just leaves the item
    without an image/snippet rather than breaking the whole list."""
    try:
        resp = requests.get(item["link"], headers=HEADERS, timeout=4, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        image_tag = soup.select_one('meta[property="og:image"]')
        desc_tag = soup.select_one('meta[property="og:description"]')

        return {
            **item,
            "image_url": image_tag["content"] if image_tag and image_tag.get("content") else None,
            "snippet": desc_tag["content"] if desc_tag and desc_tag.get("content") else None,
        }
    except Exception:
        return item


def get_company_news(code: str, company_name: str, limit: int = 6) -> list[dict]:
    if code.endswith(".KS"):
        items = fetch_naver_news_for_fight(code[: -len(".KS")], limit)
        if not items:
            return []
        with ThreadPoolExecutor(max_workers=min(6, len(items))) as pool:
            futures = [pool.submit(enrich_with_og_image, it) for it in items]
            return [f.result() for f in futures]

    items = fetch_bing_news(f'"{company_name}" stock', limit)
    if not items:
        # The exact-phrase query can come up empty for compound display names (e.g.
        # "Meta Platforms (Facebook)" rarely appears verbatim in an article) or from
        # an occasional empty/blocked response — retry once with a looser, unquoted
        # query before giving up and showing "no recent news".
        items = fetch_bing_news(f"{company_name} stock", limit)
    return items


def fetch_article_content(url: str) -> list[str] | None:
    """Generic full-article-text extraction for an arbitrary news URL. A naive
    <p>-tag grab was tested against a real article page and pulled in unrelated
    "related articles" headlines alongside the real body — different sites structure
    their markup too differently for that to work reliably. `readability-lxml`
    (a Python port of Mozilla's Readability algorithm — the same class of heuristic
    Firefox's own Reader View uses) was tested against the same page and correctly
    isolated just the real article body, so it's used here instead.

    Returns None (never raises) on any failure, or when the extracted text is too
    short to be a real article body (a login wall, cookie notice, or nav-only page
    read as a false "success") — callers fall back to the list's own snippet plus
    an external link in that case."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=6, allow_redirects=True)
        resp.raise_for_status()
        summary_html = Document(resp.text).summary()
        soup = BeautifulSoup(summary_html, "html.parser")

        paragraphs = [p.get_text(strip=True) for p in soup.select("p")]
        paragraphs = [p for p in paragraphs if len(p) > 20][:MAX_ARTICLE_PARAGRAPHS]

        if sum(len(p) for p in paragraphs) < MIN_ARTICLE_CHARS:
            return None
        return paragraphs
    except Exception:
        return None
