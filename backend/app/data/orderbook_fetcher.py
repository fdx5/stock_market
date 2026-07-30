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


def _parse_int(text: str) -> int:
    cleaned = text.replace(",", "").strip()
    return int(cleaned) if cleaned else 0


def get_orderbook(code: str) -> dict:
    """10-level bid/ask order book (호가), scraped from Naver's per-stock sise page.
    Rows are returned in the same top-to-bottom order Naver renders them: asks
    descending toward the spread, then bids descending away from it.

    Raises on any failure (network error, bad status, missing/empty table) instead of
    swallowing it into a None return. The cache this feeds (see stock.py's /orderbook
    route) treats a raised exception as "keep serving the last-known-good ladder,
    retry next cycle" but treats a returned None as a real value worth caching - so
    swallowing here used to turn one transient scrape hiccup (rate limiting, a
    momentary Naver 5xx, a captcha page in place of the table) into a 502 that stuck
    around for the full cache TTL even after the upstream had already recovered.
    """
    url = f"https://finance.naver.com/item/sise.naver?code={code}"
    resp = requests.get(url, headers=HEADERS, timeout=4)
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

    if not asks and not bids:
        raise ValueError(f"호가 데이터가 비어 있습니다: {code}")

    return {
        "code": code,
        "delayed_minutes": 20,
        "asks": asks,
        "bids": bids,
        "total_ask_qty": total_ask_qty,
        "total_bid_qty": total_bid_qty,
    }
