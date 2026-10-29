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


def _params(pnu: str, rows: int) -> dict:
    return {"sigunguCd": pnu[:5], "bjdongCd": pnu[5:10], "platGbCd": "1" if pnu[10] == "2" else "0",
            "bun": pnu[11:15], "ji": pnu[15:19], "numOfRows": str(rows)}


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
                # (the title rows a hundred a page — a thousand timed out — the floor rows five hundred)
                res = requests.get(base + op, params={"serviceKey": key, "_type": "json", **_params(pnu, 100 if op == "getBrTitleInfo" else 500), "pageNo": str(page)}, timeout=20)
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


def building_floors(pnu: str, name: str | None = None, area: float | None = None) -> dict:
    if not re.fullmatch(r"\d{19}", pnu or ""):
        raise ValueError("pnu는 19자리 숫자여야 합니다.")
    titles = _cached(f"floors-title:{pnu}", WEEK, lambda: _fetch("getBrTitleInfo", pnu)) or []
    rows = _cached(f"floors-flr:{pnu}", WEEK, lambda: _fetch("getBrFlrOulnInfo", pnu)) or []
    if not titles and not rows:
        raise LookupError("건축물대장에서 이 건물을 찾지 못했습니다.")
    # the building: on a campus of several (a hospital's main block, its cancer centre, its labs…),
    # the one whose footprint is nearest the one gone into (`area`, its plan area), named so; else the largest
    want = _norm(name)
    def score(t: dict) -> tuple:
        nm = _norm(t.get("bldNm")) + _norm(t.get("dongNm"))
        hit = bool(want) and (want in nm or (nm and nm in want))
        fit = -abs((_num(t.get("archArea")) or 0) - area) / max(area, 1) if area else 0
        return (hit, (t.get("mainAtchGbCdNm") or "주").startswith("주"), round(fit, 1), _num(t.get("totArea")) or 0)
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
    # (with no title, the floors of the 동 named most like the building, or the largest)
    if not dong and rows:
        by: dict[str, float] = {}
        for r in rows:
            by[(r.get("dongNm") or "").strip()] = by.get((r.get("dongNm") or "").strip(), 0) + (_num(r.get("area")) or 0)
        named = [d for d in by if want and _norm(d) and (_norm(d) in want or want in _norm(d))]
        dong = (named or sorted(by, key=lambda d: -by[d]))[0]
    # (the title's 동 name is not always the floor rows' — "의료시설" over "본관": then the 동 whose floors
    # reach as high and as deep as the title says)
    names = {(r.get("dongNm") or "").strip() for r in rows}
    if dong and dong not in names and names - {""}:
        def reach(d: str) -> tuple:
            lv = [floor_level(r.get("flrGbCdNm"), r.get("flrNo")) or 0 for r in rows if (r.get("dongNm") or "").strip() == d]
            top, deep = max(lv, default=0), -min(lv, default=0)
            return (-abs(top - (info.get("floors") or top)) - abs(deep - (info.get("basements") or deep)), sum(_num(r.get("area")) or 0 for r in rows if (r.get("dongNm") or "").strip() == d))
        dong = max(names - {""}, key=reach)
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
    # (the parcel's 동 in the floor rows and how many rows each: which one was taken, and from what)
    by_dong: dict[str, int] = {}
    for r in rows:
        k = (r.get("dongNm") or "").strip() or "-"
        by_dong[k] = by_dong.get(k, 0) + 1
    return {"pnu": pnu, "building": info, "floors": out, "dongs": by_dong, "taken": dong or None, "sources": ["국토교통부 건축물대장 (표제부·층별개요)"]}
