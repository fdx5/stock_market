"""Live price / market cap / day-change for many symbols in one Yahoo call —
v7/finance/quote takes a comma-separated `symbols` list in a single request (confirmed
against 8 mixed KR/US/SR/CN tickers in one call), which is what makes a 20-30s refresh
of the whole TOP 100 page affordable: one or two HTTP round trips instead of 100.

Same crumb auth as company_fundamentals_fetcher (see yahoo_session.py) — unlike the v8
chart endpoint the rest of this app already polls without auth, this one started
requiring it in 2024.
"""

import logging

from app.data import yahoo_session

logger = logging.getLogger(__name__)

QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"

# Comfortably under whatever undocumented URL-length/result-count ceiling Yahoo applies
# — the whole TOP 100 roster fits in two chunks at this size.
_CHUNK_SIZE = 50


def _fetch_chunk(symbols: list[str]) -> dict[str, dict]:
    session, crumb = yahoo_session.get_crumb()
    params = {"symbols": ",".join(symbols), "crumb": crumb}
    resp = session.get(QUOTE_URL, params=params, timeout=10)
    if resp.status_code == 401:
        session, crumb = yahoo_session.get_crumb(force_refresh=True)
        resp = session.get(QUOTE_URL, params={"symbols": ",".join(symbols), "crumb": crumb}, timeout=10)
    resp.raise_for_status()

    results = ((resp.json().get("quoteResponse") or {}).get("result")) or []
    out: dict[str, dict] = {}
    for r in results:
        symbol = r.get("symbol")
        if not symbol:
            continue
        out[symbol] = {
            "price": r.get("regularMarketPrice"),
            "market_cap": r.get("marketCap"),
            "change_pct": r.get("regularMarketChangePercent"),
            "currency": r.get("currency"),
        }
    return out


def fetch_live_quotes(symbols: list[str]) -> dict[str, dict]:
    """Live quotes keyed by symbol. A chunk that fails to fetch is simply omitted —
    callers should fall back to their own last-known price/market cap for those
    symbols rather than losing the whole refresh over one bad chunk."""
    out: dict[str, dict] = {}
    for i in range(0, len(symbols), _CHUNK_SIZE):
        chunk = symbols[i : i + _CHUNK_SIZE]
        try:
            out.update(_fetch_chunk(chunk))
        except Exception:  # noqa: BLE001 - one chunk's failure must not sink the refresh
            logger.warning("global_top100_batch_quote: chunk fetch failed", exc_info=True)
    return out
