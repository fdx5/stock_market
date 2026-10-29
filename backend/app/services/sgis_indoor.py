"""SGIS 2019 building deployment charts. Public geometry only; credentials/tokens stay in memory.

No database access. Missing coverage and provider failures are explicit, never fabricated plans.
Coordinates are converted from SGIS EPSG:5179 to a metre frame shared by all floors.
"""
from __future__ import annotations

import math
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import requests
from pyproj import Transformer

BASE = "https://sgisapi.mods.go.kr/OpenAPI3/"
_to_grid = Transformer.from_crs(4326, 5179, always_xy=True)
_to_geo = Transformer.from_crs(5179, 4326, always_xy=True)
_lock = threading.RLock()
_token = ("", 0.0)
_cache: OrderedDict = OrderedDict()
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sgis-floor")


class ProviderError(Exception):
    def __init__(self, state="unavailable", code=None):
        self.state = state
        self.code = str(code) if code is not None and re.fullmatch(r"-?\d{1,8}",str(code)) else None


def configured():
    return bool(os.getenv("SGIS_CONSUMER_KEY") and os.getenv("SGIS_CONSUMER_SECRET"))


def _access_token():
    global _token
    with _lock:
        if _token[0] and _token[1] > time.time() + 90:
            return _token[0]
        if not configured():
            raise ProviderError("unconfigured")
        try:
            r = requests.get(BASE + "auth/authentication.json", params={
                "consumer_key": os.environ["SGIS_CONSUMER_KEY"],
                "consumer_secret": os.environ["SGIS_CONSUMER_SECRET"],
            }, timeout=(2, 5))
            r.raise_for_status()
            body = r.json()
            result = body.get("result") or {}
            token = result.get("accessToken")
            if str(body.get("errCd", 0)) != "0" or not token:
                raise ProviderError("auth_error")
            expires = float(result.get("accessTimeout") or time.time() + 3600)
            # Some gateways return milliseconds, although the published contract says seconds.
            if expires > 1e12:
                expires /= 1000
            _token = (token, min(expires, time.time() + 86400))
            return token
        except (requests.RequestException, ValueError, TypeError):
            # Never propagate requests' exception URL: it includes credentials.
            raise ProviderError("auth_error") from None


def _request(path, **params):
    global _token
    for attempt in range(2):
        token = _access_token()
        try:
            r = requests.get(BASE + "figure/" + path, params={**params, "accessToken": token}, timeout=(2, 5))
            if not r.ok:
                raise ProviderError("http_error", r.status_code)
            r.raise_for_status()
            body = r.json()
        except (requests.RequestException, ValueError):
            raise ProviderError() from None
        code = str(body.get("errCd", 0))
        if code == "-200" and attempt == 0:
            with _lock:
                if _token[0] == token:
                    _token = ("", 0)
            continue
        if code == "-200":
            raise ProviderError("auth_error", code)
        if code not in ("0", "-100", "-1000"):
            raise ProviderError("provider_error",code)
        return body
    raise ProviderError("auth_error")


def _cached(key, fetch):
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.time():
            _cache.move_to_end(key)
            return hit[1]
    value = fetch()
    ttl = 21600 if value.get("status") == "available" and not value.get("partial") else 60
    with _lock:
        _cache[key] = (time.time() + ttl, value)
        while len(_cache) > 256:
            _cache.popitem(last=False)
    return value


def _features(body):
    if body.get("type") == "Feature":
        return [body]
    result = body.get("result") or {}
    return body.get("features") or (result.get("features", []) if isinstance(result, dict) else [])


def _rings(geometry):
    if not geometry:
        return []
    coords = geometry.get("coordinates") or []
    polygons = coords if geometry.get("type") == "MultiPolygon" else [coords] if geometry.get("type") == "Polygon" else []
    out = []
    for polygon in polygons:
        rings = []
        for ring in polygon:
            pts = []
            for p in ring[:2000]:
                if len(p) >= 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in p[:2]):
                    pts.append([float(p[0]), float(p[1])])
            if len(pts) >= 3:
                rings.append(pts)
        if rings:
            out.append(rings)
    return out


def _inside(x, y, ring):
    hit = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            hit = not hit
    return hit


