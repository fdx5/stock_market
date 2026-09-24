from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services import realestate_map

router = APIRouter()


@router.get("/regions")
def regions(response: Response):
    response.headers["Cache-Control"] = "public, max-age=3600"
    data = realestate_map.regions()
    return {"source": data.get("source"), "sido": data["sido"]}


@router.get("/map")
def realestate_heatmap(
    response: Response,
    sido: str | None = Query(None, pattern=r"^\d{2}$"),
    sgg: str | None = Query(None, pattern=r"^\d{5}$"),
    dong: str | None = Query(None, max_length=40),
    period: str = Query("3m", pattern=r"^(today|7d|3m|6m|1y)$"),
):
    response.headers["Cache-Control"] = "no-store"
    if not sido and not sgg:
        sido = "11"
    try:
        return realestate_map.get_map(sido, sgg, dong or None, period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
