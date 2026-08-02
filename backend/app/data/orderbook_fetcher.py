import requests
from bs4 import BeautifulSoup

# KRX real-time Level-2 order-book depth is a paid market-data product; the free page
# Naver serves individual investors carries the same 20-minute delay as everywhere else
# in this app's data sources, just rendered as a live-looking 10-level ladder.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}

# A shared, connection-pooled session — same fix already applied in
# naver_price_fetcher.py/board_fetcher.py for the same symptom. This route's 15s
# cache TTL (see stock.py's TTL_ORDERBOOK_SECONDS) means it re-hits Naver far more
# often than this app's other single-page scrapes, and every one of those requests
# was paying a fresh TCP/TLS handshake with no session cookie carried over — the
# most likely cause of the occasional 502s reported against this endpoint. Reusing
# a keep-alive connection (and letting cookies persist across calls) makes each
# request faster and look less like a fresh anonymous bot hit to Naver.
_session = requests.Session()
_session.headers.update(HEADERS)
_session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)


def _parse_int(text: str) -> int:
    cleaned = text.replace(",", "").strip()
    return int(cleaned) if cleaned else 0


def get_orderbook(code: str) -> dict:
    """10-level bid/ask order book (호가), scraped from Naver's per-stock sise page.
    Rows are returned in the same top-to-bottom order Naver renders them: asks
    descending toward the spread, then bids descending away from it.

    Raises on a genuine scrape failure (network error, bad status, missing table)
    instead of swallowing it into a None return. The cache this feeds (see stock.py's
    /orderbook route) treats a raised exception as "keep serving the last-known-good
    ladder, retry next cycle" but treats a returned None as a real value worth caching
    - so swallowing here used to turn one transient scrape hiccup (rate limiting, a
    momentary Naver 5xx, a captcha page in place of the table) into a 502 that stuck
    around for the full cache TTL even after the upstream had already recovered.

    Does NOT raise when the table itself is present but every row's price/qty cells
    are blank — confirmed (by inspecting the live page outside trading hours) to be
    how Naver renders this table whenever KRX isn't actively trading, i.e. most of the
    week (nights, weekends, holidays). That is a normal state, not an upstream
    failure, and returns `available: False` instead so the frontend can show "휴장
    중" rather than an error — this was the actual majority cause of the /orderbook
    502s reported in production, not a scrape or network problem.
    """
    url = f"https://finance.naver.com/item/sise.naver?code={code}"
    resp = _session.get(url, timeout=6)
    resp.raise_for_status()
    resp.encoding = "euc-kr"
    soup = BeautifulSoup(resp.text, "html.parser")

    table = soup.find("table", summary="호가10단계 정보")
    if table is None:
        raise ValueError(f"호가 테이블을 찾을 수 없습니다: {code}")

    asks: list[dict] = []
    bids: list[dict] = []
    total_ask_qty = 0
    total_bid_qty = 0

    for tr in table.select("tr"):
        classes = tr.get("class") or []
        cells = tr.select("td")
        if len(cells) != 3:
            continue

        if "total" in classes:
            total_ask_qty = _parse_int(cells[0].get_text(strip=True))
            total_bid_qty = _parse_int(cells[2].get_text(strip=True))
        elif "f_down" in classes:
            qty_text = cells[0].get_text(strip=True)
            price_text = cells[1].get_text(strip=True)
            if qty_text and price_text:
                asks.append({"price": _parse_int(price_text), "qty": _parse_int(qty_text)})
        elif "f_up" in classes:
            price_text = cells[1].get_text(strip=True)
            qty_text = cells[2].get_text(strip=True)
            if qty_text and price_text:
                bids.append({"price": _parse_int(price_text), "qty": _parse_int(qty_text)})

    return {
        "code": code,
        "delayed_minutes": 20,
        "available": bool(asks or bids),
        "asks": asks,
        "bids": bids,
        "total_ask_qty": total_ask_qty,
        "total_bid_qty": total_bid_qty,
    }
