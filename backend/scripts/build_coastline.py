"""Build app/data/kr_coastline.json.gz — South Korea's coastline for the 3D viewer's sea.

Input: the coastline ways of an OpenStreetMap extract (© OpenStreetMap contributors, ODbL),
as written by a pyosmium pass over Geofabrik's south-korea-latest.osm.pbf:

    [[[lon, lat], …], …]   one list per natural=coastline way, in its node order

The ways are joined end to end keeping their direction (land on the left), lightly simplified
(Douglas–Peucker, 1.5 m: under a pixel at any height the viewer shows) and stored as
microdegree integers, delta-coded per chain:

    {"v": 1, "chains": [[lon0, lat0, dlon1, dlat1, …], …],
     "beaches": [{"n": name, "o": [outer, coded so], "i": [[inner…]…]}, …]}

The beaches (natural=beach areas, as a pyosmium area pass writes them: [{name, outer, inner}])
come along when given:

    python scripts/build_coastline.py coast_ways.json app/data/kr_coastline.json.gz [beaches.json [works.json]]

works.json: the sea works (man_made=breakwater, groyne, pier) as [{kind, closed, pts}].
"""

from __future__ import annotations

import gzip
import json
import math
import sys

sys.path.insert(0, ".")
from app.services.realestate_coast import chains  # noqa: E402

TOL_M = 1.5


def simplify(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    lat0 = pts[0][1]
    kx, ky = math.cos(math.radians(lat0)) * 111_320, 110_540
    xy = [(x * kx, y * ky) for x, y in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, at = 0.0, -1
        for i in range(a + 1, b):
            d = abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / L
            if d > best:
                best, at = d, i
        if best > TOL_M and at > 0:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring) -> list[tuple[float, float]]:
    """A closed ring simplified as an open path (its first and last points the same would leave
    nothing between them), returned open."""
    pts = [tuple(p) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return simplify(pts) if len(pts) >= 3 else pts


def code(pts) -> list[int]:
    flat, px, py = [], 0, 0
    for x, y in pts:
        qx, qy = round(x * 1e6), round(y * 1e6)
        flat += [qx - px, qy - py]
        px, py = qx, qy
    return flat


def main(src: str, out: str, beaches_src: str | None = None, works_src: str | None = None) -> None:
    ways = [[tuple(p) for p in w] for w in json.load(open(src))]
    joined = chains(ways)
    coded = []
    n = 0
    for c in joined:
        s = simplify(c) if c[0] != c[-1] else simplify(c[:-1]) + [c[0]]
        q = [(round(x * 1e6), round(y * 1e6)) for x, y in s]
        flat, px, py = [], 0, 0
        for x, y in q:
            flat += [x - px, y - py]
            px, py = x, y
        coded.append(flat)
        n += len(q)
    beaches = []
    if beaches_src:
        for b in json.load(open(beaches_src, encoding="utf-8")):
            beaches.append({"n": b.get("name"), "o": code(simplify_ring(b["outer"])), "i": [code(simplify_ring(r)) for r in b.get("inner") or []]})
    works = []
    if works_src:
        for w in json.load(open(works_src, encoding="utf-8")):
            pts = simplify_ring(w["pts"]) if w["closed"] else simplify([tuple(p) for p in w["pts"]])
            works.append({"k": w["kind"], "c": 1 if w["closed"] else 0, "p": code(pts)})
    with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump({"v": 1, "source": "OpenStreetMap natural=coastline, natural=beach, man_made=breakwater/groyne/pier (ODbL)", "chains": coded, "beaches": beaches, "works": works}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(ways)} ways -> {len(joined)} chains, {n} points; {len(beaches)} beaches; {len(works)} works")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None, sys.argv[4] if len(sys.argv) > 4 else None)
