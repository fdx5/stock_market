from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services import realestate_facts, realestate_map, realestate_rent, realestate_summary

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
    if not sido and not sgg:
        sido = "11"
    try:
        # Already JSON: a 시·도 map is kept serialised, and re-encoding it here cost
        # more than reading it.
        body = realestate_map.get_map(sido, sgg, dong or None, period, top)
        return Response(content=body, media_type="application/json", headers={"Cache-Control": "no-store"})
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


@router.get("/explore")
def realestate_explore(
    sido: str = Query("11", pattern=r"^\d{2}$"),
    sgg: str | None = Query(None, pattern=r"^\d{5}$"),
    dong: str | None = Query(None, max_length=40),
    period: str = Query("3m", pattern=r"^(3m|6m|1y)$"),
    q: str = Query("", max_length=80),
    price_min: float | None = Query(None, ge=0),
    price_max: float | None = Query(None, ge=0),
    area_min: float | None = Query(None, ge=0),
    area_max: float | None = Query(None, ge=0),
    built_min: int | None = Query(None, ge=1900, le=2100),
    min_trades: int = Query(0, ge=0, le=10000),
    recent_days: int | None = Query(None, ge=1, le=3650),
    sort: str = Query("price_desc", pattern=r"^(price_desc|price_asc|change_desc|trades_desc|date_desc|name)$"),
    offset: int = Query(0, ge=0, le=100000),
    limit: int = Query(100, ge=1, le=200),
):
    """Filter all collected complexes in the region before sorting and pagination."""
    if price_min is not None and price_max is not None and price_min > price_max:
        raise HTTPException(400, "최소 가격은 최대 가격보다 클 수 없습니다.")
    if area_min is not None and area_max is not None and area_min > area_max:
        raise HTTPException(400, "최소 면적은 최대 면적보다 클 수 없습니다.")
    if sgg and sgg not in {g["code"] for s in realestate_map.regions()["sido"] if s["code"] == sido for g in s["sgg"]}:
        raise HTTPException(400, "선택한 시·도에 속하는 지역을 선택해 주세요.")
    try:
        body = realestate_map.explore(sido, sgg, dong, period, filters={
            "q": q, "price_min": price_min, "price_max": price_max,
            "area_min": area_min, "area_max": area_max, "built_min": built_min,
            "min_trades": min_trades, "recent_days": recent_days, "sort": sort,
            "offset": offset, "limit": limit,
        })
        return Response(content=body, media_type="application/json", headers={"Cache-Control": "no-store"})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


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


@router.get("/rent")
def realestate_complex_rent(response: Response, id: str = Query(..., min_length=7, max_length=200)):
    """전세·월세 of one complex, for the card's lease views."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_rent.complex_rent(id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="단지를 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

