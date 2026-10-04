"""Open water round a point, from OpenStreetMap, for the 3D viewer.

The parcels the viewer reads (연속지적도) register many lakes as parks or building lots —
석촌호수 is a 공원 — so their water is never drawn from them; and they reach only a few hundred
metres, so a river runs on past them as painted ground. OpenStreetMap maps the water itself:
lakes, ponds, reservoirs and river areas (natural=water, waterway=riverbank, landuse=reservoir).
Returned as rings in metres about the point (x east, y north, as the buildings), clipped to the
square of `radius`. Islands are not cut out: the viewer keeps water only where the ground is at
the water's level, so an island standing above it stays dry.
"""
from __future__ import annotations

from app.services.geography_cache import cached_geography
from app.services.realestate_buildings import BuildingsError, _clean, _overpass, _projector, _stitch


def _clip(ring: list[tuple[float, float]], r: float) -> list[tuple[float, float]]:
    """Sutherland–Hodgman against the square |x|, |y| <= r."""
    def cut(pts, inside, cross):
        out = []
        for i, p in enumerate(pts):
            q = pts[i - 1]
            if inside(p):
                if not inside(q):
                    out.append(cross(q, p))
                out.append(p)
            elif inside(q):
                out.append(cross(q, p))
        return out

    def at_x(x0):
        return lambda a, b: (x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / ((b[0] - a[0]) or 1e-9))

    def at_y(y0):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y0 - a[1]) / ((b[1] - a[1]) or 1e-9), y0)

    pts = list(ring)
    for inside, cross in ((lambda p: p[0] <= r, at_x(r)), (lambda p: p[0] >= -r, at_x(-r)),
                          (lambda p: p[1] <= r, at_y(r)), (lambda p: p[1] >= -r, at_y(-r))):
        if not pts:
            break
        pts = cut(pts, inside, cross)
    return [(round(x, 2), round(y, 2)) for x, y in pts]


def _water_lookup(lat: float, lon: float, radius: float = 700) -> dict:
    # (a little past the square: a lake whose middle is outside still reaches in)
    r = int(radius * 1.45)
    sel = "".join(f'{kind}{tag}(around:{r},{lat},{lon});'
                  for tag in ('["natural"="water"]', '["waterway"="riverbank"]', '["landuse"="reservoir"]')
                  for kind in ("way", "relation"))
    try:
        els = _overpass(f"[out:json][timeout:3];({sel});out geom;", deadline_s=4)
    except BuildingsError:
        return {"rings": [], "source": None}
    project = _projector(lat, lon)
    rings = []
    for e in els:
        tags = e.get("tags", {})
        name = tags.get("name")
        kind = tags.get("water") or tags.get("natural") or tags.get("waterway") or "water"
        if e.get("type") == "way":
            parts = [[project(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]]
        else:
            ways = [[project(p["lon"], p["lat"]) for p in m.get("geometry", []) if p]
                    for m in e.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "")]
            parts = _stitch(ways)
        for part in parts:
            ring = _clean(part)
            if not ring:
                continue
            clipped = _clean(_clip(ring, radius))
            if clipped:
                rings.append({"ring": clipped, "kind": kind, "name": name})
    out = {"rings": rings, "source": "OpenStreetMap"}
    return out



def _crossings_lookup(lat: float, lon: float, radius: float = 700) -> dict:
    """Mapped crosswalks (footway=crossing ways, crossing nodes) and traffic signals round a
    point, from OpenStreetMap: lines and points in metres about it (x east, y north), for the
    3D viewer's junctions — where its zebra crossings, stop lines and signal heads stand."""
    r = int(radius * 1.2)
    q = (f'[out:json][timeout:3];(way["footway"="crossing"](around:{r},{lat},{lon});'
         f'node["highway"="crossing"](around:{r},{lat},{lon});node["highway"="traffic_signals"](around:{r},{lat},{lon}););out geom;')
    try:
        els = _overpass(q, deadline_s=4)
    except BuildingsError:
        return {"crossings": [], "points": [], "signals": [], "source": None}
    project = _projector(lat, lon)
    lines, points, signals = [], [], []
    for e in els:
        tags = e.get("tags", {})
        if e.get("type") == "way":
            pts = [project(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
            if len(pts) >= 2:
                lines.append({"line": pts, "signals": tags.get("crossing") == "traffic_signals"})
        elif tags.get("highway") == "traffic_signals":
            signals.append(project(e["lon"], e["lat"]))
        else:
            points.append({"at": project(e["lon"], e["lat"]), "signals": tags.get("crossing") == "traffic_signals",
                           "marked": tags.get("crossing") in ("marked", "zebra", "traffic_signals") or tags.get("crossing:markings") not in (None, "no")})
    out = {"crossings": lines, "points": points, "signals": signals, "source": "OpenStreetMap"}
    return out



def water(lat: float, lon: float, radius: float = 700) -> dict:
    return cached_geography("water", lat, lon, radius, lambda: _water_lookup(lat, lon, radius))

def crossings(lat: float, lon: float, radius: float = 700) -> dict:
    return cached_geography("crossings", lat, lon, radius, lambda: _crossings_lookup(lat, lon, radius))
