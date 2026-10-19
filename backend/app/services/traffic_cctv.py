"""Public traffic cameras (UTIC city CCTV, ITS highways). Process-local metadata/media
references only; no database.

The service keys and provider URLs stay on the server. Media references can only be
created from a provider reply or one of its HLS manifests, never from a client URL.
UTIC authenticates by key and the server's registered address range, so every UTIC
request (catalogue, player page, video) goes through this server.
"""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import ipaddress
import math
import os
import re
import secrets
import socket
import threading
import time
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit

import requests
import urllib3

API = "https://openapi.its.go.kr:9443/cctvInfo"
SOURCE = "국토교통부 국가교통정보센터"
# Paused by the owner while hosting-network access is unresolved. Keep credentials
# intact; a future approved city provider must remain independent of this gate.
HIGHWAY_CCTV_ENABLED = False
UTIC_LIST = "https://www.utic.go.kr/guide/cctvOpenData.do"
UTIC_PAGE = "https://www.utic.go.kr/jsp/map/openDataCctvStream.jsp"
UTIC_MAP = "https://www.utic.go.kr/map/mapcctv.do"
UTIC_SOURCE = "경찰청 도시교통정보센터(UTIC)"
UTIC_KEY_NAMES = ("UTIC_CCTV_API_KEY", "UTIC_API_KEY", "UTIC_KEY", "UTIC_CCTV_KEY", "UTIC_OPEN_API_KEY")
CITY_CCTV_ENABLED = True
_cache: OrderedDict = OrderedDict()
_media: OrderedDict = OrderedDict()
_by_url: dict = {}
_lock = threading.RLock()
_slots = threading.BoundedSemaphore(10)


class CameraAuthError(ValueError):
    """Provider rejected this service's authorization; never include its URL."""


class MediaProviderError(ValueError):
    def __init__(self, status: int):
        self.status = status
        super().__init__("Provider media request rejected")


def _key():
    return (os.environ.get("ITS_CCTV_API_KEY") or os.environ.get("ITS_API_KEY") or "").strip()


def _utic_key():
    for name in UTIC_KEY_NAMES:
        value = (os.environ.get(name) or "").strip()
        if value:
            return name, value
    return None, ""


def _allowed_port(p) -> bool:
    port = p.port or (443 if p.scheme == "https" else 80)
    # The official HTTPS HLS entry redirects to this provider's port 8082; city
    # streaming servers (Wowza) publish HLS on 1935.
    return port in (80, 443, 1935, 8080, 8081, 8443, 9443) or (
        port == 8082 and p.scheme == "https" and p.hostname == "cctvsec.ktict.co.kr")


def _remember(url: str) -> str:
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Unsupported media URL")
    if len(url) > 4096 or not _allowed_port(p):
        raise ValueError("Unsupported media address")
    with _lock:
        old = _by_url.get(url)
        if old and old in _media:
            _media[old] = (url, time.monotonic() + 1800)
            _media.move_to_end(old)
            return old
        token = secrets.token_urlsafe(24)
        _media[token] = (url, time.monotonic() + 1800)
        _by_url[url] = token
        while len(_media) > 12000:
            dropped, (value, _) = _media.popitem(last=False)
            if _by_url.get(value) == dropped:
                _by_url.pop(value, None)
        return token


def _path(url: str) -> str:
    return "/api/realestate/cctv/media/" + _remember(url)


def _rows(body):
    response = body.get("response", {}) if isinstance(body, dict) else {}
    data = response.get("data", []) if isinstance(response, dict) else []
    return data if isinstance(data, list) else [data] if isinstance(data, dict) else []


