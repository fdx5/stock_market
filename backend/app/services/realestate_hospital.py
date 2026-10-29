"""A hospital's departments, for the walk mode's building interiors (/walk): the HIRA
(건강보험심사평가원) hospital register's 진료과목 for the institution at a place — the department names
and their specialists' count. Public institutional data only. Kept in memory a day.
"""

from __future__ import annotations

import logging
import re

import requests

from app.services import realestate_map as rm
from app.services.realestate_building_info import _cached, _num

log = logging.getLogger(__name__)

BASIS = "https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList"
DEPTS = "https://apis.data.go.kr/B551182/MadmDtlInfoService2.7/getDgsbjtInfo2.7"
DAY = 86400


def _items(res: requests.Response) -> list[dict]:
    res.raise_for_status()
    body = ((res.json() or {}).get("response") or {}).get("body") or {}
    items = (body.get("items") or {}) if isinstance(body.get("items"), dict) else {}
    got = items.get("item") or []
    return got if isinstance(got, list) else [got]


def departments(lat: float, lon: float, name: str = "") -> dict:
    if not (33 <= lat <= 39 and 124 <= lon <= 132):
        raise ValueError("국내 좌표가 아닙니다.")
    key = rm._service_key()
    if not key:
        return {"status": "unconfigured", "departments": []}
    words = re.sub(r"[^가-힣A-Za-z0-9]", "", name or "")[:30]

    def fetch():
        params = {"serviceKey": key, "xPos": f"{lon:.6f}", "yPos": f"{lat:.6f}", "radius": "400", "numOfRows": "60", "pageNo": "1", "_type": "json"}
        found = _items(requests.get(BASIS, params=params, timeout=10))
        # (the institution itself: a hospital class first, the name's closest, then the most doctors)
        def rank(h):
            n = str(h.get("yadmNm") or "")
            return (("병원" in str(h.get("clCdNm") or "")) + (2 if words and (words in n or n.replace(" ", "") in words) else 0), _num(h.get("drTotCnt")) or 0)
        found = [h for h in found if h.get("ykiho")]
        if not found:
            return {"status": "not_found", "departments": []}
        best = max(found, key=rank)
        rows = _items(requests.get(DEPTS, params={"serviceKey": key, "ykiho": best["ykiho"], "numOfRows": "100", "pageNo": "1", "_type": "json"}, timeout=10))
        depts = []
        for r in rows:
            n = str(r.get("dgsbjtCdNm") or "").strip()
            if n and n not in [d["name"] for d in depts]:
                depts.append({"name": n[:20], "doctors": int(_num(r.get("dgsbjtPrSdrCnt")) or 0)})
        return {"status": "available" if depts else "not_found", "institution": str(best.get("yadmNm") or "")[:60],
                "class": str(best.get("clCdNm") or "")[:20], "doctors": int(_num(best.get("drTotCnt")) or 0),
                "departments": depts, "source": "건강보험심사평가원 병원정보·진료과목"}

    try:
        got = _cached(f"hira:{lat:.4f}:{lon:.4f}:{words}", DAY, fetch)
    except Exception:  # noqa: BLE001
        got = None
    return got or {"status": "unavailable", "departments": []}
