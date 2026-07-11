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


def get_orderbook(code: str) -> dict | None:
    """10-level bid/ask order book (호가), scraped from Naver's per-stock sise page.
    Rows are returned in the same top-to-bottom order Naver renders them: asks
    descending toward the spread, then bids descending away from it."""
    url = f"https://finance.naver.com/item/sise.naver?code={code}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=4)
        resp.raise_for_status()
        resp.encoding = "euc-kr"
        soup = BeautifulSoup(resp.text, "html.parser")

        table = soup.find("table", summary="호가10단계 정보")
        if table is None:
            return None

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
            return None

        return {
            "code": code,
            "delayed_minutes": 20,
            "asks": asks,
            "bids": bids,
            "total_ask_qty": total_ask_qty,
            "total_bid_qty": total_bid_qty,
        }
    except Exception:
        return None
