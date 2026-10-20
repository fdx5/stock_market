"""Public editorial data. No login, private portfolio data or database access.

Reported equity prices are quarter-end reference prices, never purchase costs.
YouTube rankings cover discovered candidates, never claim to exhaust YouTube.
"""
import datetime as dt
import csv
import html
import io
import json
import math
import os
from pathlib import Path
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

UTC = dt.timezone.utc
KST = dt.timezone(dt.timedelta(hours=9))
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; KStockHub/1.0; +https://kospimap.com)"}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
QUERIES = {
    "kr": ("코스피 증시", "코스닥 주식", "국내 주식 시황", "삼성전자 하이닉스", "한국 증시 전망", "국내주식 투자"),
    "us": ("나스닥 미국주식", "미국증시 시황", "나스닥 빅테크", "엔비디아 테슬라 미국주식", "S&P500 미국주식", "미국주식 실적"),
}

# Associated public figure + reporting firm; these are not personal accounts.
INVESTORS = [
    {"id": "buffett", "name": "워런 버핏", "name_en": "Warren Buffett", "firm": "Berkshire Hathaway", "provider_id": "BRK", "wiki": "Warren_Buffett", "style": "가치·장기", "cik": "1067983", "color": "#487b70"},
    {"id": "ackman", "name": "빌 애크먼", "name_en": "Bill Ackman", "firm": "Pershing Square", "provider_id": "psc", "wiki": "Bill_Ackman", "style": "집중·행동주의", "cik": "1336528", "color": "#546b9c"},
    {"id": "burry", "name": "마이클 버리", "name_en": "Michael Burry", "firm": "Scion Asset Management · 최종 공개 공시", "provider": "sec_13f", "coverage_version": "sec-full-positions-v1", "style": "가치·역발상", "cik": "1649339", "color": "#9b725a", "scope_note": "운용 종료 전 마지막 SEC 공시와 이전 분기를 비교합니다. 현재 실제 보유 내역을 의미하지 않습니다. 옵션은 기초자산 명목금액으로 신고되며 실제 투자금·옵션 가격과 다릅니다.", "scope_url": "https://www.scionasset.com/"},
    {"id": "wood", "name": "캐시 우드", "name_en": "Cathie Wood", "firm": "ARK Investment Management", "provider": "sec_13f", "coverage_version": "sec-full-positions-v1", "cik": "1697748", "style": "혁신·성장", "color": "#7670aa", "scope_note": "ARK Investment Management의 분기 SEC 13F 공시 전체와 이전 분기를 비교합니다. 개인 계좌가 아니며 실제 매입단가·투자자 수익률은 공개되지 않습니다."},
    {"id": "tepper", "name": "데이비드 테퍼", "name_en": "David Tepper", "firm": "Appaloosa Management", "provider_id": "AM", "wiki": "David_Tepper", "style": "기회·매크로", "color": "#a4764e"},
    {"id": "loeb", "name": "댄 로브", "name_en": "Daniel Loeb", "firm": "Third Point", "provider_id": "TP", "wiki": "Daniel_S._Loeb", "style": "이벤트·행동주의", "color": "#8a658b"},
    {"id": "klarman", "name": "세스 클라먼", "name_en": "Seth Klarman", "firm": "Baupost Group", "provider_id": "BAUPOST", "wiki": "Seth_Klarman", "style": "가치·안전마진", "color": "#72775a"},
    {"id": "marks", "name": "하워드 막스", "name_en": "Howard Marks", "firm": "Oaktree Capital", "provider_id": "oc", "wiki": "Howard_Marks_(investor)", "style": "가치·사이클", "color": "#a06552"},
    {"id": "lilu", "name": "리 루", "name_en": "Li Lu", "firm": "Himalaya Capital", "provider_id": "HC", "wiki": "Li_Lu", "style": "가치·집중", "color": "#95734e"},
    {"id": "hohn", "name": "크리스 혼", "name_en": "Chris Hohn", "firm": "TCI Fund Management", "provider_id": "TCI", "wiki": "Chris_Hohn", "style": "집중·장기", "color": "#6f6fa0"},
]

# Reviewed identities and original license metadata, independent of wiki redirects.
PORTRAITS = json.loads(Path(__file__).with_name("editorial_portraits.json").read_text(encoding="utf-8"))
for _profile in INVESTORS:
    _profile.update(PORTRAITS.get(_profile["id"], {}))


