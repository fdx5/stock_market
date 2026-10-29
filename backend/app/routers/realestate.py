from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import Response

from app.services import realestate_floors
from app.services import realestate_hospital
from app.services import realestate_places as realestate_places_service
from app.services import sgis_indoor
from app.services import realestate_building_info, realestate_buildings, realestate_facts, realestate_map, realestate_nearby, realestate_rent, realestate_summary, realestate_water
from app.services import realestate_units as realestate_units_service

router = APIRouter()


@router.get("/cctv")
def traffic_cameras(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132), fresh: bool = False):
    from app.services import traffic_cctv
    response.headers["Cache-Control"] = "no-store"
    return traffic_cctv.cameras(lat, lon, refresh=fresh)


@router.get("/cctv/status")
def traffic_camera_status(response: Response):
    from app.services import traffic_cctv
    response.headers["Cache-Control"] = "no-store"
    return traffic_cctv.status()


@router.get("/cctv/open/{token}")
def traffic_camera_open(response: Response, token: str):
    from app.services import traffic_cctv
    response.headers["Cache-Control"] = "no-store"
    if not 20 <= len(token) <= 64 or not all(c.isalnum() or c in "_-" for c in token):
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다.")
    try:
        return traffic_cctv.open_city(token)
    except LookupError:
        raise HTTPException(status_code=410, detail="영상 연결이 만료되었습니다. CCTV 목록을 새로고침하세요.") from None
    except Exception:
        raise HTTPException(status_code=502, detail="제공기관 영상을 현재 재생할 수 없습니다.") from None


