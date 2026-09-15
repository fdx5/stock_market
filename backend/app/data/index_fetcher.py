import requests

from app.services.cache import cache

TTL_INDEX_SECONDS = 10
TTL_MARKET_INVESTOR_SECONDS = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def _fetch_index(symbol: str) -> dict:
    url = f"https://polling.finance.naver.com/api/realtime/domestic/index/{symbol}"
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    data = resp.json()["datas"][0]
    return {
        "symbol": symbol,
        "name": data["stockName"],
        "close": float(data["closePriceRaw"]),
        "change": float(data["compareToPreviousClosePriceRaw"]),
        "change_pct": float(data["fluctuationsRatioRaw"]),
        "market_status": data.get("marketStatus", ""),
        "updated_at": data.get("localTradedAt", ""),
    }


def get_index(symbol: str, fresh: bool = False) -> dict | None:
    key = f"index:{symbol}"
    try:
        return cache.get_or_set(
            key, TTL_INDEX_SECONDS, lambda: _fetch_index(symbol), allow_stale=not fresh
        )
    except Exception:
        return None


def _parse_signed_amount(value) -> float | None:
    if value in (None, "", "N/A"):
        return None
    try:
        return float(str(value).replace(",", "").replace("+", ""))
    except ValueError:
        return None


def _fetch_market_investor(symbol: str) -> dict | None:
    # Unlike per-stock investor breakdowns (only finalized after each session closes),
    # KRX publishes a running market-wide net buy/sell estimate while the session is
    # open. This used to come from finance.naver.com/sise/sise_index.naver's
    # server-rendered "투자자별 매매동향" box, but that URL now 302s to the
    # stock.naver.com Next.js app, whose HTML no longer carries it (the same
    # redirect that broke the market-cap scrape — see naver_price_fetcher.py). The
    # replacement is the JSON API that app itself loads from.
    url = f"https://m.stock.naver.com/api/index/{symbol}/integration"
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    trend = resp.json().get("dealTrendInfo")
    if not trend:
        return None

    individual = _parse_signed_amount(trend.get("personalValue"))
    foreign = _parse_signed_amount(trend.get("foreignValue"))
    institution = _parse_signed_amount(trend.get("institutionalValue"))
    if individual is None or foreign is None or institution is None:
        return None

    return {
        "individual_amount": individual,
        "foreign_amount": foreign,
        "institution_amount": institution,
    }


def get_market_investor_summary(symbol: str, fresh: bool = False) -> dict | None:
    key = f"market_investor:{symbol}"
    try:
        return cache.get_or_set(
            key,
            TTL_MARKET_INVESTOR_SECONDS,
            lambda: _fetch_market_investor(symbol),
            allow_stale=not fresh,
        )
    except Exception:
        return None
