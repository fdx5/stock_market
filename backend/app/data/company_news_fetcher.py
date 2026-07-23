import datetime as dt
import ipaddress
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse, urlunparse

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

_ALLOWED_ARTICLE_SCHEMES = {"http", "https"}
_MAX_ARTICLE_REDIRECTS = 5


def _is_safe_external_url(url: str) -> bool:
    """Guards fetch_article_content's client-supplied `link` (the one place in this
    app where the client picks an arbitrary URL for the server to fetch — every other
    outbound fetch here targets a fixed, hardcoded host) against SSRF: only http(s) is
    allowed, and every IP the hostname resolves to must be public — not
    loopback/private/link-local/reserved/multicast. Without this, a crafted `link`
    could make the server reach its own internal endpoints or other hosts on the
    hosting platform's private network. This doesn't fully defend against DNS
    rebinding (the resolved IP isn't pinned to the actual outgoing connection, so a
    hostname could resolve safely here and then differently at request time) — a
    known, accepted gap for a best-effort guard at this scale, not a claim of
    complete protection."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in _ALLOWED_ARTICLE_SCHEMES or not parsed.hostname:
            return False
        for info in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except Exception:
        return False


def _fetch_article_response(url: str) -> requests.Response | None:
    """GET with redirects followed manually (not requests' own allow_redirects=True)
    so every hop — not just the initial URL — is checked by _is_safe_external_url. A
    malicious server could otherwise pass the first check and then redirect the
    request to a private address, bypassing SSRF protection entirely."""
    for _ in range(_MAX_ARTICLE_REDIRECTS):
        if not _is_safe_external_url(url):
            return None
        resp = requests.get(url, headers=HEADERS, timeout=6, allow_redirects=False)
        location = resp.headers.get("Location")
        if resp.is_redirect and location:
            url = urljoin(url, location)
            continue
        return resp
    return None

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


# Bing returns each result page in relevance order, not newest-first (confirmed by
# direct request: pubDates within one page arrive out of order, and Bing's own
# sortbydate param had no effect), so recency has to be reconstructed from each item's
# pubDate and sorted on explicitly — otherwise a highly-relevant but weeks-old article
# outranks fresh coverage, which is exactly the "not the latest news" symptom.
_OLDEST = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


def _published_dt(published: str) -> dt.datetime:
    """Parse an RSS RFC-822 pubDate ('Wed, 22 Jul 2026 06:57:00 GMT') into a
    timezone-aware datetime for recency sorting. Anything missing or unparseable sorts
    as oldest (epoch) so dated items always rank above undated ones — and the epoch
    sentinel keeps every value at or after 1970, avoiding the Windows OSError that
    datetime.min.timestamp() raises for pre-1970 dates."""
    if not published:
        return _OLDEST
    try:
        parsed = parsedate_to_datetime(published)
    except (TypeError, ValueError, IndexError):
        return _OLDEST
    if parsed is None:
        return _OLDEST
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def _is_preferred(source: str) -> bool:
    # Substring, not exact match: Bing sometimes appends a syndication suffix (e.g.
    # "The Motley Fool on MSN") that wouldn't equal the plain outlet name.
    normalized = source.strip().lower()
    return any(preferred in normalized for preferred in PREFERRED_SOURCES)


# Domains confirmed (by direct request during development) to never yield real
# article text to a plain server-side fetch, for two different reasons: msn.com
# renders the article body entirely client-side (bare React root div, no <p> tags or
# hydration data anywhere in the raw HTML — no extraction library can help, the text
# genuinely isn't in the response), while seekingalpha.com hard-blocks with a 403.
# Reuters is deliberately NOT here despite also blocking with a bot-challenge (401 +
# "enable JS" page): it's one of the most authoritative sources this list has, and
# even when in-app reading fails for it, "원문에서 보기" still opens fine in a real
# browser — sorting it out of the list entirely would be the wrong trade-off.
UNEXTRACTABLE_DOMAINS = {"msn.com", "seekingalpha.com"}


def _is_unextractable_domain(link: str) -> bool:
    """Sorted after everything else (not filtered out) so a company with little
    coverage outside these domains still gets a full-length list instead of an
    artificially short one."""
    return any(domain in link for domain in UNEXTRACTABLE_DOMAINS)


def _normalize_title(title: str) -> str:
    """Loose dedup key for spotting the same story reposted across outlets/aggregators
    with a different trailing clause or punctuation ("Nvidia Stock Jumps 5%" vs
    "Nvidia Stock Jumps 5% After Earnings Beat") — lowercased, punctuation stripped,
    whitespace collapsed, and capped to the leading 50 chars so two headlines that only
    diverge after that point still collide."""
    cleaned = re.sub(r"[^\w\s]", "", title.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:50]


def _normalize_link(link: str) -> str:
    """Same publisher path with a different tracking query string (utm_*, syndication
    id, ...) is still the same article for dedup purposes."""
    parsed = urlparse(link)
    return f"{parsed.netloc}{parsed.path}".rstrip("/").lower()


def _dedupe_items(items: list[dict]) -> list[dict]:
    """Drops items whose title or link (normalized) has already been seen, keeping the
    first occurrence — callers sort before calling this, so "first" means
    highest-priority. Catches wire-service stories syndicated near-identically across
    several outlets (common in both the Bing and Naver results), which otherwise ate
    slots in the fixed-size list without adding distinct coverage."""
    seen_titles: set[str] = set()
    seen_links: set[str] = set()
    result = []
    for it in items:
        title_key = _normalize_title(it.get("title") or "")
        link_key = _normalize_link(it.get("link") or "")
        if (title_key and title_key in seen_titles) or (link_key and link_key in seen_links):
            continue
        if title_key:
            seen_titles.add(title_key)
        if link_key:
            seen_links.add(link_key)
        result.append(it)
    return result


def _resolve_bing_real_url(apiclick_link: str) -> str:
    """Bing's <link> is a bing.com/news/apiclick.aspx tracking wrapper, but — unlike
    Google News RSS's wrapper, which only resolves via client-side JS — the real
    publisher URL is right there in the `url` query parameter, so it can be read
    directly with no extra request."""
    query = parse_qs(urlparse(apiclick_link).query)
    real_url = query.get("url", [None])[0]
    return real_url or apiclick_link


def _upsize_bing_thumbnail(url: str) -> str:
    """Bing's News RSS <Image> tag always points at a fixed 100x100 thumbnail
    (bing.com/th?id=...&pid=News) — far too small and hard-cropped to look sharp at
    the card sizes this app displays it at. The same th.bing.com resizing endpoint
    accepts width/height/crop-mode query params and serves a real, much
    higher-resolution version of the same source image (confirmed directly: a genuine
    larger original, not an upscaled blur), so those are added here instead of using
    the URL exactly as Bing hands it back. 800x450 was tested directly against several
    sample thumbnails: c=7 fills that box edge-to-edge with real detail, while going
    higher (960x540+) started letterboxing with white padding on some images — i.e.
    800x450 is at or near the real ceiling of what the underlying source images
    actually contain, so it's the largest size reliably free of padding artifacts.
    Scheme is forced to https since Bing returns these as plain http, which a browser
    would otherwise block as mixed content on this app's https pages."""
    if "bing.com/th" not in url:
        return url
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    query["w"] = ["800"]
    query["h"] = ["450"]
    query["c"] = ["7"]
    new_query = urlencode({k: v[0] for k, v in query.items()})
    return urlunparse(parsed._replace(scheme="https", query=new_query))


def _fetch_bing_page(query: str, first: int) -> list[dict]:
    """Fetches one Bing News RSS page (one query phrasing x one `first` result
    offset). Never raises — a failed/empty page just contributes nothing to the
    caller's merged pool, since fetch_bing_news treats every (query, offset) combo
    uniformly rather than special-casing failures."""
    url = f"{BING_NEWS_RSS_URL}?q={quote(query)}&format=RSS&mkt=en-US&setmkt=en-US&cc=US&first={first}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=6)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "xml")
    except Exception:
        return []

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
                "image_url": _upsize_bing_thumbnail(image_tag.get_text(strip=True)) if image_tag else None,
            }
        )
    return items


