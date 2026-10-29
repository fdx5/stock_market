"""A building's floors for the walk mode's building interiors (/walk): the register's 표제부 (floors
above and below ground, lifts, areas, main use) and its 층별개요 (each floor's uses and areas), of
the building on a parcel that matches the name asked (or the largest there).

국토교통부_건축HUB 건축물대장정보 서비스: getBrTitleInfo and getBrFlrOulnInfo. Kept in memory a
week (failures ten minutes); nothing is stored.
"""

from __future__ import annotations

import logging
import re

import requests

from app.services import realestate_map as rm
from app.services.realestate_building_info import _cached, _num, _day
from app.services.realestate_facts import FactsError, _items

log = logging.getLogger(__name__)

HUB = "https://apis.data.go.kr/1613000/BldRgstHubService/"
V2 = "https://apis.data.go.kr/1613000/BldRgstService_v2/"
WEEK = 7 * 86400
MAX_PAGES = 5


def _params(pnu: str) -> dict:
    return {"sigunguCd": pnu[:5], "bjdongCd": pnu[5:10], "platGbCd": "1" if pnu[10] == "2" else "0",
            "bun": pnu[11:15], "ji": pnu[15:19], "numOfRows": "1000"}


def _fetch(op: str, pnu: str) -> list[dict] | None:
    key = rm._service_key()
    if not key:
        return None
    last: Exception | None = None
    for base in (HUB, V2):
        rows: list[dict] = []
        try:
            for page in range(1, MAX_PAGES + 1):
                if not rm._count_call("bldrgst"):
                    return None
                res = requests.get(base + op, params={"serviceKey": key, "_type": "json", **_params(pnu), "pageNo": str(page)}, timeout=12)
                items, total = _items(res)
                rows.extend(items)
                if len(rows) >= total or not items:
                    break
        except (FactsError, requests.RequestException, ValueError) as exc:
            if rm.is_quota_error(str(exc)):
                rm.exhaust("bldrgst")
                return None
            last = exc
            continue
        return rows
    if last:
        # (never the exception's text: the request URL carries the service key)
        raise RuntimeError(type(last).__name__)
    return None


def _norm(s) -> str:
    return re.sub(r"[\s()\[\]·,.-]|주식회사|\(주\)|빌딩|타워|센터|병원|의원", "", str(s or "")).lower()


def floor_level(gb: str | None, no) -> int | None:
    """A floor's level: B1 → -1, 1층 → 1 (the register's 지상/지하 and number)."""
    n = _num(no)
    if n is None:
        return None
    n = int(n)
    return -abs(n) if (gb or "").startswith("지하") else n


def building_floors(pnu: str, name: str | None = None) -> dict:
    if not re.fullmatch(r"\d{19}", pnu or ""):
        raise ValueError("pnu는 19자리 숫자여야 합니다.")
    titles = _cached(f"floors-title:{pnu}", WEEK, lambda: _fetch("getBrTitleInfo", pnu)) or []
    rows = _cached(f"floors-flr:{pnu}", WEEK, lambda: _fetch("getBrFlrOulnInfo", pnu)) or []
    if not titles and not rows:
        raise LookupError("건축물대장에서 이 건물을 찾지 못했습니다.")
    # the building: the one named so, else the largest main building on the parcel
    want = _norm(name)
    def score(t: dict) -> tuple:
        nm = _norm(t.get("bldNm")) + _norm(t.get("dongNm"))
        hit = bool(want) and (want in nm or (nm and nm in want))
        return (hit, (t.get("mainAtchGbCdNm") or "주") .startswith("주"), _num(t.get("totArea")) or 0)
    title = max(titles, key=score) if titles else {}
    dong = (title.get("dongNm") or "").strip()
    g = title.get
    info = {
        "name": (g("bldNm") or "").strip() or name or None,
        "dong": dong or None,
        "use": (g("mainPurpsCdNm") or "").strip() or None,
        "useDetail": (g("etcPurps") or "").strip() or None,
        "structure": (g("strctCdNm") or "").strip() or None,
        "floors": int(_num(g("grndFlrCnt")) or 0) or None,
        "basements": int(_num(g("ugrndFlrCnt")) or 0),
        "height": _num(g("heit")),
        "totalArea": _num(g("totArea")),
        "buildingArea": _num(g("archArea")),
        "rideLifts": int(_num(g("rideUseElvtCnt")) or 0),
        "emergencyLifts": int(_num(g("emgenUseElvtCnt")) or 0),
        "approved": _day(g("useAprDay")),
        "address": (g("newPlatPlc") or g("platPlc") or "").strip() or None,
    } if title else {"name": name}
    # its floors: every use on each floor with its area (the rows of other buildings on the parcel left out)
    floors: dict[int, dict] = {}
    for r in rows:
        if dong and (r.get("dongNm") or "").strip() not in ("", dong):
            continue
        lv = floor_level(r.get("flrGbCdNm"), r.get("flrNo"))
        if lv is None or lv == 0:
            continue
        f = floors.setdefault(lv, {"level": lv, "label": (r.get("flrNoNm") or (f"지하{-lv}층" if lv < 0 else f"{lv}층")).strip(), "area": 0.0, "uses": []})
        area = _num(r.get("area")) or 0.0
        f["area"] += area
        f["uses"].append({"use": (r.get("mainPurpsCdNm") or "").strip(), "detail": (r.get("etcPurps") or "").strip(), "area": round(area, 2)})
    out = sorted(floors.values(), key=lambda f: f["level"])
    for f in out:
        f["area"] = round(f["area"], 2)
        f["uses"].sort(key=lambda u: -u["area"])
    return {"pnu": pnu, "building": info, "floors": out, "sources": ["국토교통부 건축물대장 (표제부·층별개요)"]}
