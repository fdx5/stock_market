"""Validate the Render -> Cloudflare proxy chain; geolocate inside the server.

An arbitrary leftmost XFF value or the presence of CF headers is not evidence.
IP addresses leave neither this process nor the pseudonymization boundary.
"""
import ipaddress
import os
import threading
from pathlib import Path

# Cloudflare's published networks, verified 2026-10-23 against /ips-v4 and /ips-v6.
CF_NETWORKS = tuple(ipaddress.ip_network(net) for net in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32",
    "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32"))
_reader = None
_lock = threading.Lock()


def render_proxy_trusted(request) -> bool:
    if os.environ.get("RENDER", "").lower() != "true":
        return False
    chain = request.headers.get("x-forwarded-for", "").split(",")
    # Render appends real proxy hops. Ignore private internal hops, but never skip
    # a public non-Cloudflare hop to reach a client-supplied earlier entry.
    for value in reversed(chain):
        try:
            ip = ipaddress.ip_address(value.strip())
        except ValueError:
            return False
        if not ip.is_global:
            continue
        return any(ip.version == net.version and ip in net for net in CF_NETWORKS)
    return False


def geoip_available() -> bool:
    return Path(os.environ.get("AUDIENCE_GEOIP_PATH", "__not_configured__")).is_file()


def lookup(ip: str) -> dict:
    global _reader
    if not geoip_available():
        return {}
    try:
        with _lock:
            if _reader is None:
                import maxminddb
                _reader = maxminddb.open_database(os.environ["AUDIENCE_GEOIP_PATH"])
        result = _reader.get(ip) or {}
        country = result.get("country", {}).get("iso_code", "")
        subdivisions = result.get("subdivisions", [])
        region = subdivisions[0].get("names", {}) if subdivisions else {}
        city = result.get("city", {}).get("names", {})
        location = result.get("location", {})
        return {"country": country, "region": region.get("ko") or region.get("en") or "",
                "city": city.get("ko") or city.get("en") or "",
                "latitude": location.get("latitude"), "longitude": location.get("longitude"),
                # City Lite commonly supplies a city centre with no accuracy
                # radius. Never present it as a device's precise position.
                "accuracy_m": max(25000, float(location.get("accuracy_radius", 50)) * 1000)}
    except Exception:
        return {}
