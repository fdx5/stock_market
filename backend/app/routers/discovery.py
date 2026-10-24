"""Bounded public research routes; no owner credentials or destructive operations."""
import datetime as dt
from fastapi import APIRouter, HTTPException, Query
from app.services import discovery_sources as sources

router = APIRouter()


def call(function, *args):
    try:
        return function(*args)
    except Exception:
        # Never expose upstream sessions, vendor cookies, or tokens in errors.
        raise HTTPException(502, "공개 원천이 잠시 응답하지 않습니다. 다시 시도하거나 원문·로컬 자료를 이용하세요.") from None


@router.get("/asset/{code}")
def asset(code: str, market: str = Query("kospi", pattern="^(kospi|kosdaq|nasdaq)$"), period: str = Query("1y", pattern="^(6mo|1y|2y|5y)$")):
    if not __import__("re").fullmatch(r"[A-Za-z0-9.\-]{1,16}", code):
        raise HTTPException(422, "종목 코드를 확인하세요.")
    return call(sources.asset, code.upper(), market, period)


@router.get("/finance/{code}")
def finance(code: str, period: str = Query("annual", pattern="^(annual|quarter)$")):
    if not __import__("re").fullmatch(r"[A-Za-z0-9.\-]{1,16}", code):
        raise HTTPException(422, "종목 코드를 확인하세요.")
    return call(sources.finance, code.upper(), period)


@router.get("/fund/{code}")
def fund(code: str, region: str = Query("KR", pattern="^(KR|US)$")):
    if not __import__("re").fullmatch(r"[A-Za-z0-9.\-]{1,16}", code):
        raise HTTPException(422, "ETF 코드를 확인하세요.")
    return call(sources.fund, code.upper(), region)


@router.get("/profile/{code}")
def profile(code: str):
    if not __import__("re").fullmatch(r"[A-Za-z0-9.\-]{1,16}", code):
        raise HTTPException(422, "종목 코드를 확인하세요.")
    return call(sources.profile, code.upper())


@router.get("/curve")
def curve():
    return call(sources.curve)


@router.get("/macro")
def macro(indicator: str = Query("growth", pattern="^(gdp|growth|inflation|unemployment)$")):
    return call(sources.macro, indicator)


@router.get("/crypto")
def crypto():
    return call(sources.crypto)


@router.get("/orderbook")
def orderbook(market: str = Query("KRW-BTC", pattern="^KRW-[A-Z0-9]{1,12}$")):
    return call(sources.orderbook, market)


@router.get("/derivatives")
def derivatives(code: str = Query("BTCUSDT", pattern="^(BTCUSDT|ETHUSDT|SOLUSDT)$")):
    return call(sources.derivatives, code)


@router.get("/calendar")
def calendar():
    return call(sources.calendar)


@router.get("/sessions")
def sessions(start: str | None = Query(None, pattern="^20[0-9]{2}-[0-9]{2}-[0-9]{2}$")):
    if start:
        try:
            date = dt.date.fromisoformat(start)
            if not 2020 <= date.year <= dt.date.today().year + 2:
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "조회 날짜를 확인하세요.") from None
    return call(sources.sessions, start)


@router.get("/snapshots")
def snapshots(market: str = Query("kospi", pattern="^(kospi|kosdaq|nasdaq)$")):
    return call(sources.snapshots, market)


@router.post("/snapshots")
def record_snapshot(market: str = Query("kospi", pattern="^(kospi|kosdaq|nasdaq)$")):
    return call(sources.append_snapshot, market)