def _fetch_road(road, lat, lon):
    dx, dy = 2300 / (111320 * math.cos(math.radians(lat))), 2300 / 110540
    # Type 4 is the documented HTTPS HLS service; the proxy also supports HTTP
    # media returned by a provider, without mixed-content requests in the browser.
    reply = requests.get(API, params={"apiKey": _key(), "type": road, "cctvType": "4",
        "minX": lon - dx, "maxX": lon + dx, "minY": lat - dy, "maxY": lat + dy,
        "getType": "json"}, timeout=(4, 8))
    if reply.status_code in (401, 403):
        raise CameraAuthError("Provider authorization rejected")
    reply.raise_for_status()
    try:
        body = reply.json()
    except ValueError:
        if len(reply.content) > 2_000_000:
            raise ValueError("Camera response too large") from None
        root = ET.fromstring(reply.content)
        if root.tag != "response" or root.find("datacount") is None:
            raise ValueError("Invalid camera response") from None
        body = {"response": {"data": [{v.tag: v.text or "" for v in row} for row in root.findall("data")]}}
    if not isinstance(body.get("response"), dict) or "data" not in body["response"]:
        raise ValueError("Invalid camera response")
    out = []
    for row in _rows(body):
        try:
            x, y = float(row["coordx"]), float(row["coordy"])
            if not 124 <= x <= 132 or not 33 <= y <= 39:
                continue
            name = " ".join(str(row.get("cctvname") or "").split())[:160]
            if not name:
                continue
            url = str(row.get("cctvurl") or "")
            identity = hashlib.sha256(f"{road}|{name}|{x:.6f}|{y:.6f}".encode()).hexdigest()[:24]
            typ = str(row.get("cctvtype") or "4")
            media = _path(url) if url else None
            out.append({"id": "its:" + identity, "name": name, "lat": y, "lon": x,
                "source": SOURCE, "media": media, "format": "image" if typ == "3" else "mp4" if typ in ("2", "5") else "hls",
                "updatedAt": str(row.get("filecreatetime") or "")[:30]})
        except (ValueError, KeyError, TypeError):
            continue
    return out


# --- UTIC city CCTV -------------------------------------------------------------
# UTIC blocks clients that call one URL 5+ times a second or cause repeated upstream
# 50x replies. The catalogue is read at most every six hours, player pages are
# resolved once per camera and kept, and all UTIC requests share one pace.
_utic = {"rows": {}, "at": 0.0, "retry_at": 0.0, "issue": None, "fields": [], "kinds": {}}
_utic_fetch = threading.Lock()
_utic_pace = threading.Lock()
_utic_next = [0.0]
_utic_block = [0.0]
_pages: OrderedDict = OrderedDict()
_page_by_id: dict = {}
_resolved: OrderedDict = OrderedDict()
_resolve_log: list = []
_failed_media: dict = {}
_manifests: OrderedDict = OrderedDict()
UTIC_HEADERS = {"User-Agent": "Mozilla/5.0 (kospimap.com traffic CCTV)", "Referer": "https://www.utic.go.kr/"}


def _utic_get(url, params, timeout):
    """One paced UTIC request; a provider 50x pauses every UTIC request for 30 s."""
    with _utic_pace:
        now = time.monotonic()
        if now < _utic_block[0]:
            raise MediaProviderError(503)
        wait = _utic_next[0] - now
        if wait > 2:
            raise MediaProviderError(429)
        if wait > 0:
            time.sleep(wait)
        _utic_next[0] = time.monotonic() + .6
    reply = requests.get(url, params=params, headers=UTIC_HEADERS, timeout=timeout)
    if reply.status_code >= 500:
        _utic_block[0] = time.monotonic() + 30
    return reply


def _field(row: dict, *names):
    for name in names:
        for key in (name, name.lower(), name.upper()):
            value = row.get(key)
            if value not in (None, ""):
                return str(value).strip()
    return ""


def _issue_code(error) -> str:
    return ("connect_timeout" if isinstance(error, requests.exceptions.ConnectTimeout)
        else "read_timeout" if isinstance(error, requests.exceptions.ReadTimeout)
        else "tls_error" if isinstance(error, requests.exceptions.SSLError)
        else "connection_failed" if isinstance(error, requests.exceptions.ConnectionError)
        else "http_error" if isinstance(error, requests.exceptions.HTTPError)
        else "busy" if isinstance(error, MediaProviderError)
        else "invalid_response" if isinstance(error, (ValueError, ET.ParseError))
        else "provider_error")


def _text(reply) -> str:
    raw = reply.content
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace").strip()


_LISTED = re.compile(r"""test\(\s*['"]([A-Za-z0-9_-]{2,32})['"]\s*\)""")


def _catalogue(reply, key: str):
    """The cameras this key may show: a JSON list of rows, or (the approved reply) an
    HTML table whose links carry the camera IDs. A provider rejection is one JSON row
    with a resultCode. An unreadable reply records its type, size and opening
    characters (key removed) for diagnosis."""
    text = _text(reply)
    try:
        return json.loads(text, strict=False)
    except ValueError:
        pass
    ids = _LISTED.findall(text)
    if ids:
        return [{"CCTVID": cid} for cid in dict.fromkeys(ids)]
    clean = lambda t: re.sub(r"\s+", " ", t).replace(key, "<key>") if key else t
    _utic["sample"] = {"type": reply.headers.get("Content-Type", "")[:60], "bytes": len(reply.content), "head": clean(text[:160])}
    raise ValueError("Unreadable catalogue")


