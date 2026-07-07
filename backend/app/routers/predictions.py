from fastapi import APIRouter, HTTPException

from app.data.universe import get_stock_name
from app.services import market_predictions

router = APIRouter()


@router.get("/top100")
def top100():
    return {
        "date": market_predictions.today_kst(),
        "items": market_predictions.get_today_top100_predictions(),
    }


@router.get("/history/{code}")
def history(code: str):
    name = get_stock_name(code)
    if name is None:
        raise HTTPException(status_code=404, detail=f"종목 코드 '{code}'를 찾을 수 없습니다.")

    records = market_predictions.get_prediction_history(code)
    return {"code": code, "name": name, "records": records}
