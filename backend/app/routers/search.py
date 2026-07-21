from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.data.universe import get_stock_market, search_stocks
from app.data.us_universe import get_us_stock_item, search_us_stocks
from app.schemas import StockSearchResult
from app.services import stock_search_store
from app.services.cache import cache

router = APIRouter()

# The same rolling window the admin dashboard ranks stocks over, so "popular now"
# means the same thing on both surfaces.
POPULAR_WINDOW = timedelta(hours=24)
# A visitor-facing ranking doesn't need to move on every single view, and this is a
# GROUP BY over the whole retention window — one query per minute, shared by everyone.
TTL_POPULAR_SECONDS = 60


@router.get("/search", response_model=list[StockSearchResult])
def search(q: str = Query(..., min_length=1), limit: int = 30):
    # KR results first (this app's primary market) — US results fill the remaining
    # slots up to `limit` rather than getting their own separate budget, so a KR-heavy
    # query still returns a full page instead of `limit` KR + `limit` US.
    kr_results = search_stocks(q, limit=limit)
    remaining = limit - len(kr_results)
    us_results = search_us_stocks(q, limit=remaining) if remaining > 0 else []
    return kr_results + us_results


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


def _load_popular(limit: int) -> list[dict]:
    since = (datetime.now(timezone.utc) - POPULAR_WINDOW).isoformat()
    return [
        {**row, "market": _resolve_market(row["code"])}
        for row in stock_search_store.top_searches(since, limit)
    ]


@router.get("/search/popular")
def popular(limit: int = Query(8, ge=1, le=20)):
    """Most-viewed stocks across all visitors in the last 24h — the data behind the
    dashboard's "실시간 인기 종목" strip, from the same table the admin ranking uses."""
    items = cache.get_or_set(f"popular_searches:{limit}", TTL_POPULAR_SECONDS, lambda: _load_popular(limit))
    return {"items": items}
