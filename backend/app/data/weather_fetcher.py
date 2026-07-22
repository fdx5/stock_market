import requests

from app.services.cache import cache

# Open-Meteo is free, key-less, and CORS-open — but we still proxy it through the
# backend (like every other upstream) so this cache, not each visitor's browser,
# bounds how often it's hit. Weather barely moves minute to minute, so a 15-minute
# TTL is plenty and keeps the dashboard's header clock cheap.
TTL_WEATHER_SECONDS = 900

# Seoul — the site's home market, which is what the header calendar reports.
SEOUL_LAT = 37.5665
SEOUL_LON = 126.9780

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}


def _fetch_seoul_weather() -> dict:
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": SEOUL_LAT,
            "longitude": SEOUL_LON,
            "current": "temperature_2m,weather_code,is_day",
            "timezone": "Asia/Seoul",
        },
        headers=HEADERS,
        timeout=4,
    )
    resp.raise_for_status()
    current = resp.json()["current"]
    return {
        "temperature": round(float(current["temperature_2m"])),
        # WMO weather interpretation code — the frontend maps it to an icon.
        "code": int(current["weather_code"]),
        "is_day": bool(current["is_day"]),
    }


def get_seoul_weather() -> dict:
    return cache.get_or_set("seoul_weather", TTL_WEATHER_SECONDS, _fetch_seoul_weather)