# The player page needs these per-camera fields (as UTIC's own player derives them).
_KIND_BY_PREFIX = {"L01": "Seoul", "L02": "N", "L03": "O", "L04": "P", "L08": "d"}


def _utic_rows() -> dict:
    """The camera catalogue by CCTVID; the last good one is kept through failures.

    Two requests every six hours: the open-data list (key and registered address:
    which cameras may be shown) and the camera list UTIC's public map loads (their
    positions and stream fields). No per-camera attribute requests."""
    now = time.monotonic()
    if _utic["rows"] and now - _utic["at"] < 6 * 3600:
        return _utic["rows"]
    if now < _utic["retry_at"]:
        return _utic["rows"]
    if not _utic_fetch.acquire(timeout=15):
        return _utic["rows"]
    try:
        if _utic["rows"] and time.monotonic() - _utic["at"] < 6 * 3600:
            return _utic["rows"]
        _, key = _utic_key()
        try:
            reply = _utic_get(UTIC_LIST, {"key": key}, (5, 40))
            reply.raise_for_status()
            listed = _catalogue(reply, key)
            if isinstance(listed, dict):
                listed = next((v for v in listed.values() if isinstance(v, list)), [listed])
            if not isinstance(listed, list):
                raise ValueError("Invalid catalogue")
            if len(listed) == 1 and isinstance(listed[0], dict) and _field(listed[0], "resultCode"):
                # e.g. 02 "유효한 KEY값이 아닙니다." or an unregistered address
                _utic["issue"] = {"code": "not_authorized", "provider": _field(listed[0], "resultCode")[:8],
                    "message": _field(listed[0], "resultMsg")[:80]}
                _utic["retry_at"] = time.monotonic() + 600
                return _utic["rows"]
            allowed = {_field(r, "CCTVID"): r for r in listed if isinstance(r, dict) and _field(r, "CCTVID")}
            places = {}
            if any(not _field(r, "XCOORD", "COORDX") for r in list(allowed.values())[:20]):
                mapped = _utic_get(UTIC_MAP, None, (5, 40))
                mapped.raise_for_status()
                body = json.loads(_text(mapped), strict=False)
                if not isinstance(body, list):
                    raise ValueError("Invalid camera map")
                places = {_field(r, "CCTVID"): r for r in body if isinstance(r, dict)}
            rows, kinds = {}, {}
            for cid, entry in allowed.items():
                row = {**places.get(cid, {}), **{k: v for k, v in entry.items() if v not in (None, "")}}
                try:
                    x, y = float(_field(row, "XCOORD", "COORDX", "LON")), float(_field(row, "YCOORD", "COORDY", "LAT"))
                except ValueError:
                    continue
                name = " ".join(_field(row, "CCTVNAME").split())[:160]
                if not name or not 124 <= x <= 132 or not 33 <= y <= 39:
                    continue
                kind = _KIND_BY_PREFIX.get(cid[:3]) or _field(row, "KIND")
                kinds[kind] = kinds.get(kind, 0) + 1
                rows[cid] = {"id": cid, "name": name, "lat": y, "lon": x, "kind": kind,
                    "center": _field(row, "CENTERNAME")[:60], "movie": _field(row, "MOVIE").upper(),
                    "ip": _field(row, "CCTVIP"), "ch": _field(row, "CH", "CCTVCH"), "user": _field(row, "ID"),
                    "pw": _field(row, "PASSWD", "CCTVPASSWD"), "port": _field(row, "PORT", "CCTVPORT")}
            _utic.update(rows=rows, at=time.monotonic(), issue=None, kinds=kinds, listed=len(allowed),
                fields=sorted({k for r in list(places.values())[:5] + list(allowed.values())[:5] for k in r})[:40])
            if not rows:
                _utic["issue"] = {"code": "empty_catalogue", "listed": len(allowed), "mapped": len(places)}
                _utic["retry_at"] = time.monotonic() + 600
            return _utic["rows"]
        except Exception as error:
            # Exceptions can contain the credential-bearing request URL.
            issue = {"code": _issue_code(error)}
            if isinstance(error, requests.exceptions.HTTPError) and error.response is not None:
                issue["http"] = error.response.status_code
            _utic["issue"] = issue
            _utic["retry_at"] = time.monotonic() + 300
            return _utic["rows"]
    finally:
        _utic_fetch.release()


