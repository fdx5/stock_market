"""Public, read-only market workspace. Neither prices nor articles require a database."""
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
import re
from urllib.parse import parse_qs, unquote, urlsplit
from xml.etree import ElementTree as ET

import requests
from fastapi import APIRouter, HTTPException

from app.data.global_index_fetcher import get_index
from app.data.world_market_caps import latest_caps
from app.data.world_markets import BASE_DATES, DEFAULT_BASE_DATE, MARKETS, SOURCE, WFE_SOURCE
from app.services.cache import cache
from app.data.translate_fetcher import translate_via_chrome
from app.data.world_news_feeds import enrich, publisher_stories

router = APIRouter()
QUERIES = {row[0]: row[4] for row in MARKETS}


@router.get("")
def catalog():
    try:
        caps = latest_caps()
    except Exception:
        caps = {}
    return build_catalog(caps)


def build_catalog(caps):
    markets = [
        {"code": code, "name": name, "cap": caps.get(code, {}).get("cap", cap),
         "cap_as_of": caps.get(code, {}).get("as_of"), "cap_estimated": caps.get(code, {}).get("estimated", False),
         "base_cap": cap, "base_date": caps.get(code, {}).get("base_date", BASE_DATES.get(code, DEFAULT_BASE_DATE)),
         "indices": indices, "ticker": ticker, "company": company, "context": context}
        for code, name, cap, indices, _, ticker, company, context in MARKETS
    ]
    markets.sort(key=lambda m: m["cap"], reverse=True)
    as_of = max((m["cap_as_of"] for m in markets if m["cap_as_of"]), default=None)
    return {"source": SOURCE, "sources": [SOURCE, WFE_SOURCE], "period": as_of or "2026-04", "as_of": as_of, "markets": markets}


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
    "RTTNews", "MarketScreener", "Yahoo Finance", "Morningstar", "Morningstar, Inc.", "news.com.au", "Herald Sun",
    "Market Index", "Bluewin", "FinanzNachrichten.de", "이투데이", "헤럴드경제", "아주경제",
    "Arab News", "Saudi Gazette", "Argaam", "The Sydney Morning Herald", "The Australian Financial Review",
    "ABC News", "The Australian", "Handelsblatt", "Deutsche Welle", "DW", "swissinfo.ch", "SWI swissinfo.ch",
    "Investir - Les Échos Bourse", "Capital France", "Les Échos", "Le Figaro", "Taipei Times", "France 24", "Les Echos", "Investing.com", "Investing.com 한국어",
)}
MARKET_EVENT = re.compile(
    r"증시|지수|주식시장|코스피|코스닥|나스닥|다우|닛케이|항셍|가권|니프티|센섹스|뉴욕장|상하이종합|닥스|타다울|"
    r"stocks|shares|equities|index|indexes|indices|nasdaq|dow jones|s&p|tsx|ftse|cac ?40|sensex|nifty|hang seng|nikkei|taiex|kospi|dax|smi|tasi|tadawul|asx|bourse",
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
        title = unescape(item.findtext("title", "")).strip()
        if not title or urlsplit(link).scheme not in ("http", "https"):
            continue
        source = item.findtext("{*}Source") or item.findtext("source") or ""
        source = re.sub(r" on MSN(?:\.com)?$", "", unquote(source), flags=re.I).strip()
        if source.casefold() not in PUBLISHERS:
            continue
        if bing:
            link = parse_qs(urlsplit(link).query).get("url", [link])[0]
            if urlsplit(link).scheme not in ("http", "https"):
                continue
        title = re.sub(r"\s+By \w+$", "", title.removesuffix(" - " + source))
        excerpt = unescape(re.sub("<[^>]+>", "", item.findtext("description", ""))).strip() if bing else ""
        rows.append(dict(title=title, url=link, source=source, summary=excerpt[:300], published=published.astimezone(timezone.utc).isoformat(), translated=False))
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
    "DE": (r"독일.{0,5}(증시|주식|지수)|프랑크푸르트.{0,5}(증시|증권)|DAX|닥스|German stocks|Frankfurt", "DAX German stocks"),
    "CH": (r"스위스.{0,5}(증시|주식|지수)|SMI|Swiss stocks|Swiss shares|Swiss market", "Swiss SMI stocks"),
    "SA": (r"사우디.{0,5}(증시|주식|지수)|타다울|TASI|Tadawul|Saudi stocks|Saudi shares|Saudi index|Saudi bourse", "Saudi stocks Tadawul TASI"),
    "AU": (r"호주.{0,5}(증시|주식|지수)|ASX|Australian shares|Australian stocks|Australia stocks", "ASX 200 Australian shares"),
}


