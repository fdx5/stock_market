"""Real building footprints and heights of one apartment complex, for the 3D viewer.

Two sources, best first:

* VWorld (국토교통부 공간정보 오픈플랫폼) — GIS건물통합정보 `LT_C_BLDGINFO`: every
  building's surveyed footprint with 지상층수 and 높이 from the building register,
  keyed by PNU. The complex's 지번 is geocoded, its parcel (`LP_PA_CBND_BUBUN`) read,
  and the buildings on that parcel are the complex. Needs VWORLD_API_KEY.
* OpenStreetMap — the named residential area of the complex inside its 법정동, and the
  building ways within it. Coverage is partial and heights are sometimes missing;
  a height we had to fill in is marked `estimated`, never passed off as measured.

Footprints are returned in metres around the complex centre so the viewer can
extrude them directly. Results are kept (memory + the facts store) because
building shapes change on a scale of years, and a click must render at once.
"""
from __future__ import annotations

import datetime as dt
import logging
import math
import os
import re
import threading
import time
from statistics import median

import requests

from app.services import realestate_map as rm
from app.services import realestate_store as store

log = logging.getLogger(__name__)

UA = {"User-Agent": "kospimap.com apartment 3D viewer (https://kospimap.com)"}
OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
VWORLD_ADDRESS = "https://api.vworld.kr/req/address"
VWORLD_DATA = "https://api.vworld.kr/req/data"
FLOOR_M = 2.9           # typical 공동주택 floor-to-floor height
GROUND_M = 1.5          # pilotis / ground floor extra
CONTEXT_M = 288         # neighbours drawn around the complex (1.25x the former 230 m)
ROAD_M = 150            # surveyed major roads drawn around the parcel
KEEP_DAYS = 30
KEEP_MISS_DAYS = 1
STORE_VERSION = "bldg-v4"  # v4: explicit zero-storey footprints never become above-ground buildings

_cache: dict[str, tuple[float, dict]] = {}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_areas: dict[str, int | None] = {}


class BuildingsError(RuntimeError):
    pass


def _vworld_key() -> str | None:
    return (os.environ.get("VWORLD_API_KEY") or "").strip() or None


def _server_vworld() -> bool:
    """VWorld answers Korean networks only; a server abroad (Render) gets 502s and
    resets. There the browser calls VWorld itself (frontend vworldBuildings.ts) and
    the server only serves OSM. Set VWORLD_SERVER_SIDE=1 on a host inside Korea."""
    return bool(_vworld_key()) and os.environ.get("VWORLD_SERVER_SIDE") == "1"


def _norm(value: str) -> str:
    return re.sub(r"(아파트|apt)$", "", re.sub(r"[\W_]", "", value or "").casefold())


