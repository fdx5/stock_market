from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response

from app.services import realestate_buildings, realestate_facts, realestate_map, realestate_nearby, realestate_rent, realestate_summary, realestate_water

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
    crown_mode: str = Query("price", pattern=r"^(leader|price)$"),
    include_leaders: bool = Query(False),
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
            "crown_mode": crown_mode, "include_leaders": include_leaders,
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


@router.get("/buildings")
def realestate_complex_buildings(response: Response, id: str = Query(..., min_length=7, max_length=200),
                                 peek: bool = False):
    """Footprints and heights of one complex's buildings, for the 3D viewer. `peek`
    returns at once: kept shapes, or the address for the browser to ask VWorld."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_buildings.complex_buildings(id, peek=peek)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="단지를 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/water")
def realestate_water_areas(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                           r: float = Query(700, ge=100, le=1500)):
    """Open water round a point (OpenStreetMap lakes, ponds and river areas), for the 3D
    viewer: rings in metres about the point, clipped to the square of `r`."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    return realestate_water.water(lat, lon, r)


@router.get("/crossings")
def realestate_crossings(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                         r: float = Query(700, ge=100, le=1500)):
    """Mapped crosswalks and traffic signals round a point (OpenStreetMap), for the 3D viewer's
    junctions: lines and points in metres about the point."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    return realestate_water.crossings(lat, lon, r)


@router.post("/nearby")
def realestate_nearby_complexes(response: Response, body: dict = Body(...)):
    """The complexes on the parcels a browser found round one complex (the 3D view's
    주변 단지 selector): {id, parcels: [{pnu, addr, buildings: [{x, y, name, dong, floors}]}]}."""
    response.headers["Cache-Control"] = "no-store"
    complex_id, parcels = body.get("id"), body.get("parcels")
    if not isinstance(complex_id, str) or not 7 <= len(complex_id) <= 200 or not isinstance(parcels, list):
        raise HTTPException(status_code=400, detail="id와 parcels가 필요합니다.")
    try:
        return realestate_nearby.nearby(complex_id, [p for p in parcels if isinstance(p, dict)])
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



# ---- 3D 단지뷰 배송 게임: scores (drive_score_store) ----

_PLAYER_ID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


@router.post("/drive/scores")
def post_drive_score(payload: dict = Body(...)):
    """A finished drive: the player's anonymous id, nickname and the gold earned in it."""
    from app.services import drive_score_store
    import re

    pid = str(payload.get("player_id") or "")
    if not re.match(_PLAYER_ID, pid):
        raise HTTPException(status_code=400, detail="bad player_id")
    name = " ".join(str(payload.get("name") or "").split())[:16] or "익명"
    try:
        score = int(payload.get("score") or 0)
        deliveries = int(payload.get("deliveries") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="bad score")
    # (a drive's gold: a few hundred a delivery at most; anything past this is not from the game)
    if score < 0 or score > 20000 or deliveries < 0 or deliveries > 200:
        raise HTTPException(status_code=400, detail="score out of range")
    vehicle = payload.get("vehicle") if payload.get("vehicle") in ("coupang", "cyber") else "coupang"
    drive_score_store.add_score(pid, name, score, deliveries, vehicle)
    return drive_score_store.leaderboard(50, pid)


@router.get("/drive/scores")
def get_drive_scores(limit: int = Query(50, ge=1, le=200), player_id: str | None = Query(None, pattern=_PLAYER_ID)):
    """Players by their total score, rank 1 first, and the asking player's own rank."""
    from app.services import drive_score_store

    return drive_score_store.leaderboard(limit, player_id)
