"""Curated liquid ETF universes with live quotes and one-year performance context."""

import datetime as dt
from concurrent.futures import ThreadPoolExecutor

from app.data.board_fetcher import get_board_posts
from app.data.global_discussion_fetcher import resolve_naver_suffix
from app.data.toss_discussion_fetcher import get_toss_discussion
from app.data.sparkline_fetcher import get_kr_sparklines, get_us_sparklines
from app.data.stock_quote_fetcher import get_stock_quotes_bulk
from app.data.yahoo_bulk_quote import get_quotes
from app.services.cache import cache

ETF_TTL_SECONDS = 9
HISTORY_TTL_SECONDS = 60 * 60 * 6

KR_ETFS = [
    ("069500", "KODEX 200", "코스피200", "국내 대표"),
    ("102110", "TIGER 200", "코스피200", "국내 대표"),
    ("229200", "KODEX 코스닥150", "코스닥150", "국내 대표"),
    ("233740", "KODEX 코스닥150레버리지", "코스닥150 2배", "레버리지"),
    ("122630", "KODEX 레버리지", "코스피200 2배", "레버리지"),
    ("252670", "KODEX 200선물인버스2X", "코스피200 선물 -2배", "인버스"),
    ("114800", "KODEX 인버스", "코스피200 선물 역방향", "인버스"),
    ("091160", "KODEX 반도체", "국내 반도체", "섹터"),
    ("091170", "KODEX 은행", "국내 은행", "섹터"),
    ("305720", "KODEX 2차전지산업", "국내 2차전지", "테마"),
    ("364980", "TIGER 2차전지TOP10", "2차전지 대형주", "테마"),
    ("381180", "TIGER 미국필라델피아반도체나스닥", "미국 반도체", "해외지수"),
    ("360750", "TIGER 미국S&P500", "S&P 500", "해외지수"),
    ("379800", "KODEX 미국S&P500", "S&P 500", "해외지수"),
    ("133690", "TIGER 미국나스닥100", "NASDAQ 100", "해외지수"),
    ("379810", "KODEX 미국나스닥100", "NASDAQ 100", "해외지수"),
    ("458730", "TIGER 미국배당다우존스", "미국 배당주", "배당"),
    ("329200", "TIGER 리츠부동산인프라", "리츠·인프라", "배당"),
    ("132030", "KODEX 골드선물(H)", "금 선물", "원자재"),
    ("411060", "ACE KRX금현물", "KRX 금현물", "원자재"),
]

US_ETFS = [
    ("SPY", "SPDR S&P 500 ETF Trust", "S&P 500", "미국 대표"),
    ("QQQ", "Invesco QQQ Trust", "NASDAQ 100", "미국 대표"),
    ("VOO", "Vanguard S&P 500 ETF", "S&P 500", "미국 대표"),
    ("IVV", "iShares Core S&P 500 ETF", "S&P 500", "미국 대표"),
    ("VTI", "Vanguard Total Stock Market ETF", "미국 전체시장", "미국 대표"),
    ("IWM", "iShares Russell 2000 ETF", "Russell 2000", "중소형주"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "Dow Jones", "미국 대표"),
    ("SOXL", "Direxion Daily Semiconductor Bull 3X", "미국 반도체 3배", "레버리지"),
    ("TQQQ", "ProShares UltraPro QQQ", "NASDAQ 100 3배", "레버리지"),
    ("SQQQ", "ProShares UltraPro Short QQQ", "NASDAQ 100 -3배", "인버스"),
    ("SPXL", "Direxion Daily S&P 500 Bull 3X", "S&P 500 3배", "레버리지"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "미국 장기국채", "채권"),
    ("SGOV", "iShares 0-3 Month Treasury Bond ETF", "미국 초단기국채", "채권"),
    ("GLD", "SPDR Gold Shares", "금 현물", "원자재"),
    ("SLV", "iShares Silver Trust", "은 현물", "원자재"),
    ("XLF", "Financial Select Sector SPDR Fund", "미국 금융", "섹터"),
    ("XLK", "Technology Select Sector SPDR Fund", "미국 기술", "섹터"),
    ("SMH", "VanEck Semiconductor ETF", "미국 반도체", "섹터"),
    ("SCHD", "Schwab U.S. Dividend Equity ETF", "미국 배당주", "배당"),
    ("ARKK", "ARK Innovation ETF", "혁신 성장주", "테마"),
]


def _history(region: str, codes: list[str]):
    key = f"etf_history:{region}"
    return cache.get_or_set(
        key,
        HISTORY_TTL_SECONDS,
        lambda: get_kr_sparklines(codes) if region == "KR" else get_us_sparklines(codes),
    )


def _build(region: str) -> dict:
    roster = KR_ETFS if region == "KR" else US_ETFS
    codes = [row[0] for row in roster]
    quotes = get_stock_quotes_bulk(codes) if region == "KR" else get_quotes(codes)
    history = _history(region, codes)
    items = []
    for code, name, benchmark, category in roster:
        quote = quotes.get(code)
        if not quote:
            continue
        series = history.get(code)
        points = series.points if series else []
        returns = series.returns if series else {}
        volume = int(quote.get("volume") or 0)
        items.append({
            "code": code, "name": name, "benchmark": benchmark, "category": category,
            "naver_code": code if region == "KR" else f"{code}.{resolve_naver_suffix(code)}",
            "region": region, "currency": "KRW" if region == "KR" else quote.get("currency", "USD"),
            "close": quote["close"], "change": quote["change"], "change_pct": quote["change_pct"],
            "volume": volume, "turnover": quote.get("turnover") or round(volume * quote["close"], 2),
            "average_volume": quote.get("average_volume"), "session": quote.get("session", "regular"),
            "returns": {key: returns.get(key) for key in ("d20", "d60", "d120", "ytd")},
            "week52_high": series.week52_high if series else None,
            "week52_low": series.week52_low if series else None,
            "sparkline": points,
        })
    items.sort(key=lambda item: item["volume"], reverse=True)
    return {"region": region, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "items": items}


def get_etfs(region: str) -> dict:
    region = region.upper()
    # The browser asks every 10 seconds and the quote TTL is nine. Refresh expired
    # quotes synchronously so one stale-while-revalidate response does not stretch a
    # visible update to 20 seconds; the expensive history remains separately cached.
    return cache.get_or_set(f"etfs:{region}", ETF_TTL_SECONDS, lambda: _build(region), allow_stale=False)


def get_etf_discussions(region: str = "KR") -> dict[str, list[dict]]:
    """Latest ten discussion posts per ETF, fetched concurrently.

    The board fetcher's own three-minute per-code cache controls upstream traffic; this
    aggregate endpoint only turns twenty serial browser calls into one small response.
    """
    region = region.upper()
    codes = [row[0] for row in (KR_ETFS if region == "KR" else US_ETFS)]
    fetch = (
        (lambda code: get_board_posts(code, 1)[:10])
        if region == "KR"
        else (lambda code: get_toss_discussion(code, 10).get("items", [])[:10])
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(fetch, codes))
    return dict(zip(codes, rows))
