"""On-demand public apartment drawings. No account, cookie, database or bulk crawler.

Naver's public search and original gallery carry typed, exclusive-area-labelled drawings.
Never infer a type from a gallery index or the compressed map's current tab. The image is
fetched only when its type is selected. All caches are bounded, process-local memory.
"""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import html
import json
import math
import re
import threading
import time
from urllib.parse import quote, urlencode, urlparse

import requests
from bs4 import BeautifulSoup

LAND = "https://land.naver.com"
CDN = "https://landthumb-phinf.pstatic.net"
_lock = threading.RLock()
_work = threading.BoundedSemaphore(2)
_catalogues: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_images: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
_analyses: OrderedDict[str, dict] = OrderedDict()
_MAX_IMAGES = 24 * 1024 * 1024
_flights = {kind:[threading.RLock() for _ in range(32)] for kind in ("image","analysis")}
_network = threading.BoundedSemaphore(2)


def _singleflight(key: str):
    group=_flights[key.split(":",1)[0]]
    return group[int(hashlib.sha256(key.encode()).hexdigest()[:8],16)%len(group)]


def _get(url: str, limit: int = 2_500_000) -> tuple[bytes, str]:
    # Fixed hosts and no redirects: this endpoint is not an arbitrary URL proxy.
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in {"land.naver.com", "landthumb-phinf.pstatic.net"} or u.port not in (None, 443):
        raise ValueError("drawing host")
    if not _network.acquire(timeout=.15):
        raise LookupError("drawing source busy")
    try:
        return _download(url,limit)
    finally:
        _network.release()


def _download(url: str, limit: int) -> tuple[bytes,str]:
    with requests.get(url, timeout=(5, 14), stream=True, allow_redirects=False) as r:
        r.raise_for_status()
        if r.status_code != 200:
            raise LookupError("drawing response")
        chunks, size = [], 0
        for chunk in r.iter_content(65536):
            size += len(chunk)
            if size > limit:
                raise ValueError("drawing too large")
            chunks.append(chunk)
        return b"".join(chunks), r.headers.get("Content-Type", "").split(";")[0]


def _text(body: bytes) -> str:
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp949", "replace")


def _name(s: str) -> str:
    return re.sub(r"[\W_]|아파트|APT", "", s.upper())


def parse_gallery(text: str, naver_id: str) -> dict:
    # Parse JSON as data, never eval the upstream page's JavaScript.
    match = re.search(r"\bvar\s+imgInfoData\s*=\s*'([^\r\n]+)'\s*;", text)
    if not match:
        raise LookupError("gallery unavailable")
    data = json.loads(match.group(1))
    if str(data.get("rletNo")) != str(naver_id):
        raise ValueError("gallery complex mismatch")
    plans = []
    types=[]
    rows=data.get("allComplexGrdPlanList", [])
    if not rows:
        rows=[{"hscp_no":naver_id,"ptp_no":p.get("ptpNo"),"ptp_nm":p.get("ptpNm"),"excls_spc":p.get("excluseSpace"),"sply_spc":p.get("supplySpace"),"imgList":[p]} for p in data.get("GRDPLAN",{}).get("imageList",[])]
    for row in rows[:100]:
        if str(row.get("hscp_no")) != str(naver_id):
            continue
        try:
            area = float(row["excls_spc"])
            supply = float(row["sply_spc"])
            type_id = str(int(row["ptp_no"]))
        except (KeyError, ValueError, TypeError):
            continue
        if not (10 <= area <= 1000 and supply >= area):
            continue
        types.append({"key":"no-image-"+type_id,"naverId":str(naver_id),"typeId":type_id,"typeName":str(row.get("ptp_nm","")),"exclusiveArea":area,"supplyArea":supply,"variant":"원본 도면 미확인","imageId":"","imageUrl":"","sourceUrl":LAND+"/info/groundPlanGallery.naver?"+urlencode({"rletNo":naver_id,"ptpId":type_id,"newComplex":"Y"})})
        for image in sorted(row.get("imgList", []),key=lambda p:p.get("imageTypeCode")!="GA1")[:8]:
            path = image.get("imageUrl", "")
            if not isinstance(path,str) or not path.startswith("/") or path.startswith("//") or any(c in path for c in "\r\n\\\x00"):
                continue
            path=urlparse(path).path
            if not re.search(r"\.(?:jpg|jpeg|png|webp|gif)$",path,re.I):continue
            path=quote(path,safe="/%+._-")
            if str(image.get("ptpNo")) != type_id:
                continue
            # Photos, panoramas and furnishing renders cannot replace a 2D basic/expanded plan.
            code = str(image.get("imageTypeCode", ""))
            if not code.startswith("GA"):
                continue
            token = hashlib.sha256(f"{naver_id}|{type_id}|{path}".encode()).hexdigest()[:24]
            plans.append({"key": token, "naverId": str(naver_id), "typeId": type_id,
                          "typeName": str(row.get("ptp_nm", "")), "exclusiveArea": area,
                          "supplyArea": supply, "variant": image.get("imageTypeName", "평면도"),
                          "imageId": image.get("imageId", ""), "imageUrl": CDN + path,
                          "sourceUrl": LAND + "/info/groundPlanGallery.naver?" + urlencode({"rletNo": naver_id, "ptpId": type_id, "newComplex": "Y"})})
    types=list({p["typeId"]:p for p in types}.values())
    choices=[next((p for p in plans if p["typeId"]==t["typeId"]),t) for t in types]
    covered=len({p["typeId"] for p in plans})
    return {"status": "available" if plans else "no_drawings", "naverId": str(naver_id),
            "name": data.get("rletNm", ""), "town": data.get("secNm", ""),
            "regionCode": str(data.get("cortar_no", "")), "plans": plans,"types":choices,
            "typeCount":len(types),"typesWithImages":covered,"typesWithoutImages":len(types)-covered,
            "source": "네이버 부동산 공개 원본 평면도"}


