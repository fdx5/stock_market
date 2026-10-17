"""Live public data over the drone view: subway trains and stations, emergency-room beds,
road speeds, 따릉이 docks and public car parks.

Everything is read-only and process-local (short in-memory caches, no database). Provider keys
stay on the server; the browser receives only the values below. Each answer carries a `status`:

  ok             the provider answered
  needs_key      the server has no key for this provider yet
  invalid_key    the provider rejected the key (not issued, or not approved for this API)
  unavailable    the provider could not be reached or answered something unreadable

Sources (all public open data):
  서울 열린데이터광장  openapi.seoul.go.kr:8088  (SEOUL_OPEN_API_KEY): 따릉이 bikeList,
      공영주차장 GetParkingInfo, 도로소통 TrafficInfo, 역 정보·시간표
  서울 실시간 지하철    swopenapi.seoul.go.kr     (SEOUL_SUBWAY_API_KEY): 열차 위치, 도착 정보
  국립중앙의료원 E-Gen  apis.data.go.kr/B552657   (DATA_GO_KR_API_KEY / MOLIT_API_KEY): 응급실 가용병상
  국가교통정보센터 ITS  openapi.its.go.kr         (ITS_API_KEY): 표준링크 소통정보
  VWorld 지오코더      (VWORLD_API_KEY): 공영주차장 주소의 좌표
"""
from __future__ import annotations

import datetime as dt
import math
import os
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import requests

SEOUL = "http://openapi.seoul.go.kr:8088"
SUBWAY = "http://swopenapi.seoul.go.kr/api/subway"
EGEN = "https://apis.data.go.kr/B552657/ErmctInfoInqireService"
ITS = "https://openapi.its.go.kr:9443/trafficInfo"
VWORLD_GEOCODE = "https://api.vworld.kr/req/address"
KST = dt.timezone(dt.timedelta(hours=9))

SUBWAY_LINES = ("1호선", "2호선", "3호선", "4호선", "5호선", "6호선", "7호선", "8호선", "9호선", "경의중앙선",
                "공항철도", "경춘선", "수인분당선", "신분당선", "우이신설선", "서해선", "경강선", "GTX-A", "신림선")
# The real-time API's line codes (subwayId)
LINE_IDS = {"1001": "1호선", "1002": "2호선", "1003": "3호선", "1004": "4호선", "1005": "5호선", "1006": "6호선",
            "1007": "7호선", "1008": "8호선", "1009": "9호선", "1063": "경의중앙선", "1065": "공항철도", "1067": "경춘선",
            "1075": "수인분당선", "1077": "신분당선", "1092": "우이신설선", "1093": "서해선", "1081": "경강선",
            "1032": "GTX-A", "1094": "신림선"}
TRAIN_STATUS = {"0": "진입", "1": "도착", "2": "출발", "3": "전역출발"}
ARRIVAL_CODE = {"0": "진입", "1": "도착", "2": "출발", "3": "전역 출발", "4": "전역 진입", "5": "전역 도착", "99": "운행 중"}

_lock = threading.RLock()
_cache: dict = {}
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="public-live")


class KeyMissing(Exception):
    pass


class KeyRejected(Exception):
    pass


def _env(*names: str) -> str:
    for n in names:
        v = (os.environ.get(n) or "").strip()
        if v:
            return v
    return ""


def _seoul_key() -> str:
    return _env("SEOUL_OPEN_API_KEY", "SEOUL_API_KEY")


def _subway_key() -> str:
    return _env("SEOUL_SUBWAY_API_KEY", "SEOUL_OPEN_API_KEY", "SEOUL_API_KEY")


def _portal_key() -> str:
    key = _env("DATA_GO_KR_API_KEY", "EGEN_API_KEY", "MOLIT_API_KEY")
    # (the portal's "Encoding" key: requests encodes it again otherwise)
    return urllib.parse.unquote(key) if "%" in key else key


