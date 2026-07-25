from app.data.us_index_fetcher import get_nasdaq100_constituents, get_sp500_constituents


def get_sp500_map(limit: int = 503, fresh: bool = False) -> list[dict]:
    return get_sp500_constituents(fresh=fresh)[:limit]


def get_nasdaq100_map(limit: int = 103, fresh: bool = False) -> list[dict]:
    return get_nasdaq100_constituents(fresh=fresh)[:limit]


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
        "avg_change_pct": weighted_change / total_weight if total_weight > 0 else 0.0,
        "count": len(peers),
        "items": peers,
    }
