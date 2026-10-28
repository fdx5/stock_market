"""The flats of one apartment 동, for the walk mode's interiors (/walk).

Sources
    건축물대장 전유공용면적   국토교통부_건축HUB 건축물대장정보 서비스 (getBrExposPubuseAreaInfo), by the
                             building's PNU and 동 name: one row per 호 and 전유/공용 part — the
                             전용면적 of every flat in that 동, with its floor.
    실거래 전용면적           the complex's 평형 as the map holds them (realestate_map.complex_detail),
                             with how many trades each had.
    공동주택 기본정보(K-apt)   세대수 (realestate_facts.complex_facts).

There are no floor plans in public data: the walk builds an estimated plan from the area. Nothing
is written to the database; register answers are kept in memory for a week, failures ten minutes.
"""

from __future__ import annotations

import logging
import re
import threading
import time

import requests

from app.services import realestate_facts
from app.services import realestate_map as rm
from app.services.realestate_facts import FactsError, _items

log = logging.getLogger(__name__)

EXPOS_ENDPOINTS = (
    "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo",
    "https://apis.data.go.kr/1613000/BldRgstService_v2/getBrExposPubuseAreaInfo",
)
WEEK = 7 * 86400
MAX_PAGES = 6

_lock = threading.Lock()
_memo: dict[str, tuple[float, float, object]] = {}
_MEMO_MAX = 2000


