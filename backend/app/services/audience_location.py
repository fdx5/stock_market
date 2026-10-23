"""Opt-in browser position -> coarse region using an owner-controlled geocoder.

No public geocoding service default, no coordinates or addresses in persistence.
"""
import os
import threading
import time
from urllib.parse import urlparse

import requests

from app.services import audience_analytics as audience

_lock = threading.Lock()
_next_lookup = 0.0


def enabled() -> bool:
    url = urlparse(os.environ.get("AUDIENCE_GEOCODER_URL", ""))
    # Use an owned/contracted Nominatim-compatible endpoint, never the public OSM API.
    return (audience.configured() and url.scheme == "https" and bool(url.hostname)
            and not url.username and not url.password
            and not (url.hostname == "openstreetmap.org" or url.hostname.endswith(".openstreetmap.org")))


def resolve(observation: dict, latitude: float, longitude: float, accuracy_m: float) -> bool:
    global _next_lookup
    if not enabled() or accuracy_m > 5000:
        return False
    # Reject bursts rather than queue positions or create unbounded background jobs.
    if not _lock.acquire(blocking=False):
        return False
    try:
        if time.monotonic() < _next_lookup:
            return False
        _next_lookup = time.monotonic() + 1.1
        response = requests.get(os.environ["AUDIENCE_GEOCODER_URL"], params={
            "lat": round(latitude, 3), "lon": round(longitude, 3),
            "format": "jsonv2", "zoom": 10, "addressdetails": 1,
            "accept-language": "ko,en",
        }, headers={"User-Agent": "KStockHubAudience/1.0"}, timeout=(2, 4), allow_redirects=False)
        if response.status_code != 200:
            return False
        address = response.json().get("address", {})
        country = str(address.get("country_code", "")).upper()
        if len(country) != 2 or not country.isascii() or not country.isalpha():
            return False
        region = audience._text(address.get("state") or address.get("province"))
        city = audience._text(address.get("city") or address.get("town") or address.get("county"))
        if not region and not city:
            return False
        return audience.record({**observation, "country": country, "region": region, "city": city,
                                "location_source": "browser_location"})
    except Exception:
        # Do not log exception URLs, coordinates, response bodies, or request headers.
        return False
    finally:
        _lock.release()
