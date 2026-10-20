from fastapi import APIRouter, HTTPException, Query, Response

from app.services import editorial

router = APIRouter()


@router.get("/videos")
def videos(response: Response, market: str = Query("kr", pattern="^(kr|us)$")):
    response.headers["Cache-Control"] = "no-store"
    return editorial.get_videos(market)


@router.get("/investors")
def investors(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return editorial.get_investors()


@router.get("/investors/{investor_id}")
def portfolio(investor_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    result = editorial.get_portfolio(investor_id)
    if result is None:
        raise HTTPException(status_code=404, detail="등록된 투자자를 찾을 수 없습니다.")
    return result
