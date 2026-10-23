from typing import Literal

from fastapi import APIRouter, HTTPException

from app.services import treasury_market

router = APIRouter()


@router.get("/treasuries")
def treasury_snapshot():
    return treasury_market.snapshot()


@router.get("/treasuries/{tenor}/history")
def treasury_history(tenor: Literal["2", "5", "10"]):
    try:
        return treasury_market.history(tenor)
    except Exception:
        raise HTTPException(status_code=503, detail="국채 금리 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")
