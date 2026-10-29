"""Crosswalks as surveyed: the 전국횡단보도표준데이터 (data.go.kr standard data, every local
authority's crossings with their place, width, length, lanes and signals), for the walk mode's
streets (/walk) — a zebra is drawn only where one is registered.

The standard-data API filters by field values, not by place, and VWorld's reverse geocoding does
not answer this server's network: the whole register (~10⁵ rows, public data) is fetched once in
the background, a page at a time, kept compact in memory and in a temporary file for a week, and
asked by radius. No database; nothing stored but this public register.
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import os
import tempfile
import threading
import time

import requests

from app.services import realestate_map as rm
from app.services.realestate_building_info import _num

log = logging.getLogger(__name__)

URLS = ("https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api", "http://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api")
ROWS = 1000
KEEP_S = 7 * 86400
FILE = os.path.join(tempfile.gettempdir(), "kospimap-crosswalks-v1.json.gz")
CELL = 0.01  # ~1 km

_lock = threading.Lock()
_state: dict = {"rows": None, "grid": None, "at": 0.0, "loading": False, "progress": 0, "total": 0, "error": None, "fields": None}


def _first(it: dict, *names: str):
    for n in names:
        v = it.get(n)
        if v not in (None, ""):
            return v
    return None


def _row(it: dict):
    lat, lon = _num(_first(it, "latitude", "lat", "위도")), _num(_first(it, "longitude", "lon", "lot", "경도"))
    if lat is None or lon is None or not (33 <= lat <= 39 and 124 <= lon <= 132):
        return None
    width = _num(_first(it, "bt", "crslkBt", "width", "횡단보도폭"))
    length = _num(_first(it, "et", "crslkEt", "length", "횡단보도연장"))
    lanes = _num(_first(it, "cartrkCo", "laneCo", "차로수"))
    signal = str(_first(it, "tfclghtYn", "ptpYn", "보행자신호등유무") or "").upper() == "Y"
    kind = str(_first(it, "crslkKnd", "횡단보도종류") or "")[:12]
    return [round(lat, 6), round(lon, 6), width or 0, length or 0, int(lanes or 0), 1 if signal else 0, kind]


def _page(key: str, page: int) -> tuple[list[dict], int, str]:
    last = ""
    for url in URLS:
        try:
            res = requests.get(url, params={"serviceKey": key, "pageNo": str(page), "numOfRows": str(ROWS), "type": "json"}, timeout=(5, 30))
            if res.status_code != 200:
                last = f"http {res.status_code}"; continue
            try:
                raw = res.json()
            except ValueError:
                # (an XML answer: the portal's error envelope — its code and message only)
                txt = res.text[:600]
                code = (txt.split("<returnReasonCode>")[1].split("<")[0] if "<returnReasonCode>" in txt else txt.split("<resultCode>")[1].split("<")[0] if "<resultCode>" in txt else "")
                msg = (txt.split("<returnAuthMsg>")[1].split("<")[0] if "<returnAuthMsg>" in txt else txt.split("<resultMsg>")[1].split("<")[0] if "<resultMsg>" in txt else "")
                last = f"xml {code} {msg}"[:80]; continue
            # (the standard-data API answers {header, body}; the other portal APIs wrap it in response)
            body = raw.get("response") or raw
            head, data = body.get("header") or {}, body.get("body") or {}
            code = str(head.get("resultCode", ""))
            if code not in ("00", "0", "NORMAL_SERVICE", ""):
                last = f"result {code} {str(head.get('resultMsg', ''))[:40]}"; continue
            if not data:
                last = "shape " + ",".join(sorted(raw.keys()))[:60]; continue
            items = data.get("items") or []
            if isinstance(items, dict):
                items = items.get("item") or []
            if isinstance(items, dict):
                items = [items]
            return items, int(_num(data.get("totalCount")) or 0), "ok"
        except (requests.RequestException, ValueError) as exc:
            # (never the exception's text: its URL carries the service key)
            last = type(exc).__name__
    return [], 0, last


def _index(rows: list[list]) -> dict:
    grid: dict[tuple[int, int], list[int]] = {}
    for i, r in enumerate(rows):
        grid.setdefault((int(r[0] // CELL), int(r[1] // CELL)), []).append(i)
    return grid


def _load_file() -> bool:
    try:
        if time.time() - os.path.getmtime(FILE) > KEEP_S:
            return False
        with gzip.open(FILE, "rt", encoding="utf-8") as f:
            rows = json.load(f)
        with _lock:
            _state.update(rows=rows, grid=_index(rows), at=os.path.getmtime(FILE), error=None)
        return True
    except (OSError, ValueError):
        return False


def _fetch_all():
    key = rm._service_key()
    try:
        if not key:
            _state.update(error="unconfigured"); return
        items, total, status = _page(key, 1)
        if status != "ok":
            _state.update(error=status); return
        if items:
            _state["fields"] = sorted(items[0].keys())[:40]
        rows = [r for r in (_row(it) for it in items) if r]
        if not rows:
            _state.update(error=f"no rows (total {total}, items {len(items)})"); return
        pages = max(1, math.ceil(total / ROWS))
        _state.update(total=total, progress=1)
        for page in range(2, pages + 1):
            got, _, status = _page(key, page)
            if status != "ok":
                got, _, status = _page(key, page)   # (once more: the portal drops a request now and then)
            rows.extend(r for r in (_row(it) for it in got) if r)
            _state["progress"] = page
        try:
            with gzip.open(FILE, "wt", encoding="utf-8") as f:
                json.dump(rows, f, separators=(",", ":"))
        except OSError:
            pass
        with _lock:
            _state.update(rows=rows, grid=_index(rows), at=time.time(), error=None)
        log.info("crosswalks: %d registered crossings", len(rows))
    finally:
        _state["loading"] = False
        if _state["rows"] is None:
            _state["retry_at"] = time.time() + 120


def _ensure():
    with _lock:
        fresh = _state["rows"] is not None and time.time() - _state["at"] < KEEP_S
        if fresh or _state["loading"] or time.time() < _state.get("retry_at", 0):
            return
        _state["loading"] = True
    if _load_file():
        _state["loading"] = False
        return
    threading.Thread(target=_fetch_all, name="crosswalks", daemon=True).start()


def crosswalks(lat: float, lon: float, radius: float = 1500, debug: bool = False) -> dict:
    if not (33 <= lat <= 39 and 124 <= lon <= 132):
        raise ValueError("국내 좌표가 아닙니다.")
    _ensure()
    rows, grid = _state["rows"], _state["grid"]
    if rows is None:
        out = {"status": "loading" if _state["loading"] else "unavailable", "items": [], "progress": _state["progress"], "total": _state["total"],
               "error": _state["error"], "source": None}
        if debug:
            out["fields"] = _state["fields"]
        return out
    kx, ky = math.cos(math.radians(lat)) * 111_320, 110_540
    r = max(100.0, min(3000.0, radius))
    dlat, dlon = r / ky, r / kx
    items = []
    for i in range(int((lat - dlat) // CELL), int((lat + dlat) // CELL) + 1):
        for j in range(int((lon - dlon) // CELL), int((lon + dlon) // CELL) + 1):
            for k in grid.get((i, j), ()):
                la, lo, w, ln, lanes, sig, kind = rows[k]
                x, y = (lo - lon) * kx, (la - lat) * ky
                if x * x + y * y <= r * r:
                    items.append({"at": [round(x, 2), round(y, 2)], "width": w, "length": ln, "lanes": lanes, "signals": bool(sig), "kind": kind})
    out = {"status": "available", "items": items, "source": "전국횡단보도표준데이터 (공공데이터포털)", "count": len(rows)}
    if debug:
        out["fields"] = _state["fields"]
    return out
