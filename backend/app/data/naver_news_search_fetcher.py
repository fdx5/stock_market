"""Naver news search, for the stocks finance.naver has no news page for.

news_fetcher.py covers KRX names by reading finance.naver's per-code news tab. There
is no such tab for AAPL or NVDA, so the S&P 500 side of 종목정보 asks Naver's general
news search for the company by name instead — Korean coverage of a US company, which
is what a Korean reader wants and what the finance tab would have given them.

**On the selectors.** Naver's search results are rendered from a design system whose
class names are half stable (`sds-comps-text-type-headline1`) and half build hashes
that rotate (`z8kbNxJnxSwkUP0T`). Nothing here matches a hash. An article is found by
its title anchor's `data-heatmap-target=".tit"` — an analytics hook, so it survives
restyling — and its press and timestamp are read from the nearest ancestor that
contains exactly one such anchor, rather than from a container selected by class.
That ancestor is three levels up today; walking up to it instead of reaching for
`.parent.parent.parent` is what keeps this working when it becomes four.

A failure returns an empty list rather than raising: news is one tab of a panel, and a
scraper is a thing that breaks. The panel says it found nothing, and the price, chart
and discussion beside it are unaffected.
"""

from __future__ import annotations

import datetime as dt
import re

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

SEARCH_URL = "https://search.naver.com/search.naver"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    # Naver serves the search page fine without a Referer, but sends a different
    # (mobile-shaped) document to clients that look like they arrived from nowhere.
    "Referer": "https://www.naver.com/",
}

# Matches news_fetcher.TTL_NEWS_SECONDS. A company's headlines change on the order of
# minutes, and every viewer of a panel shares one entry.
TTL_SECONDS = 15 * 60

TIMEOUT_SECONDS = 6

# Naver appends this to every link it renders, as screen-reader text inside the anchor.
# It is not part of any headline or press name.
_NEW_WINDOW_SUFFIX = "새 창 열림"

# The subtext column carries either a relative age ("34분 전"), an absolute date
# ("2026.08.24."), or the words "네이버뉴스" for the "read on Naver" link that sits in
# the same row. Only the first two are timestamps.
_RELATIVE_AGE = re.compile(r"^\d+(초|분|시간|일|주|개월|년)\s*전$")
_ABSOLUTE_DATE = re.compile(r"^\d{4}\.\d{2}\.\d{2}\.?$")

# Naver's `sort`: "0" is 관련도순, "1" is 최신순. Relevance, and it is not a close call
# on this data. A company name is a common word as often as not, and newest-first hands
# back whatever happened to mention it in the last ten minutes — asking for 애플 that
# way returns App Store game rankings and a Galaxy Buds review before it returns Apple.
# Sorted by relevance the same query returns Tim Cook's retirement, which is what a
# reader who opened Apple's panel came for. The list is still recent: these are search
# results for a company in the news, not an archive.
SORT_RELEVANCE = "0"

# Naver clusters near-duplicate syndicated copy but still surfaces the same story from
# several outlets under slightly different headlines; comparing punctuation-stripped
# titles collapses those the way news_fetcher does for the finance tab.
_TITLE_NOISE = re.compile(r"[^0-9A-Za-z가-힣]+")


def _text(tag) -> str:
    """A tag's rendered text, with Naver's screen-reader suffix removed.

    Deliberately `get_text()` and not `get_text(strip=True)`. Naver wraps every matched
    query term in `<mark>`, and the stripping form strips each string node separately —
    which deletes the space *between* nodes, turning "스페이스X AI, 엔비디아" into
    "스페이스XAI,엔비디아". Taking the text unstripped keeps the original spacing, and
    collapsing runs of whitespace afterwards handles the newlines in the markup.
    """
    return _clean(tag.get_text())


def _clean(text: str) -> str:
    if text.rstrip().endswith(_NEW_WINDOW_SUFFIX):
        text = text.rstrip()[: -len(_NEW_WINDOW_SUFFIX)]
    return re.sub(r"\s+", " ", text).strip()


def _title_key(title: str) -> str:
    return _TITLE_NOISE.sub("", title)[:60]


