from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.data.universe import get_stock_market, search_stocks
from app.data.us_universe import get_us_stock_item, search_us_stocks
from app.schemas import StockSearchResult
from app.services import stock_search_store
from app.services.cache import cache
from app.services.etf_market import search_etfs

router = APIRouter()

# The same rolling window the admin dashboard ranks stocks over, so "popular now"
# means the same thing on both surfaces.
POPULAR_WINDOW = timedelta(hours=24)
# A visitor-facing ranking doesn't need to move on every single view, and this is a
# GROUP BY over the whole retention window — one query per minute, shared by everyone.
TTL_POPULAR_SECONDS = 60


@router.get("/search", response_model=list[StockSearchResult])
def search(q: str = Query(..., min_length=1), limit: int = 30, include_etf: bool = False):
    # ETF matches lead when present so an exact code such as SPY or 069500 cannot be
    # crowded out by a large stock result set. The asset marker lets /stock/:code
    # select the ETF-specific detail case after the user chooses the result.
    etf_results = search_etfs(q, limit=limit) if include_etf else []
    remaining = limit - len(etf_results)
    kr_results = search_stocks(q, limit=remaining) if remaining > 0 else []
    remaining -= len(kr_results)
    us_results = search_us_stocks(q, limit=remaining) if remaining > 0 else []
    return etf_results + kr_results + us_results


def _resolve_market(code: str) -> str:
    """The search log mixes KR codes with US tickers (the /global page records views
    through the same tracker), and the client routes on this field — a US ticker
    labelled KOSPI would send the visitor to a KR detail view that can't resolve it.
    The code shape is the tiebreaker for anything neither universe knows yet: KR
    codes are always six digits, US tickers never are."""
    kr_market = get_stock_market(code)
    if kr_market:
        return kr_market
    if get_us_stock_item(code):
        return "US"
    return "KOSPI" if code.isdigit() and len(code) == 6 else "US"


# One pool, deep enough that filtering it by market still fills a strip.
#
# The ranking is overwhelmingly KR — this is a KR-first site and the log reflects
# that — so a US-only view taken from the top 20 is usually empty. Ranking 200 and
# filtering afterwards is what lets the global page show a US strip at all, and it
# costs nothing extra: the query is the same GROUP BY over the same window, and one
# cached pool now serves every (limit, market) combination the clients ask for
# instead of one cache entry per limit.
POPULAR_POOL = 200


def _load_popular_pool() -> list[dict]:
    since = (datetime.now(timezone.utc) - POPULAR_WINDOW).isoformat()
    return [
        {**row, "market": _resolve_market(row["code"])}
        for row in stock_search_store.top_searches(since, POPULAR_POOL)
    ]


@router.get("/search/popular")
def popular(
    limit: int = Query(8, ge=1, le=20),
    market: str | None = Query(
        None,
        description='Restrict to one side: "US" for US tickers, "KR" for KOSPI/KOSDAQ. '
        "Omitted returns the combined ranking, which is what the KR surfaces want.",
    ),
):
    """Most-viewed stocks across all visitors in the last 24h — the data behind the
    "실시간 인기 종목" strips, from the same table the admin ranking uses."""
    pool = cache.get_or_set("popular_searches:pool", TTL_POPULAR_SECONDS, _load_popular_pool)

    wanted = (market or "").strip().upper()
    if wanted == "US":
        pool = [row for row in pool if row["market"] == "US"]
    elif wanted == "KR":
        pool = [row for row in pool if row["market"] != "US"]

    return {"items": pool[:limit]}
