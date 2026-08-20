import datetime as dt

from fastapi import APIRouter, HTTPException, Query
from app.services import market_brief, market_brief_store

router = APIRouter()


@router.get("")
def history(limit: int = Query(120, ge=1, le=500)):
    return {"items": market_brief_store.dates(limit)}


@router.get("/latest/{market}")
def latest(market: str):
    target = market_brief.normalize_target(market)
    item = market_brief_store.latest(target)
    if not item or item.get("version", 1) < market_brief.REPORT_VERSION:
        try:
            item = market_brief.generate(target)
        except Exception:
            pass
    if not item:
        raise HTTPException(404, "오늘 브리핑이 없습니다.")
    return item


@router.get("/{day}/{market}")
def detail(day: str, market: str):
    target = market_brief.normalize_target(market)
    item = market_brief_store.get(day, target)
    # generate() always builds TODAY's trading-day report, regardless of what `day`
    # was requested - falling back to it for a missing/stale *historical* day silently
    # served today's (or a stale cached) report mislabeled as the requested date. Only
    # auto-heal when the requested day actually is today; any other missing day is a
    # real 404, not something generate() can produce.
    today = dt.datetime.now(market_brief.KST).date().isoformat()
    if (not item or item.get("version", 1) < market_brief.REPORT_VERSION) and day == today:
        try:
            item = market_brief.generate(target)
        except Exception:
            pass
    if not item:
        raise HTTPException(404, "오늘 브리핑이 없습니다.")
    return item

