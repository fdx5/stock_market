from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query

from app.data import index_fetcher, investor_fetcher
from app.data.universe import get_stock_name
from app.services.investor_summary import get_investor_summary, get_weekly_foreign_top

router = APIRouter()
_index_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="overview-index")


@router.get("/indices")
def indices(fresh: bool = Query(False)):
    # Four independent upstream reads run together, rather than adding four
    # request timeouts. Each source cache still deduplicates concurrent visitors.
    pending = {
        "kospi": _index_pool.submit(index_fetcher.get_index, "KOSPI", fresh=fresh),
        "kosdaq": _index_pool.submit(index_fetcher.get_index, "KOSDAQ", fresh=fresh),
        "kospi_investor": _index_pool.submit(index_fetcher.get_market_investor_summary, "KOSPI", fresh=fresh),
        "kosdaq_investor": _index_pool.submit(index_fetcher.get_market_investor_summary, "KOSDAQ", fresh=fresh),
    }
    return {key: future.result() for key, future in pending.items()}


@router.get("/summary")
def summary():
    return {"items": get_investor_summary()}


@router.get("/weekly-foreign-top")
def weekly_foreign_top():
    return get_weekly_foreign_top()


@router.get("/{code}")
def trend(code: str, days: int = 20):
    name = get_stock_name(code)
    if name is None:
        raise HTTPException(status_code=404, detail=f"종목 코드 '{code}'를 찾을 수 없습니다.")

    records = investor_fetcher.get_investor_trend(code, days)
    return {"code": code, "name": name, "records": records}
