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
from contextlib import contextmanager
import time
import unicodedata
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
_flights: dict[str, threading.RLock] = {}
_network = threading.BoundedSemaphore(2)
_analysis_gate = threading.BoundedSemaphore(1)


def _singleflight(key: str):
    # One lock per key: shared striped locks made unrelated complexes queue behind
    # one slow lookup, each waiter holding a request thread. Idle locks are pruned.
    with _lock:
        lock=_flights.get(key)
        if lock is None:
            if len(_flights)>2048:
                for old,idle in list(_flights.items()):
                    if idle.acquire(blocking=False):
                        idle.release();_flights.pop(old,None)
            lock=_flights[key]=threading.RLock()
    return lock


@contextmanager
def _slot(gate: threading.BoundedSemaphore, timeout: float):
    # Bounded wait: a request thread never queues forever behind slow sources.
    if not gate.acquire(timeout=timeout):
        raise LookupError("drawing source busy")
    try:
        yield
    finally:
        gate.release()


def _get(url: str, limit: int = 2_500_000) -> tuple[bytes, str]:
    # Fixed hosts and no redirects: this endpoint is not an arbitrary URL proxy.
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in {"land.naver.com", "landthumb-phinf.pstatic.net"} or u.port not in (None, 443):
        raise ValueError("drawing host")
    if not _network.acquire(timeout=2):
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


def complex_name(value: str, town: str = "") -> str:
    """Strip a building identifier, retaining phase and complex names."""
    name=unicodedata.normalize("NFKC",value).strip()
    name=re.sub(r"\(\s*(?:제\s*)?(?:\d{1,4}|[A-Z가-힣])\s*동\s*\)\s*$","",name,flags=re.I)
    name=re.sub(r"\s*(?:제\s*)?(?:\d{1,4}|[A-Z])\s*동(?:\s*\d{1,4}\s*호)?\s*$","",name,flags=re.I)
    name=re.sub(r"\s+[가-힣]\s*동\s*$","",name)
    name=re.sub(r"아파트|\bAPT\b","",name,flags=re.I).strip()
    name=re.sub(r"\(\s*주상복합\s*\)\s*$","",name).strip()
    if town and name.startswith(town):name=name[len(town):].strip()
    return re.sub(r"\s+"," ",name)


def _brand_name(value: str) -> str:
    return re.sub(r"I[\s-]*PARK", "아이파크", value, flags=re.I)


def _phase_name(value: str) -> tuple[str, str, str] | None:
    """A phase suffix, with hyphenated subphases kept distinct from 61/other phases."""
    value=re.sub(r"[\s()（）]", "", unicodedata.normalize("NFKC", value))
    value=re.sub(r"[‐‑–—−]", "-", value)
    m=re.fullmatch(r"(.+?)(?:제)?(?<!\d)(\d{1,2}(?:-\d{1,2})?)(차|단지)?", value)
    if not m:return None
    return m[1],"-".join(str(int(n)) for n in m[2].split("-")),m[3] or ""


def _identity_name(value: str, town: str = "") -> str:
    value=_brand_name(complex_name(value,town))
    # Provider names sometimes repeat the legal-town stem before the brand.
    stem=re.sub(r"동$", "", town)
    if len(stem)>=2 and value.startswith(stem) and len(value)-len(stem)>=2:value=value[len(stem):]
    phase=_phase_name(value)
    return f"{_name(phase[0])}:{phase[2] or 'ordinal'}:{phase[1]}" if phase else _name(value)


def _same_name(a: str, b: str, town: str = "") -> bool:
    aa,bb=_identity_name(a,town),_identity_name(b,town)
    if aa==bb:return True
    left,right=aa.split(":"),bb.split(":")
    return len(left)==len(right)==3 and left[0]==right[0] and left[2]==right[2] and "ordinal" in (left[1],right[1])


def _search_names(value: str) -> list[str]:
    canonical=_brand_name(value);names=[value,canonical];phase=_phase_name(canonical)
    if phase:names.extend([f"{phase[0]}{phase[1]}{suffix}" for suffix in ([phase[2]] if phase[2] else ["차","단지"])] + [phase[0]])
    return list(dict.fromkeys(n for n in names if _name(n)))[:4]


