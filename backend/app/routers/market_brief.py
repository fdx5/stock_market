from fastapi import APIRouter,HTTPException,Query
from app.services import market_brief,market_brief_store
router=APIRouter()
@router.get("")
def history(limit:int=Query(120,ge=1,le=500)):return {"items":market_brief_store.dates(limit)}
@router.get("/latest/{market}")
def latest(market:str):
    item=market_brief_store.latest(market.upper())
    if not item:
        try:item=market_brief.generate(market)
        except Exception:pass
    if not item:raise HTTPException(404,"리포트가 없습니다.")
    return item
@router.get("/{day}/{market}")
def detail(day:str,market:str):
    item=market_brief_store.get(day,market.upper())
    if not item:raise HTTPException(404,"리포트가 없습니다.")
    return item
