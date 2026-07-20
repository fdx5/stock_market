from fastapi import APIRouter, Query

from app.data.universe import search_stocks
from app.data.us_universe import search_us_stocks
from app.schemas import StockSearchResult

router = APIRouter()


@router.get("/search", response_model=list[StockSearchResult])
def search(q: str = Query(..., min_length=1), limit: int = 30):
    # KR results first (this app's primary market) — US results fill the remaining
    # slots up to `limit` rather than getting their own separate budget, so a KR-heavy
    # query still returns a full page instead of `limit` KR + `limit` US.
    kr_results = search_stocks(q, limit=limit)
    remaining = limit - len(kr_results)
    us_results = search_us_stocks(q, limit=remaining) if remaining > 0 else []
    return kr_results + us_results