# Home-language Google News for markets whose own press rarely reaches Korean or
# US-English searches. Only established outlets of that market are kept.
LOCAL_SEARCH = {
    "DE": [("DAX Börse when:2d", "de", "DE")],
    "CH": [("SMI Börse when:2d", "de", "CH")],
    "AU": [("ASX 200 when:2d", "en-AU", "AU")],
    "SA": [("تاسي when:2d", "ar", "SA"), ("Saudi TASI when:3d", "en", "US")],
    "GB": [("FTSE 100 when:2d", "en-GB", "GB")],
    "FR": [("CAC 40 Bourse when:2d", "fr", "FR")],
}
# Arabic outlets appear under their Arabic names (Argaam with its whole tagline).
SOURCE_NAMES = {"ارقام": "Argaam", "الاقتصادية": "Al Eqtisadiah", "صحيفة مال": "Maaal", "اندبندنت عربية": "Independent Arabia",
                "عاجل": "Ajel", "الشرق الأوسط": "Asharq Al-Awsat", "ASHARQ AL-AWSAT English": "Asharq Al-Awsat", "العربية": "Al Arabiya"}
# Derivative quote pages and other listings that share index names with news.
LISTING = re.compile(r"\bTurbo\b|Optionsschein|Zertifikat|Knock-?out|\| (Kurs|Chart|Preis)|Stock Price Today|Cours (de )?Bourse|: Cours|Cours Action|Cotation Bourse", re.I)
LOCAL_PUBLISHERS = {name.casefold() for name in (
    "tagesschau.de", "Manager Magazin", "WELT", "Finanzen.net", "DIE ZEIT", "Onvista", "boerse.de", "Der Aktionär",
    "n-tv.de", "Handelsblatt", "FAZ", "Frankfurter Allgemeine", "FAZ - Frankfurter Allgemeine Zeitung",
    "Süddeutsche Zeitung", "DER SPIEGEL", "Börse Online", "Börse Frankfurt", "WirtschaftsWoche", "Capital", "dpa-AFX",
    "finanzen.ch", "Cash", "NZZ", "Neue Zürcher Zeitung", "SRF", "Handelszeitung", "Tages-Anzeiger", "Blick",
    "nau.ch", "Finanz und Wirtschaft", "finews.ch", "AWP", "Luzerner Zeitung", "watson",
    "The Motley Fool Australia", "Market Index", "The Sydney Morning Herald", "The Australian Financial Review",
    "AFR", "ABC News", "The Australian", "news.com.au", "Herald Sun", "Livewire Markets", "The Guardian",
    "Arab News", "Argaam", "Saudi Gazette", "Asharq Al-Awsat", "Zawya", "Reuters", "Bloomberg",
    "Al Eqtisadiah", "Maaal", "Independent Arabia", "Ajel", "Al Arabiya",
    "Yahoo Finance UK", "marketscreener.com", "Investors' Chronicle", "City AM", "Interactive Investor", "The Times",
    "London Evening Standard", "Investing.com UK", "BBC", "Financial Times", "The Telegraph", "This is Money", "Sky News",
    "Boursorama", "Investir Les Echos", "BFM Bourse", "Zonebourse", "Boursier.com", "ABC Bourse", "Capital.fr",
    "Le Revenu", "Les Echos", "Le Figaro Bourse", "Le Figaro", "Le Monde", "La Tribune", "Yahoo Finance France", "France 24",
)}


# The translator renders "Anthropic" literally ("인류") but leaves "Anthropic Inc."
# alone; the marked name is put back in Korean afterwards.
GLOSSARY_KO = {"anthropic": "앤트로픽", "nvidia": "엔비디아", "openai": "오픈AI"}
GLOSSARY = re.compile(r"\b(" + "|".join(GLOSSARY_KO) + r")\b(?:,? Inc\.?)?", re.I)
MARKED = re.compile(r"\b(" + "|".join(GLOSSARY_KO) + r")(?:,? Inc\.?)?", re.I)


def _particles(text):
    """Re-pick the Korean particle after a substituted name (앤트로픽와 -> 앤트로픽과)."""
    def fix(m):
        word, particle = m.group(1), m.group(2)
        batchim = (ord(word[-1]) - 0xAC00) % 28 != 0
        pairs = {"와": "과", "가": "이", "는": "은", "를": "을", "로": "으로"}
        if batchim:
            return word + pairs.get(particle, particle)
        back = {v: k for k, v in pairs.items()}
        return word + back.get(particle, particle)
    names = "|".join(GLOSSARY_KO.values())
    text = re.sub(rf"({names})\s?\((주|Inc\.?)\)", r"\1", text)
    return re.sub(rf"({names})(으로|와|과|가|이|는|은|를|을|로)(?![가-힣])", fix, text)


