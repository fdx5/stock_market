from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from app.services.cache import cache

# A 3s-polled ticker still needs to be cheap on the upstream (unauthenticated,
# rate-limit-sensitive) API — this TTL is what actually bounds how often Yahoo
# gets hit, regardless of how often the frontend polls our own endpoint.
TTL_TICKER_SECONDS = 10

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

# Yahoo Finance's unofficial chart API, keyed by its own ticker symbols — the only
# no-auth source that covers FX, commodities futures, and crypto uniformly.
SYMBOLS = [
    {"symbol": "KRW=X", "label": "USD/KRW"},
    {"symbol": "^GSPC", "label": "S&P 500"},
    {"symbol": "^NDX", "label": "Nasdaq 100"},
    {"symbol": "NVDA", "label": "NVIDIA"},
    {"symbol": "SKHYV", "label": "SK Hynix"},
    {"symbol": "MU", "label": "Micron Technology"},
    {"symbol": "AVGO", "label": "Broadcom"},
    {"symbol": "INTC", "label": "Intel"},
    {"symbol": "AMD", "label": "AMD"},
    {"symbol": "AAPL", "label": "Apple"},
    {"symbol": "GOOGL", "label": "Alphabet (Google)"},
    {"symbol": "MSFT", "label": "Microsoft"},
    {"symbol": "META", "label": "Meta"},
    {"symbol": "CL=F", "label": "WTI Crude"},
    {"symbol": "BTC-USD", "label": "Bitcoin"},
    {"symbol": "ETH-USD", "label": "Ethereum"},
    {"symbol": "XRP-USD", "label": "Ripple"},
    {"symbol": "GC=F", "label": "Gold"},
    {"symbol": "SI=F", "label": "Silver"},
]


def _fetch_one(entry: dict) -> dict | None:
    symbol = entry["symbol"]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        resp = requests.get(url, headers=HEADERS, params={"interval": "15m", "range": "1d"}, timeout=4)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        meta = result["meta"]
        price = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is None or prev_close is None:
            return None

        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
        points = [round(float(c), 4) for c in closes if c is not None]

        change = float(price) - float(prev_close)
        change_pct = (change / prev_close * 100) if prev_close else 0.0
        return {
            "symbol": symbol,
            "label": entry["label"],
            "price": round(float(price), 4),
            "change": round(change, 4),
            "change_pct": round(change_pct, 2),
            "points": points,
            "currency": meta.get("currency") or "USD",
        }
    except Exception:
        return None


def _fetch_all() -> list[dict]:
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=len(SYMBOLS)) as executor:
        futures = {executor.submit(_fetch_one, entry): entry for entry in SYMBOLS}
        for future in as_completed(futures):
            data = future.result()
            if data:
                results[data["symbol"]] = data

    # Keep the declared order regardless of which request finished first, so the
    # ticker's left-to-right sequence stays stable across refreshes.
    return [results[entry["symbol"]] for entry in SYMBOLS if entry["symbol"] in results]


def get_market_ticker() -> list[dict]:
    return cache.get_or_set("market_ticker", TTL_TICKER_SECONDS, _fetch_all)