def _gallery(naver_id: str) -> dict:
    key = "gallery:" + naver_id
    with _lock:
        hit = _catalogues.get(key)
        if hit and time.monotonic() - hit[0] < 86400:
            _catalogues.move_to_end(key)
            return hit[1]
    body, _ = _get(LAND + "/info/groundPlanGallery.naver?" + urlencode({"rletNo": naver_id, "newComplex": "Y", "ptpListOpen": "true"}))
    result = parse_gallery(_text(body), naver_id)
    with _lock:
        _catalogues[key] = (time.monotonic(), result)
        while len(_catalogues) > 96:
            _catalogues.popitem(last=False)
    return result


def _near(x: float, y: float, lat: float, lon: float) -> bool:
    return math.hypot((x - lon) * 111000 * math.cos(math.radians(lat)), (y - lat) * 111000) < 650


def catalogue(name: str, lat: float, lon: float, town: str = "", region: str = "", naver_id: str = "") -> dict:
    """The same matching path for every complex. Ambiguous names fail closed."""
    key = f"lookup:{_name(name)}:{town}:{region}:{lat:.4f}:{lon:.4f}:{naver_id}"
    with _lock:
        hit = _catalogues.get(key)
        if hit and time.monotonic() - hit[0] < (86400 if hit[1].get("status") == "available" else 300):
            return hit[1]
    with _work:
        try:
            ids: list[str] = [naver_id] if naver_id else []
            if not ids:
                query = f"{town} {name}".strip()
                raw, _ = _get(LAND + "/search/search.naver?" + urlencode({"query": query}))
                text = _text(raw)
                match = re.search(r"baseQueryResult\s*=\s*({[^\r\n]+});", text)
                info = json.loads(match.group(1)) if match else {}
                direct = str(info.get("complexCode", ""))
                if direct.isdigit() and _name(str(info.get("complexName", ""))) == _name(name):
                    try:
                        if _near(float(info["complexMapXCrdn"]), float(info["complexMapYCrdn"]), lat, lon):
                            ids.append(direct)
                    except (ValueError, TypeError, KeyError):
                        pass
                # Older search pages also expose exact-name complex links when several match.
                if not ids:
                    soup = BeautifulSoup(text, "html.parser")
                    for link in soup.select("a[href*='rletNo=']"):
                        m = re.search(r"[?&]rletNo=(\d+)", html.unescape(link.get("href", "")))
                        if m and _name(link.get_text("", strip=True)) == _name(name) and m[1] not in ids:
                            ids.append(m[1])
                        if len(ids) == 4:
                            break
                    for link in soup.select("a[onclick*='reSearchComplexTab']"):
                        m=re.search(r"reSearchComplexTab\(\s*'[^']*'\s*,\s*'(\d+)'\s*\)",link.get("onclick",""))
                        if m and _name(link.get_text("",strip=True))==_name(name) and m[1] not in ids:
                            ids.append(m[1])
                        if len(ids)==4:break
            found = []
            for cid in ids[:4]:
                g = _gallery(cid)
                if _name(str(g.get("name", ""))) != _name(name):
                    continue
                if town and _name(g.get("town", "")) != _name(town):
                    continue
                if region and not g.get("regionCode", "").startswith(region):
                    continue
                found.append(g)
            result = found[0] if len(found) == 1 else {"status": "ambiguous" if found else "not_found", "plans": []}
        except (requests.RequestException, LookupError, ValueError, json.JSONDecodeError):
            result = {"status": "unavailable", "plans": []}
    with _lock:
        _catalogues[key] = (time.monotonic(), result)
        while len(_catalogues) > 96:
            _catalogues.popitem(last=False)
    return result


def selected(naver_id: str, key: str) -> dict:
    plan = next((p for p in _gallery(naver_id)["plans"] if p["key"] == key), None)
    if not plan:
        raise LookupError("drawing not found")
    return plan


def image(naver_id: str, key: str) -> tuple[bytes, str]:
    with _singleflight("image:"+key):
        return _image(naver_id,key)


def _image(naver_id: str, key: str) -> tuple[bytes, str]:
    plan = selected(naver_id, key)
    with _lock:
        if key in _images:
            _images.move_to_end(key)
            return _images[key]
    with _work:
        # Recheck after waiting: concurrent requests for one selected image share its download.
        with _lock:
            if key in _images:
                return _images[key]
        data, mime = _get(plan["imageUrl"], 8 * 1024 * 1024)
        if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise ValueError("drawing content type")
        with _lock:
            _images[key] = (data, mime)
            while len(_images) > 24 or sum(len(v[0]) for v in _images.values()) > _MAX_IMAGES:
                _images.popitem(last=False)
        return data, mime


def analyze(naver_id: str, key: str) -> dict:
    with _singleflight("analysis:"+key):
        return _analyze(naver_id,key)


def _analyze(naver_id: str, key: str) -> dict:
    from app.services.floorplan_image_analysis import VERSION, analyze_image
    plan = selected(naver_id, key)
    cache_key = "image-plan:" + VERSION + ":" + key
    with _lock:
        hit = _analyses.get(cache_key)
        if hit:
            _analyses.move_to_end(cache_key)
            return hit
    data, _ = image(naver_id, key)
    with _work:
        with _lock:
            if cache_key in _analyses:
                return _analyses[cache_key]
        result = {**analyze_image(data, plan["exclusiveArea"]), "drawing": plan}
        with _lock:
            _analyses[cache_key] = result
            while len(_analyses) > 48:
                _analyses.popitem(last=False)
        return result
