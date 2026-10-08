"""Live price / market cap / day-change for many symbols in one Yahoo call —
v7/finance/quote takes a comma-separated `symbols` list in a single request (confirmed
against 8 mixed KR/US/SR/CN tickers in one call), which is what makes a 20-30s refresh
of the whole TOP 100 page affordable: one or two HTTP round trips instead of 100.

Same crumb auth as company_fundamentals_fetcher (see yahoo_session.py) — unlike the v8
chart endpoint the rest of this app already polls without auth, this one started
requiring it in 2024.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor

import requests

from app.data import yahoo_session
from app.data.yahoo_batch_transport import fetch_rows

logger = logging.getLogger(__name__)

QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
# Few enough to stay polite to a per-symbol endpoint; 100 symbols take a few seconds.
_CHART_WORKERS = 8

# Comfortably under whatever undocumented URL-length/result-count ceiling Yahoo applies
# — the whole TOP 100 roster fits in two chunks at this size.
_CHUNK_SIZE = 50


def _fetch_chunk(symbols: list[str]) -> dict[str, dict]:
    results = fetch_rows(symbols)
    out: dict[str, dict] = {}
    for r in results:
        symbol = r.get("symbol")
        if not isinstance(symbol, str) or symbol not in symbols:
            continue
        price = _finite_number(r.get("regularMarketPrice"))
        if price is None or price <= 0:
            continue  # A malformed symbol must not discard the other quotes.
        change = _finite_number(r.get("regularMarketChangePercent"))
        market_cap = _finite_number(r.get("marketCap"))
        out[symbol] = {
            "price": price,
            "market_cap": market_cap,
            "change_pct": change,
            "currency": r.get("currency"),
        }
    return out


def _finite_number(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def fetch_live_quotes(symbols: list[str]) -> dict[str, dict]:
    """Live quotes keyed by symbol. A chunk that fails to fetch is simply omitted —
    callers should fall back to their own last-known price/market cap for those
    symbols rather than losing the whole refresh over one bad chunk."""
    out: dict[str, dict] = {}
    # While yahoo_session is cooling down after a refused handshake no chunk can be
    # asked for; the page keeps its last-known prices, and yahoo_session has already
    # logged the one fact worth logging. This module was left out when yahoo_bulk_quote
    # learned the same, and went on writing a traceback for every chunk of every
    # 20-30s refresh.
    if yahoo_session.cooling_down():
        return out
    symbols = list(dict.fromkeys(symbol for symbol in symbols if symbol))
    for i in range(0, len(symbols), _CHUNK_SIZE):
        chunk = symbols[i : i + _CHUNK_SIZE]
        try:
            out.update(_fetch_chunk(chunk))
        except yahoo_session.CrumbUnavailable:
            # Every remaining chunk would get the same answer without a request.
            break
        except Exception as error:  # noqa: BLE001 - unexpected failure isolated to one chunk
            logger.warning("global_top100_batch_quote: unexpected chunk error (%s), preserving prior quotes", type(error).__name__)
    return out


def _chart_quote(symbol: str) -> dict | None:
    """One symbol off the v8 chart endpoint, which needs no crumb — the same endpoint
    global_returns_fetcher already reads every symbol's history from, and which keeps
    answering on the server while getcrumb is refused. Its meta carries the regular
    price, the day's change and the listing currency, the three fields the page's
    live layer needs."""
    try:
        resp = requests.get(
            CHART_URL.format(symbol=symbol),
            params={"interval": "1d", "range": "1d"},
            headers=yahoo_session.HEADERS,
            timeout=6,
        )
        resp.raise_for_status()
        meta = (resp.json()["chart"]["result"] or [{}])[0].get("meta") or {}
    except Exception:  # noqa: BLE001 - one symbol's miss costs that symbol only
        return None
    if not isinstance(meta, dict):
        return None
    price = _finite_number(meta.get("regularMarketPrice"))
    if price is None or price <= 0:
        return None
    change_pct = _finite_number(meta.get("regularMarketChangePercent"))
    if change_pct is None:
        previous = _finite_number(meta.get("previousClose") or meta.get("chartPreviousClose"))
        change_pct = (price / previous - 1) * 100 if previous and previous > 0 else None
    return {
        "price": float(price),
        "market_cap": None,
        "change_pct": None if change_pct is None else round(float(change_pct), 4),
        "currency": meta.get("currency"),
    }


def fetch_chart_quotes(symbols: list[str]) -> dict[str, dict]:
    """The crumbless path for many symbols: one v8 chart call each, over a small pool.
    A symbol that fails is simply absent."""
    out: dict[str, dict] = {}
    if not symbols:
        return out
    with ThreadPoolExecutor(max_workers=min(_CHART_WORKERS, len(symbols))) as pool:
        for symbol, quote in zip(symbols, pool.map(_chart_quote, symbols)):
            if quote:
                out[symbol] = quote
    return out