def _local_articles(country):
    rows = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=3)
    for query, hl, gl in LOCAL_SEARCH[country]:
        response = requests.get("https://news.google.com/rss/search", timeout=(2, 5),
                                params={"q": query, "hl": hl, "gl": gl, "ceid": f"{gl}:{hl.split('-')[0]}"})
        response.raise_for_status()
        for item in ET.fromstring(response.content).findall("./channel/item"):
            try:
                published = parsedate_to_datetime(item.findtext("pubDate", ""))
            except (TypeError, ValueError):
                continue
            raw = (item.findtext("source") or "").strip()
            source = next((name for prefix, name in SOURCE_NAMES.items() if raw.startswith(prefix)), raw)
            link = item.findtext("link", "").strip()
            title = unescape(item.findtext("title", "")).strip().removesuffix(" - " + raw)
            if (published < cutoff or source.casefold() not in LOCAL_PUBLISHERS or urlsplit(link).scheme != "https"
                    or LISTING.search(title)):
                continue
            rows.append(dict(title=title, url=link, source=source, summary="",
                             published=published.astimezone(timezone.utc).isoformat(), translated=False))
    return rows


def _news(country):
    stories = {}
    received = False
    pattern, fallback = NEWS_TERMS[country]
    # Publisher feeds carry the article body and picture themselves; search
    # results only fill the remaining slots.
    for row in publisher_stories(country, pattern, MARKET_EVENT):
        stories.setdefault(row["title"], row)
        received = True
    if country in LOCAL_SEARCH:
        try:
            for row in _local_articles(country):
                stories.setdefault(row["title"], row)
            received = True
        except (requests.RequestException, ET.ParseError):
            pass
    for query, bing in ((QUERIES[country], True), (fallback, True), (QUERIES[country], False)):
        if len(stories) >= 12:
            break
        try:
            rows = _articles(query, bing)
            received = True
            for row in rows:
                if re.search(pattern, row["title"], re.I) and MARKET_EVENT.search(row["title"]):
                    stories.setdefault(row["title"], row)
        except (requests.RequestException, ET.ParseError):
            continue
    if not received:
        raise HTTPException(503, "News feed unavailable")
    selected = []
    fresh = (datetime.now(timezone.utc) - timedelta(hours=36)).isoformat()
    rank = lambda row: (row["published"] >= fresh, bool(row.get("paragraphs")) + bool(row.get("image")), row["published"])
    for row in sorted(stories.values(), key=rank, reverse=True):
        # The same wire story often reappears with a lightly edited headline.
        bare = lambda title: re.sub(r"^\[[^\]]*\]\s*", "", title)
        if sum(kept["source"] == row["source"] for kept in selected) >= 2:
            continue
        if not any(SequenceMatcher(None, bare(row["title"]), bare(kept["title"])).ratio() > 0.8 for kept in selected):
            selected.append(row)
    selected = selected[:6]
    with ThreadPoolExecutor(max_workers=5) as pool:
        selected = list(pool.map(enrich, selected)) if selected else []
    hangul = re.compile(r"[가-힣]")
    fields = []
    for row in selected:
        row.setdefault("paragraphs", [])
        row.setdefault("image", None)
        fields += [(row, key, None) for key in ("title", "summary") if row[key] and not hangul.search(row[key])]
        fields += [(row, "paragraphs", i) for i, line in enumerate(row["paragraphs"]) if not hangul.search(line)]
    texts = [GLOSSARY.sub(lambda m: m.group(1) + " Inc.", row[key] if i is None else row[key][i]) for row, key, i in fields]
    translations = translate_via_chrome(texts, "auto", "ko")
    if fields and not translations and all(not hangul.search(row["title"]) for row in selected):
        raise HTTPException(503, "Korean translation unavailable")
    for (row, key, i), translated in zip(fields, translations or [""] * len(fields)):
        value = _particles(MARKED.sub(lambda m: GLOSSARY_KO[m.group(1).casefold()], translated)) if hangul.search(translated or "") else ""
        if i is None:
            row[key] = value
        else:
            row[key][i] = value
        row["translated"] = True
    for row in selected:
        row["paragraphs"] = [line for line in row["paragraphs"] if line]
    # Today's and yesterday's stories first; within them, a picture and readable body lead.
    selected = [row for row in selected if row["title"]]
    selected.sort(key=rank, reverse=True)
    return selected[:5]


@router.get("/news/{country}")
def news(country: str):
    if country not in QUERIES:
        raise HTTPException(404)
    return cache.get_or_set("world_markets:news:" + country, 900, lambda: _news(country))
