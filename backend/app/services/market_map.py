from concurrent.futures import ThreadPoolExecutor, as_completed

import FinanceDataReader as fdr
import pandas as pd

from app.data.naver_price_fetcher import NAVER_PAGE_SIZE, fetch_market_cap_page
from app.data.stock_quote_fetcher import get_stock_quotes_bulk
from app.services.cache import cache

# Ranks by market cap refresh on three cadences — the top of the board is what carries
# most of the map's visual weight, the tail barely matters moment-to-moment. This is
# cached per Naver page (not per request), so a cold fetch only ever touches the pages
# whose TTL actually expired — most requests hit an already-warm cache and return fast.
# Page 1 alone covers ranks ~1-48 post-ETF-filter, pages 2-3 extend that to ~120, so
# these page cutoffs comfortably bracket the requested rank tiers (1-20 / 21-50 / rest);
# each TTL is set to at least as fresh as its fastest-polling tier needs.
FIRST_TIER_PAGES = 1
FIRST_TIER_TTL_SECONDS = 10
SECOND_TIER_PAGES = 3
SECOND_TIER_TTL_SECONDS = 30
LONG_TAIL_TTL_SECONDS = 60
TTL_INDUSTRY_SECONDS = 24 * 3600

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


def _naver_page_ttl(page: int) -> int:
    if page <= FIRST_TIER_PAGES:
        return FIRST_TIER_TTL_SECONDS
    if page <= SECOND_TIER_PAGES:
        return SECOND_TIER_TTL_SECONDS
    return LONG_TAIL_TTL_SECONDS


# Mirrors the map page's own rank tiers exactly, since this is keyed by the same
# `limit` values it requests (20 / 50 / fullLimit): rank 1-20 refreshes most often,
# since that's exactly where an NXT after-hours move is most likely to be noticed.
def _realtime_quotes_ttl(limit: int) -> int:
    if limit <= 20:
        return FIRST_TIER_TTL_SECONDS
    if limit <= 50:
        return SECOND_TIER_TTL_SECONDS
    return LONG_TAIL_TTL_SECONDS


def _get_naver_page(market: str, sosok: int, page: int, fresh: bool = False) -> list[dict]:
    ttl = _naver_page_ttl(page)
    return cache.get_or_set(
        f"{market}_naver_page:{page}", ttl, lambda: fetch_market_cap_page(page, sosok), allow_stale=not fresh
    )


def _get_price_snapshot(market: str, sosok: int, pages: int, fresh: bool = False) -> list[dict]:
    results: dict[int, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(_get_naver_page, market, sosok, page, fresh): page for page in range(1, pages + 1)
        }
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


def _get_market_map(market: str, sosok: int, limit: int, fresh: bool = False) -> list[dict]:
    industry_by_code = _get_industry_map()
    etf_codes = _get_etf_codes()

    # ETFs make up roughly a third of the ranked rows, so start with headroom and grow
    # the page count if the post-filter count still falls short of `limit`.
    pages = min(MAX_NAVER_PAGES, max(1, -(-(limit * 2) // NAVER_PAGE_SIZE)))
    items: list[dict] = []
    while True:
        snapshot = _get_price_snapshot(market, sosok, pages, fresh)
        items = [
            {**row, "sector": _classify_sector(industry_by_code.get(row["code"]))}
            for row in snapshot
            if row["marcap"] > 0 and row["code"] not in etf_codes
        ]
        if len(items) >= limit or pages >= MAX_NAVER_PAGES:
            break
        pages = min(pages + 10, MAX_NAVER_PAGES)

    items.sort(key=lambda it: it["marcap"], reverse=True)
    items = items[:limit]

    # The Naver page scrape above freezes at the 15:30 regular-session close, so overlay
    # live (NXT-aware) price/change/marcap on top of it — the same data source the
    # battle page already uses for Samsung/SK Hynix, just batched across every listed
    # code here. Cached like the page snapshots above so concurrent requests within the
    # TTL window share one round-trip instead of each triggering their own.
    ttl = _realtime_quotes_ttl(limit)
    quotes = cache.get_or_set(
        f"realtime_quotes:{market}:{limit}",
        ttl,
        lambda: get_stock_quotes_bulk([it["code"] for it in items]),
        allow_stale=not fresh,
    )
    for it in items:
        quote = quotes.get(it["code"])
        if quote:
            it["close"] = quote["close"]
            it["change"] = quote["change"]
            it["change_pct"] = quote["change_pct"]
            it["marcap"] = quote["marcap"]

    return items


def get_kospi_map(limit: int = 500, fresh: bool = False) -> list[dict]:
    return _get_market_map("kospi", 0, limit, fresh)


def get_kosdaq_map(limit: int = 200, fresh: bool = False) -> list[dict]:
    return _get_market_map("kosdaq", 1, limit, fresh)
