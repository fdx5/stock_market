import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qs, urlparse

import FinanceDataReader as fdr
import pandas as pd
import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

# Prices/marcap/change refresh on a short cycle so the map tracks the live session;
# the industry classification never changes intraday, so it's cached separately and
# far less often. TTLCache naturally coalesces concurrent pollers within the window
# into a single upstream fetch, so a 5s TTL doesn't mean 5s of extra load per visitor.
TTL_PRICE_SECONDS = 5
TTL_INDUSTRY_SECONDS = 24 * 3600

# FinanceDataReader's StockListing('KOSPI') snapshot reflects the prior completed
# session (full-day close/volume), not the live intraday tape — comparing it against
# a live quote mid-session showed a ~6.9% vs ~0.3% mismatch. Naver's market-cap-sum
# listing is scraped instead: it's a live-refreshed page, and paginating it (50 rows
# each) covers the top 500 by market cap since that's its default sort.
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}
NAVER_PAGE_SIZE = 50
CHANGE_WORD_SIGN = {"상승": 1, "하락": -1, "보합": 0}

# KRX-DESC gives a fine-grained KSIC industry string (~100+ distinct values across the
# top names), too granular for a Finviz-style zoned map. Bucket into broad sectors via
# keyword match, ordered so more specific terms are checked first.
_SECTOR_KEYWORDS: list[tuple[str, list[str]]] = [
    ("배터리", ["전지"]),
    ("반도체/전자", [
        "전자", "반도체", "통신 및 방송 장비", "컴퓨터", "정밀기기", "전동기",
        "전기 변환", "절연선", "케이블", "가정용 기기", "영상 및 음향",
    ]),
    ("제약/바이오", ["의약", "의료", "바이오", "연구개발"]),
    ("자동차/조선", [
        "자동차", "선박", "보트", "운송장비", "항공기", "우주선", "무기", "총포탄", "조선",
    ]),
    ("금융", ["금융", "보험", "은행", "신탁", "저축기관", "연금"]),
    ("화학/소재", ["화학", "플라스틱", "고무", "유리", "시멘트", "요업", "비료", "농약"]),
    ("철강/금속", ["철강", "금속", "제철"]),
    ("기계/산업재", ["기계", "장비 임대"]),
    ("건설/부동산", ["건설", "부동산", "건축", "공사업", "축조"]),
    ("에너지/유틸리티", ["석유", "가스", "전기업", "증기", "발전"]),
    ("운송/물류", ["운송업", "여객", "화물", "여행사"]),
    ("IT서비스/미디어", [
        "소프트웨어", "프로그래밍", "정보매개", "포털", "호스팅", "통신업", "방송",
        "광고", "오락", "정보 서비스", "출판", "영화",
    ]),
    ("식품/음료", ["식품", "음료", "낙농", "수산물", "곡물", "사료", "담배"]),
    ("유통/소비재", ["소매업", "도매업", "의복", "가방", "가구", "가죽", "종이", "골판지", "방적"]),
    ("지주/서비스", ["회사 본부", "경영 컨설팅", "경비", "경호"]),
]


def _classify_sector(industry) -> str:
    if not industry or (isinstance(industry, float) and pd.isna(industry)):
        return "기타"
    for sector, keywords in _SECTOR_KEYWORDS:
        if any(kw in industry for kw in keywords):
            return sector
    return "기타"


def _parse_change(text: str) -> float:
    match = re.match(r"(상승|하락|보합)([\d,]+)", text)
    if not match:
        return 0.0
    sign = CHANGE_WORD_SIGN[match.group(1)]
    return sign * float(match.group(2).replace(",", ""))


def _parse_number(text: str) -> float:
    cleaned = text.replace(",", "").replace("%", "").strip()
    return float(cleaned) if cleaned else 0.0


def _fetch_naver_page(page: int) -> list[dict]:
    url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page={page}"
    resp = requests.get(url, headers=NAVER_HEADERS, timeout=8)
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    table = soup.select_one("table.type_2")
    if table is None:
        return []

    rows = []
    for tr in table.select("tr"):
        link = tr.select_one("a.tltle")
        if not link:
            continue
        code = parse_qs(urlparse(link.get("href", "")).query).get("code", [None])[0]
        if not code:
            continue

        cells = [td.get_text(strip=True) for td in tr.select("td")]
        if len(cells) < 7:
            continue

        try:
            rows.append(
                {
                    "code": code,
                    "name": link.get_text(strip=True),
                    "close": _parse_number(cells[2]),
                    "change": _parse_change(cells[3]),
                    "change_pct": _parse_number(cells[4]),
                    "marcap": _parse_number(cells[6]) * 100_000_000,  # 억원 -> 원
                }
            )
        except (ValueError, IndexError):
            continue
    return rows


def _load_price_snapshot(pages: int) -> list[dict]:
    results: dict[int, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_naver_page, page): page for page in range(1, pages + 1)}
        for future in as_completed(futures):
            page = futures[future]
            try:
                results[page] = future.result()
            except Exception:  # noqa: BLE001 - one bad page shouldn't sink the whole map
                results[page] = []

    ordered: list[dict] = []
    for page in range(1, pages + 1):
        ordered.extend(results.get(page, []))
    return ordered


def _get_price_snapshot(pages: int) -> list[dict]:
    key = f"kospi_price_snapshot:{pages}"
    return cache.get_or_set(key, TTL_PRICE_SECONDS, lambda: _load_price_snapshot(pages))


def _load_industry_map() -> dict[str, str]:
    desc = fdr.StockListing("KRX-DESC")[["Code", "Industry"]]
    return dict(zip(desc["Code"].astype(str), desc["Industry"]))


def _get_industry_map() -> dict[str, str]:
    return cache.get_or_set("krx_industry_map", TTL_INDUSTRY_SECONDS, _load_industry_map)


def _load_etf_codes() -> set[str]:
    # The Naver market-cap listing mixes ETFs/ETNs into the KOSPI ranking; a Finviz-style
    # company map should only show operating companies, so cross-reference and exclude them.
    etf = fdr.StockListing("ETF/KR")
    return set(etf["Symbol"].astype(str))


def _get_etf_codes() -> set[str]:
    return cache.get_or_set("etf_codes", TTL_INDUSTRY_SECONDS, _load_etf_codes)


MAX_NAVER_PAGES = 45  # safety cap; the KOSPI board (incl. ETFs) tops out around here


def get_kospi_map(limit: int = 500) -> list[dict]:
    industry_by_code = _get_industry_map()
    etf_codes = _get_etf_codes()

    # ETFs make up roughly a third of the ranked rows, so start with headroom and grow
    # the page count if the post-filter count still falls short of `limit`.
    pages = min(MAX_NAVER_PAGES, max(1, -(-(limit * 2) // NAVER_PAGE_SIZE)))
    items: list[dict] = []
    while True:
        snapshot = _get_price_snapshot(pages)
        items = [
            {**row, "sector": _classify_sector(industry_by_code.get(row["code"]))}
            for row in snapshot
            if row["marcap"] > 0 and row["code"] not in etf_codes
        ]
        if len(items) >= limit or pages >= MAX_NAVER_PAGES:
            break
        pages = min(pages + 10, MAX_NAVER_PAGES)

    items.sort(key=lambda it: it["marcap"], reverse=True)
    return items[:limit]
