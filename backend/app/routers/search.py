from fastapi import APIRouter, Query

from app.data.universe import search_stocks
from app.schemas import StockSearchResult

router = APIRouter()


@router.get("/search", response_model=list[StockSearchResult])
def search(q: str = Query(..., min_length=1), limit: int = 10):
    return search_stocks(q, limit=limit)