def edition_window(now: dt.datetime | None = None) -> tuple[dt.datetime, dt.datetime]:
    """Latest 08:00 KST edition, from the preceding calendar day's midnight."""
    local = (now or dt.datetime.now(UTC)).astimezone(KST)
    cutoff = local.replace(hour=8, minute=0, second=0, microsecond=0)
    if local < cutoff:
        cutoff -= dt.timedelta(days=1)
    start = (cutoff - dt.timedelta(days=1)).replace(hour=0)
    return start, cutoff


def _text(value) -> str:
    if not isinstance(value, dict):
        return ""
    return str(value.get("simpleText") or "".join(run.get("text", "") for run in value.get("runs", [])))


def _walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def embedded_json(document: str, variable: str) -> dict:
    match = re.search(r"(?:var\s+)?" + re.escape(variable) + r"\s*=\s*", document)
    if not match:
        raise ValueError("Missing public page data")
    value = json.JSONDecoder().raw_decode(document[match.end():])[0]
    if not isinstance(value, dict):
        raise ValueError("Invalid public page data")
    return value


def _request(url: str, **kwargs):
    response = requests.get(url, headers=HEADERS, timeout=12, **kwargs)
    response.raise_for_status()
    return response


def relevant_video(title: str, market: str) -> bool:
    if len(re.findall(r"[가-힣]", title)) < 2:
        return False
    if re.search(r"텔레그램|수익보장|원금보장|불법리딩", title):
        return False
    if market == "us":
        return bool(re.search(r"나스닥|미국\s*(?:주식|증시)|미증시|월가|빅테크|엔비디아|테슬라|S.?P\s*500|NASDAQ|FOMC", title, re.I))
    return bool(re.search(r"코스피|코스닥|국내\s*(?:주식|증시)|한국\s*(?:주식|증시)|삼성전자|하이닉스|국장|KOSPI|KOSDAQ", title, re.I))


def _topic(title: str) -> str:
    if re.search(r"반도체|삼성전자|하이닉스|엔비디아|HBM", title, re.I): return "반도체"
    if re.search(r"실적|기업|주가|테슬라|애플|매출", title): return "기업분석"
    if re.search(r"전략|투자법|포트폴리오|매수|매도", title): return "투자전략"
    return "시장읽기"


def _iso(value: str) -> dt.datetime | None:
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None  # A date alone cannot prove the 08:00 cutoff.
    except (ValueError, TypeError, AttributeError):
        return None


def rank_videos(rows: list[dict], market: str, start: dt.datetime, cutoff: dt.datetime) -> list[dict]:
    by_id = {}
    for row in rows:
        published = _iso(row.get("published_at", ""))
        if not VIDEO_ID.fullmatch(row.get("id", "")) or not published or not start <= published < cutoff:
            continue
        if not relevant_video(row.get("title", ""), market) or not isinstance(row.get("views"), int) or row["views"] < 0:
            continue
        old = by_id.get(row["id"])
        if old is None or row["views"] > old["views"]:
            by_id[row["id"]] = {**row, "topic": _topic(row["title"])}
    return [dict(row, rank=i + 1) for i, row in enumerate(sorted(by_id.values(), key=lambda r: (-r["views"], r["id"]))[:20])]


def _public_candidates(query: str) -> list[str]:
    result = []
    # A weekly popularity page alone misses new videos. Follow the visible Today
    # and This week filters, retaining fresh results before the popularity sort.
    for time_filter in ("EgIIAg==", "EgIIAw=="):
        params = {"search_query": query, "hl": "en", "gl": "KR", "sp": time_filter}
        try:
            data = embedded_json(_request("https://www.youtube.com/results", params=params).text, "ytInitialData")
            pages = [data]
            for node in _walk(data):
                filter_ = node.get("searchFilterRenderer", {})
                if _text(filter_.get("label", {})) in ("Popularity", "View count"):
                    selected = filter_.get("navigationEndpoint", {}).get("searchEndpoint", {}).get("params")
                    if selected:
                        pages.append(embedded_json(_request("https://www.youtube.com/results", params={**params, "sp": selected}).text, "ytInitialData"))
                    break
            for page in pages:
                for node in _walk(page):
                    row = node.get("videoRenderer")
                    if row and VIDEO_ID.fullmatch(row.get("videoId", "")) and relevant_video(_text(row.get("title", {})), "us" if query in QUERIES["us"] else "kr"):
                        result.append(row["videoId"])
        except (requests.RequestException, ValueError, TypeError):
            continue
    return list(dict.fromkeys(result))[:80]