def _page_token(cid: str) -> str:
    with _lock:
        token = _page_by_id.get(cid)
        if token and token in _pages:
            _pages[token] = (cid, time.monotonic() + 6 * 3600)
            _pages.move_to_end(token)
            return token
        token = secrets.token_urlsafe(24)
        _pages[token] = (cid, time.monotonic() + 6 * 3600)
        _page_by_id[cid] = token
        while len(_pages) > 20000:
            dropped, (value, _) = _pages.popitem(last=False)
            if _page_by_id.get(value) == dropped:
                _page_by_id.pop(value, None)
        return token


def _city_cameras(lat: float, lon: float) -> dict:
    if not _utic_key()[1]:
        return {"items": [], "status": "needs_key", "source": UTIC_SOURCE}
    rows = _utic_rows()
    if not rows:
        issue = _utic["issue"] or {"code": "unavailable"}
        status = "not_authorized" if issue.get("code") == "not_authorized" else "unavailable"
        return {"items": [], "status": status, "source": UTIC_SOURCE, "issues": [{"road": "city", "code": issue.get("code")}]}
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    near = []
    for row in rows.values():
        if row["movie"] == "N":
            continue
        dx, dy = (row["lon"] - lon) * kx, (row["lat"] - lat) * ky
        if abs(dx) <= 2300 and abs(dy) <= 2300:
            near.append((dx * dx + dy * dy, row))
    near.sort(key=lambda e: e[0])
    items = [{"id": "utic:" + row["id"], "name": row["name"], "lat": row["lat"], "lon": row["lon"],
        "source": UTIC_SOURCE + (" · " + row["center"] if row["center"] else ""), "address": row["center"],
        "media": None, "resolve": "/api/realestate/cctv/open/" + _page_token(row["id"]), "format": "hls"}
        for _, row in near[:300]]
    return {"items": items, "status": "ok", "source": UTIC_SOURCE}


_MEDIA_RE = re.compile(r"""(?:src\s*=\s*["']|["'])((?:https?:)?//[^"'\s<>]+?\.(?:m3u8|mp4|jpe?g|png)(?:\?[^"'\s<>]*)?)["']""", re.I)
_FRAME_RE = re.compile(r"""<iframe[^>]+src\s*=\s*["']((?:https?:)?//[^"'\s<>]+)["']""", re.I)


def _page_media(html: str, base: str):
    """The video a UTIC player page shows: its <source>/<video> or a quoted HLS/MP4
    address, outside HTML comments (the page keeps old addresses in them)."""
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    start = html.find('id="cctvarea"')
    area = html[start:] if start >= 0 else html
    for m in _MEDIA_RE.finditer(area):
        url = urljoin(base, m.group(1))
        p = urlsplit(url)
        if "/null" in p.path or "null." in p.path:
            continue  # a field the catalogue left empty
        return url, None
    frame = _FRAME_RE.search(area)
    return None, urljoin(base, frame.group(1)) if frame else None


def _format(url: str) -> str:
    path = urlsplit(url).path.lower()
    return "mp4" if path.endswith(".mp4") else "image" if path.endswith((".jpg", ".jpeg", ".png")) else "hls"


def _log_resolve(entry: dict):
    _resolve_log.append({**entry, "at": int(time.time())})
    del _resolve_log[:-30]