def _cached(name: str, ttl: float, make, stale: float = 0):
    """`make()` at most every `ttl` seconds per name; a failure within `stale` seconds of the last
    good answer returns that answer (marked stale) rather than nothing."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(name)
        if hit and now - hit[0] < ttl:
            return hit[1]
        lock = _cache.setdefault("lock:" + name, (0, threading.Lock()))[1]
    with lock:
        with _lock:
            hit = _cache.get(name)
            if hit and time.monotonic() - hit[0] < ttl:
                return hit[1]
        try:
            value = make()
        except (KeyMissing, KeyRejected):
            raise
        except Exception:
            if hit and now - hit[0] < stale:
                return {**hit[1], "stale": True} if isinstance(hit[1], dict) else hit[1]
            raise
        with _lock:
            _cache[name] = (time.monotonic(), value)
            # (bounded: the per-station and per-cell entries come and go)
            if len(_cache) > 4000:
                for k in sorted((k for k in _cache if not k.startswith("lock:")), key=lambda k: _cache[k][0])[:1000]:
                    _cache.pop(k, None)
        return value


def _status_of(exc: Exception) -> str:
    return "needs_key" if isinstance(exc, KeyMissing) else "invalid_key" if isinstance(exc, KeyRejected) else "unavailable"


def _seoul(service: str, start: int, end: int, *args: str, fmt: str = "json", timeout=(4, 10)):
    key = _seoul_key()
    if not key:
        raise KeyMissing(service)
    if key == "sample":  # (the providers' public sample key, for local checks: five rows at most)
        end = start + 4
    path = "/".join(urllib.parse.quote(str(a), safe="") for a in (key, fmt, service, start, end, *args))
    r = requests.get(f"{SEOUL}/{path}/", timeout=timeout)
    r.raise_for_status()
    if fmt == "xml":
        root = ET.fromstring(r.content)
        code = root.findtext("RESULT/CODE") or root.findtext("CODE") or ""
        if code == "INFO-100":
            raise KeyRejected(service)
        if code.startswith("ERROR"):
            raise ValueError(code)
        return [{c.tag: (c.text or "") for c in row} for row in root.findall("row")]
    try:
        body = r.json()
    except ValueError:
        # (errors come as XML whatever was asked for)
        code = ET.fromstring(r.content).findtext(".//CODE") or "unreadable"
        if code == "INFO-100":
            raise KeyRejected(service) from None
        if code == "INFO-200":
            return []
        raise ValueError(code) from None
    block = body.get(service) if isinstance(body, dict) else None
    # (some services answer under another name: bikeList's rows are in rentBikeStatus)
    if block is None and isinstance(body, dict):
        block = next((v for v in body.values() if isinstance(v, dict) and ("row" in v or "list_total_count" in v)), None)
    result = (block or body).get("RESULT", {}) if isinstance(block or body, dict) else {}
    code = str(result.get("CODE", ""))
    if code == "INFO-100":
        raise KeyRejected(service)
    if code == "INFO-200":
        return []
    if not block:
        raise ValueError(code or "no data")
    return block.get("row", []) or []


def _subway(service: str, start: int, end: int, arg: str):
    key = _subway_key()
    if not key:
        raise KeyMissing(service)
    if key == "sample":
        start, end = 0, 5
    r = requests.get(f"{SUBWAY}/{urllib.parse.quote(key, safe='')}/json/{service}/{start}/{end}/{urllib.parse.quote(arg, safe='')}", timeout=(4, 8))
    r.raise_for_status()
    body = r.json()
    err = body.get("errorMessage") or (body if "code" in body else {})
    code = str(err.get("code", ""))
    if code in ("INFO-100", "ERROR-300") and "인증" in str(err.get("message", "")):
        raise KeyRejected(service)
    if code == "INFO-100":
        raise KeyRejected(service)
    if code == "INFO-200":
        return []
    if code and code != "INFO-000":
        raise ValueError(code)
    return body.get("realtimePositionList") or body.get("realtimeArrivalList") or []


def _num(v, default=None):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _near(lat: float, lon: float, items: list[dict], radius: float, limit: int) -> list[dict]:
    kx = 111320 * math.cos(math.radians(lat))
    out = []
    for it in items:
        d = math.hypot((it["lon"] - lon) * kx, (it["lat"] - lat) * 110540)
        if d <= radius:
            out.append({**it, "distance": round(d)})
    out.sort(key=lambda it: it["distance"])
    return out[:limit]


# ── subway ──────────────────────────────────────────────────────────────────


def _line_trains(line: str) -> list[dict]:
    rows = _subway("realtimePosition", 0, 300, line)
    out = []
    for r in rows:
        out.append({
            "line": LINE_IDS.get(str(r.get("subwayId")), line), "train": str(r.get("trainNo") or ""),
            "station": str(r.get("statnNm") or ""), "stationId": str(r.get("statnId") or ""),
            "direction": str(r.get("updnLine") or ""), "terminal": str(r.get("statnTnm") or "").removesuffix("종착"),
            "status": TRAIN_STATUS.get(str(r.get("trainSttus")), ""), "express": str(r.get("directAt")) in ("1", "7"),
            "last": str(r.get("lstcarAt")) == "1", "at": str(r.get("recptnDt") or ""),
        })
    return out


def subway_trains(lines: list[str]) -> dict:
    lines = [l for l in dict.fromkeys(lines) if l in SUBWAY_LINES][:8]
    trains, issues = [], []
    futures = {l: _pool.submit(_cached, "trains:" + l, 20, lambda l=l: {"items": _line_trains(l)}, 120) for l in lines}
    status = "ok"
    for line, f in futures.items():
        try:
            trains += f.result()["items"]
        except Exception as e:  # noqa: BLE001 - reported per line
            s = _status_of(e)
            issues.append({"line": line, "status": s})
            if s in ("needs_key", "invalid_key"):
                status = s
    if issues and status == "ok":
        status = "partial" if trains else "unavailable"
    return {"status": status, "items": trains, "issues": issues, "source": "서울교통공사·서울시 실시간 지하철 위치 (서울 열린데이터광장)",
            "updated": dt.datetime.now(KST).strftime("%H:%M:%S")}


_HOLIDAYS = {
    # 관공서의 공휴일 (대체공휴일 포함), 2026–2027
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24",
    "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26",
    "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
    "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13",
    "2027-06-06", "2027-08-15", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04",
    "2027-10-09", "2027-10-11", "2027-12-25",
}


def day_type(now: dt.datetime | None = None) -> str:
    """The timetable for today: 1 평일, 2 토요일, 3 일요일·공휴일. (The trains' day runs past midnight:
    before 4 a.m. it is still yesterday's timetable.)"""
    now = (now or dt.datetime.now(KST)) - dt.timedelta(hours=4)
    if now.strftime("%Y-%m-%d") in _HOLIDAYS or now.weekday() == 6:
        return "3"
    return "2" if now.weekday() == 5 else "1"


def _line_of_code(line_num: str) -> str:
    n = line_num.strip()
    if n[:2].isdigit() and n.endswith("호선"):
        return f"{int(n[:2])}호선"
    for key, line in (("신분당", "신분당선"), ("분당", "수인분당선"), ("수인", "수인분당선"), ("경의", "경의중앙선"), ("중앙", "경의중앙선"),
                      ("공항", "공항철도"), ("경춘", "경춘선"), ("우이", "우이신설선"), ("서해", "서해선"), ("경강", "경강선"),
                      ("GTX", "GTX-A"), ("신림", "신림선")):
        if key in n:
            return line
    return n


def _station_codes(name: str) -> list[dict]:
    def make():
        rows = _seoul("SearchInfoBySubwayNameService", 1, 50, name)
        return {"items": [{"code": str(r.get("STATION_CD") or ""), "line": _line_of_code(str(r.get("LINE_NUM") or "")),
                           "lineNum": str(r.get("LINE_NUM") or ""), "fr": str(r.get("FR_CODE") or ""), "name": str(r.get("STATION_NM") or "")}
                          for r in rows if r.get("STATION_CD")]}
    return _cached("codes:" + name, 86400, make, 86400 * 3)["items"]


def _timetable(code: str, week: str, inout: str) -> list[dict]:
    def make():
        rows = _seoul("SearchSTNTimeTableByIDService", 1, 1000, code, week, inout)
        items = []
        for r in rows:
            # (a train ending here has no departure: 00:00:00; its arrival is its time)
            left, arrive = str(r.get("LEFTTIME") or ""), str(r.get("ARRIVETIME") or "")
            t = left if left and left != "00:00:00" else arrive
            if not t or t == "00:00:00":
                continue
            items.append({"time": t[:5], "arrive": str(r.get("ARRIVETIME") or "")[:5], "train": str(r.get("TRAIN_NO") or ""),
                          "to": str(r.get("SUBWAYENAME") or ""), "from": str(r.get("SUBWAYSNAME") or ""),
                          "express": str(r.get("EXPRESS_YN") or "") in ("D", "Y", "E")})
        # (after midnight belongs at the end of the day)
        items.sort(key=lambda i: ("1" if i["time"] < "04:00" else "0") + i["time"])
        return {"items": items}
    return _cached(f"tt:{code}:{week}:{inout}", 43200, make, 86400)["items"]


def _arrivals(name: str) -> list[dict]:
    def make():
        rows = _subway("realtimeStationArrival", 0, 60, name)
        items = []
        for r in rows:
            items.append({
                "line": LINE_IDS.get(str(r.get("subwayId")), str(r.get("subwayId") or "")),
                "direction": str(r.get("updnLine") or ""), "heading": str(r.get("trainLineNm") or ""),
                "toward": str(r.get("bstatnNm") or ""), "train": str(r.get("btrainNo") or ""),
                "seconds": int(_num(r.get("barvlDt"), 0) or 0), "message": str(r.get("arvlMsg2") or ""),
                "at": str(r.get("arvlMsg3") or ""), "code": ARRIVAL_CODE.get(str(r.get("arvlCd")), ""),
                "kind": str(r.get("btrainSttus") or ""), "last": str(r.get("lstcarAt")) == "1",
                "received": str(r.get("recptnDt") or ""), "order": str(r.get("ordkey") or ""),
            })
        return {"items": items}
    return _cached("arr:" + name, 15, make, 60)["items"]


def subway_station(name: str, lines: list[str] | None = None, week: str | None = None) -> dict:
    name = name.strip().removesuffix("역") if len(name.strip()) > 2 else name.strip()
    week = week if week in ("1", "2", "3") else day_type()
    out: dict = {"name": name, "week": week, "weekName": {"1": "평일", "2": "토요일", "3": "일요일·공휴일"}[week],
                 "source": "서울교통공사·서울시 (서울 열린데이터광장) 실시간 도착·역 시간표", "updated": dt.datetime.now(KST).strftime("%H:%M:%S")}
    try:
        out["arrivals"] = _arrivals(name)
        out["arrivalStatus"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["arrivals"], out["arrivalStatus"] = [], _status_of(e)
    timetables = []
    try:
        codes = _station_codes(name)
        if lines:
            codes = sorted(codes, key=lambda c: (c["line"] not in lines, c["line"]))
        jobs = []
        for c in codes[:6]:
            for inout in ("1", "2"):
                jobs.append((c, inout, _pool.submit(_timetable, c["code"], week, inout)))
        for c, inout, f in jobs:
            try:
                items = f.result()
            except Exception as e:  # noqa: BLE001
                timetables.append({"line": c["line"], "code": c["code"], "inout": inout, "status": _status_of(e), "items": []})
                continue
            timetables.append({"line": c["line"], "code": c["code"], "fr": c["fr"], "inout": inout,
                               "direction": ("내선" if inout == "1" else "외선") if c["line"] == "2호선" else ("상행" if inout == "1" else "하행"),
                               "status": "ok", "items": items})
        out["timetableStatus"] = "ok"
    except Exception as e:  # noqa: BLE001
        out["timetableStatus"] = _status_of(e)
    out["timetables"] = timetables
    s = [out.get("arrivalStatus"), out.get("timetableStatus")]
    out["status"] = "ok" if "ok" in s else s[0]
    return out


# ── emergency rooms ─────────────────────────────────────────────────────────


def _egen(op: str, params: dict) -> list[dict]:
    key = _portal_key()
    if not key:
        raise KeyMissing(op)
    r = requests.get(f"{EGEN}/{op}", params={"serviceKey": key, "pageNo": 1, "numOfRows": 1000, **params}, timeout=(4, 15))
    text = r.content
    if r.status_code in (401, 403) or b"SERVICE_KEY_IS_NOT_REGISTERED" in text or b"SERVICE ACCESS DENIED" in text:
        raise KeyRejected(op)
    r.raise_for_status()
    root = ET.fromstring(text)
    code = root.findtext("header/resultCode") or root.findtext(".//returnReasonCode") or ""
    if code and code not in ("00", "0"):
        if code in ("30", "20", "31", "32"):
            raise KeyRejected(op)
        raise ValueError(code)
    return [{c.tag: (c.text or "").strip() for c in item} for item in root.findall(".//item")]


def _er_places() -> dict:
    def make():
        rows = _egen("getEgytListInfoInqire", {})
        out = {}
        for r in rows:
            lat, lon = _num(r.get("wgs84Lat")), _num(r.get("wgs84Lon"))
            if r.get("hpid") and lat and lon:
                out[r["hpid"]] = {"lat": lat, "lon": lon, "address": r.get("dutyAddr", ""), "kind": r.get("dutyEmclsName", ""),
                                  "tel": r.get("dutyTel1", ""), "name": r.get("dutyName", "")}
        if not out:
            raise ValueError("no places")
        return {"items": out}
    return _cached("er:places", 86400, make, 86400 * 7)["items"]


def _er_beds() -> list[dict]:
    def make():
        return {"items": _egen("getEmrrmRltmUsefulSckbdInfoInqire", {})}
    return _cached("er:beds", 60, make, 600)["items"]


def emergency(lat: float, lon: float, radius: float = 8000) -> dict:
    try:
        places = _er_places()
        beds = _er_beds()
    except Exception as e:  # noqa: BLE001
        return {"status": _status_of(e), "items": []}
    items = []
    for b in beds:
        p = places.get(b.get("hpid", ""))
        if not p:
            continue
        def n(k):
            v = _num(b.get(k))
            return int(v) if v is not None else None
        items.append({
            "id": b["hpid"], "name": b.get("dutyName") or p["name"], "lat": p["lat"], "lon": p["lon"], "kind": p["kind"],
            "address": p["address"], "tel": b.get("dutyTel3") or p["tel"], "updated": b.get("hvidate", ""),
            "er": n("hvec"), "erTotal": n("hvs01"), "surgery": n("hvoc"), "icu": n("hvicc"), "ward": n("hvgc"),
            "neonatal": n("hvncc"), "neuroIcu": n("hvcc"), "chestIcu": n("hvccc"),
            "ct": b.get("hvctayn") == "Y", "mri": b.get("hvmriayn") == "Y", "angio": b.get("hvangioayn") == "Y",
            "ventilator": b.get("hvventiayn") == "Y", "ambulance": b.get("hvamyn") == "Y",
        })
    return {"status": "ok", "items": _near(lat, lon, items, radius, 60), "source": "국립중앙의료원 중앙응급의료센터 (E-Gen) 실시간 가용병상"}


# ── 따릉이 ──────────────────────────────────────────────────────────────────


def _bike_all() -> list[dict]:
    def make():
        rows = []
        for start in range(1, 5001, 1000):
            page = _seoul("bikeList", start, start + 999)
            rows += page
            if len(page) < 1000:
                break
        items = []
        for r in rows:
            lat, lon = _num(r.get("stationLatitude")), _num(r.get("stationLongitude"))
            if not lat or not lon:
                continue
            items.append({"id": str(r.get("stationId") or ""), "name": str(r.get("stationName") or "").split(". ", 1)[-1].strip(),
                          "lat": lat, "lon": lon, "bikes": int(_num(r.get("parkingBikeTotCnt"), 0)), "racks": int(_num(r.get("rackTotCnt"), 0)),
                          "shared": int(_num(r.get("shared"), 0))})
        if not items:
            raise ValueError("no stations")
        return {"items": items}
    return _cached("bikes", 60, make, 600)["items"]


def bikes(lat: float, lon: float, radius: float = 1500) -> dict:
    try:
        return {"status": "ok", "items": _near(lat, lon, _bike_all(), radius, 200), "source": "서울특별시 공공자전거 실시간 대여정보 (서울 열린데이터광장)",
                "updated": dt.datetime.now(KST).strftime("%H:%M")}
    except Exception as e:  # noqa: BLE001
        return {"status": _status_of(e), "items": []}


# ── 공영주차장 ──────────────────────────────────────────────────────────────


def _geocode(address: str) -> tuple[float, float] | None:
    key = _env("VWORLD_API_KEY")
    if not key or not address:
        return None

    def make():
        for kind in ("parcel", "road"):
            r = requests.get(VWORLD_GEOCODE, params={"service": "address", "request": "getcoord", "version": "2.0", "crs": "epsg:4326",
                                                    "address": "서울특별시 " + address, "type": kind, "format": "json", "key": key}, timeout=(4, 8))
            body = r.json().get("response", {})
            if body.get("status") == "OK":
                p = body["result"]["point"]
                return {"at": (float(p["y"]), float(p["x"]))}
        return {"at": None}
    try:
        return _cached("geo:" + address, 86400 * 7, make)["at"]
    except Exception:  # noqa: BLE001
        return None


_coords: dict | None = None


def _parking_coords() -> dict:
    global _coords
    if _coords is None:
        import json
        path = os.path.join(os.path.dirname(__file__), "..", "data", "seoul_parking_coords_20261017.json")
        try:
            with open(path, encoding="utf-8") as f:
                _coords = json.load(f).get("lots", {})
        except (OSError, ValueError):
            _coords = {}
    return _coords


def _parking_all() -> list[dict]:
    def make():
        rows = []
        for start in range(1, 3001, 1000):
            page = _seoul("GetParkingInfo", start, start + 999)
            rows += page
            if len(page) < 1000:
                break
        lots: dict[str, dict] = {}
        for r in rows:
            code = str(r.get("PKLT_CD") or "")
            if not code or code in lots:
                continue
            total, now = _num(r.get("TPKCT")), _num(r.get("NOW_PRK_VHCL_CNT"))
            lots[code] = {"id": code, "name": str(r.get("PKLT_NM") or ""), "address": str(r.get("ADDR") or ""),
                          "total": int(total) if total is not None else None, "parked": int(now) if now is not None else None,
                          "live": str(r.get("PRK_STTS_YN")) == "1", "updated": str(r.get("NOW_PRK_VHCL_UPDT_TM") or ""),
                          "type": str(r.get("PRK_TYPE_NM") or ""), "tel": str(r.get("TELNO") or ""), "paid": str(r.get("PAY_YN_NM") or ""),
                          "basic": {"won": _num(r.get("BSC_PRK_CRG")), "minutes": _num(r.get("BSC_PRK_HR"))},
                          "extra": {"won": _num(r.get("ADD_PRK_CRG")), "minutes": _num(r.get("ADD_PRK_HR"))},
                          "dayMax": _num(r.get("DAY_MAX_CRG")),
                          "hours": {"weekday": f"{r.get('WD_OPER_BGNG_TM', '')}-{r.get('WD_OPER_END_TM', '')}",
                                    "weekend": f"{r.get('WE_OPER_BGNG_TM', '')}-{r.get('WE_OPER_END_TM', '')}",
                                    "holiday": f"{r.get('LHLDY_OPER_BGNG_TM', '')}-{r.get('LHLDY_OPER_END_TM', '')}"}}
        if not lots:
            raise ValueError("no lots")
        # (positions: from the table geocoded in Korea — the hosting network cannot reach the
        # geocoder — else geocoded here once per address, in parallel)
        known = _parking_coords()
        found = list(_pool.map(lambda lot: tuple(known[lot["id"]]) if lot["id"] in known else _geocode(lot["address"]), lots.values()))
        items = []
        for lot, at in zip(lots.values(), found):
            if at:
                items.append({**lot, "lat": at[0], "lon": at[1]})
        return {"items": items}
    return _cached("parking", 120, make, 900)["items"]


def parking(lat: float, lon: float, radius: float = 3000) -> dict:
    try:
        return {"status": "ok", "items": _near(lat, lon, _parking_all(), radius, 120), "source": "서울시 공영주차장 실시간 주차대수 (서울 열린데이터광장)"}
    except Exception as e:  # noqa: BLE001
        return {"status": _status_of(e), "items": []}


# ── road speeds ─────────────────────────────────────────────────────────────


def _its_cell(lat: float, lon: float) -> dict:
    key = _env("ITS_TRAFFIC_API_KEY", "ITS_API_KEY")
    if not key:
        raise KeyMissing("its")
    cy, cx = round(lat / 0.02) * 0.02, round(lon / 0.025) * 0.025

    def make():
        r = requests.get(ITS, params={"apiKey": key, "type": "all", "drcType": "all", "minX": cx - 0.025, "maxX": cx + 0.025,
                                      "minY": cy - 0.02, "maxY": cy + 0.02, "getType": "json"}, timeout=(3, 8))
        if r.status_code in (401, 403):
            raise KeyRejected("its")
        r.raise_for_status()
        try:
            body = r.json()
            items = ((body.get("body") or body.get("response", {}).get("body") or {}).get("items")) or []
        except ValueError:
            root = ET.fromstring(r.content)
            code = root.findtext("header/resultCode") or ""
            if code not in ("", "0"):
                raise KeyRejected("its") if code in ("1", "2", "3", "99") else ValueError(code)
            items = [{c.tag: c.text for c in it} for it in root.findall(".//item")]
        if isinstance(items, dict):
            items = items.get("item") or []
        speeds = {}
        for it in items if isinstance(items, list) else [items]:
            v = _num(it.get("speed"))
            if it.get("linkId") and v is not None:
                speeds[str(it["linkId"])] = v
        return {"speeds": speeds}
    return _cached(f"its:{cy:.3f}:{cx:.3f}", 300, make, 900)["speeds"]


_its_down = 0.0
_topis: dict[str, tuple[float, float | None]] = {}
_topis_busy: set[str] = set()


def _topis_fetch(link: str) -> None:
    try:
        rows = _seoul("TrafficInfo", 1, 5, link, fmt="xml", timeout=(3, 6))
        v = _num(rows[0].get("prcs_spd")) if rows else None
        with _lock:
            _topis[link] = (time.monotonic(), v)
            if len(_topis) > 20000:
                for k in sorted(_topis, key=lambda k: _topis[k][0])[:5000]:
                    _topis.pop(k, None)
    except Exception:  # noqa: BLE001 - asked again on a later poll
        pass
    finally:
        with _lock:
            _topis_busy.discard(link)


def _topis_speeds(links: list[str]) -> tuple[dict[str, float], int]:
    """What TOPIS has said about these links in the last five minutes; the others are asked for in
    the background (the next poll has them): one link per request is the provider's form."""
    now, out, asked = time.monotonic(), {}, 0
    with _lock:
        for link in links:
            hit = _topis.get(link)
            if hit and now - hit[0] < 300:
                if hit[1] is not None:
                    out[link] = hit[1]
                continue
            if hit and hit[1] is not None and now - hit[0] < 900:
                out[link] = hit[1]
            if link not in _topis_busy and len(_topis_busy) < 600:
                _topis_busy.add(link)
                asked += 1
                _pool.submit(_topis_fetch, link)
    return out, asked


def traffic(lat: float, lon: float, links: list[str]) -> dict:
    """Speeds (km/h) by standard link ID round (lat, lon): the national ITS feed for the area, and
    Seoul's TOPIS feed link by link for the links asked about that ITS did not cover."""
    speeds: dict[str, float] = {}
    sources, statuses = [], []
    in_seoul = 37.42 <= lat <= 37.71 and 126.76 <= lon <= 127.19
    # ITS only outside Seoul (TOPIS covers Seoul), and not again for 10 minutes after it failed:
    # the hosting network has timed out connecting to it, and nobody should wait on that.
    global _its_down
    if not in_seoul and time.monotonic() > _its_down:
        try:
            speeds.update(_its_cell(lat, lon))
            sources.append("국토교통부 국가교통정보센터")
            statuses.append("ok")
        except Exception as e:  # noqa: BLE001
            if not isinstance(e, KeyMissing):
                _its_down = time.monotonic() + 600
            statuses.append(_status_of(e))
    want = [l for l in dict.fromkeys(links) if l not in speeds and l.isdigit() and len(l) == 10][:600]
    # (TOPIS answers for Seoul's links only: asked only over Seoul)
    seoul = want if in_seoul else []
    pending = 0
    if seoul and _seoul_key():
        got, pending = _topis_speeds(seoul)
        speeds.update(got)
        statuses.append("ok" if got or pending else "unavailable")
        if got or pending:
            sources.append("서울시 교통정보센터 TOPIS")
    elif seoul:
        statuses.append("needs_key")
    status = "ok" if "ok" in statuses else (statuses[0] if statuses else "unavailable")
    if not in_seoul and status != "ok":
        status = "outside"
    return {"status": status, "speeds": speeds, "pending": pending, "source": " · ".join(sources), "updated": dt.datetime.now(KST).strftime("%H:%M")}


def _safe(f, *a):
    try:
        return f(*a)
    except Exception:  # noqa: BLE001
        return None


def status() -> dict:
    """Which providers have keys (names only, never values)."""
    return {"seoul": bool(_seoul_key()), "subway": bool(_subway_key()), "egen": bool(_portal_key()),
            "its": bool(_env("ITS_TRAFFIC_API_KEY", "ITS_API_KEY")), "geocoder": bool(_env("VWORLD_API_KEY"))}


# ── public facilities (OpenStreetMap) ───────────────────────────────────────

FACILITY_KINDS = (
    ("fire", "소방서·119안전센터", '["amenity"="fire_station"]'),
    ("police", "경찰서·지구대·파출소", '["amenity"="police"]'),
    ("health", "보건소", '["amenity"~"clinic|doctors|hospital"]["name"~"보건(소|지소|분소)"]'),
    ("post", "우체국", '["amenity"="post_office"]'),
    ("aed", "자동심장충격기(AED)", '["emergency"="defibrillator"]'),
    ("shelter", "대피소·대피장소", '["emergency"~"assembly_point|shelter"]'),
    ("exit", "지하철 출입구", '["railway"="subway_entrance"]'),
)


def _facility_kind(tags: dict) -> str | None:
    a, e, n = tags.get("amenity", ""), tags.get("emergency", ""), tags.get("name", "")
    if tags.get("railway") == "subway_entrance":
        return "exit"
    if a == "fire_station":
        return "fire"
    if a == "police":
        return "police"
    if a in ("clinic", "doctors", "hospital") and "보건" in n:
        return "health"
    if a == "post_office":
        return "post"
    if e == "defibrillator":
        return "aed"
    if e in ("assembly_point", "shelter"):
        return "shelter"
    return None


OVERPASS = ("https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter")
_overpass_skip: dict[str, float] = {}


def _overpass_any(query: str) -> list[dict]:
    """The first public Overpass server that answers (one that failed is left alone a minute)."""
    last = "unavailable"
    for url in OVERPASS:
        if time.monotonic() < _overpass_skip.get(url, 0):
            continue
        try:
            r = requests.post(url, data={"data": query}, headers={"User-Agent": "kospimap.com drone public facilities"}, timeout=(5, 30))
            if r.ok:
                body = r.json()
                if isinstance(body, dict) and isinstance(body.get("elements"), list) and "error" not in str(body.get("remark", "")).lower():
                    return body["elements"]
            last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = type(e).__name__
        _overpass_skip[url] = time.monotonic() + 60
    raise ValueError(last)


def facilities(lat: float, lon: float) -> dict:
    """Fire stations, police, public health centres, post offices, AEDs and shelters round (lat, lon)
    from OpenStreetMap: one query per ~2 km cell, kept a day."""
    cy, cx = round(lat / 0.02) * 0.02, round(lon / 0.025) * 0.025

    def make():
        box = f"({cy - 0.03:.4f},{cx - 0.035:.4f},{cy + 0.03:.4f},{cx + 0.035:.4f})"
        parts = "".join(f"nwr{f}{box};" for _, _, f in FACILITY_KINDS)
        elements = _overpass_any(f"[out:json][timeout:25];({parts});out center tags;")
        items = []
        for el in elements:
            tags = el.get("tags") or {}
            kind = _facility_kind(tags)
            at = (el.get("lat"), el.get("lon")) if "lat" in el else ((el.get("center") or {}).get("lat"), (el.get("center") or {}).get("lon"))
            if not kind or at[0] is None:
                continue
            name = tags.get("name:ko") or tags.get("name") or dict((k, l) for k, l, _ in FACILITY_KINDS)[kind]
            address = " ".join(v for v in (tags.get("addr:city"), tags.get("addr:district"), tags.get("addr:street"), tags.get("addr:housenumber")) if v) or tags.get("addr:full", "")
            items.append({"id": f"{el.get('type', 'n')}{el.get('id')}", "kind": kind, "name": name[:80], "lat": float(at[0]), "lon": float(at[1]),
                          "address": address[:120], "phone": (tags.get("phone") or tags.get("contact:phone") or "")[:40],
                          "hours": (tags.get("opening_hours") or "")[:80], "access": tags.get("access", ""),
                          "indoor": tags.get("indoor") == "yes" or tags.get("location") == "indoor",
                          "description": (tags.get("defibrillator:location") or tags.get("description") or "")[:160],
                          "ref": (tags.get("ref") or "")[:12], "wheelchair": tags.get("wheelchair", "")})
        return {"items": items}
    try:
        items = _cached(f"fac2:{cy:.3f}:{cx:.3f}", 86400, make, 86400 * 3)["items"]
    except Exception:  # noqa: BLE001
        return {"status": "unavailable", "items": []}
    return {"status": "ok", "items": _near(lat, lon, items, 3000, 800), "source": "© OpenStreetMap contributors (ODbL)"}


# ── AEDs (국립중앙의료원 자동심장충격기 정보) ───────────────────────────────

AED = "https://apis.data.go.kr/B552657/AEDInfoInqireService/getAedLcinfoInqire"


def aed(lat: float, lon: float) -> dict:
    """The registered AEDs nearest (lat, lon): the official register (needs the portal's approval of
    the AED API for the same service key); a cell of ~1 km asked once an hour."""
    key = _portal_key()
    if not key:
        return {"status": "needs_key", "items": []}
    cy, cx = round(lat / 0.01) * 0.01, round(lon / 0.0125) * 0.0125

    def make():
        r = requests.get(AED, params={"serviceKey": key, "WGS84_LAT": cy, "WGS84_LON": cx, "pageNo": 1, "numOfRows": 300}, timeout=(4, 15))
        if r.status_code in (401, 403) or b"SERVICE_KEY_IS_NOT_REGISTERED" in r.content or b"SERVICE ACCESS DENIED" in r.content:
            raise KeyRejected("aed")
        r.raise_for_status()
        root = ET.fromstring(r.content)
        code = root.findtext("header/resultCode") or ""
        if code and code not in ("00", "0"):
            raise KeyRejected("aed") if code in ("20", "30", "31", "32") else ValueError(code)
        items = []
        for it in root.findall(".//item"):
            g = {c.tag: (c.text or "").strip() for c in it}
            la, lo = _num(g.get("wgs84Lat")), _num(g.get("wgs84Lon"))
            if not la or not lo:
                continue
            items.append({"id": "aed:" + (g.get("rnum") or "") + ":" + f"{la:.6f}:{lo:.6f}", "kind": "aed", "name": (g.get("org") or "자동심장충격기")[:80],
                          "lat": la, "lon": lo, "address": (g.get("buildAddress") or "")[:120], "phone": (g.get("clerkTel") or "")[:40],
                          "hours": "", "access": "", "indoor": False, "description": (g.get("buildPlace") or "")[:160],
                          "model": (g.get("model") or "")[:60], "manager": (g.get("manager") or "")[:20]})
        return {"items": items}
    try:
        items = _cached(f"aed:{cy:.3f}:{cx:.3f}", 3600, make, 86400)["items"]
    except Exception as e:  # noqa: BLE001
        return {"status": _status_of(e), "items": []}
    return {"status": "ok", "items": _near(lat, lon, items, 3000, 300), "source": "국립중앙의료원 자동심장충격기(AED) 정보"}
