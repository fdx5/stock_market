"""Public, read-only market workspace. Neither prices nor articles require a database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
import re
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET

import requests
from fastapi import APIRouter, HTTPException

from app.data.global_index_fetcher import get_index
from app.data.world_markets import MARKETS, SOURCE
from app.services.cache import cache
from app.data.translate_fetcher import translate_via_chrome

router = APIRouter()
QUERIES = {row[0]: row[4] for row in MARKETS}


@router.get("")
def catalog():
    return {"source": SOURCE, "period": "2026-04", "markets": [
        {"code": code, "name": name, "cap": cap, "indices": indices,
         "ticker": ticker, "company": company, "context": context}
        for code, name, cap, indices, _, ticker, company, context in MARKETS
    ]}


def _quotes():
    codes = [code for row in MARKETS for code, _ in row[3]]
    with ThreadPoolExecutor(max_workers=6) as pool:
        return dict(zip(codes, pool.map(get_index, codes)))


@router.get("/quotes")
def quotes():
    return cache.get_or_set("world_markets:quotes", 60, _quotes)


# Exact publisher attributions from the RSS providers, including their named
# syndication partners. Never promote an unknown source to fill an empty slot.
PUBLISHERS = {name.casefold() for name in (
    "연합뉴스", "연합뉴스TV", "연합인포맥스", "한국경제", "한국경제TV", "매일경제", "서울경제",
    "아시아경제", "이데일리", "머니투데이", "파이낸셜뉴스", "뉴스핌", "뉴스1", "뉴시스",
    "조선비즈", "한경닷컴", "KBS", "SBS", "MBC", "YTN", "한겨레", "중앙일보", "한국일보",
    "로이터", "Reuters", "Bloomberg", "Bloomberg.com", "Associated Press", "AP News",
    "CNBC", "Financial Times", "The Wall Street Journal", "MarketWatch", "Barron's",
    "Nikkei Asia", "The Japan Times", "The Globe and Mail", "BNN Bloomberg", "CBC News",
    "The Economic Times", "Business Standard", "South China Morning Post", "Focus Taiwan",
    "Investir - Les Échos Bourse", "Capital France", "Les Échos", "Le Figaro", "Taipei Times", "France 24", "Les Echos", "Investing.com", "Investing.com 한국어",
)}
MARKET_EVENT = re.compile(
    r"증시|지수|주식시장|코스피|코스닥|나스닥|다우|닛케이|항셍|가권|니프티|센섹스|뉴욕장|상하이종합|"
    r"stocks|shares|equities|index|indexes|indices|nasdaq|dow jones|s&p|tsx|ftse|cac ?40|sensex|nifty|hang seng|nikkei|taiex|kospi",
    re.I,
)


def _articles(query, bing):
    url = "https://www.bing.com/news/search" if bing else "https://news.google.com/rss/search"
    params = {"q": query, "format": "rss", "mkt": "en-US" if query.isascii() else "ko-KR"} if bing else {
        "q": query + " when:7d", "hl": "ko", "gl": "KR", "ceid": "KR:ko"}
    response = requests.get(url, params=params, timeout=(2, 5))
    response.raise_for_status()
    rows = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    for item in ET.fromstring(response.content).findall("./channel/item"):
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
            if published < cutoff:
                continue
        except (ValueError, TypeError):
            continue
        link = item.findtext("link", "").strip()
        title = item.findtext("title", "").strip()
        if not title or urlsplit(link).scheme not in ("http", "https"):
            continue
        source = item.findtext("{*}Source") or item.findtext("source") or ""
        source = re.sub(r" on MSN(?:\.com)?$", "", source, flags=re.I).strip()
        if source.casefold() not in PUBLISHERS:
            continue
        if bing:
            link = parse_qs(urlsplit(link).query).get("url", [link])[0]
            if urlsplit(link).scheme not in ("http", "https"):
                continue
        title = title.removesuffix(" - " + source)
        excerpt = unescape(re.sub("<[^>]+>", "", item.findtext("description", ""))).strip() if bing else ""
        rows.append(dict(title=title, url=link, source=source, summary=excerpt[:300], published=published.isoformat(), translated=False))
    return sorted(rows, key=lambda row: row["published"], reverse=True)


# Localised searches sometimes return unrelated US market wraps. Require a
# country or benchmark in the headline before assigning a story to a market.
NEWS_TERMS = {
    "US": ("뉴욕|미국|다우|나스닥|월가|S&P|Dow Jones|Nasdaq|Wall Street", "Dow Jones Nasdaq stocks"),
    "CN": ("중국|中|상하이|상해|본토|위안|Shanghai|China", "Shanghai Composite China stocks"),
    "JP": ("일본|닛케이|도쿄|엔화|日|Nikkei|Japan", "Japan Nikkei stocks"),
    "HK": ("홍콩|항셍|항생|Hang Seng|Hong Kong", "Hong Kong Hang Seng stocks"),
    "IN": ("인도|니프티|센섹스|Nifty|Sensex|India", "India Nifty Sensex stocks"),
    "CA": ("캐나다|토론토|TSX|Canada|Canadian|Toronto", "Canadian TSX stocks Reuters"),
    "TW": ("대만|가권|타이완|TSMC|Taiwan|Taiex", "대만 증시 반도체"),
    "KR": ("국내|한국|코스피|코스닥|KOSPI|KOSDAQ", "South Korea Kospi stocks"),
    "GB": (r"영국.{0,5}(증시|주식|지수)|런던.{0,5}(증시|증권)|FTSE|London stocks", "FTSE 100 stocks"),
    "FR": (r"프랑스.{0,5}(증시|주식|지수)|파리.{0,5}(증시|증권)|CAC\s?40|Paris stocks", "Bourse Paris CAC 40"),
}


def _news(country):
    stories = {}
    received = False
    pattern, fallback = NEWS_TERMS[country]
    for query, bing in ((QUERIES[country], True), (fallback, True), (QUERIES[country], False)):
        try:
            rows = _articles(query, bing)
            received = True
            for row in rows:
                if re.search(pattern, row["title"], re.I) and MARKET_EVENT.search(row["title"]):
                    stories.setdefault(row["title"], row)
        except (requests.RequestException, ET.ParseError):
            continue
        if len(stories) >= 3:
            break
    if not received:
        raise HTTPException(503, "News feed unavailable")
    selected = sorted(stories.values(), key=lambda item: (bool(item["summary"]), item["published"]), reverse=True)[:5]
    hangul = re.compile(r"[가-힣]")
    fields = [(row, key) for row in selected for key in ("title", "summary")
              if row[key] and not hangul.search(row[key])]
    translations = translate_via_chrome([row[key] for row, key in fields], "auto", "ko")
    if fields and not translations and all(not hangul.search(row["title"]) for row in selected):
        raise HTTPException(503, "Korean translation unavailable")
    for (row, key), translated in zip(fields, translations or [""] * len(fields)):
        row[key] = translated if hangul.search(translated) else ""
        row["translated"] = True
    return [row for row in selected if row["title"]][:3]


@router.get("/news/{country}")
def news(country: str):
    if country not in QUERIES:
        raise HTTPException(404)
    return cache.get_or_set("world_markets:news:" + country, 900, lambda: _news(country))