def _names_match(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    return a == b or (len(b) >= 3 and b in a) or (len(a) >= 3 and a in b)


# ── geometry ────────────────────────────────────────────────────────────────


def _projector(lat0: float, lon0: float):
    kx = math.cos(math.radians(lat0)) * 111_320
    ky = 110_540
    return lambda lon, lat: (round((lon - lon0) * kx, 2), round((lat - lat0) * ky, 2))


def _area(ring: list[tuple[float, float]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def _inside(pt, ring) -> bool:
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def _centroid(ring):
    xs, ys = zip(*ring)
    return sum(xs) / len(xs), sum(ys) / len(ys)


def _clean(ring):
    """Open ring (no repeated closing point), counter-clockwise, at least a triangle."""
    ring = [tuple(p) for p in ring]
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3 or abs(_area(ring)) < 4:
        return None
    return ring if _area(ring) > 0 else ring[::-1]


def _stitch(ways: list[list[tuple]]) -> list[list[tuple]]:
    """Join a multipolygon's member ways into closed rings."""
    rings, open_ = [], [list(w) for w in ways if len(w) > 1]
    while open_:
        ring = open_.pop(0)
        grew = True
        while ring[0] != ring[-1] and grew:
            grew = False
            for i, w in enumerate(open_):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[::-1][1:]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[::-1][:-1] + ring
                else:
                    continue
                open_.pop(i)
                grew = True
                break
        rings.append(ring)
    return rings


def _num(value) -> float | None:
    try:
        n = float(str(value).replace("m", "").replace(",", ".").split(";")[0].strip())
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) and n > 0 else None


def _year(day) -> int | None:
    """사용승인일 (yyyymmdd) → year, or None for a blank or implausible date."""
    text = str(day or "").strip()
    return int(text[:4]) if len(text) >= 4 and text[:4].isdigit() and 1900 <= int(text[:4]) <= 2100 else None


def _fill_heights(buildings: list[dict], tower_fallback: bool = False) -> None:
    """Fill a building with neither 층수 nor 높이, marked `estimated`.

    In the building register every apartment tower has its 층수, so a VWorld footprint
    without one is a guard post, ramp or low 부대시설: two floors. OSM often omits
    levels on towers too, so there (`tower_fallback`) a tower-sized footprint takes
    the complex's median."""
    known = [b["floors"] for b in buildings if b["floors"]]
    fallback = round(median(known)) if known else None
    for b in buildings:
        if b["height"]:
            b["floors"] = b["floors"] or max(1, round((b["height"] - GROUND_M) / FLOOR_M))
            continue
        if b["floors"]:
            b["height"] = round(b["floors"] * FLOOR_M + GROUND_M, 1)
            b["height_source"] = "floors"
            continue
        towerish = tower_fallback and fallback and abs(_area(b["rings"][0])) >= 250
        b["floors"] = fallback if towerish else 2
        b["height"] = round(b["floors"] * FLOOR_M + GROUND_M, 1) if towerish else 6.5
        b["height_source"] = "estimated"


# ── VWorld ──────────────────────────────────────────────────────────────────


def _vworld(url: str, params: dict) -> dict:
    key = _vworld_key()
    res = requests.get(url, params={**params, "key": key, "format": "json",
                                    "domain": os.environ.get("VWORLD_DOMAIN", "https://kospimap.com")},
                       headers=UA, timeout=(5, 12))
    if not res.ok:
        raise BuildingsError(f"VWorld HTTP {res.status_code}")
    body = res.json().get("response", {})
    status = body.get("status")
    if status == "NOT_FOUND":
        return {}
    if status != "OK":
        text = str(body.get("error", {}).get("text") or status)
        raise BuildingsError(f"VWorld: {text.replace(key or '__', '[key]')[:120]}")
    return body.get("result") or {}


def _features(result: dict) -> list[dict]:
    return (result.get("featureCollection") or {}).get("features") or []


def _has_above_ground_evidence(props: dict) -> bool:
    """Explicit zero storeys is different from an unknown storey count."""
    floors = str(props.get("grnd_flr") if props.get("grnd_flr") is not None else "").strip()
    try:
        return not (floors and float(floors) == 0 and not _num(props.get("height")))
    except ValueError:
        return True


def _polygons(geometry: dict) -> list[list[list]]:
    kind, coords = geometry.get("type"), geometry.get("coordinates") or []
    if kind == "Polygon":
        return [coords]
    if kind == "MultiPolygon":
        return list(coords)
    return []


def _from_vworld(c: dict, address: str) -> dict | None:
    point = _vworld(VWORLD_ADDRESS, {"service": "address", "request": "getcoord", "version": "2.0",
                                     "crs": "epsg:4326", "address": address, "refine": "true",
                                     "simple": "false", "type": "parcel"}).get("point")
    if not point:
        return None
    lon, lat = float(point["x"]), float(point["y"])
    common = {"service": "data", "request": "GetFeature", "crs": "EPSG:4326", "geometry": "true",
              "attribute": "true"}
    parcels = _features(_vworld(VWORLD_DATA, {**common, "data": "LP_PA_CBND_BUBUN",
                                              "geomFilter": f"POINT({lon} {lat})", "size": 10}))
    if not parcels:
        return None
    parcel = parcels[0]
    pnu = parcel["properties"].get("pnu")
    rings = [p[0] for p in _polygons(parcel["geometry"])]
    lons = [x for r in rings for x, _ in r] or [lon]
    lats = [y for r in rings for _, y in r] or [lat]
    pad_lon = CONTEXT_M / (111_320 * math.cos(math.radians(lat)))
    pad_lat = CONTEXT_M / 110_540
    box = f"BOX({min(lons) - pad_lon},{min(lats) - pad_lat},{max(lons) + pad_lon},{max(lats) + pad_lat})"
    around = []
    for page in range(1, 6):
        result = _vworld(VWORLD_DATA, {**common, "data": "LT_C_BLDGINFO", "geomFilter": box,
                                       "size": 1000, "page": page})
        batch = _features(result)
        around += batch
        if len(batch) < 1000:
            break
    # The complex: buildings registered on its parcel, or standing inside it, or —
    # for a complex spread over several parcels — carrying the complex's own name.
    def centre(f):
        polys = _polygons(f["geometry"])
        return _centroid([tuple(p) for p in polys[0][0]]) if polys else (0, 0)
    mine = {id(f) for f in around
            if f["properties"].get("pnu") == pnu
            or any(_inside(centre(f), [tuple(p) for p in r]) for r in rings)
            or _names_match(f["properties"].get("bld_nm") or "", c["name"])}
    on_parcel = [f for f in around if id(f) in mine]
    project = _projector(lat, lon)
    buildings, context = [], []
    for f in around:
        p = f["properties"]
        if not _has_above_ground_evidence(p):
            continue  # explicit zero-storey footprints must not acquire invented height
        for poly in _polygons(f["geometry"]):
            outer = _clean([project(x, y) for x, y in poly[0]])
            if not outer:
                continue
            holes = [h for h in (_clean([project(x, y) for x, y in r]) for r in poly[1:]) if h]
            height, floors = _num(p.get("height")), _num(p.get("grnd_flr"))
            b = {"rings": [outer, *[h[::-1] for h in holes]], "height": height,
                 "floors": int(floors) if floors else None, "base": 0,
                 "height_source": "measured" if height else "floors" if floors else None,
                 "name": (p.get("dong_nm") or "").strip() or None, "use": p.get("usability") or None,
                 "title": (p.get("bld_nm") or "").strip() or None,
                 "approved": _year(p.get("useapr_day"))}
            (buildings if id(f) in mine else context).append(b)
    if not buildings:
        return None
    site = [s for s in (_clean([project(x, y) for x, y in r]) for r in rings) if s]
    # Major roads (국가기본도 도로중심선) with their registered width and lanes; keep in
    # step with frontend vworldBuildings.ts parseRoads.
    rlon = ROAD_M / (111_320 * math.cos(math.radians(lat)))
    rlat = ROAD_M / 110_540
    roads = []
    try:
        road_box = f"BOX({min(lons) - rlon},{min(lats) - rlat},{max(lons) + rlon},{max(lats) + rlat})"
        for f in _features(_vworld(VWORLD_DATA, {**common, "data": "LT_L_N3A0020000", "geomFilter": road_box, "size": 1000, "page": 1})):
            width, lanes = _num(f["properties"].get("rvwd")) or 0, round(_num(f["properties"].get("rdln")) or 0)
            if width < 8 and lanes < 2:
                continue
            geom = f.get("geometry") or {}
            lines = [geom.get("coordinates")] if geom.get("type") == "LineString" else geom.get("coordinates") or []
            for line in lines:
                if line and len(line) > 1:
                    roads.append({"line": [project(x, y) for x, y in line], "width": min(60, width or lanes * 3.3), "lanes": max(1, lanes)})
    except BuildingsError:
        roads = []  # roads are setting; the buildings stand without them
    return {"source": "vworld", "center": {"lat": lat, "lon": lon}, "site": site, "pnu": pnu,
            "buildings": buildings, "context": context, "roads": roads,
            "attribution": "국토교통부 GIS건물통합정보 · 연속지적도 (브이월드)"}


# ── OpenStreetMap ───────────────────────────────────────────────────────────


def _overpass(query: str, deadline_s: float | None = None) -> list[dict]:
    last: Exception | None = None
    deadline = time.monotonic() + deadline_s if deadline_s is not None else None
    for url in OVERPASS:
        remaining = deadline - time.monotonic() if deadline is not None else None
        if remaining is not None and remaining <= 0:
            break
        try:
            timeout = (5, 20) if remaining is None else (min(1, remaining / 3), min(2, remaining * 2 / 3))
            res = requests.post(url, data={"data": query}, headers=UA, timeout=timeout)
            if res.ok:
                body = res.json()
                # (a query that ran out of time or memory still answers 200, with a remark and
                # whatever it had: not an answer)
                remark = str(body.get("remark") or "")
                if "error" in remark.lower() or "timed out" in remark.lower():
                    last = BuildingsError(f"Overpass: {remark[:80]}")
                    continue
                return body.get("elements", [])
            last = BuildingsError(f"Overpass {res.status_code}")
        except (requests.RequestException, ValueError) as exc:
            last = exc
    raise BuildingsError(f"OpenStreetMap 응답 없음 ({type(last).__name__})")


def _dong_area(address: str) -> int | None:
    if address in _areas:
        return _areas[address]
    res = requests.get("https://nominatim.openstreetmap.org/search",
                       params={"q": address, "format": "jsonv2", "countrycodes": "kr", "limit": 5},
                       headers=UA, timeout=15)
    res.raise_for_status()
    rel = next((x for x in res.json() if x.get("osm_type") == "relation"), None)
    _areas[address] = 3_600_000_000 + int(rel["osm_id"]) if rel else None
    return _areas[address]


def _osm_building(e: dict, project) -> dict | None:
    tags = e.get("tags", {})
    outer = _clean([project(p["lon"], p["lat"]) for p in e.get("geometry", []) if p])
    if not outer:
        return None
    height, floors = _num(tags.get("height")), _num(tags.get("building:levels"))
    base = _num(tags.get("min_height")) or ((_num(tags.get("building:min_level")) or 0) * FLOOR_M)
    return {"rings": [outer], "height": height, "floors": int(floors) if floors else None, "base": round(base, 1),
            "height_source": "measured" if height else "floors" if floors else None,
            "name": tags.get("name") or tags.get("addr:housenumber") or None,
            # (a plain "yes" building says what it is by its amenity or shop tag, when it has one)
            "use": tags.get("building") if tags.get("building") not in (None, "yes") else (tags.get("amenity") or tags.get("shop") or tags.get("building")),
            "title": tags.get("name") or None}


def _from_osm(c: dict, dong_address: str) -> dict | None:
    area = _dong_area(dong_address)
    if not area:
        return None
    named = _overpass(
        f'[out:json][timeout:25];area({area})->.d;('
        f'way["landuse"="residential"]["name"](area.d);relation["landuse"="residential"]["name"](area.d);'
        f'way["building"]["name"](area.d););out tags center;')
    hits = [e for e in named if _names_match(e["tags"].get("name", ""), c["name"])]
    lands = sorted((e for e in hits if e["tags"].get("landuse")),
                   key=lambda e: (_norm(e["tags"]["name"]) != _norm(c["name"]), e["type"] != "way"))
    if lands:
        land = lands[0]
        sel = f'{land["type"]}({land["id"]})'
        els = _overpass(f'[out:json][timeout:25];{sel}->.l;.l map_to_area->.a;'
                        f'(way["building"](area.a);way["building"](around.l:{CONTEXT_M});.l;);out geom;')
        site_el = next(e for e in els if e["type"] == land["type"] and e["id"] == land["id"])
        if site_el["type"] == "way":
            raw_rings = [[(p["lon"], p["lat"]) for p in site_el["geometry"]]]
        else:
            raw_rings = _stitch([[(p["lon"], p["lat"]) for p in m.get("geometry", [])]
                                 for m in site_el.get("members", []) if m.get("role") == "outer"])
        lat0, lon0 = land["center"]["lat"], land["center"]["lon"]
        project = _projector(lat0, lon0)
        site = [s for s in (_clean([project(x, y) for x, y in r]) for r in raw_rings) if s]
        buildings, context = [], []
        for e in els:
            if e["type"] != "way" or "building" not in e.get("tags", {}):
                continue
            b = _osm_building(e, project)
            if b:
                (buildings if any(_inside(_centroid(b["rings"][0]), s) for s in site) else context).append(b)
    else:
        parts = [e for e in hits if e["tags"].get("building")]
        if not parts:
            return None
        lat0 = sum(e["center"]["lat"] for e in parts) / len(parts)
        lon0 = sum(e["center"]["lon"] for e in parts) / len(parts)
        ids = {e["id"] for e in parts}
        els = _overpass(f'[out:json][timeout:25];way["building"](around:{CONTEXT_M + 150},{lat0},{lon0});out geom;')
        project = _projector(lat0, lon0)
        site, buildings, context = [], [], []
        for e in els:
            b = _osm_building(e, project)
            if b:
                (buildings if e["id"] in ids else context).append(b)
    if not buildings:
        return None
    return {"source": "osm", "center": {"lat": lat0, "lon": lon0}, "site": site,
            "buildings": buildings, "context": context, "attribution": "© OpenStreetMap contributors (ODbL)"}


# ── entry point ─────────────────────────────────────────────────────────────


def _lookup(complex_id: str) -> dict:
    lawd = complex_id.split(":", 1)[0]
    index = rm._sgg_index()
    if lawd not in index:
        raise ValueError("unknown 시군구")
    from app.services import realestate_rights
    found = realestate_rights.merge(rm._complexes([lawd]), [lawd])
    c = found.get(complex_id) or next((x for x in found.values() if complex_id in x.get("aliases", [])), None)
    if c is None:
        raise LookupError("no such complex")
    return {**c, "sgg_name": index[lawd]["name"], "sido_name": index[lawd]["sido_name"]}


def _build(complex_id: str) -> dict:
    c = _lookup(complex_id)
    region = f'{c["sido_name"]} {c["sgg_name"]}'
    result, errors = None, []
    if _server_vworld() and c.get("jibun"):
        try:
            result = _from_vworld(c, f'{region} {c.get("umd") or c["dong"]} {c["jibun"]}')
        except Exception as exc:  # noqa: BLE001 — fall through to OSM
            errors.append("vworld: " + (str(exc) if isinstance(exc, BuildingsError) else type(exc).__name__))
    if result is None:
        try:
            result = _from_osm(c, f'{region} {c["dong"]}')
        except Exception as exc:  # noqa: BLE001
            errors.append("osm: " + (str(exc) if isinstance(exc, BuildingsError) else type(exc).__name__))
    base = {"id": complex_id, "name": c["name"], "address": f'{region} {c["dong"]} {c.get("jibun") or ""}'.strip(),
            "built": c.get("built") or None, "attempts": errors,
            "fetched_at": dt.datetime.now(rm.KST).isoformat(timespec="seconds")}
    if result is None:
        return {**base, "found": False, "buildings": [], "context": [], "site": [],
                "error": errors[-1] if errors else "건물 윤곽 자료에서 이 단지를 찾지 못했습니다.",
                "vworld": bool(_vworld_key())}
    osm = result["source"] == "osm"
    _fill_heights(result["buildings"], tower_fallback=osm)
    _fill_heights(result["context"], tower_fallback=osm)
    # Every registered neighbour in the radius, down to low annexes; only sheds go.
    near = lambda b: math.hypot(*_centroid(b["rings"][0]))
    result["context"] = sorted((b for b in result["context"] if b["height"] >= 2.5), key=near)[:3000]
    measured = sum(b["height_source"] in ("measured", "floors") for b in result["buildings"])
    return {**base, "found": True, **result, "vworld": bool(_vworld_key()),
            "coverage": {"buildings": len(result["buildings"]), "with_height": measured},
            "error": None}


def _query(c: dict) -> dict:
    region = f'{c["sido_name"]} {c["sgg_name"]}'
    return {"parcel": f'{region} {c.get("umd") or c["dong"]} {c["jibun"]}' if c.get("jibun") else None,
            "name": c["name"]}


def complex_buildings(complex_id: str, peek: bool = False) -> dict:
    body = _complex_buildings(complex_id, peek)
    # Kept results carry the (public, domain-bound) key too, so a browser can add the
    # surveyed roads a result lacks (OpenStreetMap results, older kept shapes).
    if body.get("found") and "vworld_key" not in body and _vworld_key():
        body = {**body, "vworld_key": _vworld_key(), "vworld_domain": os.environ.get("VWORLD_DOMAIN", "https://kospimap.com")}
    # An OpenStreetMap result (the server abroad can't reach VWorld's registry) carries
    # the parcel too: a browser in Korea asks VWorld for the surveyed buildings itself.
    if body.get("found") and body.get("source") == "osm" and "query" not in body:
        try:
            body = {**body, "query": _query(_lookup(complex_id))}
        except Exception:  # noqa: BLE001 — the upgrade is optional
            pass
    return body


def _complex_buildings(complex_id: str, peek: bool = False) -> dict:
    """The complex's buildings. `peek` answers at once: a kept result, or else what
    the browser needs to ask VWorld itself (the parcel address and the key, which is
    bound to this site's domain and public by design)."""
    now = time.time()
    hit = _cache.get(complex_id)
    if hit and hit[0] > now and (hit[1]["found"] or not peek):
        return hit[1]
    key = f"{STORE_VERSION}:{complex_id}"
    try:
        saved = store.load_facts(key)
    except Exception:  # noqa: BLE001 — the store is an optimisation here
        saved = None
    kept = saved[1] if saved and isinstance(saved[1], dict) else None
    if kept:
        age = (dt.datetime.now(rm.KST) - dt.datetime.fromisoformat(saved[0])).days if saved[0] else 999
        upgrade = kept.get("source") == "osm" and _server_vworld()
        if kept.get("found") and age < KEEP_DAYS and not upgrade:
            _cache[complex_id] = (now + 3600, kept)
            return kept
    if peek:
        c = _lookup(complex_id)
        return {"id": complex_id, "name": c["name"], "built": c.get("built") or None, "found": False, "pending": True,
                "query": _query(c), "vworld_key": _vworld_key(),
                "vworld_domain": os.environ.get("VWORLD_DOMAIN", "https://kospimap.com"), "buildings": [], "context": [], "site": [],
                "vworld": bool(_vworld_key()), "error": None,
                "fetched_at": dt.datetime.now(rm.KST).isoformat(timespec="seconds")}
    with _locks_guard:
        lock = _locks.setdefault(complex_id, threading.Lock())
    with lock:
        hit = _cache.get(complex_id)
        if hit and hit[0] > now:
            return hit[1]
        body = _build(complex_id)
        if not body["found"] and kept and kept.get("found"):
            body = kept  # a failed refresh never replaces shapes we already had
        _cache[complex_id] = (now + (3600 if body["found"] else 300), body)
        if body["found"] and body is not kept:
            try:
                store.save_facts(key, body, body["fetched_at"])
            except Exception as exc:  # noqa: BLE001
                log.info("realestate buildings: saving %s failed (%s)", complex_id, exc)
        return body
