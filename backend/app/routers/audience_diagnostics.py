"""Operations gateway: aggregate SELECTs only, no IDs, positions, or DB keys."""
import hmac
import os

from fastapi import APIRouter, Header, HTTPException
from app.services import audience_analytics, audience_live, audience_network

router = APIRouter()


@router.get("/audience-diagnostics")
def audience_diagnostics(x_audience_diagnostics_key: str = Header(default="")):
    expected = os.environ.get("AUDIENCE_DIAGNOSTICS_KEY", "")
    if len(expected) < 32 or not hmac.compare_digest(expected.encode(), x_audience_diagnostics_key.encode()):
        raise HTTPException(401, "Diagnostics authentication required")
    data = audience_analytics.overview(7)
    live = audience_live.overview()
    countries = {}
    for row in data["regions"]:
        countries[row["country"] or "unknown"] = countries.get(row["country"] or "unknown", 0) + row["browser_days"]
    return {"enabled": data["enabled"], "schema_ready": data["schema_ready"],
            "geoip_available": audience_network.geoip_available(), "map_ready": live["enabled"],
            "totals": {key: data[key] for key in ("browsers", "sessions", "network_days", "located_browser_days")},
            "location_sources": sorted({row["source"] for row in data["regions"]}),
            "country_browser_days": countries,
            "ip_source_counts": dict(audience_analytics._ip_source_counts),
            "online": {"located": live["located"], "unlocated": live["unlocated"]},
            "write_counts": live["diagnostics"]}
