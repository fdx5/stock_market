from concurrent.futures import ThreadPoolExecutor, as_completed

import FinanceDataReader as fdr
import pandas as pd

from app.data.naver_price_fetcher import NAVER_PAGE_SIZE, fetch_market_cap_page
from app.data.stock_quote_fetcher import get_stock_quotes_bulk
from app.data.universe import get_stock_market
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


# Code-level overrides for names the KSIC industry string misclassifies. The big
# offender is holding companies: KRX files nearly every 지주회사 under "기타 금융업"
# (other financial services), so the keyword map drops them into 금융 even though they
# are not financial businesses. Diversified conglomerate holdcos belong in 지주/서비스;
# single-industry group holdcos (에코프로, 세아제강지주 …) read far better in their
# operating sector — that's exactly the 에코프로→배터리 fix the map needed. Genuine
# financial-group holdcos (KB금융, 신한지주, 증권/보험/은행) are intentionally absent
# here so they stay in 금융. Keyed by 6-char code.
_SECTOR_OVERRIDES: dict[str, str] = {
    # Single-industry group holdcos → operating sector
    "086520": "배터리",         # 에코프로 (이차전지 소재 그룹 지주)
    "009540": "자동차/조선",     # HD한국조선해양 (조선 중간지주)
    "003030": "철강/금속",       # 세아제강지주
    "005810": "철강/금속",       # 풍산홀딩스
    "010060": "화학/소재",       # OCI홀딩스 (폴리실리콘/화학)
    "008930": "제약/바이오",     # 한미사이언스 (한미약품 지주)
    "000640": "제약/바이오",     # 동아쏘시오홀딩스
    "096760": "제약/바이오",     # JW홀딩스
    "001800": "식품/음료",       # 오리온홀딩스
    "072710": "식품/음료",       # 농심홀딩스
    "000140": "식품/음료",       # 하이트진로홀딩스
    "084690": "식품/음료",       # 대상홀딩스
    "007700": "유통/소비재",     # F&F홀딩스 (의류)
    # Diversified conglomerate / miscellaneous holdcos → 지주/서비스
    "034730": "지주/서비스",     # SK
    "402340": "지주/서비스",     # SK스퀘어
    "006120": "지주/서비스",     # SK디스커버리
    "003550": "지주/서비스",     # LG
    "006260": "지주/서비스",     # LS
    "078930": "지주/서비스",     # GS
    "001040": "지주/서비스",     # CJ
    "267250": "지주/서비스",     # HD현대
    "004990": "지주/서비스",     # 롯데지주
    "004800": "지주/서비스",     # 효성
    "002020": "지주/서비스",     # 코오롱
    "012630": "지주/서비스",     # HDC
    "027410": "지주/서비스",     # BGF
    "060980": "지주/서비스",     # HL홀딩스
    "000240": "지주/서비스",     # 한국앤컴퍼니
    "005440": "지주/서비스",     # 현대지에프홀딩스
    "009970": "지주/서비스",     # 영원무역홀딩스
    "192400": "지주/서비스",     # 쿠쿠홀딩스
    "036530": "지주/서비스",     # SNT홀딩스
    "383800": "지주/서비스",     # LX홀딩스
    "015860": "지주/서비스",     # 일진홀딩스
    "024720": "지주/서비스",     # 콜마홀딩스
    "001230": "지주/서비스",     # 동국홀딩스
    "000320": "지주/서비스",     # 노루홀딩스
    "000070": "지주/서비스",     # 삼양홀딩스
    "006040": "지주/서비스",     # 동원산업 (그룹 지주)
    "180640": "지주/서비스",     # 한진칼 (한진그룹 지주)
    "006840": "지주/서비스",     # AK홀딩스
    "000480": "지주/서비스",     # 조선내화
}


def _classify_industry(industry) -> str:
    if not industry or (isinstance(industry, float) and pd.isna(industry)):
        return "기타"
    for sector, keywords in _SECTOR_KEYWORDS:
        if any(kw in industry for kw in keywords):
            return sector
    return "기타"


def _resolve_sector(code: str, industry_by_code: dict[str, str]) -> str:
    """Sector for one stock: manual override first, then KSIC keyword match, then a
    preferred-share fallback. Preferred shares (우선주) carry no industry string of their
    own so they'd otherwise all land in 기타; the common share shares the first five code
    digits and ends in 0 (삼성전자우 005935 → 삼성전자 005930, 현대차2우B 005387 →
    현대차 005380), so inherit its sector."""
    override = _SECTOR_OVERRIDES.get(code)
    if override:
        return override
    sector = _classify_industry(industry_by_code.get(code))
    if sector == "기타" and len(code) == 6 and not code.endswith("0"):
        common = code[:5] + "0"
        return _SECTOR_OVERRIDES.get(common) or _classify_industry(industry_by_code.get(common))
    return sector


def _naver_page_ttl(page: int) -> int:
    if page <= FIRST_TIER_PAGES:
        return FIRST_TIER_TTL_SECONDS
    if page <= SECOND_TIER_PAGES:
        return SECOND_TIER_TTL_SECONDS
    return LONG_TAIL_TTL_SECONDS


# Live-quote overlay TTL, keyed by the same `limit` values the callers request
# (20 / 50 / fullLimit). The top 50 is the tier the dashboard's headline "시총 50위"
# table and the map's tier-2 both draw, and it's exactly where an NXT after-hours move
# is worth noticing, so it refreshes on the fast 10s cadence — one bulk Naver poll of
# 50 codes, the same cheap request the top-20 already makes. Only the long tail (the
# full 500/200 list, whose lower ranks barely move moment-to-moment) stays on the slow
# cadence to avoid re-fetching hundreds of codes every few seconds.
def _realtime_quotes_ttl(limit: int) -> int:
    if limit <= 50:
        return FIRST_TIER_TTL_SECONDS
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
            {**row, "sector": _resolve_sector(row["code"], industry_by_code)}
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


SECTOR_PEER_LIMIT = 40


def get_sector_map(code: str, limit: int = SECTOR_PEER_LIMIT) -> dict:
    """The sector cohort around one stock — what the dashboard draws beside the chart.

    Deliberately built by filtering the full market map rather than by its own scrape:
    those snapshots are already cached per Naver page and already carry live NXT-aware
    quotes, and the keep-alive workflow warms exactly these two limits (KOSPI 500 /
    KOSDAQ 200) every 10 minutes. So the common case costs no upstream request at all,
    and every tile here shows the same number the full map would for that stock.

    A stock outside its market's ranked window (a small cap below KOSPI's top 500) still
    resolves a sector and still gets its cohort back; it just won't be among the tiles.
    The caller decides what to do about that — there's no per-stock quote fetch here to
    force it in, which would cost a round trip on exactly the page that can least
    afford one.
    """
    market = get_stock_market(code) or "KOSPI"
    ranked = get_kospi_map() if market == "KOSPI" else get_kosdaq_map()

    sector = _resolve_sector(code, _get_industry_map())
    peers = [it for it in ranked if it["sector"] == sector][:limit]

    total_marcap = sum(it["marcap"] for it in peers)
    weighted_change = sum(it["change_pct"] * it["marcap"] for it in peers)

    return {
        "code": code,
        "market": market,
        "sector": sector,
        "avg_change_pct": weighted_change / total_marcap if total_marcap > 0 else 0.0,
        "count": len(peers),
        "items": peers,
    }
