import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}

URL = "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW"


def get_usd_krw() -> dict | None:
    """하나은행 고시환율(USD/KRW). Updates once per notice round during business
    hours rather than tick-by-tick, but it's the closest thing to a live retail
    exchange rate Naver exposes without authentication."""
    try:
        resp = requests.get(URL, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        data = resp.json()["result"]
        return {
            "rate": float(data["closePrice"].replace(",", "")),
            "change": float(data["fluctuations"].replace(",", "")),
            "change_pct": float(data["fluctuationsRatio"].replace(",", "")),
        }
    except Exception:
        return None
