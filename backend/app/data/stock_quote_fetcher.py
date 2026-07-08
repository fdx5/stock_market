from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}

# Keeps each batched request's URL (comma-joined codes) a reasonable size.
BULK_CHUNK_SIZE = 50


def _parse_signed(text: str) -> float:
    cleaned = text.replace(",", "").replace("%", "").strip()
    return float(cleaned) if cleaned else 0.0


def _quote_from_data(data: dict) -> dict:
    """Korea's NXT alternative exchange keeps trading before 09:00 and after 15:30,
    which moves market cap outside the regular KRX session — but that continued
    trading only shows up in `overMarketPriceInfo`, not in the regular
    closePrice/marketValueFull fields (which freeze at the 15:30 close). When that NXT
    session is open, we recompute market cap from its price instead of the frozen
    regular-session figure."""
    close_price = float(data["closePriceRaw"])
    change = float(data["compareToPreviousClosePriceRaw"])
    change_pct = float(data["fluctuationsRatioRaw"])
    marcap = float(data["marketValueFullRaw"])
    shares = marcap / close_price if close_price else 0.0

    over = data.get("overMarketPriceInfo")
    if over and over.get("overMarketStatus") == "OPEN":
        over_price = _parse_signed(over["overPrice"])
        change = _parse_signed(over["compareToPreviousClosePrice"])
        change_pct = _parse_signed(over["fluctuationsRatio"])
        close_price = over_price
        marcap = shares * over_price

    return {
        "code": data["itemCode"],
        "name": data["stockName"],
        "close": close_price,
        "change": change,
        "change_pct": change_pct,
        "marcap": marcap,
    }


def get_stock_quote(code: str) -> dict | None:
    """Live, NXT-aware price + market cap for one stock."""
    url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        return _quote_from_data(resp.json()["datas"][0])
    except Exception:
        return None


def _fetch_quotes_chunk(codes: list[str]) -> dict[str, dict]:
    url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{','.join(codes)}"
    resp = requests.get(url, headers=HEADERS, timeout=8)
    resp.raise_for_status()
    datas = resp.json().get("datas", [])
    return {d["itemCode"]: _quote_from_data(d) for d in datas}


def get_stock_quotes_bulk(codes: list[str]) -> dict[str, dict]:
    """Live, NXT-aware quotes for many codes in one batch of requests, keyed by code.
    Used to overlay real-time price/change/marcap onto listings (KOSPI MAP, the
    dashboard's top-50 table) whose ranking data otherwise comes from a scrape that
    freezes at the 15:30 regular-session close. A failed chunk is dropped rather than
    failing the whole batch — callers should treat this as a best-effort overlay."""
    unique_codes = list(dict.fromkeys(codes))
    chunks = [unique_codes[i : i + BULK_CHUNK_SIZE] for i in range(0, len(unique_codes), BULK_CHUNK_SIZE)]
    if not chunks:
        return {}

    quotes: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(8, len(chunks))) as pool:
        futures = [pool.submit(_fetch_quotes_chunk, chunk) for chunk in chunks]
        for future in as_completed(futures):
            try:
                quotes.update(future.result())
            except Exception:
                continue
    return quotes