def _cached(key: str, ttl: float, fetch):
    now = time.time()
    with _lock:
        hit = _memo.get(key)
        if hit and now - hit[0] < hit[1]:
            return hit[2]
    try:
        value = fetch()
    except Exception as exc:  # noqa: BLE001 — the register failing leaves the trades
        log.info("units: %s failed (%s)", key.split(":")[0], type(exc).__name__)
        value, ttl = None, 600
    with _lock:
        if len(_memo) >= _MEMO_MAX:
            for k, _ in sorted(_memo.items(), key=lambda kv: kv[1][0])[: _MEMO_MAX // 2]:
                _memo.pop(k, None)
        _memo[key] = (now, ttl, value)
    return value


def _num(v) -> float | None:
    try:
        f = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def dong_key(name: str | None) -> str:
    """'제101동', '101동', '101' → '101'; 'A동' → 'A'; anything else as it is, trimmed."""
    s = re.sub(r"\s+", "", str(name or ""))
    m = re.fullmatch(r"(?:제)?([0-9A-Za-z가-힣]+?)동?", s)
    return (m.group(1) if m else s).upper()


def _expos_rows(pnu: str, dong: str | None) -> list[dict] | None:
    """The register's 전유 rows (one per flat) of the building at `pnu`, of `dong` if given."""
    if not re.fullmatch(r"\d{19}", pnu or ""):
        return None
    key = rm._service_key()
    if not key:
        return None
    base = {"sigunguCd": pnu[:5], "bjdongCd": pnu[5:10], "platGbCd": "1" if pnu[10] == "2" else "0",
            "bun": pnu[11:15], "ji": pnu[15:19], "numOfRows": "1000"}
    want = dong_key(dong) if dong else ""
    tries = [{"dongNm": d} for d in dict.fromkeys([dong, want, f"{want}동", f"제{want}동"]) if d] if dong else []
    tries.append({})  # the whole parcel, filtered here
    last: Exception | None = None
    for url in EXPOS_ENDPOINTS:
        for extra in tries:
            rows: list[dict] = []
            try:
                for page in range(1, MAX_PAGES + 1):
                    if not rm._count_call("bldrgst"):
                        return None
                    res = requests.get(url, params={"serviceKey": key, "_type": "json", **base, **extra, "pageNo": str(page)}, timeout=12)
                    items, total = _items(res)
                    rows.extend(items)
                    if len(rows) >= total or not items:
                        break
            except (FactsError, requests.RequestException, ValueError) as exc:
                if rm.is_quota_error(str(exc)):
                    rm.exhaust("bldrgst")
                    return None
                last = exc
                break
            flats = [r for r in rows if str(r.get("exposPubuseGbCd", "")).strip() == "1"]
            if want:
                flats = [r for r in flats if dong_key(r.get("dongNm")) == want]
            if flats:
                return [{"ho": str(r.get("hoNm") or "").strip(), "floor": _num(r.get("flrNo")), "area": _num(r.get("area")),
                         "dong": str(r.get("dongNm") or "").strip(), "use": str(r.get("mainPurpsCdNm") or r.get("etcPurps") or "").strip()}
                        for r in flats if _num(r.get("area"))]
        if last is None:
            return []
    if last:
        raise last
    return []


def summarize_flats(rows: list[dict]) -> list[dict]:
    """Flats grouped by 전용면적 (to 0.01 ㎡): how many, on which floors. Parts of one 호 are
    summed first (a few registers split a flat's 전유 area over two rows)."""
    per_ho: dict[tuple, dict] = {}
    for r in rows:
        if not re.search(r"아파트|공동주택|주택", r.get("use") or "아파트"):
            continue
        k = (r.get("dong"), r.get("floor"), r.get("ho"))
        h = per_ho.setdefault(k, {"area": 0.0, "floor": r.get("floor")})
        h["area"] += r["area"]
    groups: dict[float, dict] = {}
    for h in per_ho.values():
        a = round(h["area"], 2)
        if not 15 <= a <= 300:
            continue
        g = groups.setdefault(a, {"area": a, "count": 0, "floors": []})
        g["count"] += 1
        if h["floor"] is not None:
            g["floors"].append(int(h["floor"]))
    out = []
    for g in sorted(groups.values(), key=lambda g: g["area"]):
        fl = g.pop("floors")
        out.append({**g, "floor_min": min(fl) if fl else None, "floor_max": max(fl) if fl else None})
    return out


def _rooms(area: float) -> tuple[int, int]:
    return (1, 1) if area < 50 else (2, 2) if area < 78 else (3, 2) if area < 100 else (4, 2)


def units(complex_id: str, dong: str | None = None, pnu: str | None = None) -> dict:
    """The flat types to choose from when entering `dong` of a complex (the map item's id)."""
    detail = rm.complex_detail(complex_id, "1y")  # LookupError / ValueError pass through
    trades = [(float(t["area"]), int(t.get("trades_total") or 0), t.get("price_source") or "sale")
              for t in detail.get("types", []) if _num(t.get("area"))]
    try:
        facts = realestate_facts.complex_facts(complex_id)
    except (LookupError, ValueError, FactsError):
        facts = {}
    register = _cached(f"expos:{pnu}:{dong_key(dong)}", WEEK, lambda: _expos_rows(pnu or "", dong)) if pnu else None
    flats = summarize_flats(register) if register else []
    types = []
    sources = []
    if flats:
        sources.append("건축물대장 전유공용면적 (국토교통부)")
        for f in flats:
            near = min(trades, key=lambda t: abs(t[0] - f["area"]), default=None)
            n = near[1] if near and abs(near[0] - f["area"]) < 1.0 else 0
            rooms, baths = _rooms(f["area"])
            types.append({"key": f"{f['area']:.2f}", "areaM2": f["area"], "trades": n, "households": f["count"],
                          "floors": [f["floor_min"], f["floor_max"]], "rooms": rooms, "baths": baths,
                          "label": f"{f['area']:.2f}㎡ ({round(f['area'] / 3.3058 * 1.33)}평형)",
                          "source": "건축물대장 전유부 전용면적"})
    elif trades:
        for a, n, src in sorted(trades):
            rooms, baths = _rooms(a)
            types.append({"key": f"{a:.2f}", "areaM2": a, "trades": n, "rooms": rooms, "baths": baths,
                          "label": f"{a:.2f}㎡ ({round(a / 3.3058 * 1.33)}평형)",
                          "source": "국토교통부 실거래 전용면적" if src == "sale" else "분양권 전매 신고 전용면적"})
    if trades:
        sources.append("국토교통부 아파트 매매 실거래가")
    if facts.get("matched"):
        sources.append("공동주택관리정보(K-apt)")
    floors = [f["floor_max"] for f in flats if f.get("floor_max")]
    return {
        "complexId": complex_id, "name": detail.get("name") or "", "built": (detail.get("item") or {}).get("built"),
        "households": facts.get("households"), "types": types,
        "dong": {"name": dong, "floors": max(floors) if floors else None, "areaRows": sum(f["count"] for f in flats)} if dong else None,
        "sources": sources,
    }
