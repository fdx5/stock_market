"""Public ITS traffic cameras. Process-local metadata/media references only; no database.

The service key and provider URLs stay on the server. Media references can only be
created from an ITS reply or one of its HLS manifests, never from a client URL.
"""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
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
_cache: OrderedDict = OrderedDict()
_media: OrderedDict = OrderedDict()
_by_url: dict = {}
_lock = threading.RLock()
_slots = threading.BoundedSemaphore(6)


class CameraAuthError(ValueError):
    """Provider rejected this service's authorization; never include its URL."""


def _key():
    return (os.environ.get("ITS_CCTV_API_KEY") or os.environ.get("ITS_API_KEY") or "").strip()


def _remember(url: str) -> str:
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Unsupported media URL")
    if len(url) > 4096 or (p.port or (443 if p.scheme == "https" else 80)) not in (80, 443, 8080, 8081, 8443, 9443):
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


def cameras(lat: float, lon: float, refresh: bool = False) -> dict:
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
        items, failed, unauthorized = [], 0, 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(_fetch_road, road, lat, lon) for road in ("ex", "its")]
            for job in jobs:
                try:
                    items.extend(job.result())
                except CameraAuthError:
                    failed += 1
                    unauthorized += 1
                except Exception:
                    # Exceptions can contain the credential-bearing request URL.
                    failed += 1
        result = {"items": items[:1000], "status": "not_authorized" if failed == 2 and unauthorized else "unavailable" if failed == 2 else "partial" if failed else "ok", "source": SOURCE}
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
        if port not in (80, 443, 8080, 8081, 8443, 9443):
            raise ValueError("Invalid media port")
        addresses = [a[4][0] for a in socket.getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)]
        if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
            raise ValueError("Invalid media host")
        host = p.hostname + (f":{port}" if p.port else "")
        pool = urllib3.HTTPSConnectionPool(addresses[0], port=port, server_hostname=p.hostname,
            assert_hostname=p.hostname, cert_reqs="CERT_REQUIRED") if p.scheme == "https" else urllib3.HTTPConnectionPool(addresses[0], port=port)
        try:
            resp = pool.request("GET", p.path + ("?" + p.query if p.query else ""),
                headers={"Host": host, "Accept-Encoding": "identity"}, redirect=False,
                preload_content=False, retries=False, timeout=urllib3.Timeout(connect=4, read=8))
            try:
                if resp.status in (301, 302, 303, 307, 308):
                    url = urljoin(url, resp.headers.get("Location", ""))
                    continue
                if resp.status != 200:
                    raise ValueError("Media unavailable")
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
    if not _slots.acquire(timeout=.1):
        raise ValueError("Media busy")
    try:
        body, content_type, final = _public_fetch(entry[0])
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
            return ("\n".join(lines) + "\n").encode(), "application/vnd.apple.mpegurl"
        if not (content_type.startswith(("video/", "image/", "audio/")) or content_type.split(";")[0] in ("application/octet-stream", "binary/octet-stream")):
            raise ValueError("Unsupported media response")
        return body, content_type
    finally:
        _slots.release()
