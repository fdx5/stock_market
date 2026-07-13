import re

import requests
from bs4 import BeautifulSoup

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


def _fetch_market_investor(symbol: str) -> dict | None:
    # Unlike per-stock investor breakdowns (only finalized after each session closes),
    # KRX publishes a running market-wide net buy/sell estimate while the session is
    # open, and Naver renders it server-side on the classic index page — no separate
    # API needed.
    url = f"https://finance.naver.com/sise/sise_index.naver?code={symbol}"
    resp = requests.get(url, headers=HEADERS, timeout=4)
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    heading = soup.find(string=lambda s: s and s.strip() == "투자자별 매매동향")
    if heading is None:
        return None
    dl = heading.find_parent("dl")
    if dl is None:
        return None

    amounts: dict[str, float] = {}
    for label, dd in zip(["individual", "foreign", "institution"], dl.select("dd.dd")[:3]):
        match = re.search(r"([+-]?[\d,]+)\s*억", dd.get_text(" ", strip=True))
        if match:
            amounts[label] = float(match.group(1).replace(",", ""))

    if len(amounts) < 3:
        return None

    return {
        "individual_amount": amounts["individual"],
        "foreign_amount": amounts["foreign"],
        "institution_amount": amounts["institution"],
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