def open_city(token: str) -> dict:
    """One camera's current video, from its UTIC player page fetched by this server
    (the registered address). A resolved link is reused for five minutes."""
    with _lock:
        entry = _pages.get(token)
    if not entry or entry[1] < time.monotonic():
        raise LookupError("Camera link expired")
    cid = entry[0]
    with _lock:
        hit = _resolved.get(cid)
        if hit and time.monotonic() - hit[0] < 300:
            return hit[1]
    row = _utic["rows"].get(cid)
    _, key = _utic_key()
    if not row or not key:
        raise LookupError("Camera unknown")
    params = {"key": key, "cctvid": cid, "cctvName": row["name"], "kind": row["kind"], "cctvip": row["ip"] or "null",
        "cctvch": row["ch"] or "null", "id": row["user"] or "null", "cctvpasswd": row["pw"] or "null", "cctvport": row["port"] or "null"}
    try:
        reply = _utic_get(UTIC_PAGE, params, (5, 10))
        reply.raise_for_status()
        html = reply.content[:600_000].decode("utf-8", "replace")
    except Exception as error:
        _log_resolve({"kind": row["kind"], "code": _issue_code(error)})
        raise ValueError("Player page unavailable") from None
    url, frame = _page_media(html, UTIC_PAGE)
    if not url and frame:
        try:
            body, _, final = _public_fetch(frame)
            url, _ = _page_media(body[:600_000].decode("utf-8", "replace"), final)
        except Exception as error:
            _log_resolve({"kind": row["kind"], "code": "frame_" + _issue_code(error), "frame": urlsplit(frame).hostname})
            raise ValueError("Player frame unavailable") from None
    if not url:
        visible = re.sub(r"<script.*?</script>|<!--.*?-->", "", html, flags=re.S)
        code = "maintenance" if "점검중" in visible else "no_media"
        _log_resolve({"kind": row["kind"], "code": code})
        raise ValueError("No video on the player page")
    result = {"media": _path(url), "format": _format(url)}
    # The stream servers are public (UTIC's own map plays them in visitors' browsers);
    # only the key, catalogue and player page are tied to the registered address.
    # HTTPS streams play directly (the relay crossed the Pacific slower than real
    # time); the relay stays for plain-HTTP streams and as the fallback.
    if urlsplit(url).scheme == "https" and not urlsplit(url).query:
        result["direct"] = url
    _log_resolve({"kind": row["kind"], "code": "ok", "host": urlsplit(url).hostname, "format": result["format"]})
    with _lock:
        _resolved[cid] = (time.monotonic(), result)
        while len(_resolved) > 2000:
            _resolved.popitem(last=False)
    return result


def status() -> dict:
    """Provider state for production checks: names and counts only, never keys or URLs."""
    name, key = _utic_key()
    return {"city": {"enabled": CITY_CCTV_ENABLED, "key": name if key else None,
        "env_names": [n for n in os.environ if "UTIC" in n.upper()][:10],
        "cameras": len(_utic["rows"]), "age_s": int(time.monotonic() - _utic["at"]) if _utic["at"] else None,
        "issue": _utic["issue"], "listed": _utic.get("listed"), "fields": _utic["fields"], "sample": _utic.get("sample"),
        "kinds": dict(sorted(_utic["kinds"].items(), key=lambda e: -e[1])[:30]),
        "resolves": _resolve_log[-15:]}, "highway": {"enabled": HIGHWAY_CCTV_ENABLED, "key": bool(_key())}}


def cameras(lat: float, lon: float, refresh: bool = False) -> dict:
    city = _city_cameras(lat, lon) if CITY_CCTV_ENABLED else None
    if not HIGHWAY_CCTV_ENABLED:
        return city or {"items": [], "status": "disabled", "source": SOURCE}
    road = _road_cameras(lat, lon, refresh)
    if not city:
        return road
    return {**city, "items": city["items"] + road["items"], "issues": city.get("issues", []) + road.get("issues", [])}


def _road_cameras(lat: float, lon: float, refresh: bool = False) -> dict:
    if not _key():
        return {"items": [], "status": "needs_key", "source": SOURCE}
    if _key().lower() == "test":
        return {"items": [], "status": "invalid_key", "source": SOURCE}
    # Fixed small cells reuse one request while flying; bounded cache, five minutes.
    lat, lon = round(lat / .005) * .005, round(lon / .005) * .005
    cell = (lat, lon)
    with _lock:
        hit = _cache.get(cell)
        if not refresh and hit and time.monotonic() - hit[0] < hit[2]:
            _cache.move_to_end(cell)
            return hit[1]
    if not _slots.acquire(timeout=.1):
        return {"items": [], "status": "unavailable", "source": SOURCE}
    try:
        items, failed, unauthorized, issues = [], 0, 0, []
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [(road, pool.submit(_fetch_road, road, lat, lon)) for road in ("ex", "its")]
            for road, job in jobs:
                try:
                    items.extend(job.result())
                except CameraAuthError:
                    failed += 1
                    unauthorized += 1
                    issues.append({"road": road, "code": "not_authorized"})
                except Exception as error:
                    # Exceptions can contain the credential-bearing request URL.
                    failed += 1
                    code = ("connect_timeout" if isinstance(error, requests.exceptions.ConnectTimeout)
                        else "read_timeout" if isinstance(error, requests.exceptions.ReadTimeout)
                        else "tls_error" if isinstance(error, requests.exceptions.SSLError)
                        else "connection_failed" if isinstance(error, requests.exceptions.ConnectionError)
                        else "http_error" if isinstance(error, requests.exceptions.HTTPError)
                        else "invalid_response" if isinstance(error, (ValueError, ET.ParseError))
                        else "provider_error")
                    issue = {"road": road, "code": code}
                    if isinstance(error, requests.exceptions.HTTPError) and error.response is not None:
                        issue["http"] = error.response.status_code
                    issues.append(issue)
        result = {"items": items[:1000], "status": "not_authorized" if failed == 2 and unauthorized else "unavailable" if failed == 2 else "partial" if failed else "ok", "source": SOURCE, "issues": issues}
        with _lock:
            _cache[cell] = (time.monotonic(), result, 30 if failed else 300)
            while len(_cache) > 128:
                _cache.popitem(last=False)
        return result
    finally:
        _slots.release()


