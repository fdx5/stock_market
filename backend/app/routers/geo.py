import requests
from fastapi import APIRouter, Request

from app.services.cache import cache

router = APIRouter()

TTL_GEO_SECONDS = 24 * 3600

_PRIVATE_PREFIXES = ("127.", "10.", "192.168.", "::1")


def _client_ip(request: Request) -> str | None:
    # Render (and most PaaS reverse proxies) put the original client IP first in
    # X-Forwarded-For; request.client.host would otherwise just be the proxy's own IP.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _lookup_country(ip: str) -> str | None:
    try:
        resp = requests.get(f"http://ip-api.com/json/{ip}?fields=countryCode", timeout=5)
        resp.raise_for_status()
        code = resp.json().get("countryCode")
        return code if isinstance(code, str) and len(code) == 2 else None
    except Exception:
        return None


@router.get("/geo/country")
def geo_country(request: Request):
    """Best-effort IP -> country lookup, used only to pick a sane default UI
    language for first-time visitors (see the frontend's LanguageContext) — never
    blocks or errors the app if it fails, since the caller just falls back to
    Korean. Local/private IPs (dev) skip the lookup outright."""
    ip = _client_ip(request)
    if not ip or ip.startswith(_PRIVATE_PREFIXES):
        return {"country": None}

    country = cache.get_or_set(f"geo_country:{ip}", TTL_GEO_SECONDS, lambda: _lookup_country(ip))
    return {"country": country}
