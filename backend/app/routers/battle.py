from fastapi import APIRouter, HTTPException

from app.services.battle import get_battle

router = APIRouter()


@router.get("/status")
def battle_status():
    data = get_battle()
    if not data["samsung"] or not data["skhynix"]:
        raise HTTPException(status_code=502, detail="시가총액 데이터를 가져오지 못했습니다.")
    return data
