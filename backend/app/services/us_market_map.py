from app.data import yahoo_bulk_quote
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
#
# Reads its quote from Yahoo (SKHY, the actual US-listed ADR) rather than the KRX
# common shares (000660) a first pass used — the request was explicit that the change
# shown here should be the ADR's own, the same live/extended-hours source every real
# tile on this map already reads (yahoo_bulk_quote), not a KRW price converted after
# the fact. One name is a one-symbol call to the same batched endpoint the whole
# roster's overlay already makes; no separate fetcher needed.
SKHYNIX_TICKER = "SKHY"
TTL_SKHYNIX_SECONDS = 15

# The tile's area is driven by this alone (an explicit request: "시가총액만 반영해서
# 면적을 그려줘") — Yahoo's own marketCap field for the ADR, divided by each index's
# rough aggregate market cap to land in the same "percent of the index" units real
# constituents' weights are already in. There's no true index weight for a non-member,
# so the denominator is an order-of-magnitude estimate; the numerator (what actually
# varies day to day) is real. Neither number is ever shown, both only ever feed one
# division.
_SP500_TOTAL_MARKETCAP_USD = 48_000_000_000_000
_NASDAQ100_TOTAL_MARKETCAP_USD = 26_000_000_000_000


def _fetch_skhynix_quote() -> dict | None:
    quote = yahoo_bulk_quote.get_quotes([SKHYNIX_TICKER]).get(SKHYNIX_TICKER)
    if not quote or not quote.get("market_cap"):
        return None
    return {
        **quote,
        "code": SKHYNIX_TICKER,
        # Plain text — the flag marking this as the one Korean name on the map is drawn
        # as an actual /img/flag/kr.svg image on the frontend instead (see
        # MarketMapPage.tsx's tileLabel/SKHY handling), not baked in here as an emoji.
        # A flag emoji depends on the viewer's OS shipping colour flag glyphs at all;
        # Windows' own fonts mostly don't, so it was rendering as bare "KR" letters
        # there rather than a flag.
        "name": "SK Hynix",
        "sector": "Information Technology",
    }


def _get_skhynix_quote() -> dict | None:
    return cache.get_or_set("skhynix_us_map_tile", TTL_SKHYNIX_SECONDS, _fetch_skhynix_quote)


def _skhynix_tile(total_marketcap_usd: float) -> dict | None:
    # `_get_skhynix_quote` is cached and returns the SAME dict object on every hit
    # within its TTL — mutating it (e.g. `.pop`) here would corrupt that shared cache
    # entry for every caller after the first, which is exactly what an earlier version
    # of this function did (a `.pop("marcap_usd")` that worked once per TTL window and
    # KeyError'd on every call after, taking down both map endpoints with a 500). This
    # builds a fresh dict instead and never touches the cached one.
    base = _get_skhynix_quote()
    if base is None:
        return None
    tile = {k: v for k, v in base.items() if k != "market_cap"}
    tile["marcap"] = base["market_cap"] / total_marketcap_usd * 100
    return tile


def get_sp500_map_with_skhynix(limit: int = 503, fresh: bool = False) -> list[dict]:
    """get_sp500_map, plus SK Hynix's tile — see the note above. A quote miss (Yahoo
    not answering for SKHY, or a crumb handshake failure) just omits the tile for that
    request rather than failing the whole map; it reappears once the miss clears."""
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

    SKHY gets the same standing membership here it has on the two full maps (see
    _skhynix_tile above): neither `ranked` nor the Nasdaq-100 snapshot will ever
    resolve its sector on their own (it's KRX-listed, not a real constituent of
    either), so it's recognized as Information Technology directly — both so its
    own /global page gets a proper cohort (itself included) instead of an empty
    one, and so every OTHER Information Technology stock's cohort gains it as a
    peer, same as the request asked for.
    """
    ticker = code.strip().upper()
    ranked = get_sp500_constituents()

    sector = _find_sector(ranked, ticker)
    if sector is None:
        # Only paid for on a miss, which is the minority of /global entries.
        sector = _find_sector(get_nasdaq100_constituents(), ticker)
    if sector is None and ticker == SKHYNIX_TICKER:
        sector = "Information Technology"

    peers = (
        sorted((it for it in ranked if it["sector"] == sector), key=lambda it: it["marcap"], reverse=True)[:limit]
        if sector is not None
        else []
    )
    if sector == "Information Technology":
        extra = _skhynix_tile(_SP500_TOTAL_MARKETCAP_USD)
        if extra:
            peers = peers + [extra]

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
