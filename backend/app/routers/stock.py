import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.data import board_fetcher, company_overview_fetcher, news_fetcher, orderbook_fetcher, price_fetcher
from app.data.stock_quote_fetcher import get_stock_quote
from app.data.universe import get_stock_name
from app.services.cache import cache
from app.services.indicators import compute_indicators
from app.services.predictor import predict_next_day
from app.utils import dataframe_to_records

router = APIRouter()

# Matches the cadence the battle page already polls Samsung/SK Hynix quotes at.
TTL_QUOTE_SECONDS = 5
# The underlying Naver page is itself 20-minutes delayed, so there's no benefit to
# polling our own cache faster than this - it just re-fetches the same ladder.
TTL_ORDERBOOK_SECONDS = 15


def _resolve_name(code: str) -> str:
    name = get_stock_name(code)
    if name is None:
        raise HTTPException(status_code=404, detail=f"종목 코드 '{code}'를 찾을 수 없습니다.")
    return name


def _load_history(code: str, years: int = 3) -> pd.DataFrame:
    try:
        return price_fetcher.get_history(code, years)
    except Exception as exc:  # noqa: BLE001 - surface upstream data errors as 404
        raise HTTPException(status_code=404, detail=f"시세 데이터를 가져올 수 없습니다: {exc}") from exc


@router.get("/{code}/summary")
def summary(code: str):
    name = _resolve_name(code)
    # years=3 so this shares price_fetcher's cache key with /indicators (which the
    # dashboard always requests in the same breath) instead of each cold-starting its
    # own separate history fetch for the same code - only the last two rows are used
    # here regardless of how many years came back.
    df = _load_history(code, years=3)

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    change = float(last["close"] - prev["close"])
    change_pct = round((change / prev["close"] * 100) if prev["close"] else 0.0, 2)

    return {
        "code": code,
        "name": name,
        "date": last["date"],
        "close": float(last["close"]),
        "change": round(change, 2),
        "change_pct": change_pct,
        "volume": int(last["volume"]),
    }


@router.get("/{code}/quote")
def quote(code: str):
    """Live close/change/change_pct, refreshed far more often than /summary (which is
    built from the daily OHLCV history and only moves once that history's 6h cache
    rolls over) — meant for a short-interval poll on an already-loaded detail view."""
    _resolve_name(code)
    data = cache.get_or_set(f"stock_quote:{code}", TTL_QUOTE_SECONDS, lambda: get_stock_quote(code))
    if not data:
        raise HTTPException(status_code=502, detail="시세 데이터를 가져오지 못했습니다.")
    return data


@router.get("/{code}/orderbook")
def orderbook(code: str):
    """10-level bid/ask depth (호가), 20-minutes delayed per Naver's free feed."""
    _resolve_name(code)
    data = cache.get_or_set(f"stock_orderbook:{code}", TTL_ORDERBOOK_SECONDS, lambda: orderbook_fetcher.get_orderbook(code))
    if not data:
        raise HTTPException(status_code=502, detail="호가 데이터를 가져오지 못했습니다.")
    return data


@router.get("/{code}/history")
def history(code: str, years: int = 3):
    name = _resolve_name(code)
    df = _load_history(code, years)
    return {"code": code, "name": name, "points": dataframe_to_records(df)}


@router.get("/{code}/indicators")
def indicators(code: str, years: int = 3):
    name = _resolve_name(code)
    df = _load_history(code, years)
    indicator_df = compute_indicators(df)
    points = dataframe_to_records(indicator_df)
    latest = points[-1] if points else {}
    return {"code": code, "name": name, "points": points, "latest": latest}


@router.get("/{code}/predict")
def predict(code: str):
    name = _resolve_name(code)
    df = _load_history(code, years=3)
    indicator_df = compute_indicators(df)
    try:
        result = predict_next_day(indicator_df)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result["code"] = code
    result["name"] = name
    return result


@router.get("/{code}/overview")
def overview(code: str):
    name = _resolve_name(code)
    info = company_overview_fetcher.get_company_info(code)
    return {"code": code, "name": name, **info}


@router.get("/{code}/news")
def news(code: str):
    name = _resolve_name(code)
    items = news_fetcher.get_news(code)
    return {"code": code, "name": name, "items": items}


@router.get("/{code}/board")
def board(code: str, page: int = 1, fresh: bool = Query(False)):
    name = _resolve_name(code)
    posts = board_fetcher.get_board_posts(code, page, fresh=fresh)
    return {"code": code, "name": name, "page": page, "items": posts}


@router.get("/{code}/board/{nid}")
def board_detail(code: str, nid: str):
    _resolve_name(code)
    detail = board_fetcher.get_board_detail(nid)
    if detail is None:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    return detail


@router.get("/{code}/board/{nid}/comments")
def board_comments(code: str, nid: str):
    _resolve_name(code)
    comments = board_fetcher.get_board_comments(nid)
    return {"nid": nid, "items": comments, "count": len(comments)}
