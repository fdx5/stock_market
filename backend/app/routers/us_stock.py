from fastapi import APIRouter, HTTPException, Query

from app.data import naver_news_search_fetcher, price_fetcher, us_company_korean_names
from app.data.us_index_fetcher import get_us_stock_quote
from app.data.us_universe import get_korean_names_ready, get_us_stock_item
from app.services import fight_comment_store
from app.services.cache import cache
from app.services.daily_prices import build_daily_rows
from app.services.indicators import compute_indicators
from app.utils import dataframe_to_records

router = APIRouter()

# Matches stock.py's own /quote poll cadence.
TTL_QUOTE_SECONDS = 5


def _resolve_item(code: str) -> dict:
    item = get_us_stock_item(code)
    if item is None:
        raise HTTPException(status_code=404, detail=f"종목 코드 '{code}'를 찾을 수 없습니다.")
    return item


def _load_history(code: str, years: int = 3):
    try:
        return price_fetcher.get_history(code, years)
    except Exception as exc:  # noqa: BLE001 - surface upstream data errors as 404
        raise HTTPException(status_code=404, detail=f"시세 데이터를 가져올 수 없습니다: {exc}") from exc


@router.get("/{code}/quote")
def quote(code: str):
    """Live-ish close/change/change_pct for a short-interval poll on an already-loaded
    global stock detail view — same role as stock.py's /quote, backed by Yahoo Finance
    with a slickcharts-snapshot fallback (see get_us_stock_quote)."""
    item = _resolve_item(code)
    return cache.get_or_set(
        f"us_stock_quote:{code}", TTL_QUOTE_SECONDS, lambda: get_us_stock_quote(code, item["name"], snapshot=item)
    )


@router.get("/{code}/history")
def history(code: str, years: int = Query(3, ge=1, le=10)):
    item = _resolve_item(code)
    df = _load_history(code, years)
    return {"code": code, "name": item["name"], "points": dataframe_to_records(df)}


@router.get("/{code}/daily")
def daily(code: str, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    """The 일별 시세 table for a US symbol — same shape and paging as stock.py's own
    /daily, off the same shared history frame (Yahoo-backed here rather than Naver)."""
    item = _resolve_item(code)
    df = _load_history(code, years=3)
    return {"code": code, "name": item["name"], **build_daily_rows(df, offset, limit)}


@router.get("/{code}/indicators")
def indicators(code: str, years: int = Query(3, ge=1, le=10)):
    item = _resolve_item(code)
    df = _load_history(code, years)
    indicator_df = compute_indicators(df)
    points = dataframe_to_records(indicator_df)
    latest = points[-1] if points else {}
    return {"code": code, "name": item["name"], "points": points, "latest": latest}


@router.get("/{code}/news")
def news(code: str, limit: int = Query(15, ge=1, le=30)):
    """Korean-language coverage of a US company, from Naver's news search.

    finance.naver's per-code news tab — what stock.py's own /news reads — only exists
    for KRX codes, so this asks Naver for the company by name instead. Which name it
    asks for is the whole difficulty, and us_company_korean_names.news_query decides:
    Korean articles call NVIDIA "엔비디아", and asking for the English name finds a
    thinner, noisier slice of the same day's reporting.
    """
    item = _resolve_item(code)
    name = item["name"]
    query = us_company_korean_names.news_query(code, name, get_korean_names_ready().get(name))
    return {
        "code": code,
        "name": name,
        "query": query,
        "items": naver_news_search_fetcher.get_news(query, limit),
    }


@router.get("/{code}/comments")
def comments(code: str, limit: int = Query(200, ge=1, le=500)):
    _resolve_item(code)
    items = fight_comment_store.list_comments_for_company(code, limit)
    return {"items": items, "count": len(items)}