def _byline(anchor) -> tuple[str, str]:
    """The press name and timestamp belonging to one title anchor.

    Paired by document order rather than by climbing to a shared ancestor, because
    Naver clusters related coverage: a story carried by five outlets renders as a group
    headline followed by its five members, so the group's subtree holds five title
    anchors and not one. Climbing from a member to "the ancestor with exactly one
    title" finds nothing at all in that layout, which is how every cluster's rows lost
    their press name.

    In document order a row reads title -> summary -> press -> timestamp, so the byline
    is whatever appears after this anchor and before the next one. A group headline has
    none of its own by that rule, which is correct — it is a heading over rows that each
    have theirs, and _fetch drops it.
    """
    press = ""
    date = ""
    # Every following tag, not only the ones carrying a class. The next title anchor is
    # what bounds this row, and whether Naver happens to put a class on it is not
    # something to depend on — filtering by class once let the walk run straight past a
    # class-less boundary and collect the *next* article's byline for this one.
    for node in anchor.find_all_next():
        if node.name == "a" and node.get("data-heatmap-target") == ".tit":
            break
        classes = " ".join(node.get("class") or [])
        if not press and "sds-comps-profile-info-title-text" in classes:
            press = _text(node)
        elif not date and "sds-comps-profile-info-subtext" in classes:
            text = _text(node)
            if _RELATIVE_AGE.match(text) or _ABSOLUTE_DATE.match(text):
                date = text
        if press and date:
            break
    return press, date


def _summary(anchor) -> str:
    """The article's snippet: the `.body` anchor between this title and the next."""
    for node in anchor.find_all_next("a"):
        target = node.get("data-heatmap-target")
        if target == ".tit":
            return ""
        if target == ".body":
            span = node.select_one("span")
            return _text(span) if span else ""
    return ""


def _fetch(query: str, limit: int) -> list[dict]:
    response = requests.get(
        SEARCH_URL,
        params={"where": "news", "query": query, "sort": SORT_RELEVANCE},
        headers=HEADERS,
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    items: list[dict] = []
    seen_links: set[str] = set()
    seen_titles: set[str] = set()
    for anchor in soup.select('a[data-heatmap-target=".tit"]'):
        link = anchor.get("href", "")
        title_span = anchor.select_one("span")
        if not link or link in seen_links or title_span is None:
            continue
        title = _text(title_span)
        title_key = _title_key(title)
        if not title or title_key in seen_titles:
            continue

        press, date = _byline(anchor)
        if not press:
            # A cluster's group headline. Keeping it would put a byline-less row at the
            # top of the panel and, since it repeats one of the rows beneath it verbatim,
            # would spend the dedupe slot that row needs.
            continue

        seen_links.add(link)
        seen_titles.add(title_key)
        # The same keys news_fetcher.get_news returns, so one NewsItem type serves both
        # markets on the client. `summary` is the one addition, and it is optional there.
        items.append({"title": title, "link": link, "press": press, "date": date, "summary": _summary(anchor)})
        if len(items) >= limit:
            break
    return items


def get_news(query: str, limit: int = 15) -> list[dict]:
    """Newest Korean-language articles matching `query`, or [] if the scrape fails."""
    if not query.strip():
        return []
    key = f"naver_news_search:{query}:{limit}"
    try:
        return cache.get_or_set(key, TTL_SECONDS, lambda: _fetch(query, limit))
    except Exception:
        return []


def to_absolute_date(relative: str, now: dt.datetime | None = None) -> str:
    """"3시간 전" -> "2026.08.25". Absolute inputs pass through, unknown ones return "".

    Naver dates recent articles by age and older ones by date; a list mixing both sorts
    correctly on screen but cannot be compared or grouped. Callers that need a real date
    resolve it here rather than each parsing the Korean units again.
    """
    text = relative.strip()
    if _ABSOLUTE_DATE.match(text):
        return text.rstrip(".")
    match = re.match(r"^(\d+)(초|분|시간|일|주|개월|년)\s*전$", text)
    if not match:
        return ""
    amount, unit = int(match.group(1)), match.group(2)
    days = {"초": 0, "분": 0, "시간": 0, "일": 1, "주": 7, "개월": 30, "년": 365}[unit]
    moment = (now or dt.datetime.now()) - dt.timedelta(days=amount * days)
    return moment.strftime("%Y.%m.%d")