def _public_fetch(url: str):
    """Pin the connection to a validated public IP, including after each redirect."""
    for _ in range(4):
        p = urlsplit(url)
        if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
            raise ValueError("Invalid media")
        port = p.port or (443 if p.scheme == "https" else 80)
        if not _allowed_port(p):
            raise ValueError("Invalid media port")
        addresses = [a[4][0] for a in socket.getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)]
        if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
            raise ValueError("Invalid media host")
        host = p.hostname + (f":{port}" if p.port else "")
        pool = urllib3.HTTPSConnectionPool(addresses[0], port=port, server_hostname=p.hostname,
            assert_hostname=p.hostname, cert_reqs="CERT_REQUIRED") if p.scheme == "https" else urllib3.HTTPConnectionPool(addresses[0], port=port)
        try:
            resp = pool.request("GET", p.path + ("?" + p.query if p.query else ""),
                headers={"Host": host, "Accept-Encoding": "identity", **UTIC_HEADERS}, redirect=False,
                preload_content=False, retries=False, timeout=urllib3.Timeout(connect=4, read=8))
            try:
                if resp.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, resp.headers.get("Location", ""))
                    continue
                if resp.status != 200:
                    raise MediaProviderError(resp.status)
                content = resp.read(8 * 1024 * 1024 + 1)
                if len(content) > 8 * 1024 * 1024:
                    raise ValueError("Media too large")
                return content, resp.headers.get("Content-Type", "application/octet-stream"), url
            finally:
                resp.close()
        finally:
            pool.close()
    raise ValueError("Too many redirects")


def media(token: str):
    with _lock:
        entry = _media.get(token)
    if not entry or entry[1] < time.monotonic():
        raise LookupError("Camera link expired")
    with _lock:
        _media[token] = (entry[0], time.monotonic() + 1800)
        # Viewers of one camera share a playlist fetched within the last second, and
        # a provider error is not repeated for ten seconds (UTIC blocks clients that
        # keep producing upstream 50x replies).
        listed = _manifests.get(entry[0])
        if listed and time.monotonic() - listed[0] < 1:
            return listed[1], "application/vnd.apple.mpegurl"
        failed = _failed_media.get(entry[0])
        if failed and failed[0] > time.monotonic():
            raise MediaProviderError(failed[1])
    if not _slots.acquire(timeout=3):
        raise ValueError("Media busy")
    try:
        try:
            body, content_type, final = _public_fetch(entry[0])
        except MediaProviderError as error:
            with _lock:
                _failed_media[entry[0]] = (time.monotonic() + 10, error.status)
                while len(_failed_media) > 2000:
                    _failed_media.pop(next(iter(_failed_media)))
            raise
        if body.startswith(b"#EXTM3U"):
            if len(body) > 512000:
                raise ValueError("Manifest too large")
            lines = []
            for line in body.decode("utf-8-sig").splitlines():
                if line.startswith("#"):
                    line = re.sub(r'URI="([^"]+)"', lambda m: 'URI="' + _path(urljoin(final, m[1])) + '"', line)
                elif line.strip():
                    line = _path(urljoin(final, line.strip()))
                lines.append(line)
            out = ("\n".join(lines) + "\n").encode()
            with _lock:
                _manifests[entry[0]] = (time.monotonic(), out)
                while len(_manifests) > 500:
                    _manifests.popitem(last=False)
            return out, "application/vnd.apple.mpegurl"
        if not (content_type.startswith(("video/", "image/", "audio/")) or content_type.split(";")[0] in ("application/octet-stream", "binary/octet-stream")):
            raise ValueError("Unsupported media response")
        return body, content_type
    finally:
        _slots.release()