def building(lat, lon, name=""):
    if not configured():
        return {"status": "unconfigured", "source": "SGIS", "year": 2019}
    x, y = _to_grid.transform(lon, lat)

    def fetch():
        try:
            body = _request("buildingarea.geojson", minx=x-180, miny=y-180, maxx=x+180, maxy=y+180)
            candidates = []
            for f in _features(body):
                polys = _rings(f.get("geometry"))
                prop = f.get("properties") or {}
                if not polys or not prop.get("sufid"):
                    continue
                contains = any(_inside(x, y, p[0]) and not any(_inside(x, y, h) for h in p[1:]) for p in polys)
                # Do not silently attach a neighbouring building's chart.
                if not contains:
                    continue
                pts = [q for p in polys for q in p[0]]
                area = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))) / 2
                candidates.append((area, prop, pts, polys))
            if not candidates:
                return {"status": "not_covered", "source": "SGIS", "year": 2019}
            _, p, pts, polys = min(candidates, key=lambda c:c[0])
            x0, y0 = min(q[0] for q in pts), min(q[1] for q in pts)
            w, d = max(q[0] for q in pts)-x0, max(q[1] for q in pts)-y0
            olon, olat = _to_geo.transform(x0, y0)
            try:
                attr = _request("buildingattribute.json", sufid=str(p["sufid"])).get("result") or {}
            except ProviderError:
                attr = {}
            return {"status": "available", "source": "SGIS 사업체 전개도", "year": 2019,
                    "id": str(p["sufid"]), "name": str(p.get("bd_nm") or name)[:120], "outlines": polys,
                    "address": str(attr.get("bd_naddr") or "")[:180],
                    "frame": {"x": x0, "y": y0, "lon": olon, "lat": olat, "width": w, "depth": d}}
        except ProviderError as exc:
            return {"status": exc.state, "source": "SGIS", "year": 2019}
    return _cached(("building", round(lat, 6), round(lon, 6)), fetch)


def floor(sufid, level):
    def fetch():
        try:
            boundary = _request("floorboundary.geojson", sufid=sufid, flr_no=level)
            outlines = [p for f in _features(boundary) for p in _rings(f.get("geometry"))]
            if not outlines:
                return {"status": "not_covered", "year": 2019, "level": level}
            paths = ("floorcompany.geojson", "flooretcfacility2.json", "floorcompanyinfo.json")
            def optional(path):
                try:
                    return _request(path, sufid=sufid, flr_no=level)
                except ProviderError as exc:
                    return {"_layer_status":exc.state,"_layer_code":exc.code}
            responses = list(_pool.map(optional, paths))
            layers = {path:{"status":body.get("_layer_status") or ("empty" if str(body.get("errCd",0)) in ("-100","-1000") else "responded"),
                           "code":body.get("_layer_code") or str(body.get("errCd",0))} for path,body in zip(paths,responses)}
            companies, facility, info = responses
            info = info.get("result") or {}
            themes = {str(t.get("theme_cd")): str(t.get("theme_cd_nm") or "") for t in info.get("theme_cd_list", [])}
            rooms = [{"polygons": _rings(f.get("geometry")), "type": str((f.get("properties") or {}).get("type", "10"))}
                     for f in _features(companies)][:600]
            def points(items, is_company=False):
                out = []
                for item in items[:600]:
                    try:
                        px, py = float(item["center_x"]), float(item["center_y"])
                    except (KeyError, ValueError, TypeError):
                        continue
                    if not math.isfinite(px+py):
                        continue
                    out.append({"x": px, "y": py, "type": str(item.get("fac_type") or ""),
                                **({"name": str(item.get("corp_nm") or "사업체")[:100], "category": themes.get(str(item.get("theme_cd")), "")} if is_company else {})})
                return out
            facilities = facility.get("result") or info.get("facilitylist") or []
            if not isinstance(facilities, list):
                facilities = []
            return {"status": "available", "source": "SGIS 사업체 전개도", "year": 2019, "level": level,
                    "outlines": outlines, "rooms": rooms,
                    "companies": points(info.get("companylist") or [], True), "facilities": points(facilities),
                    "partitionsAvailable": bool(rooms), "facilitiesAvailable": bool(facilities), "layers":layers,
                    "partial":any(v["status"] not in ("responded","empty") for v in layers.values())}
        except ProviderError as exc:
            return {"status": exc.state, "year": 2019, "level": level}
    return _cached(("floor", sufid, level), fetch)