def fetch_bing_news(company_name: str, limit: int) -> list[dict]:
    """Bing News RSS search — no API key needed. Unlike Google News RSS, the feed
    already carries a real (non-wrapper) article URL, a genuine summary, and a
    thumbnail per item, so no extra per-article scrape is needed to enrich these.

    Without an explicit market, Bing infers one from the request's origin (this
    server's own region), which surfaced Korean English-language outlets (SBS News,
    Maeil Business) instead of major US financial press even for US companies —
    forcing en-US/US here reliably returns outlets like Forbes, Yahoo Finance, and
    The Motley Fool instead (confirmed by direct comparison during development).

    Fetches 2 query phrasings (exact-phrase + loose) x 3 result offsets (Bing's
    `first` param) in parallel and merges them into one pool before ranking: checked
    directly against msn.com during development — the response has no <p> tags, no
    canonical link back to an original (non-MSN) publisher, and no other reference to
    one anywhere in the page, so an MSN hit can never be extracted server-side no
    matter how it's fetched. The only lever left is maximizing how many *other*,
    extractable outlets are even in the candidate pool before the existing
    unextractable-domain-last sort + dedupe picks the final `limit` — a single page for
    a single phrasing was frequently >60% MSN for heavily-covered large caps, starving
    the final list of readable items even though the sort already deprioritizes MSN
    correctly."""
    queries = [f'"{company_name}" stock', f"{company_name} stock"]
    offsets = (1, 11, 21)
    combos = [(q, first) for q in queries for first in offsets]

    all_items: list[dict] = []
    seen_raw_links: set[str] = set()
    with ThreadPoolExecutor(max_workers=len(combos)) as pool:
        futures = [pool.submit(_fetch_bing_page, q, first) for q, first in combos]
        for future in futures:
            for it in future.result():
                if it["link"] in seen_raw_links:
                    continue
                seen_raw_links.add(it["link"])
                all_items.append(it)

    # Recency is the primary sort so the list actually leads with the latest coverage
    # (see _published_dt for why Bing's own order can't be trusted for this). Known-
    # unextractable domains are still pushed to the very end regardless of how fresh
    # they are — they can't render an in-app article body, so a readable slightly-older
    # story is more useful there. Preferred-source reputation drops to a tiebreaker,
    # only deciding order between items published at the same minute. Deduping after the
    # sort (not before) means the higher-priority copy of a reposted story is kept.
    all_items.sort(
        key=lambda it: (
            _is_unextractable_domain(it["link"]),
            -_published_dt(it["published"]).timestamp(),
            0 if _is_preferred(it["source"]) else 1,
        )
    )
    return _dedupe_items(all_items)[:limit]


