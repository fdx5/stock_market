from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from app.data import yahoo_quote
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
    {"symbol": "CL=F", "label": "WTI Crude"},
    {"symbol": "KRW=X", "label": "USD/KRW"},
    {"symbol": "^GSPC", "label": "S&P 500"},
    {"symbol": "^NDX", "label": "Nasdaq 100"},
    {"symbol": "NVDA", "label": "NVIDIA"},
    # SK Hynix's US ADR migrated off "SKHYV" on 2026-07-10 — that symbol's Yahoo
    # quote froze at its last trade instead of erroring, so the ticker card kept
    # rendering with a stale price/flat 0.00% and an empty chart instead of failing
    # loudly. "SKHY" is the actively-quoted successor.
    {"symbol": "SKHY", "label": "SK Hynix"},
    {"symbol": "MU", "label": "Micron Technology"},
    {"symbol": "AVGO", "label": "Broadcom"},
    {"symbol": "INTC", "label": "Intel"},
    {"symbol": "AMD", "label": "AMD"},
    {"symbol": "AAPL", "label": "Apple"},
    {"symbol": "GOOGL", "label": "Alphabet (Google)"},
    {"symbol": "MSFT", "label": "Microsoft"},
    {"symbol": "META", "label": "Meta"},
    {"symbol": "TSLA", "label": "Tesla"},
    {"symbol": "SPCX", "label": "SpaceX"},
    {"symbol": "BTC-USD", "label": "Bitcoin"},
    {"symbol": "ETH-USD", "label": "Ethereum"},
    {"symbol": "XRP-USD", "label": "Ripple"},
    {"symbol": "GC=F", "label": "Gold"},
    {"symbol": "SI=F", "label": "Silver"},
]


# A sparkline needs a shape, not just a couple of dots. Early in a pre-market
# session "1d" holds only the handful of bars printed since 04:00 ET, so anything
# under this count gets refetched over a wider window.
MIN_SPARKLINE_POINTS = 12


def _fetch_closes(symbol: str, range_: str) -> list[float]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {"interval": "15m", "range": range_, **yahoo_quote.BASE_PARAMS}
    resp = requests.get(url, headers=HEADERS, params=params, timeout=4)
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
    return [round(float(c), 4) for c in closes if c is not None]


def _fetch_one(entry: dict) -> dict | None:
    symbol = entry["symbol"]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    try:
        params = {"interval": "15m", "range": "1d", **yahoo_quote.BASE_PARAMS}
        resp = requests.get(url, headers=HEADERS, params=params, timeout=4)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        meta = result["meta"]
        # Extended hours included: the US equities on this belt (NVDA, AAPL, TSLA, ...)
        # otherwise froze at the previous close for the whole Korean evening. The
        # FX/futures/crypto entries are unaffected — they have no pre/post session, so
        # extract_quote returns them on the regular path.
        quote = yahoo_quote.extract_quote(result)
        if quote is None:
            return None
        price, prev_close = quote["price"], quote["previous_close"]

        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
        points = [round(float(c), 4) for c in closes if c is not None]

        # Two cases land here. Futures (GC=F, SI=F, CL=F, ...) report an empty "1d"
        # series whenever today's session hasn't traded yet (e.g. the weekend gap
        # before Globex reopens) — unlike equities/FX, Yahoo doesn't fall back to the
        # last completed session for them. And a US equity a few minutes into
        # pre-market has only those few minutes in "1d". Either way, widen the window
        # so the card gets a real trend line instead of a stub.
        if len(points) < MIN_SPARKLINE_POINTS:
            try:
                points = _fetch_closes(symbol, "5d")[-96:]
            except Exception:
                pass

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
            "session": quote["session"],
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
