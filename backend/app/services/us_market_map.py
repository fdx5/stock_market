from app.data.exchange_fetcher import get_usd_krw
from app.data.stock_quote_fetcher import get_stock_quote
from app.data.us_index_fetcher import get_nasdaq100_constituents, get_sp500_constituents, market_session
from app.services.cache import cache


def get_sp500_map(limit: int = 503, fresh: bool = False) -> list[dict]:
    return get_sp500_constituents(fresh=fresh)[:limit]


def get_nasdaq100_map(limit: int = 103, fresh: bool = False) -> list[dict]:
    return get_nasdaq100_constituents(fresh=fresh)[:limit]


# SK Hynix, standing in as a permanent Information Technology tile on both US maps — an
# explicit, always-on request, not a real index membership: it's KRX-listed, not
# NYSE/NASDAQ, so it can never appear in either scrape above on its own. Kept out of
# get_sp500_map/get_nasdaq100_map themselves (see the two wrappers below) rather than
# added there directly, since get_nasdaq100_map also backs stock_board's Nasdaq board —
# a ranked roster of real constituents, which a synthetic tile has no business joining.
SKHYNIX_CODE = "000660"
SKHYNIX_TICKER = "SKHY"
TTL_SKHYNIX_SECONDS = 15

# Its tile is sized by an approximate index weight, since there's no real one to read for
# a non-member — both denominators are just each index's rough aggregate market cap in
# USD, order-of-magnitude figures that move far slower than the tile's own size needs to
# stay believable. Neither number is ever shown; both only ever feed one division.
_SP500_TOTAL_MARKETCAP_USD = 48_000_000_000_000
_NASDAQ100_TOTAL_MARKETCAP_USD = 26_000_000_000_000


def _fetch_skhynix_quote() -> dict | None:
    """SK Hynix's live KRW quote (see stock_quote_fetcher — the same NXT-aware source
    the KOSPI map and the /fight page read), converted to USD with the live retail
    exchange rate. `change_pct` needs no conversion: it's a same-currency ratio, so
    multiplying both sides of it by the same FX rate leaves it unchanged — the same
    fact battle.get_global_top20_cached leans on for its own foreign-currency tickers."""
    quote = get_stock_quote(SKHYNIX_CODE)
    fx = get_usd_krw()
    if not quote or not fx or not fx.get("rate"):
        return None
    rate = fx["rate"]
    return {
        "code": SKHYNIX_TICKER,
        # The flag marks it as the one Korean name sitting in an otherwise all-US map —
        # baked into the name string itself (rather than a separate field) so every
        # surface that already just prints `name` (the tile, its tooltip, the PNG
        # export's canvas redraw) shows it for free, with nothing to update per surface.
        "name": "SK Hynix \U0001f1f0\U0001f1f7",
        "sector": "Information Technology",
        "close": quote["close"] / rate,
        "change": quote["change"] / rate,
        "change_pct": quote["change_pct"],
        "marcap_usd": quote["marcap"] / rate,
        # Naver's quote already folds NXT's pre-/after-hours trading into `close`
        # whenever the regular KRX session isn't open (see stock_quote_fetcher), so
        # there is no separate extended session to badge this tile with — it always
        # reads as the current, up-to-date price, hence "regular" rather than omitted.
        "session": "regular",
        "regular_close": None,
        "regular_change_pct": None,
        "extended_change_pct": None,
    }


def _get_skhynix_quote() -> dict | None:
    return cache.get_or_set("skhynix_us_map_tile", TTL_SKHYNIX_SECONDS, _fetch_skhynix_quote)


def _skhynix_tile(total_marketcap_usd: float) -> dict | None:
    base = _get_skhynix_quote()
    if base is None:
        return None
    marcap_usd = base.pop("marcap_usd")
    return {**base, "marcap": marcap_usd / total_marketcap_usd * 100}


def get_sp500_map_with_skhynix(limit: int = 503, fresh: bool = False) -> list[dict]:
    """get_sp500_map, plus SK Hynix's tile — see the note above. A quote miss (network
    hiccup, Naver/exchange-rate fetch failing) just omits the tile for that request
    rather than failing the whole map; it reappears once the miss clears."""
    items = get_sp500_map(limit, fresh=fresh)
    extra = _skhynix_tile(_SP500_TOTAL_MARKETCAP_USD)
    return items + [extra] if extra else items


def get_nasdaq100_map_with_skhynix(limit: int = 103, fresh: bool = False) -> list[dict]:
    """See get_sp500_map_with_skhynix."""
    items = get_nasdaq100_map(limit, fresh=fresh)
    extra = _skhynix_tile(_NASDAQ100_TOTAL_MARKETCAP_USD)
    return items + [extra] if extra else items


US_SECTOR_PEER_LIMIT = 40


def _find_sector(items: list[dict], ticker: str) -> str | None:
    return next((it["sector"] for it in items if it["code"] == ticker), None)


def get_us_sector_map(code: str, limit: int = US_SECTOR_PEER_LIMIT) -> dict:
    """The S&P 500 sector cohort around one US ticker — what /global draws beside its
    chart column, mirroring what market_map.get_sector_map does for the KR dashboard.

    Built by filtering the cached constituent snapshot rather than by its own fetch:
    that single slickcharts request already carries every name's GICS sector, index
    weight and delayed change, and main.py warms it at startup, so the common case
    costs no upstream request at all and every tile here shows the same number
    /sp500-map would for that stock.

    A ticker outside the S&P 500 (a Nasdaq-100-only name) still resolves its sector
    from the Nasdaq-100 snapshot and still gets the S&P cohort back; it just won't be
    among the tiles — the same bargain get_sector_map makes for a small cap below its
    market's ranked window.
    """
    ticker = code.strip().upper()
    ranked = get_sp500_constituents()

    sector = _find_sector(ranked, ticker)
    if sector is None:
        # Only paid for on a miss, which is the minority of /global entries.
        sector = _find_sector(get_nasdaq100_constituents(), ticker)

    peers = (
        sorted((it for it in ranked if it["sector"] == sector), key=lambda it: it["marcap"], reverse=True)[:limit]
        if sector is not None
        else []
    )

    total_weight = sum(it["marcap"] for it in peers)
    weighted_change = sum(it["change_pct"] * it["marcap"] for it in peers)

    return {
        "code": ticker,
        "index": "S&P500",
        "sector": sector,
        "session": market_session(peers),
        "avg_change_pct": weighted_change / total_weight if total_weight > 0 else 0.0,
        "count": len(peers),
        "items": peers,
    }
