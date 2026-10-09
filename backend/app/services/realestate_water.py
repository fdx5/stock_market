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
import datetime as dt
import logging
import math
import threading
import time

from app.services import realestate_coast
from app.services.geography_cache import cached_geography, peek_geography
from app.services.realestate_buildings import BuildingsError, _clean, _overpass, _projector, _stitch

log = logging.getLogger(__name__)


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


def _water_lookup(lat: float, lon: float, radius: float = 700, deadline_s: float = 4) -> dict:
    """Open water round a point (lakes, ponds, river areas), the sea (made from the coastline,
    realestate_coast) and the beaches, from OpenStreetMap: rings in metres about the point,
    clipped to the square of `radius`. The sea comes as rings of kind "sea"; the beaches apart
    (`beaches`), for the ground's sand."""
    # (a little past the square: a lake whose middle is outside still reaches in)
    r = int(radius * 1.45)
    sel = "".join(f'{kind}{tag}(around:{r},{lat},{lon});'
                  for tag in ('["natural"="water"]', '["waterway"="riverbank"]', '["landuse"="reservoir"]')
                  for kind in ("way", "relation"))
    project = _projector(lat, lon)
    # The coastline and the beaches: bundled (app/data/kr_coastline.json.gz — they come at once,
    # everywhere); without the file, from Overpass with the rest (the coastline over the square
    # and a margin: every way crossing it comes whole).
    coast, sea, beaches, bundled_beaches = _bundled(lat, lon, radius, project)
    if bundled_beaches is None:  # (no file: the beaches from Overpass with the rest)
        sel += "".join(f'{kind}["natural"="beach"](around:{r},{lat},{lon});' for kind in ("way", "relation"))
    if coast is None:
        k = math.cos(math.radians(lat)) * 111_320
        m = radius * 1.1
        bbox = f"{lat - m / 110_540:.6f},{lon - m / k:.6f},{lat + m / 110_540:.6f},{lon + m / k:.6f}"
        sel += f'way["natural"="coastline"]({bbox});'
        coast = []
    try:
        els = _overpass(f"[out:json][timeout:{max(3, int(deadline_s) - 1)}];({sel});out geom;", deadline_s=deadline_s)
    except BuildingsError:
        # (the lakes and beaches another time — the background survey; the sea now)
        return {"rings": sea, "beaches": beaches, "source": None}
    rings = []
    for e in els:
        tags = e.get("tags", {})
        if tags.get("natural") == "coastline" and e.get("type") == "way":
            pts = [project(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
            if len(pts) > 1:
                coast.append(pts)
            continue
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
                (beaches if tags.get("natural") == "beach" else rings).append({"ring": clipped, "kind": kind, "name": name})
    rings += sea or _sea_rings(coast, radius)
    out = {"rings": rings, "beaches": beaches, "source": "OpenStreetMap"}
    return out


def _bundled(lat: float, lon: float, radius: float, project):
    """From the bundled file: (coastline parts or None, sea rings, beach rings, beaches or None)."""
    coast = realestate_coast.coastline_near(lat, lon, radius, project)
    found = realestate_coast.beaches_near(lat, lon, radius, project)
    beaches: list[dict] = []
    for b in found or []:
        clipped = _clean(_clip(b["ring"], radius))
        if clipped:
            beaches.append({"ring": clipped, "kind": "beach", "name": b["name"]})
    sea = _sea_rings(coast or [], radius)
    # (no coastline across the square: all sea or all land — which side of the nearest coast)
    if coast is not None and not sea and realestate_coast.sea_at(lat, lon):
        made = realestate_coast.sea(coast, radius)
        islands = [r for r in (_clean(i) for i in made["islands"]) if r]
        sea = [{"ring": _clean([(-radius, -radius), (radius, -radius), (radius, radius), (-radius, radius)]), "kind": "sea", "name": None, **({"islands": islands} if islands else {})}]
    return coast, sea, beaches, found


def _sea_rings(coast: list, radius: float) -> list[dict]:
    """The sea within the square as water rings (kind "sea"), its islands as their holes."""
    if not coast:
        return []
    made = realestate_coast.sea(coast, radius)
    islands = [r for r in (_clean(i) for i in made["islands"]) if r]
    out = []
    for ring in made["rings"]:
        clean = _clean(ring)
        if clean:
            out.append({"ring": clean, "kind": "sea", "name": None, **({"islands": islands} if islands else {})})
    return out



def _crossings_lookup(lat: float, lon: float, radius: float = 700, deadline_s: float = 4) -> dict:
    """Mapped crosswalks (footway=crossing ways, crossing nodes) and traffic signals round a
    point, from OpenStreetMap: lines and points in metres about it (x east, y north), for the
    3D viewer's junctions — where its zebra crossings, stop lines and signal heads stand."""
    r = int(radius * 1.2)
    q = (f'[out:json][timeout:{max(3, int(deadline_s) - 2)}];(way["footway"="crossing"](around:{r},{lat},{lon});'
         f'node["highway"="crossing"](around:{r},{lat},{lon});node["highway"="traffic_signals"](around:{r},{lat},{lon}););out geom;')
    try:
        els = _overpass(q, deadline_s=deadline_s)
        return _parse_crossings(els, lat, lon)
    except (BuildingsError, KeyError, TypeError, ValueError, AttributeError, OverflowError) as exc:
        log.info("crossings: unavailable (%s)", type(exc).__name__)
        return {"crossings": [], "points": [], "signals": [], "signal_details": [], "source": None, "signal_state_source": None}


def _parse_crossings(els: list[dict], lat: float, lon: float) -> dict:
    project = _projector(lat, lon)
    lines, points, signals, signal_details = [], [], [], []
    for e in els:
        tags = e.get("tags", {})
        try:
            layer = int(tags.get("layer", "0"))
        except (TypeError, ValueError):
            layer = 0
        if e.get("type") == "way":
            pts = [project(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
            if len(pts) >= 2:
                lines.append({"line": pts, "signals": tags.get("crossing") == "traffic_signals", "layer": layer, "id": f"way/{e.get('id')}"})
        elif tags.get("highway") == "traffic_signals":
            at = project(e["lon"], e["lat"])
            signals.append(at)
            signal_details.append({"id": f"node/{e.get('id')}", "at": at, "layer": layer,
                                   "direction": tags.get("traffic_signals:direction"), "state": None})
        else:
            points.append({"at": project(e["lon"], e["lat"]), "signals": tags.get("crossing") == "traffic_signals",
                           "marked": tags.get("crossing") in ("marked", "zebra", "traffic_signals") or tags.get("crossing:markings") not in (None, "no")})
    out = {"crossings": lines, "points": points, "signals": signals, "signal_details": signal_details, "source": "OpenStreetMap",
           "signal_state_source": None, "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    return out



def water(lat: float, lon: float, radius: float = 700, fast: bool = False) -> dict:
    """Answered within a few seconds; where OpenStreetMap was too slow (a coast's long ways),
    the survey goes on in the background and the next ask has it. `fast` (the drone's tiles,
    asked as they stream in): at once — a kept survey, else the bundled sea and beaches with the
    survey started for the next ask."""
    if fast:
        kept = peek_geography("water-v3", lat, lon, radius)
        if kept is not None:
            return {**kept, "works": realestate_coast.works_near(lat, lon, radius, _projector(lat, lon))}
        if radius <= 1500:  # (the drone's wide sea square: the bundled coast alone)
            _in_background("water-v3", lat, lon, radius, lambda: _water_lookup(lat, lon, radius, deadline_s=40))
        _, sea, beaches, _ = _bundled(lat, lon, radius, _projector(lat, lon))
        return {"rings": sea, "beaches": beaches, "works": realestate_coast.works_near(lat, lon, radius, _projector(lat, lon)), "source": None}
    body = cached_geography("water-v3", lat, lon, radius, lambda: _water_lookup(lat, lon, radius))
    body = {**body, "works": realestate_coast.works_near(lat, lon, radius, _projector(lat, lon))}
    if not body.get("source"):
        _in_background("water-v3", lat, lon, radius, lambda: _water_lookup(lat, lon, radius, deadline_s=40))
    return body

_slow_lock = threading.Lock()
_slow_running: set[str] = set()
_slow_gate = threading.Semaphore(2)  # (Overpass answers a busy client with 429s)


def _slow_survey(kind: str, lat: float, lon: float, radius: float, lookup) -> None:
    """A survey again with time to answer (dense city centres and long coastlines take Overpass
    5–20 s), kept by cached_geography for the next ask. Never raises: a background thread."""
    key = f"{kind}:{lat:.4f}:{lon:.4f}:{int(radius)}"
    try:
        with _slow_gate:
            for attempt in range(3):
                body = cached_geography(kind, lat, lon, radius, lookup)
                if body.get("source"):
                    return
                time.sleep(5 + attempt * 10)
    except Exception as exc:  # noqa: BLE001
        log.info("%s: background survey failed (%s)", kind, type(exc).__name__)
    finally:
        with _slow_lock:
            _slow_running.discard(key)


def _in_background(kind: str, lat: float, lon: float, radius: float, lookup) -> None:
    key = f"{kind}:{lat:.4f}:{lon:.4f}:{int(radius)}"
    with _slow_lock:
        if key in _slow_running or len(_slow_running) >= 64:
            return
        _slow_running.add(key)
    threading.Thread(target=_slow_survey, args=(kind, lat, lon, radius, lookup), daemon=True, name=f"{kind}-survey").start()


def crossings(lat: float, lon: float, radius: float = 700) -> dict:
    """The mapped crossings round a point: answered within a few seconds; where OpenStreetMap was
    too slow for that, the survey goes on in the background and the next ask has it (the viewer
    draws no crossing it has no survey for)."""
    body = cached_geography("crossings-v2", lat, lon, radius, lambda: _crossings_lookup(lat, lon, radius))
    if not body.get("source"):
        _in_background("crossings-v2", lat, lon, radius, lambda: _crossings_lookup(lat, lon, radius, deadline_s=40))
    return body
