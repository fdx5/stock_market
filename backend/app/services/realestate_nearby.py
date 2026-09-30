"""The apartment complexes around one complex, for the 3D viewer's 주변 단지 selector.

The trades carry no coordinates, only each complex's 법정동 and 지번, so the places come
from the browser: it reads the 공동주택 buildings round the view from VWorld (a Korean
network only, which the server abroad can't reach) and the 연속지적도 parcel each stands
on, and sends them here grouped by parcel. A parcel is a complex when a complex's 지번
is that parcel's, in the same 시군구 and 법정동 — an exact match, never a guess by
distance. Several complexes registered on one lot (압구정 현대 1차·2차 on 369-1) are told
apart by the 동 numbers in their names ("현대1차(12,13,21,22,31,32,33동)").
"""
from __future__ import annotations

import re

from app.services import realestate_map as rm

MAX_PARCELS = 400
MAX_ITEMS = 40


def _dongs_in(name: str) -> set[int]:
    """The 동 numbers a complex's name lists: "현대6차(78~81,83,84동)" -> {78..81, 83, 84}."""
    out: set[int] = set()
    for group in re.findall(r"\(([^)]*동[^)]*)\)", name or ""):
        for a, b in re.findall(r"(\d+)\s*(?:[~\-]\s*(\d+))?", group.split(":")[-1]):
            lo, hi = int(a), int(b or a)
            if hi - lo <= 60:
                out.update(range(lo, hi + 1))
    return out


def _dong_of(building: dict) -> int | None:
    """A building's 동 number: its registered 동 name, else the one in its 건물명."""
    for text in (building.get("dong") or "", building.get("name") or ""):
        m = re.search(r"(\d+)\s*동\s*$", text) or re.fullmatch(r"\s*제?\s*(\d+)\s*", text)
        if m:
            return int(m.group(1))
    return None


def _lot(addr: str) -> tuple[str, str] | None:
    """(법정동, 지번) from a parcel's address: "서울특별시 강남구 압구정동 369-1"."""
    parts = (addr or "").split()
    if len(parts) < 2:
        return None
    lot = parts[-1]
    umd = parts[-2]
    if umd == "산" and len(parts) >= 3:
        umd, lot = parts[-3], "산" + lot
    return (umd, lot) if re.fullmatch(r"산?\d+(-\d+)?", lot) else None


def _complexes(lawd: str, cache: dict[str, dict]) -> dict:
    if lawd not in cache:
        found: dict = {}
        if lawd in rm._sgg_index():
            from app.services import realestate_rights
            found = realestate_rights.merge(rm._complexes([lawd]), [lawd])
        cache[lawd] = found
    return cache[lawd]


def nearby(complex_id: str, parcels: list[dict]) -> dict:
    """Complexes on the parcels the browser found round `complex_id` (x east, y north,
    metres from the view's centre). One entry per complex, nearest first."""
    home_lawd = complex_id.split(":", 1)[0]
    if home_lawd not in rm._sgg_index():
        raise ValueError("unknown 시군구")
    cache: dict[str, dict] = {}
    by_lot: dict[tuple[str, str, str], list[dict]] = {}
    found: dict[str, dict] = {}
    for parcel in parcels[:MAX_PARCELS]:
        pnu = str(parcel.get("pnu") or "")
        lot = _lot(str(parcel.get("addr") or ""))
        buildings = [b for b in parcel.get("buildings") or [] if isinstance(b, dict)]
        if not re.fullmatch(r"\d{19}", pnu) or not lot or not buildings:
            continue
        lawd = pnu[:5]
        key = (lawd, *lot)
        if key not in by_lot:
            index = _complexes(lawd, cache)
            # (a 읍·면's trades name the 리 after it: "양평읍 양근리")
            by_lot[key] = [c for c in index.values()
                           if c.get("jibun") == lot[1] and (c.get("umd") or "").split()[-1:] == [lot[0]]]
        matches = by_lot[key]
        if not matches:
            continue
        # One lot, several complexes: each takes the buildings its name lists by 동.
        shares: dict[str, list[dict]] = {c["id"]: [] for c in matches}
        if len(matches) > 1:
            lists = {c["id"]: _dongs_in(c["name"]) for c in matches}
            for b in buildings:
                d = _dong_of(b)
                owner = next((cid for cid, ds in lists.items() if d is not None and d in ds), None)
                if owner:
                    shares[owner].append(b)
            unlisted = [cid for cid, ds in lists.items() if not ds]
            spare = [b for b in buildings if not any(b in s for s in shares.values())]
            if spare and len(unlisted) == 1:
                shares[unlisted[0]].extend(spare)
            # (none told apart: every complex on the lot stands on all of it)
            if not any(shares.values()):
                shares = {cid: buildings for cid in shares}
        else:
            shares[matches[0]["id"]] = buildings
        for c in matches:
            mine = shares[c["id"]]
            if not mine:
                continue
            entry = found.setdefault(c["id"], {"id": c["id"], "name": c["name"], "dong": c.get("dong") or "",
                                               "built": c.get("built") or None, "points": []})
            entry["points"].extend(mine)
    home = {complex_id}
    items = []
    for cid, e in found.items():
        c = _complexes(cid.split(":", 1)[0], cache).get(cid) or {}
        if cid in home or complex_id in (c.get("aliases") or []):
            continue
        pts = e.pop("points")
        x = sum(float(b.get("x") or 0) for b in pts) / len(pts)
        y = sum(float(b.get("y") or 0) for b in pts) / len(pts)
        floors = max((int(b.get("floors") or 0) for b in pts), default=0)
        items.append({**e, "x": round(x, 1), "y": round(y, 1), "towers": len(pts), "floors": floors or None})
    items.sort(key=lambda e: e["x"] ** 2 + e["y"] ** 2)
    return {"id": complex_id, "items": items[:MAX_ITEMS]}
