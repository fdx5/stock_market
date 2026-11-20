"""Read text and media supplied in the publishers' public syndication feeds."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
import re
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

COMMON = [
    ("뉴시스", "https://www.newsis.com/RSS/international.xml"),
    ("뉴시스", "https://www.newsis.com/RSS/economy.xml"),
    ("머니투데이", "https://rss.mt.co.kr/mt_news.xml"),
]
REGIONAL = {
    "CA": ("The Globe and Mail", "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/investing/"),
    "GB": ("The Guardian", "https://www.theguardian.com/business/stock-markets/rss"),
    "FR": ("BFM Business", "https://www.bfmtv.com/rss/economie/"),
    "IN": ("The Economic Times", "https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms"),
}

# "[서울=뉴시스] 홍길동 기자 = " style datelines that open Korean wire copy.
BYLINE = re.compile(r"^\s*(?:\([^)]{1,20}\)|\[[^\]]{1,30}\])?\s*(?:[가-힣]{2,4}\s*(?:기자|특파원)\s*=\s*)?")


def picture(raw, base):
    if not raw:
        return None
    url = urljoin(base, raw.strip())
    parts = urlsplit(url)
    return url if parts.scheme == "https" and parts.hostname else None


def _read(source, url):
    response = requests.get(url, timeout=(2, 4))
    response.raise_for_status()
    rows = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    for item in ET.fromstring(response.content).findall("./channel/item")[:100]:
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
            if published < cutoff:
                continue
        except (TypeError, ValueError):
            continue
        title = unescape(item.findtext("title", "")).strip()
        link = item.findtext("link", "").strip()
        if not title or urlsplit(link).scheme not in ("https", "http"):
            continue
        html = item.findtext("{*}encoded") or item.findtext("description") or ""
        image = next((node.get("url") for node in item if node.tag in
                      ("enclosure", "{http://search.yahoo.com/mrss/}content", "{http://search.yahoo.com/mrss/}thumbnail")
                      and node.get("url") and (node.get("type") or "image/").startswith("image/")), None)
        rows.append((title, link, source, published.isoformat(), html, image))
    return rows


def _cached(feed):
    source, url = feed
    try:
        return cache.get_or_set("world:publisher:" + url, 600, lambda: _read(source, url))
    except (requests.RequestException, ET.ParseError, ValueError):
        return []


def publisher_stories(country, pattern, market_event):
    feeds = [*COMMON, *([REGIONAL[country]] if country in REGIONAL else [])]
    with ThreadPoolExecutor(max_workers=len(feeds)) as pool:
        candidates = [item for feed in pool.map(_cached, feeds) for item in feed
                      if re.search(pattern, item[0], re.I) and market_event.search(item[0])]
    stories = {}
    for title, link, source, published, html, media in sorted(candidates, key=lambda item: item[3], reverse=True):
        if link in stories:
            continue
        soup = BeautifulSoup(html, "html.parser")
        img = soup.find("img", src=True)
        for br in soup.find_all("br"):
            br.replace_with("\n")
        for paragraph in soup.find_all("p"):
            paragraph.insert_after("\n")
        lines = [line.strip() for line in soup.get_text().splitlines() if line.strip()]
        lines = [line for line in lines if len(line) > 12 and line.lower() not in ("continue reading...", "continue reading…")]
        lines = [BYLINE.sub("", line).strip() for line in lines]
        lines = [line for line in lines if len(line) > 12]
        if len(" ".join(lines)) < 100:
            continue
        stories[link] = dict(title=title, url=link, source=source, published=published, translated=False,
                             summary=lines[0], paragraphs=lines[1:16], image=picture(media or (img and img["src"]), link))
        if len(stories) >= 6:
            break
    return list(stories.values())


def _page(url):
    """Open-Graph picture, description and readable body of one article page."""
    from readability import Document
    from app.data.company_news_fetcher import _fetch_article_response
    response = _fetch_article_response(url)
    if response is None or not response.ok or "html" not in response.headers.get("Content-Type", "html"):
        return {}
    soup = BeautifulSoup(response.text, "html.parser")
    meta = lambda key: (soup.select_one(f'meta[property="{key}"]') or soup.select_one(f'meta[name="{key}"]') or {}).get("content")
    body = BeautifulSoup(Document(response.text).summary(), "html.parser")
    for br in body.find_all("br"):
        br.replace_with("\n")
    lines = [line.strip() for node in (body.find_all("p") or [body]) for line in node.get_text().splitlines()]
    lines = [line for line in lines if len(line) > 30 and not re.search(r"copyright|all rights reserved|무단.?전재|구독|sign up|newsletter", line, re.I)]
    return dict(image=picture(meta("og:image") or meta("twitter:image"), response.url),
                description=(meta("og:description") or "").strip(),
                paragraphs=lines[:16] if len(" ".join(lines)) >= 300 else [])


def enrich(story):
    """Fill a feed story's missing picture and body from the publisher's own page."""
    if story.get("paragraphs") and story.get("image") or "news.google.com" in story["url"]:
        return tidy(dict(story))
    try:
        page = cache.get_or_set("world:page:" + story["url"], 21600, lambda: _page(story["url"]))
    except Exception:
        page = {}
    story = dict(story)
    story["image"] = story.get("image") or page.get("image")
    if not story.get("paragraphs") and page.get("paragraphs"):
        story["paragraphs"] = page["paragraphs"]
    if not story.get("summary"):
        story["summary"] = page.get("description") or ""
    return tidy(story)


def _brief(text, limit=210):
    """At most the opening sentences of a lead, cut at a sentence end."""
    if len(text) <= limit:
        return text
    ends = [m.end() for m in re.finditer(r"(?:다|요|[.!?])[.\"'”’]?\s", text[:limit + 1])]
    return text[:ends[-1]].strip() if ends and ends[-1] > 60 else text[:limit].rstrip() + "…"


def tidy(story):
    """Drop datelines, shorten the lead, and skip body lines it already covers."""
    raw = BYLINE.sub("", story.get("summary") or "").strip()
    lines = [BYLINE.sub("", line).strip() for line in story.get("paragraphs") or []]
    key = lambda text: re.sub(r"\W", "", text)[:40]
    lead = _brief(raw)
    covered = re.sub(r"\W", "", lead)
    if not lines and lead != raw:
        lines = [raw[len(lead):].lstrip(" …")]
    story["summary"] = lead
    story["paragraphs"] = [line for line in lines if len(line) > 12 and key(line) not in covered]
    return story
