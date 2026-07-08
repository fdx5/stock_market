import requests

from app.services.cache import cache

TTL_INDEX_SECONDS = 10

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def _fetch_index(symbol: str) -> dict:
    url = f"https://polling.finance.naver.com/api/realtime/domestic/index/{symbol}"
    resp = requests.get(url, headers=HEADERS, timeout=8)
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


def get_index(symbol: str) -> dict | None:
    key = f"index:{symbol}"
    try:
        return cache.get_or_set(key, TTL_INDEX_SECONDS, lambda: _fetch_index(symbol))
    except Exception:
        return None