@router.get("/cctv/media/{token}")
def traffic_camera_media(token: str):
    from app.services import traffic_cctv
    if not 20 <= len(token) <= 64 or not all(c.isalnum() or c in "_-" for c in token):
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다.")
    try:
        body, content_type = traffic_cctv.media(token)
        return Response(body, media_type=content_type, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
    except LookupError:
        raise HTTPException(status_code=410, detail="영상 연결이 만료되었습니다. CCTV 목록을 새로고침하세요.") from None
    except Exception:
        raise HTTPException(status_code=502, detail="제공기관 영상을 현재 재생할 수 없습니다.") from None


LAT = Query(..., ge=33, le=39)
LON = Query(..., ge=124, le=132)


@router.get("/live/status")
def live_status(response: Response):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.status()


@router.get("/live/subway/trains")
def live_subway_trains(response: Response, lines: str = Query(..., max_length=200)):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.subway_trains([l.strip() for l in lines.split(",") if l.strip()])


@router.get("/live/subway/station")
def live_subway_station(response: Response, name: str = Query(..., min_length=1, max_length=40), lines: str = Query("", max_length=200),
                        week: str | None = Query(None, pattern=r"^[123]$")):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.subway_station(name, [l for l in lines.split(",") if l], week)


@router.get("/live/emergency")
def live_emergency(response: Response, lat: float = LAT, lon: float = LON):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.emergency(lat, lon)


@router.get("/live/bikes")
def live_bikes(response: Response, lat: float = LAT, lon: float = LON):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.bikes(lat, lon)


@router.get("/live/parking")
def live_parking(response: Response, lat: float = LAT, lon: float = LON):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.parking(lat, lon)


@router.get("/live/aed")
def live_aed(response: Response, lat: float = LAT, lon: float = LON):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.aed(lat, lon)


@router.get("/live/facilities")
def live_facilities(response: Response, lat: float = LAT, lon: float = LON):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    return public_live.facilities(lat, lon)


@router.post("/live/traffic")
def live_traffic(response: Response, body: dict = Body(...)):
    from app.services import public_live
    response.headers["Cache-Control"] = "no-store"
    try:
        lat, lon = float(body["lat"]), float(body["lon"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="lat, lon") from None
    if not (33 <= lat <= 39 and 124 <= lon <= 132):
        raise HTTPException(status_code=422, detail="lat, lon")
    links = [str(l) for l in (body.get("links") or [])[:1500] if isinstance(l, (str, int))]
    return public_live.traffic(lat, lon, links)


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


@router.get("/building-info")
def realestate_building_card(response: Response, name: str = Query(..., min_length=2, max_length=80),
                             lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                             pnu: str | None = Query(None, pattern=r"^\d{19}$"), area: str | None = Query(None, max_length=30)):
    """One building's card for the 3D view's drone signs: its register (허가·착공·사용승인,
    용도, 구조, 층수, 면적), the place and photographs of that name, a geotagged article."""
    try:
        card = realestate_building_info.building_info(name, lat, lon, pnu, area)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "public, max-age=3600" if card.get("sources") else "no-store"
    return card


@router.get("/units")
def realestate_units(response: Response, id: str = Query(..., min_length=7, max_length=200),
                     dong: str | None = Query(None, max_length=40), pnu: str | None = Query(None, pattern=r"^\d{19}$")):
    """The flats of one 동 for the walk mode (/walk): every 전용면적 the building register holds
    for it (with how many 호), else the complex's traded 평형; 세대수 from K-apt."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return realestate_units_service.units(id, dong, pnu)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="단지를 찾을 수 없습니다.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/places")
def realestate_places(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132), r: int = Query(300, ge=50, le=500)):
    """The shops and offices round a point (trading name, kind, place) for the walk mode's signs."""
    try:
        result = realestate_places_service.places(lat, lon, r)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "public, max-age=3600"
    return result


@router.get("/indoor-building")
def indoor_building(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                   name: str = Query("", max_length=120)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return sgis_indoor.building(lat, lon, name)


@router.get("/walk-config")
def walk_config():
    # VWorld's existing public, domain-bound browser key. SGIS credentials are never returned.
    import os
    return {"vworld_key": realestate_buildings._vworld_key(),
            "vworld_domain": os.environ.get("VWORLD_DOMAIN", "https://kospimap.com")}


@router.get("/indoor-floor")
def indoor_floor(response: Response, id: str = Query(..., pattern=r"^\d{15,40}$"), level: int = Query(1, ge=-20, le=160)):
    response.headers["Cache-Control"] = "public, max-age=60"
    return sgis_indoor.floor(id, level)


@router.get("/indoor-stack")
def indoor_stack(response: Response, id: str = Query(..., pattern=r"^\d{15,40}$"), levels: str = Query("-1,1,2", max_length=400)):
    """The vertical cores (lifts, stairs, toilets, shafts) from the building's nearest charted floor."""
    try:
        wanted = [int(v) for v in levels.split(",") if v.strip()][:80]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="levels") from exc
    response.headers["Cache-Control"] = "public, max-age=600"
    return sgis_indoor.stack(id, wanted)


@router.get("/hospital-departments")
def hospital_departments(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                         name: str = Query("", max_length=80)):
    """A hospital's departments (HIRA register) for the walk mode's outpatient floors."""
    try:
        result = realestate_hospital.departments(lat, lon, name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "public, max-age=3600"
    return result


@router.get("/building-floors")
def realestate_building_floors(response: Response, pnu: str = Query(..., pattern=r"^\d{19}$"), name: str | None = Query(None, max_length=80),
                               area: float | None = Query(None, ge=0, le=1e6)):
    """A building's floors for the walk mode's building interiors: the register's 표제부 (floors,
    lifts, areas, use) and 층별개요 (each floor's uses and areas)."""
    try:
        result = realestate_floors.building_floors(pnu, name, area)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "public, max-age=3600"
    return result


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
                           r: float = Query(700, ge=100, le=4000), fast: bool = False):
    """Open water round a point (OpenStreetMap lakes, ponds and river areas, the sea from the
    coastline) and the beaches, for the 3D viewer: rings in metres about the point, clipped to
    the square of `r`. `fast`: at once (the drone's tiles)."""
    if r > 1500 and not fast:  # (the wide square — the drone's sea round it — only from the bundled coast)
        raise HTTPException(status_code=400, detail="r over 1500 needs fast=1")
    result = realestate_water.water(lat, lon, r, fast)
    response.headers["Cache-Control"] = "public, max-age=86400" if result.get("source") else "no-store"
    return result


@router.get("/crossings")
def realestate_crossings(response: Response, lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                         r: float = Query(700, ge=100, le=1500)):
    """Mapped crosswalks and traffic signals round a point (OpenStreetMap), for the 3D viewer's
    junctions: lines and points in metres about the point."""
    result = realestate_water.crossings(lat, lon, r)
    response.headers["Cache-Control"] = "public, max-age=86400" if result.get("source") else "no-store"
    return result


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
