from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services import realestate_facts, realestate_map, realestate_summary

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
    top: int | None = Query(None, ge=1, le=1000),
):
    """`top` sizes a 시·도 map (a phone asks for 100); every 시·군·구 still keeps its 10."""
    response.headers["Cache-Control"] = "no-store"
    if not sido and not sgg:
        sido = "11"
    try:
        return realestate_map.get_map(sido, sgg, dong or None, period, top)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/complex")
def realestate_complex(
    response: Response,
    id: str = Query(..., min_length=7, max_length=200),
    period: str = Query("3m", pattern=r"^(today|7d|3m|6m|1y)$"),
):
    """Every 평형 of one complex, for the popup's 평형 selector."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_map.complex_detail(id, period)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="단지를 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/facts")
def realestate_complex_facts(response: Response, id: str = Query(..., min_length=7, max_length=200)):
    """세대수 and 주차대수 of one complex, from 공동주택관리정보 (K-apt)."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_facts.complex_facts(id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="단지를 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/summary")
def realestate_region_summary(
    response: Response,
    level: str = Query(..., pattern=r"^(sido|sgg|dong)$"),
    sido: str | None = Query(None, pattern=r"^\d{2}$"),
    sgg: str | None = Query(None, pattern=r"^\d{5}$"),
    period: str = Query("3m", pattern=r"^(today|7d|3m|6m|1y)$"),
):
    """How every region of one level moved — the 3D region map's colours."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_summary.region_summary(level, period, sido=sido, sgg=sgg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