def _search_ids(text: str, name: str, town: str, lat: float, lon: float) -> list[str]:
    ids=[];disallowed=set()
    match=re.search(r"baseQueryResult\s*=\s*({[^\r\n]+});",text)
    info=json.loads(match.group(1)) if match else {}
    direct=str(info.get("complexCode", ""))
    if direct.isdigit() and _same_name(str(info.get("complexName", "")),name,town):
        try:
            if _near(float(info["complexMapXCrdn"]),float(info["complexMapYCrdn"]),lat,lon):ids.append(direct)
            else:disallowed.add(direct)
        except (ValueError,TypeError,KeyError):pass
    soup=BeautifulSoup(text,"html.parser")
    for link in soup.select("a[href*='rletNo='],a[onclick*='reSearchComplexTab']"):
        if not _same_name(link.get_text("",strip=True),name,town):continue
        m=re.search(r"[?&]rletNo=(\d+)",html.unescape(link.get("href", ""))) or re.search(r"reSearchComplexTab\(\s*'[^']*'\s*,\s*'(\d+)'\s*\)",link.get("onclick", ""))
        if m and m[1] not in ids and m[1] not in disallowed:ids.append(m[1])
        if len(ids)>=4:break
    return ids


def _located_candidate(text: str, name: str, town: str, lat: float, lon: float) -> dict:
    """Independent source coordinates can verify an administrative-code change."""
    match=re.search(r"baseQueryResult\s*=\s*({[^\r\n]+});",text)
    info=json.loads(match.group(1)) if match else {}
    place=info.get('cortarInfo') or {}
    try:
        if (str(info.get('complexCode','')).isdigit() and _same_name(str(info.get('complexName','')),name,town)
                and town and _name(str(place.get('secNm','')))==_name(town)
                and _near(float(info['complexMapXCrdn']),float(info['complexMapYCrdn']),lat,lon)):
            return {'naverId':str(info['complexCode']),'regionCode':str(place.get('cortarNo') or info.get('regionCode','')),
                    'lat':float(info['complexMapYCrdn']),'lon':float(info['complexMapXCrdn'])}
    except (KeyError,TypeError,ValueError):pass
    return {}


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
            if not code.startswith("GA") or re.search(r"입체|투시|3\s*D",str(image.get('imageTypeName','')),re.I):
                continue
            token = hashlib.sha256(f"{naver_id}|{type_id}|{path}".encode()).hexdigest()[:24]
            plans.append({"key": token, "naverId": str(naver_id), "typeId": type_id,
                          "typeName": str(row.get("ptp_nm", "")), "exclusiveArea": area,
                          "supplyArea": supply, "variant": {"GA1":"평면도 기본형","GA3":"평면도 확장형"}.get(code,image.get("imageTypeName", "평면도")),
                          "imageId": image.get("imageId", ""), "imageUrl": CDN + path,
                          "sourceUrl": LAND + "/info/groundPlanGallery.naver?" + urlencode({"rletNo": naver_id, "ptpId": type_id, "newComplex": "Y"})})
    types=list({p["typeId"]:p for p in types}.values())
    choices=[next((p for p in plans if p["typeId"]==t["typeId"]),t) for t in types]
    covered=len({p["typeId"] for p in plans})
    return {"status": "available" if plans else "no_drawings", "naverId": str(naver_id),
            "name": data.get("rletNm", ""), "town": data.get("secNm", ""),
            "propertyType":str(data.get('hscpTypeCd','')),"propertyTypeName":str(data.get('hscpTypeNm','')),
            "regionCode": str(data.get("cortar_no", "")), "plans": plans,"types":choices,
            "typeCount":len(types),"typesWithImages":covered,"typesWithoutImages":len(types)-covered,
            "source": "네이버 부동산 공개 원본 평면도"}


def _gallery(naver_id: str) -> dict:
    if naver_id.startswith('ref-'):
        from app.services import floorplan_references
        return floorplan_references.catalogue(naver_id)
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


def catalogue(name: str, lat: float, lon: float, town: str = "", region: str = "", naver_id: str = "",pnu:str="") -> dict:
    """The same matching path for every complex. Ambiguous names fail closed."""
    name=complex_name(name,town)
    if not name:return {"status":"not_found","plans":[],"reason":"complex_name_required"}
    from app.services import floorplan_references
    reference=floorplan_references.lookup(name,lat,lon,town,region,pnu)
    if reference:return reference
    location=f"{town}:{region}" if town and region else f"{town}:{region}:{lat:.4f}:{lon:.4f}"
    key = f"complex-lookup:v3:{_identity_name(name,town)}:{location}:{naver_id}"
    with _singleflight("catalogue:"+key):
        return _catalogue(name,lat,lon,town,region,naver_id,key)