def parse_watch_page(document: str, video_id: str) -> dict | None:
    player = embedded_json(document, "ytInitialPlayerResponse")
    detail = player.get("videoDetails", {})
    micro = player.get("microformat", {}).get("playerMicroformatRenderer", {})
    if detail.get("videoId") != video_id or micro.get("liveBroadcastDetails", {}).get("isLiveNow"):
        return None
    views = detail.get("viewCount")
    published = micro.get("publishDate") or micro.get("uploadDate")
    if not str(views).isdigit() or not _iso(published):
        return None
    return {"id": video_id, "title": detail.get("title", ""), "channel": detail.get("author", ""),
            "views": int(views), "published_at": published, "duration_seconds": int(detail.get("lengthSeconds") or 0),
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg", "url": f"https://www.youtube.com/watch?v={video_id}"}


def _watch(video_id: str) -> dict | None:
    try:
        return parse_watch_page(_request("https://www.youtube.com/watch", params={"v": video_id, "hl": "en"}).text, video_id)
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return None


def _api_videos(market: str, start: dt.datetime, cutoff: dt.datetime, key: str) -> list[dict]:
    ids = set()
    common = {"part": "snippet", "type": "video", "order": "viewCount", "regionCode": "KR", "relevanceLanguage": "ko",
              "publishedAfter": start.astimezone(UTC).isoformat(), "publishedBefore": cutoff.astimezone(UTC).isoformat(), "maxResults": 50, "key": key}
    for query in QUERIES[market]:
        data = _request("https://www.googleapis.com/youtube/v3/search", params={**common, "q": query}).json()
        ids.update(item.get("id", {}).get("videoId") for item in data.get("items", []) if item.get("id", {}).get("videoId"))
    ids = sorted(ids)
    rows = []
    for offset in range(0, len(ids), 50):
        data = _request("https://www.googleapis.com/youtube/v3/videos", params={"id": ",".join(ids[offset:offset+50]), "part": "snippet,statistics,contentDetails", "key": key}).json()
        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            if snippet.get("liveBroadcastContent") == "live": continue
            count = item.get("statistics", {}).get("viewCount")
            if not str(count).isdigit(): continue
            thumbs = snippet.get("thumbnails", {})
            rows.append({"id": item["id"], "title": html.unescape(snippet.get("title", "")), "channel": snippet.get("channelTitle", ""),
                         "published_at": snippet.get("publishedAt"), "views": int(count), "duration_seconds": None,
                         "thumbnail": (thumbs.get("high") or thumbs.get("medium") or {}).get("url"), "url": f'https://www.youtube.com/watch?v={item["id"]}'})
    return rows


def fetch_videos(market: str, now: dt.datetime | None = None) -> dict:
    start, cutoff = edition_window(now)
    source = "youtube_public"
    rows = []
    candidates = set()
    key = os.environ.get("YOUTUBE_DATA_API_KEY")
    if key:
        try:
            rows = _api_videos(market, start, cutoff, key)
            source = "youtube_data_api"
        except (requests.RequestException, ValueError, TypeError):
            pass  # Never log an exception URL: it could contain the server API key.
    if not rows:
        with ThreadPoolExecutor(max_workers=2) as pool:
            for future in as_completed([pool.submit(_public_candidates, query) for query in QUERIES[market]]):
                try: candidates.update(future.result())
                except (requests.RequestException, ValueError, TypeError): pass
        with ThreadPoolExecutor(max_workers=3) as pool:
            rows = [row for row in pool.map(_watch, sorted(candidates)[:240]) if row]
    items = rank_videos(rows, market, start, cutoff)
    if not items:
        error = RuntimeError("No verified videos in the edition window")
        error.diagnostics = {"candidate_count": len(candidates), "verified_count": len(rows)}
        raise error
    return {"market": market, "edition": cutoff.date().isoformat(), "window_start": start.isoformat(), "window_end": cutoff.isoformat(),
            "collected_at": dt.datetime.now(UTC).isoformat(), "source": source, "candidate_count": len(rows),
            "ranking_basis": "views_among_discovered_candidates", "items": items}


def number(value: str) -> float | None:
    try:
        parsed = float(re.sub(r"[$,%\s]", "", value))
        return parsed if math.isfinite(parsed) else None
    except (ValueError, TypeError):
        return None


def parse_portfolio(document: str, investor: dict) -> dict:
    soup = BeautifulSoup(document, "html.parser")
    summary = soup.select_one("#p2")
    spans = [span.get_text(" ", strip=True) for span in summary.select("span")] if summary else []
    if len(spans) < 4 or not re.fullmatch(r"Q[1-4] 20\d{2}", spans[0]):
        raise ValueError("Missing portfolio period")
    rows = []
    for row in soup.select("#grid tbody tr"):
        cells = row.find_all("td", recursive=False)
        anchor = row.select_one("td.stock a[href]")
        if not anchor or len(cells) < 9: continue
        code = (parse_qs(urlparse(anchor["href"]).query).get("sym") or [""])[0]
        if not re.fullmatch(r"[A-Z0-9.\-]{1,15}", code): continue
        label = anchor.get_text(" ", strip=True)
        weight, shares, reference, value, current = [number(cells[i].get_text(" ", strip=True)) for i in (2, 4, 5, 6, 8)]
        if weight is None or not 0 <= weight <= 100 or shares is None or shares <= 0 or not reference or reference <= 0 or not value:
            continue
        activity = cells[3].get_text(" ", strip=True)
        change = "new" if activity.startswith("Buy") else "add" if activity.startswith("Add") else "reduce" if activity.startswith("Reduce") else "hold"
        rows.append({"code": code, "name": label.removeprefix(code).lstrip(" -"), "weight_pct": weight, "shares": int(shares),
                     "reference_price": reference, "purchase_price": None, "reported_value": value, "snapshot_price": current if current and current > 0 else None,
                     "activity": change, "shares_change_pct": number(activity.split(" ")[-1]) if change in ("add", "reduce") else None})
    if not rows:
        raise ValueError("No valid equity holdings")
    rows.sort(key=lambda row: (-row["weight_pct"], row["code"]))
    try: report_date = dt.datetime.strptime(spans[1], "%d %b %Y").date().isoformat()
    except ValueError: raise ValueError("Invalid portfolio date") from None
    return {"id": investor["id"], "period": spans[0], "report_date": report_date, "reported_value": number(spans[3]),
            "reported_count": int(number(spans[2]) or len(rows)), "holdings": rows,
            "source_url": f'https://www.dataroma.com/m/holdings.php?m={investor["provider_id"]}', "collected_at": dt.datetime.now(UTC).isoformat()}


def fetch_portrait(investor: dict) -> dict:
    return dict(PORTRAITS.get(investor["id"], {}))


ARKK_HOLDINGS_URL = "https://assets.ark-funds.com/fund-documents/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv"


def parse_ark_holdings(document: str, investor: dict) -> dict:
    rows, dates = [], set()
    total_value = 0
    for raw in csv.DictReader(io.StringIO(document.lstrip("\ufeff"))):
        if raw.get("fund") != "ARKK":
            continue
        try:
            report_date = dt.datetime.strptime(raw.get("date", ""), "%m/%d/%Y").date().isoformat()
        except ValueError:
            continue
        value, shares, weight = [number(raw.get(key, "")) for key in ("market value ($)", "shares", "weight (%)")]
        if value is None or shares is None or shares <= 0 or value <= 0 or weight is None or not 0 <= weight <= 100:
            continue
        dates.add(report_date)
        total_value += value
        code = raw.get("ticker", "").strip()
        if not re.fullmatch(r"[A-Z0-9.\-]{1,15}", code):
            continue  # Private/no-ticker assets stay in the denominator, never get fake stock quotes.
        rows.append({"code": code, "name": raw.get("company", code), "weight_pct": weight, "shares": int(shares),
                     "reference_price": value / shares, "purchase_price": None, "reported_value": value,
                     "snapshot_price": value / shares, "activity": "unavailable", "shares_change_pct": None})
    if len(dates) != 1 or not rows:
        raise ValueError("Missing or mixed ARKK holdings dates")
    rows.sort(key=lambda row: (-row["weight_pct"], row["code"]))
    return {"id": investor["id"], "period": "ARKK 일일 공개", "report_date": dates.pop(), "data_basis": "daily_fund",
            "reported_value": total_value, "reported_count": len(rows), "holdings": rows,
            "source_url": ARKK_HOLDINGS_URL, "collected_at": dt.datetime.now(UTC).isoformat()}


def fetch_portfolio(investor: dict) -> dict:
    if investor.get("provider") == "sec_13f":
        from app.data import sec_portfolios
        return {**sec_portfolios.fetch_portfolio(investor), **fetch_portrait(investor)}
    if investor.get("provider") == "ark_fund":
        return {**parse_ark_holdings(_request(ARKK_HOLDINGS_URL).text, investor), **fetch_portrait(investor)}
    url = f'https://www.dataroma.com/m/holdings.php?m={investor["provider_id"]}'
    result = parse_portfolio(_request(url).text, investor)
    return {**result, **fetch_portrait(investor)}
