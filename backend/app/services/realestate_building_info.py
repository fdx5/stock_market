"""One building's card for the 3D view's 드론 mode: what a sign over it tells when tapped.

Sources (each optional; the card shows what came back)
    건축물대장 표제부      국토교통부_건축HUB 건축물대장정보 서비스 (getBrTitleInfo), by the
                           building's PNU (VWorld GIS건물통합정보 carries it): 허가·착공·사용승인일,
                           주용도, 구조, 층수, 높이, 면적, 세대수, 승강기 — one row per 동.
    카카오 장소 검색        the place of that name nearest the building: category, address,
                           phone, its Kakao Map page (photos, road view, reviews).
    카카오 이미지 검색      photographs of it (thumbnails, with the page each comes from).
    위키미디어 공용        photographs geotagged at the building (named after it first), credited.
    위키백과               the article of that name, only when it is geotagged within 2 km
                           of the building (a landmark's history in a few sentences).

Nothing is stored: answers are kept in memory for a while (photos and places a day, the
register a week), so a sign tapped twice, or by many people, costs one round of calls.
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import math
import os
import re
import threading
import time
import urllib.parse

import requests

from app.services import realestate_map as rm
from app.services.realestate_facts import FactsError, _items

log = logging.getLogger(__name__)

TITLE_ENDPOINTS = (
    "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
    "https://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo",
)
KAKAO_PLACE = "https://dapi.kakao.com/v2/local/search/keyword.json"
KAKAO_IMAGE = "https://dapi.kakao.com/v2/search/image"
WIKI_SUMMARY = "https://ko.wikipedia.org/api/rest_v1/page/summary/"
UA = "kospimap.com building card (+https://kospimap.com)"

_lock = threading.Lock()
_memo: dict[str, tuple[float, float, object]] = {}  # key -> (at, ttl, value)
_MEMO_MAX = 4000
_pool = cf.ThreadPoolExecutor(max_workers=8, thread_name_prefix="bldinfo")


def _cached(key: str, ttl: float, fetch):
    now = time.time()
    with _lock:
        hit = _memo.get(key)
        if hit and now - hit[0] < hit[1]:
            return hit[2]
    try:
        value = fetch()
    except Exception as exc:  # noqa: BLE001 — one source failing leaves the others
        log.info("building card: %s failed (%s)", key.split(":")[0], type(exc).__name__)
        value, ttl = None, 600
    with _lock:
        if len(_memo) >= _MEMO_MAX:  # the oldest half goes (memory only)
            for k, _ in sorted(_memo.items(), key=lambda kv: kv[1][0])[: _MEMO_MAX // 2]:
                _memo.pop(k, None)
        _memo[key] = (now, ttl, value)
    return value


def _num(v) -> float | None:
    try:
        f = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _day(v) -> str | None:
    s = re.sub(r"\D", "", str(v or ""))
    if len(s) == 8 and s[:2] in ("18", "19", "20") and s[4:6] != "00":
        return f"{s[:4]}-{s[4:6]}-{s[6:]}" if s[6:] != "00" else f"{s[:4]}-{s[4:6]}"
    if len(s) >= 4 and s[:2] in ("18", "19", "20"):
        return s[:4]
    return None


# ----------------------------------------------------------------------------- register

def _register(pnu: str):
    if not re.fullmatch(r"\d{19}", pnu or ""):
        return None
    key = rm._service_key()
    if not key:
        return None
    params = {
        "sigunguCd": pnu[:5], "bjdongCd": pnu[5:10], "platGbCd": "1" if pnu[10] == "2" else "0",
        "bun": pnu[11:15], "ji": pnu[15:19], "numOfRows": "100", "pageNo": "1",
    }
    last: Exception | None = None
    for url in TITLE_ENDPOINTS:
        if not rm._count_call("bldrgst"):
            return None
        try:
            res = requests.get(url, params={"serviceKey": key, "_type": "json", **params}, timeout=12)
            items, _ = _items(res)
        except (FactsError, requests.RequestException, ValueError) as exc:
            if rm.is_quota_error(str(exc)):
                rm.exhaust("bldrgst")
                return None
            last = exc
            continue
        return [_title_row(it) for it in items]
    if last:
        raise last
    return None


def _title_row(it: dict) -> dict:
    g = it.get
    lifts = sum(x for x in (_num(g("rideUseElvtCnt")), _num(g("emgenUseElvtCnt"))) if x) or None
    return {
        "name": (g("bldNm") or "").strip() or None,
        "dong": (g("dongNm") or "").strip() or None,
        "kind": (g("regstrKindCdNm") or "").strip() or None,
        "use": (g("mainPurpsCdNm") or "").strip() or None,
        "useDetail": (g("etcPurps") or "").strip() or None,
        "structure": (g("strctCdNm") or "").strip() or None,
        "roof": (g("roofCdNm") or "").strip() or None,
        "floors": _num(g("grndFlrCnt")),
        "basements": _num(g("ugrndFlrCnt")),
        "height": _num(g("heit")),
        "totalArea": _num(g("totArea")),
        "buildingArea": _num(g("archArea")),
        "siteArea": _num(g("platArea")),
        "households": _num(g("hhldCnt")) or _num(g("hoCnt")) or None,
        "lifts": lifts,
        "permitted": _day(g("pmsDay")),
        "started": _day(g("stcnsDay")),
        "approved": _day(g("useAprDay")),
        "address": (g("newPlatPlc") or g("platPlc") or "").strip() or None,
        "seismic": (g("rserthqkDsgnApplyYn") or "").strip() == "1" or None,
    }


# ----------------------------------------------------------------------------- kakao

def _kakao_key() -> str | None:
    return (os.environ.get("KAKAO_REST_API_KEY") or "").strip() or None


def _place(name: str, lat: float, lon: float):
    key = _kakao_key()
    if not key:
        return None
    res = requests.get(KAKAO_PLACE, headers={"Authorization": f"KakaoAK {key}"}, timeout=8,
                       params={"query": name, "x": f"{lon:.6f}", "y": f"{lat:.6f}", "radius": "1500", "sort": "distance", "size": "5"})
    res.raise_for_status()
    docs = res.json().get("documents") or []
    want = _norm(name)
    best = None
    for d in docs:
        n = _norm(d.get("place_name"))
        if want and (want in n or n in want):
            best = d
            break
    best = best or (docs[0] if docs and int(docs[0].get("distance") or 9999) < 250 else None)
    if not best:
        return None
    return {
        "name": best.get("place_name"),
        "category": (best.get("category_name") or "").replace(" > ", " › ") or None,
        "address": best.get("road_address_name") or best.get("address_name") or None,
        "phone": best.get("phone") or None,
        "url": best.get("place_url") or None,
        "distance": _num(best.get("distance")),
    }


def _photos(query: str):
    key = _kakao_key()
    if not key:
        return None
    res = requests.get(KAKAO_IMAGE, headers={"Authorization": f"KakaoAK {key}"}, timeout=8,
                       params={"query": query, "size": "12", "sort": "accuracy"})
    res.raise_for_status()
    out = []
    for d in res.json().get("documents") or []:
        thumb, image = d.get("thumbnail_url"), d.get("image_url")
        if not thumb or not str(thumb).startswith("https://"):
            continue
        w, h = _num(d.get("width")) or 0, _num(d.get("height")) or 0
        if w and h and (w < 300 or h < 200 or w / h > 3.2 or h / w > 2.2):
            continue  # icons, banners, long captures
        out.append({"thumb": thumb, "image": image if str(image).startswith("https://") else None,
                    "site": d.get("display_sitename") or None, "link": d.get("doc_url") or None,
                    "w": w or None, "h": h or None})
        if len(out) >= 8:
            break
    return out


# ----------------------------------------------------------------------------- commons

COMMONS = "https://commons.wikimedia.org/w/api.php"


def _commons(name: str, lat: float, lon: float, radius: int = 150):
    """Photographs taken at the building (Wikimedia Commons, geotagged within `radius` m): those
    named after it first, then the nearest. Each with its author and licence."""
    res = requests.get(COMMONS, timeout=8, headers={"User-Agent": UA}, params={
        "action": "query", "format": "json", "generator": "geosearch", "ggscoord": f"{lat:.6f}|{lon:.6f}",
        "ggsradius": str(radius), "ggsnamespace": "6", "ggslimit": "30", "prop": "imageinfo|coordinates",
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "960", "iiextmetadatafilter": "Artist|LicenseShortName"})
    res.raise_for_status()
    pages = ((res.json().get("query") or {}).get("pages") or {}).values()
    want = _norm(name)
    out = []
    for pg in pages:
        ii = (pg.get("imageinfo") or [{}])[0]
        if ii.get("mime") not in ("image/jpeg", "image/webp", "image/png") or not ii.get("thumburl"):
            continue
        w, h = ii.get("width") or 0, ii.get("height") or 0
        if w < 600 or h < 400:
            continue
        title = str(pg.get("title") or "")
        if re.search(r"(?i)map|logo|diagram|plan|sign|\.svg", title):
            continue
        c = (pg.get("coordinates") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        artist = re.sub(r"<[^>]+>", "", str((meta.get("Artist") or {}).get("value") or "")).strip()[:60]
        lic = str((meta.get("LicenseShortName") or {}).get("value") or "").strip()[:30]
        named = bool(want) and want in _norm(title.replace("File:", ""))
        out.append(((0 if named else 1), _dist(lat, lon, c.get("lat"), c.get("lon")), {
            "thumb": ii["thumburl"], "image": ii["thumburl"], "link": ii.get("descriptionurl"),
            "site": "위키미디어 공용" + (f" · {artist}" if artist else "") + (f" ({lic})" if lic else ""),
            "w": w, "h": h, "near": not named}))
    out.sort(key=lambda t: (t[0], t[1]))
    return [o for *_, o in out[:8]]


# ----------------------------------------------------------------------------- wikipedia

def _wiki(name: str, lat: float, lon: float):
    res = requests.get(WIKI_SUMMARY + urllib.parse.quote(name.replace(" ", "_"), safe=""), timeout=8,
                       headers={"User-Agent": UA, "Accept": "application/json"})
    if res.status_code == 404:
        return None
    res.raise_for_status()
    j = res.json()
    if j.get("type") != "standard":
        return None
    c = j.get("coordinates") or {}
    if not c or _dist(lat, lon, c.get("lat"), c.get("lon")) > 2000:
        return None  # only an article placed at this building
    return {
        "title": j.get("title"), "extract": (j.get("extract") or "").strip()[:900] or None,
        "url": ((j.get("content_urls") or {}).get("mobile") or {}).get("page") or None,
        "thumb": (j.get("thumbnail") or {}).get("source") or None,
    }


def _dist(lat1, lon1, lat2, lon2) -> float:
    try:
        ky, kx = 110540, math.cos(math.radians(lat1)) * 111320
        return math.hypot((float(lat2) - lat1) * ky, (float(lon2) - lon1) * kx)
    except (TypeError, ValueError):
        return 1e9


def _norm(s) -> str:
    return re.sub(r"[\s()·\-_.,]|아파트$", "", str(s or ""))


# ----------------------------------------------------------------------------- the card

def building_info(name: str, lat: float, lon: float, pnu: str | None = None, area: str | None = None) -> dict:
    name = re.sub(r"\s+", " ", (name or "").strip())[:60]
    if len(name) < 2:
        raise ValueError("건물 이름이 필요합니다.")
    area = re.sub(r"\s+", " ", (area or "").strip())[:20]
    g = f"{lat:.3f},{lon:.3f}"
    jobs = {
        "register": (lambda: _cached(f"reg:{pnu}", 7 * 86400, lambda: _register(pnu or ""))) if pnu else None,
        "place": lambda: _cached(f"place:{name}:{g}", 86400, lambda: _place(name, lat, lon)),
        "wiki": lambda: _cached(f"wiki:{name}:{g}", 7 * 86400, lambda: _wiki(name, lat, lon)),
        "commons": lambda: _cached(f"commons:{name}:{g}", 7 * 86400, lambda: _commons(name, lat, lon)),
    }
    futures = {k: _pool.submit(f) for k, f in jobs.items() if f}
    out: dict = {"name": name, "lat": lat, "lon": lon, "pnu": pnu}
    if "register" in futures:
        try:
            out["register"] = futures.pop("register").result(timeout=15)
        except Exception:  # noqa: BLE001
            out["register"] = None
    # (the photographs searched with the building's 동 — "길음동 래미안" rather than every 래미안 —
    # from its register address where there is one)
    addr = next((r.get("address") for r in out.get("register") or [] if r.get("address")), None)
    m = re.search(r"\S+[동읍면리가](?=\s|\d|$)", re.sub(r"^\S+[시도]\s+\S+[시군구]\s+", "", addr or ""))
    area = (m.group(0) if m and not re.search(r"\d", m.group(0)) else "") or area
    futures["photos"] = _pool.submit(lambda: _cached(f"img:{name}:{area}", 86400, lambda: _photos(f"{area} {name}".strip())))
    out["area"] = area or None
    for k, fut in futures.items():
        try:
            out[k] = fut.result(timeout=15)
        except Exception:  # noqa: BLE001
            out[k] = None
    # (the photographs: those taken at the building and named after it, the searched ones, then the
    # others taken right there)
    commons = out.pop("commons", None) or []
    searched = out.get("photos") or []
    out["photos"] = ([p for p in commons if not p["near"]] + searched + [p for p in commons if p["near"]])[:12] or None
    rows = out.get("register") or []
    # (a complex: its 동 rows; the 총괄 row, where there is one, leads)
    rows.sort(key=lambda r: (r.get("kind") != "총괄표제부", -(r.get("floors") or 0)))
    out["register"] = rows or None
    out["sources"] = [s for s, on in (
        ("국토교통부 건축물대장", bool(rows)), ("카카오 장소", bool(out.get("place"))),
        ("카카오 이미지 검색", bool(searched)), ("위키미디어 공용", bool(commons)), ("위키백과", bool(out.get("wiki"))),
    ) if on]
    return out
