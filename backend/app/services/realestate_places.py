"""The shops and offices round a point, for the walk mode's shop signs (/walk): their trading names,
kinds and positions from Kakao Local's category search (restaurants, cafés, convenience stores,
pharmacies, clinics, academies, banks, marts, estate agents, …). A business's public listing only
— name, kind, place; no phone numbers or people. Kept in memory a day by a ~250 m cell.
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import math

import requests

from app.services import realestate_map as rm
from app.services.realestate_building_info import _cached, _kakao_key, _num

log = logging.getLogger(__name__)

KAKAO_CATEGORY = "https://dapi.kakao.com/v2/local/search/category.json"
# 소상공인시장진흥공단_상가(상권)정보: every registered shop in a radius, with its floor (data.go.kr key)
SBIZ_RADIUS = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius"
# (Kakao's category groups that put up a sign on a street front)
GROUPS = {"FD6": "food", "CE7": "cafe", "CS2": "store", "PM9": "pharmacy", "HP8": "clinic", "AC5": "academy",
          "BK9": "bank", "MT1": "mart", "AG2": "agent", "PS3": "kids", "SW8": "station", "OL7": "fuel", "CT1": "culture", "AD5": "lodging"}
DAY = 86400
CELL = 0.0025  # ~250 m
_pool = cf.ThreadPoolExecutor(max_workers=6, thread_name_prefix="places")


def _group(code: str, lat: float, lon: float, radius: int) -> list[dict]:
    key = _kakao_key()
    if not key:
        return []
    out: list[dict] = []
    for page in (1, 2, 3):
        res = requests.get(KAKAO_CATEGORY, headers={"Authorization": f"KakaoAK {key}"}, timeout=8,
                           params={"category_group_code": code, "x": f"{lon:.6f}", "y": f"{lat:.6f}", "radius": str(radius), "page": str(page), "size": "15", "sort": "distance"})
        res.raise_for_status()
        body = res.json()
        for d in body.get("documents") or []:
            x, y = _num(d.get("x")), _num(d.get("y"))
            if x is None or y is None or not d.get("place_name"):
                continue
            out.append({"name": d["place_name"].strip(), "kind": GROUPS[code], "category": (d.get("category_name") or "").split(" > ")[-1] or None,
                        "lat": round(y, 6), "lon": round(x, 6)})
        if (body.get("meta") or {}).get("is_end", True):
            break
    return out


def _kind_of(l: str, m: str, s: str) -> str:
    t = f"{l} {m} {s}"
    if "커피" in t or "카페" in t or "제과" in t: return "cafe"
    if "편의점" in t: return "store"
    if "의약" in t or "약국" in t: return "pharmacy"
    if "의료" in t or "의원" in t or "병원" in t or "보건" in t: return "clinic"
    if "교육" in t or "학원" in t: return "academy"
    if "부동산" in t: return "agent"
    if "숙박" in t: return "lodging"
    if "음식" in t or "주점" in t: return "food"
    if "마트" in t or "슈퍼" in t: return "mart"
    if "스포츠" in t or "예술" in t or "오락" in t: return "culture"
    return "store"


def _sbiz(lat: float, lon: float, radius: int) -> list[dict]:
    key = rm._service_key()
    if not key:
        return []
    out: list[dict] = []
    for page in (1, 2, 3):
        res = requests.get(SBIZ_RADIUS, params={"serviceKey": key, "pageNo": str(page), "numOfRows": "1000", "radius": str(radius), "cx": f"{lon:.6f}", "cy": f"{lat:.6f}", "type": "json"}, timeout=15)
        res.raise_for_status()
        body = (res.json() or {}).get("body") or {}
        items = body.get("items") or []
        for it in items:
            x, y, name = _num(it.get("lon")), _num(it.get("lat")), (it.get("bizesNm") or "").strip()
            if x is None or y is None or not name:
                continue
            branch = (it.get("brchNm") or "").strip()
            fl = _num(it.get("flrNo"))
            out.append({"name": f"{name} {branch}".strip() if branch and len(name) < 8 else name,
                        "kind": _kind_of(it.get("indsLclsNm") or "", it.get("indsMclsNm") or "", it.get("indsSclsNm") or ""),
                        "category": (it.get("indsSclsNm") or it.get("indsMclsNm") or None), "lat": round(y, 6), "lon": round(x, 6),
                        "floor": int(fl) if fl is not None else None})
        if len(items) < 1000 or len(out) >= int(_num(body.get("totalCount")) or 0):
            break
    return out


def places(lat: float, lon: float, radius: int = 300) -> dict:
    if not (33 <= lat <= 39 and 124 <= lon <= 132):
        raise ValueError("국내 좌표가 아닙니다.")
    radius = max(50, min(500, int(radius)))
    # (a cell's centre: neighbours share the answer)
    clat, clon = (math.floor(lat / CELL) + 0.5) * CELL, (math.floor(lon / CELL) + 0.5) * CELL

    def fetch():
        # (the register of shops first — names and floors as registered; Kakao's listings if it has none)
        try:
            out = _sbiz(clat, clon, radius)
        except (requests.RequestException, ValueError) as exc:
            log.info("places: shop register failed (%s)", type(exc).__name__)
            out = []
        if out:
            return {"items": out, "source": "소상공인시장진흥공단 상가(상권)정보"}
        futs = [_pool.submit(_group, code, clat, clon, radius) for code in GROUPS]
        out, seen = [], set()
        for f in futs:
            try:
                for p in f.result():
                    k = (p["name"], p["lat"], p["lon"])
                    if k not in seen:
                        seen.add(k); out.append(p)
            except (requests.RequestException, ValueError) as exc:
                log.info("places: a group failed (%s)", type(exc).__name__)
        if not out:
            # (nothing from either: not kept a day — tried again in ten minutes)
            raise RuntimeError("no places")
        return {"items": out, "source": "카카오 로컬 (업소명·업종·위치)"}

    got = _cached(f"places2:{clat:.4f}:{clon:.4f}:{radius}", DAY, fetch) or {"items": [], "source": None}
    return got