def _catalogue(name: str, lat: float, lon: float, town: str, region: str, naver_id: str,key:str) -> dict:
    failure_key=f'{key}:at:{lat:.4f}:{lon:.4f}'
    with _lock:
        hit = _catalogues.get(key)
        verified=hit[1].get('locationVerification') if hit else None
        nearby=not verified or _near(verified['lon'],verified['lat'],lat,lon)
        if not hit or not nearby:hit=_catalogues.get(failure_key)
        if hit and time.monotonic() - hit[0] < (86400 if hit[1].get("status") == "available" else 15):
            return hit[1]
    if not _work.acquire(timeout=20):
        return {"status":"unavailable","plans":[],"reason":"source_busy"}
    try:
        try:
            found=[];seen=set();source_failed=False;location_mismatch=False;located={}
            variants=_search_names(name)
            primary=list(dict.fromkeys(f'{town} {variant}'.strip() for variant in variants))
            queries=primary+[variant for variant in variants if variant not in primary]
            deadline=time.monotonic()+24
            for index,query in enumerate([name] if naver_id else queries):
                # A legal-town name can resolve to the wrong city upstream.
                # Retry the complex name itself, then verify its town/location.
                if index>=len(primary) and found:break
                if time.monotonic()>deadline:source_failed=True;break
                ids=[naver_id] if naver_id else []
                if not ids:
                    try:
                        raw,_=_get(LAND+"/search/search.naver?"+urlencode({"query":query}))
                        text=_text(raw);ids=_search_ids(text,name,town,lat,lon)
                        evidence=_located_candidate(text,name,town,lat,lon)
                        if evidence:located[evidence['naverId']]=evidence
                    except (requests.RequestException,LookupError,ValueError,json.JSONDecodeError):
                        source_failed=True;continue
                for cid in ids[:4]:
                    if cid in seen:continue
                    seen.add(cid)
                    try:g=_gallery(cid)
                    except (requests.RequestException,LookupError,ValueError,json.JSONDecodeError):
                        source_failed=True;continue
                    # Mixed developments expose separate apartment/officetel
                    # catalogues at one address, often under the same name.
                    if g.get('propertyType')=='A02':continue
                    if not _same_name(str(g.get("name", "")),name,town):continue
                    if town and _name(g.get("town", ""))!=_name(town):
                        location_mismatch=True;continue
                    if region and not g.get('regionCode','').startswith(region):
                        evidence=located.get(cid)
                        if not (evidence and evidence['regionCode']==g.get('regionCode') and evidence['regionCode'].startswith(region[:2])):
                            location_mismatch=True;continue
                        g={**g,'locationVerification':evidence,'locationMatchedBy':'source_coordinates'}
                    found.append(g)
                phase=_phase_name(name)
                if found and (not phase or phase[2] or naver_id):break
            result=({**found[0],"requestedName":name,"matchedBy":"exact_name" if _name(found[0].get("name",""))==_name(name) else "phase_or_town_label"} if len(found)==1
                    else {"status":"ambiguous" if found else "unavailable" if source_failed else "not_found","plans":[],"reason":"multiple_complexes" if found else "source_load_failed" if source_failed else "location_mismatch" if location_mismatch else "no_name_candidate"})
        except (requests.RequestException, LookupError, ValueError, json.JSONDecodeError):
            result = {"status": "unavailable", "plans": []}
    finally:
        _work.release()
    with _lock:
        _catalogues[key if result.get('status')=='available' else failure_key] = (time.monotonic(), result)
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
    if naver_id.startswith('ref-'):
        from app.services import floorplan_references
        return floorplan_references.image(naver_id,key)
    plan = selected(naver_id, key)
    with _lock:
        if key in _images:
            _images.move_to_end(key)
            return _images[key]
    with _slot(_work,20):
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
    if naver_id.startswith('ref-'):
        from app.services import floorplan_references
        return floorplan_references.analyze(naver_id,key)
    from app.services.floorplan_analysis_runtime import VERSION, analyze_isolated
    plan = selected(naver_id, key)
    cache_key = "image-plan:" + VERSION + ":" + key
    with _lock:
        hit = _analyses.get(cache_key)
        if hit:
            _analyses.move_to_end(cache_key)
            return hit
    with _slot(_analysis_gate,30):
        with _lock:
            if cache_key in _analyses:
                return _analyses[cache_key]
        data, _ = image(naver_id, key)
        result = {**analyze_isolated(data, plan["exclusiveArea"],expanded=plan["variant"]=="평면도 확장형",supply_area=plan["supplyArea"]), "drawing": plan}
        with _lock:
            _analyses[cache_key] = result
            while len(_analyses) > 48:
                _analyses.popitem(last=False)
        return result
