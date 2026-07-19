from app.data.us_index_fetcher import get_nasdaq100_constituents, get_sp500_constituents


def get_sp500_map(limit: int = 503, fresh: bool = False) -> list[dict]:
    return get_sp500_constituents(fresh=fresh)[:limit]


def get_nasdaq100_map(limit: int = 103, fresh: bool = False) -> list[dict]:
    return get_nasdaq100_constituents(fresh=fresh)[:limit]