def fetch_naver_news_for_fight(krx_code: str, limit: int) -> list[dict]:
    """Reuses the existing Naver-based fetcher (already used by the per-stock
    dashboard news tab and its recent-news digest) and reshapes its
    {title, link, press, date} into this feature's shape. news_fetcher.get_news
    already dedupes by both link and normalized title before it ever returns, so no
    separate dedup pass is needed here."""
    raw_items = news_fetcher.get_news(krx_code, limit)
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

    return fetch_bing_news(company_name, limit)


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
    an external link in that case. Also returns None outright for a `url` that fails
    the SSRF guard (see _is_safe_external_url) — this is the one endpoint in the app
    where the client picks the URL a server-side fetch targets."""
    try:
        resp = _fetch_article_response(url)
        if resp is None:
            return None
        resp.raise_for_status()
        summary_html = Document(resp.text).summary()
        soup = BeautifulSoup(summary_html, "html.parser")

        paragraphs = [p.get_text(strip=True) for p in soup.select("p")]
        paragraphs = [p for p in paragraphs if len(p) > 20][:MAX_ARTICLE_PARAGRAPHS]

        if sum(len(p) for p in paragraphs) < MIN_ARTICLE_CHARS:
            # Naver's news template (and other, similarly older Korean sites) renders
            # the whole article body as one block with <br> tags between lines instead
            # of separate <p> elements — confirmed directly against a real 삼성전자
            # article where this was the ONLY reason extraction failed: readability
            # correctly isolated the real ~3800-char article body, but the <p>-only
            # grab above found just 3 unrelated short strings (byline, copyright
            # notice) since none of the actual article text was inside a <p> tag at
            # all. Scoped to the <article> tag readability wraps the identified main
            # content in (when present) rather than the whole summary, so sibling
            # chrome it left in (that same byline/copyright) doesn't get pulled in as
            # false paragraphs alongside the real ones.
            container = soup.select_one("article") or soup
            for br in container.select("br"):
                br.replace_with("\n")
            lines = [line.strip() for line in container.get_text().split("\n")]
            paragraphs = [line for line in lines if len(line) > 20][:MAX_ARTICLE_PARAGRAPHS]

        if sum(len(p) for p in paragraphs) < MIN_ARTICLE_CHARS:
            return None
        return paragraphs
    except Exception:
        return None
