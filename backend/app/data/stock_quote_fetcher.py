import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}


def _parse_signed(text: str) -> float:
    cleaned = text.replace(",", "").replace("%", "").strip()
    return float(cleaned) if cleaned else 0.0


def get_stock_quote(code: str) -> dict | None:
    """Live price + market cap for one stock. Korea's NXT alternative exchange keeps
    trading before 09:00 and after 15:30, which moves market cap outside the regular
    KRX session — but that continued trading only shows up in this endpoint's
    `overMarketPriceInfo`, not in the regular closePrice/marketValueFull fields (which
    freeze at the 15:30 close). When that NXT session is open, we recompute market cap
    from its price instead of the frozen regular-session figure."""
    url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        data = resp.json()["datas"][0]

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
            "code": code,
            "name": data["stockName"],
            "close": close_price,
            "change": change,
            "change_pct": change_pct,
            "marcap": marcap,
        }
    except Exception:
        return None
