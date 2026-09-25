import requests
from app.data.http_pool import mount_pool

# Shared by any feature that needs a live KOSPI/KOSDAQ market-cap-ranked snapshot (the
# KOSPI MAP treemap, the top-100 prediction panel's live price column, etc). Each caller
# owns its own cache tier on top of this — this module only knows how to fetch and parse
# one page of Naver's market-cap ranking.
#
# This used to scrape the HTML table at finance.naver.com/sise/sise_market_sum.naver,
# but that URL now 302s to the stock.naver.com Next.js app, whose server-rendered
# response contains no `table.type_2` (the data loads client-side). That silently
# turned every page fetch into zero rows, which cascaded into every KOSPI/KOSDAQ stock
# — 현대차 included — dropping out of the map. The app itself fetches its data from a
# JSON API at m.stock.naver.com; that's what this module calls instead.
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}
NAVER_PAGE_SIZE = 50
_MARKET_CATEGORY = {0: "KOSPI", 1: "KOSDAQ"}

# A shared, connection-pooled session avoids paying a fresh TCP/TLS handshake for each
# of the (potentially many) page requests a cold fetch makes to the same host.
_session = requests.Session()
_session.headers.update(NAVER_HEADERS)
mount_pool(_session)  # pool sized for the threads sharing it (http_pool.py)


def _parse_signed(value) -> float:
    """Handles the API's own raw numeric strings, which already carry their sign (a
    falling stock's compareToPreviousClosePriceRaw is e.g. "-8000") and occasional
    "N/A"/empty placeholders for fields Naver has nothing to report."""
    if value in (None, "", "N/A"):
        return 0.0
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return 0.0


def fetch_market_cap_page(page: int, sosok: int = 0) -> list[dict]:
    """One page (50 rows) of the market-cap ranking, live — `sosok=0` for KOSPI,
    `sosok=1` for KOSDAQ. Includes ETFs — callers that need companies only should
    cross-reference StockListing('ETF/KR')."""
    category = _MARKET_CATEGORY.get(sosok, "KOSPI")
    url = f"https://m.stock.naver.com/api/stocks/marketValue/{category}"
    resp = _session.get(url, params={"page": page, "pageSize": NAVER_PAGE_SIZE}, timeout=4)
    resp.raise_for_status()
    payload = resp.json()

    rows = []
    for item in payload.get("stocks", []):
        code = item.get("itemCode")
        if not code:
            continue
        rows.append(
            {
                "code": code,
                "name": item.get("stockName") or "",
                "close": _parse_signed(item.get("closePriceRaw")),
                "change": _parse_signed(item.get("compareToPreviousClosePriceRaw")),
                "change_pct": _parse_signed(item.get("fluctuationsRatio")),
                "marcap": _parse_signed(item.get("marketValueRaw")),
                "volume": _parse_signed(item.get("accumulatedTradingVolumeRaw")),
            }
        )
    return rows
