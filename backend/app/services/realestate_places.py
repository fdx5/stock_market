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

from app.services.realestate_building_info import _cached, _kakao_key, _num

log = logging.getLogger(__name__)

KAKAO_CATEGORY = "https://dapi.kakao.com/v2/local/search/category.json"
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


def places(lat: float, lon: float, radius: int = 300) -> dict:
    if not (33 <= lat <= 39 and 124 <= lon <= 132):
        raise ValueError("국내 좌표가 아닙니다.")
    radius = max(50, min(500, int(radius)))
    # (a cell's centre: neighbours share the answer)
    clat, clon = (math.floor(lat / CELL) + 0.5) * CELL, (math.floor(lon / CELL) + 0.5) * CELL

    def fetch():
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
        return out

    items = _cached(f"places:{clat:.4f}:{clon:.4f}:{radius}", DAY, fetch) or []
    return {"items": items, "source": "카카오 로컬 (업소명·업종·위치)" if items else None}
