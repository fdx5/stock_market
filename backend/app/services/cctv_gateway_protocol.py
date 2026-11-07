"""Bounded, GET-only protocol for the operator's domestic CCTV egress worker."""
import json
import ipaddress
import os
import struct
from urllib.parse import urlsplit

MAX_BODY = 8 * 1024 * 1024
MAX_HEADER = 8192
CHALLENGE_CONTEXT = b"kospimap-cctv-gateway/v1\x00"


class GatewayUnavailable(ValueError):
    pass


def gateway_required():
    return os.environ.get("CCTV_HIGHWAY_GATEWAY", "").strip().lower() == "required"


def validate_target(url: str, kind: str) -> None:
    if not isinstance(url, str) or len(url) > 4096:
        raise ValueError("Unsupported CCTV target")
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.fragment:
        raise ValueError("Unsupported CCTV target")
    host = p.hostname.lower()
    port = p.port or (443 if p.scheme == "https" else 80)
    if kind == "api":
        allowed = p.scheme == "https" and host == "openapi.its.go.kr" and port == 9443 and p.path == "/cctvInfo"
    elif kind == "media":
        allowed = any(host == root or host.endswith("." + root) for root in ("ktict.co.kr", "its.go.kr", "ex.co.kr")) and port in (80, 443, 8081, 8082, 1935)
    elif kind == "city_media":
        # UTIC embeds municipal providers, including public IPs and custom ports.
        # Only the trusted server creates these jobs from a resolved UTIC page or
        # its HLS children; no browser endpoint accepts a destination URL. The
        # worker additionally pins public DNS on EVERY connection/redirect.
        allowed = port in (80, 443) or 1024 <= port <= 65535
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            allowed = False
        try:
            if not ipaddress.ip_address(host).is_global:
                allowed = False
        except ValueError:
            pass
    else:
        allowed = False
    if not allowed:
        raise ValueError("Unsupported CCTV target")


def pack_reply(job: str, status: int, body: bytes = b"", content_type: str = "", final_url: str = "") -> bytes:
    if len(body) > MAX_BODY:
        raise ValueError("CCTV reply too large")
    header = json.dumps({"id": job, "status": status, "content_type": content_type[:150], "final_url": final_url}, separators=(",", ":")).encode()
    if len(header) > MAX_HEADER:
        raise ValueError("CCTV reply header too large")
    return struct.pack("!I", len(header)) + header + body


def unpack_reply(packet: bytes) -> tuple[dict, bytes]:
    if len(packet) < 4 or len(packet) > MAX_BODY + MAX_HEADER + 4:
        raise ValueError("Invalid CCTV reply")
    size = struct.unpack("!I", packet[:4])[0]
    if not 1 <= size <= MAX_HEADER or size + 4 > len(packet):
        raise ValueError("Invalid CCTV reply")
    header = json.loads(packet[4:4 + size])
    if not isinstance(header, dict) or not isinstance(header.get("id"), str) or not isinstance(header.get("status"), int):
        raise ValueError("Invalid CCTV reply")
    if not 100 <= header["status"] <= 599 or not isinstance(header.get("content_type"), str) or not isinstance(header.get("final_url"), str):
        raise ValueError("Invalid CCTV reply")
    body = packet[4 + size:]
    if len(body) > MAX_BODY:
        raise ValueError("CCTV reply too large")
    return header, body
