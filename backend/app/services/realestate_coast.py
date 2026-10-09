"""The sea round a point, from OpenStreetMap's coastline, for the 3D viewer's water.

OpenStreetMap does not map the sea as an area: it maps the coastline (natural=coastline) as
lines drawn with the land on their left and the water on their right. The sea inside a square
is made from them the way the map's own renderers do it:

  1. the coastline ways are joined end to end into chains (keeping their direction);
  2. each chain is cut to the square: pieces that come in over its edge and go out again, and
     rings wholly inside (islands, drawn anticlockwise; an enclosed water clockwise);
  3. from where each piece leaves the square, its edge is followed clockwise (the water on the
     right) to where the next piece comes in, and so on round — the water's outlines.

With no piece crossing the square, an island ring inside means the square is sea round it;
otherwise there is no sea (the coast is farther off).
"""

from __future__ import annotations

Point = tuple[float, float]


def chains(ways: list[list[Point]]) -> list[list[Point]]:
    """Ways joined end to end, each keeping its direction (a coastline's side matters)."""
    open_ = [list(w) for w in ways if len(w) > 1]
    out: list[list[Point]] = []
    while open_:
        c = open_.pop(0)
        grew = True
        while grew and c[0] != c[-1]:
            grew = False
            for i, w in enumerate(open_):
                if w[0] == c[-1]:
                    c += w[1:]
                elif w[-1] == c[0]:
                    c = w[:-1] + c
                else:
                    continue
                open_.pop(i)
                grew = True
                break
        out.append(c)
    return out


def _inside(p: Point, R: float) -> bool:
    return -R <= p[0] <= R and -R <= p[1] <= R


def _clip_segment(p: Point, q: Point, R: float):
    """Liang–Barsky: the part of p→q within the square as (t0, t1), or None."""
    t0, t1 = 0.0, 1.0
    dx, dy = q[0] - p[0], q[1] - p[1]
    for a, b in ((-dx, p[0] + R), (dx, R - p[0]), (-dy, p[1] + R), (dy, R - p[1])):
        if a == 0:
            if b < 0:
                return None
            continue
        t = b / a
        if a < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return t0, t1


def _lerp(p: Point, q: Point, t: float) -> Point:
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


def _to_edge(p: Point, R: float) -> Point:
    """The nearest point of the square's edge (a coastline that stops short, inside)."""
    x, y = p
    d = {(-R, y): x + R, (R, y): R - x, (x, -R): y + R, (x, R): R - y}
    return min(d, key=d.get)


def _perimeter(p: Point, R: float) -> float:
    """Position along the square's edge, clockwise from its top-left corner (y north)."""
    x, y = p
    e = 1e-6 * max(1.0, R)
    if abs(y - R) <= e:
        return x + R
    if abs(x - R) <= e:
        return 2 * R + (R - y)
    if abs(y + R) <= e:
        return 4 * R + (R - x)
    return 6 * R + (y + R)


def _area(ring: list[Point]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def sea(coast: list[list[Point]], R: float) -> dict:
    """Sea outlines within |x|, |y| <= R (x east, y north) from coastline ways in the same frame:
    {"rings": [ring…] (clockwise, water inside), "islands": [ring…] (land inside them)}."""
    pieces: list[list[Point]] = []
    closed: list[list[Point]] = []
    for c in chains(coast):
        if c[0] == c[-1]:
            if all(_inside(p, R) for p in c):
                closed.append(c[:-1])
                continue
            # (a ring across the square's edge: started from a point outside it — begun inside, its
            # first point was taken for a coastline stopping short and joined to the edge)
            k = next(i for i, p in enumerate(c) if not _inside(p, R))
            c = c[k:-1] + c[:k + 1]
        cur: list[Point] | None = None
        if _inside(c[0], R):
            cur = [_to_edge(c[0], R), c[0]]  # (stops short inside: carried straight to the edge)
        for p, q in zip(c, c[1:]):
            cut = _clip_segment(p, q, R)
            if cut is None:
                continue
            t0, t1 = cut
            a, b = _lerp(p, q, t0), _lerp(p, q, t1)
            if cur is None:
                cur = [a]
            if t1 < 1:
                cur.append(b)
                pieces.append(cur)
                cur = None
            else:
                cur.append(q)
        if cur is not None:
            cur.append(_to_edge(cur[-1], R))
            pieces.append(cur)
    pieces = [p for p in pieces if len(p) >= 2]
    rings: list[list[Point]] = []
    if pieces:
        P = 8 * R
        starts = [_perimeter(p[0], R) for p in pieces]
        used = [False] * len(pieces)
        corners = [(-R, R), (R, R), (R, -R), (-R, -R)]  # at 0, 2R, 4R, 6R
        for i0 in range(len(pieces)):
            if used[i0]:
                continue
            ring: list[Point] = []
            i = i0
            for _ in range(len(pieces) + 1):
                used[i] = True
                ring += pieces[i]
                s = _perimeter(pieces[i][-1], R)
                # the next piece coming in, clockwise from here (a piece's own start last)
                j = min(range(len(pieces)), key=lambda k: (starts[k] - s) % P if (starts[k] - s) % P > 1e-9 else P)
                gap = (starts[j] - s) % P or P
                # (the corners passed on the way, in order)
                passed = sorted(((cs - s) % P, corners[ci]) for ci, cs in enumerate((0.0, 2 * R, 4 * R, 6 * R)) if 1e-9 < (cs - s) % P < gap)
                ring += [pt for _, pt in passed]
                if j == i0:
                    break
                if used[j]:
                    break
                i = j
            if len(ring) >= 3 and abs(_area(ring)) > 4:
                rings.append(ring)
    # A ring wholly inside the square is an island (a rock, a pier head): drawn anticlockwise,
    # land inside — and so taken whichever way it was drawn (a few small ones are mapped
    # clockwise; a sea enclosed by land would not fit in a square of a few hundred metres).
    islands = [r if _area(r) > 0 else r[::-1] for r in closed]
    if not pieces and islands:
        rings.append([(-R, R), (R, R), (R, -R), (-R, -R)])
    return {"rings": [[(round(x, 2), round(y, 2)) for x, y in r] for r in rings],
            "islands": [[(round(x, 2), round(y, 2)) for x, y in r] for r in islands]}


# ----------------------------------------------------------------------------- bundled coastline

import gzip as _gzip
import json as _json
import math as _math
import threading as _threading
from pathlib import Path as _Path

DATA = _Path(__file__).resolve().parent.parent / "data" / "kr_coastline.json.gz"
CELL = 0.02  # degrees: the index's cells (~2 km)
RUN = 48  # points per indexed run of a chain
_index_lock = _threading.Lock()
_index: tuple[list[list[tuple[float, float]]], dict[tuple[int, int], list[tuple[int, int]]]] | None = None
_works: list[tuple[str, bool, tuple[float, float, float, float], list[tuple[float, float]]]] = []
_beaches: list[tuple[str | None, tuple[float, float, float, float], list[tuple[float, float]], list[list[tuple[float, float]]]]] = []


def _decode(flat: list[int]) -> list[tuple[float, float]]:
    pts, x, y = [], 0, 0
    for k in range(0, len(flat), 2):
        x += flat[k]
        y += flat[k + 1]
        pts.append((x / 1e6, y / 1e6))
    return pts


def _load():
    """The bundled coastline (scripts/build_coastline.py) and a grid index of its runs."""
    global _index
    with _index_lock:
        if _index is not None:
            return _index
        chains_: list[list[tuple[float, float]]] = []
        grid: dict[tuple[int, int], list[tuple[int, int]]] = {}
        try:
            with _gzip.open(DATA, "rt", encoding="utf-8") as f:
                body = _json.load(f)
            coded = body["chains"]
        except (OSError, ValueError, KeyError):
            body, coded = {}, []
        for w in body.get("works") or []:
            pts = _decode(w["p"])
            if len(pts) < 2:
                continue
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            _works.append((w["k"], bool(w["c"]), (min(xs), min(ys), max(xs), max(ys)), pts))
        for b in body.get("beaches") or []:
            outer = _decode(b["o"])
            if len(outer) < 3:
                continue
            xs, ys = [p[0] for p in outer], [p[1] for p in outer]
            _beaches.append((b.get("n"), (min(xs), min(ys), max(xs), max(ys)), outer, [_decode(i) for i in b.get("i") or []]))
        for flat in coded:
            pts, x, y = [], 0, 0
            for k in range(0, len(flat), 2):
                x += flat[k]
                y += flat[k + 1]
                pts.append((x / 1e6, y / 1e6))
            ci = len(chains_)
            chains_.append(pts)
            for r0 in range(0, max(1, len(pts) - 1), RUN):
                run = pts[r0:r0 + RUN + 1]
                xs, ys = [p[0] for p in run], [p[1] for p in run]
                for gx in range(int(_math.floor(min(xs) / CELL)), int(_math.floor(max(xs) / CELL)) + 1):
                    for gy in range(int(_math.floor(min(ys) / CELL)), int(_math.floor(max(ys) / CELL)) + 1):
                        grid.setdefault((gx, gy), []).append((ci, r0))
        _index = (chains_, grid)
        return _index


def coastline_near(lat: float, lon: float, half_m: float, project) -> list[list[Point]] | None:
    """The bundled coastline's parts within `half_m` (and a margin) of a point, projected with
    `project(lon, lat)` — each a stretch of a chain in its direction. None when no data is bundled."""
    chains_, grid = _load()
    if not chains_:
        return None
    k = _math.cos(_math.radians(lat)) * 111_320
    m = half_m * 1.2
    x0, x1 = lon - m / k, lon + m / k
    y0, y1 = lat - m / 110_540, lat + m / 110_540
    runs: set[tuple[int, int]] = set()
    for gx in range(int(_math.floor(x0 / CELL)), int(_math.floor(x1 / CELL)) + 1):
        for gy in range(int(_math.floor(y0 / CELL)), int(_math.floor(y1 / CELL)) + 1):
            runs.update(grid.get((gx, gy), ()))
    out: list[list[Point]] = []
    by_chain: dict[int, list[int]] = {}
    for ci, r0 in runs:
        by_chain.setdefault(ci, []).append(r0)
    for ci, starts in by_chain.items():
        pts = chains_[ci]
        starts.sort()
        # (consecutive runs as one stretch)
        cur_a, cur_b = starts[0], min(len(pts) - 1, starts[0] + RUN)
        stretches = []
        for r0 in starts[1:]:
            if r0 <= cur_b:
                cur_b = min(len(pts) - 1, r0 + RUN)
            else:
                stretches.append((cur_a, cur_b))
                cur_a, cur_b = r0, min(len(pts) - 1, r0 + RUN)
        stretches.append((cur_a, cur_b))
        # (a closed chain whose stretches meet round its end: one stretch)
        for a, b in stretches:
            out.append([project(x, y) for x, y in pts[a:b + 1]])
    return out


def beaches_near(lat: float, lon: float, half_m: float, project) -> list[dict] | None:
    """The bundled beaches (natural=beach) reaching within `half_m` of a point, projected:
    [{"name", "ring", "holes"}]. None when no data is bundled."""
    chains_, _ = _load()
    if not chains_:
        return None
    k = _math.cos(_math.radians(lat)) * 111_320
    x0, x1 = lon - half_m / k, lon + half_m / k
    y0, y1 = lat - half_m / 110_540, lat + half_m / 110_540
    out = []
    for name, (bx0, by0, bx1, by1), outer, inner in _beaches:
        if bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1:
            continue
        out.append({"name": name, "ring": [project(x, y) for x, y in outer], "holes": [[project(x, y) for x, y in r] for r in inner]})
    return out


def sea_at(lat: float, lon: float, reach_cells: int = 12) -> bool:
    """Whether a point with no coastline round it lies at sea: on the water side (the right) of
    the nearest stretch of the bundled coastline, looked for out to ~reach_cells × 2 km."""
    chains_, grid = _load()
    if not chains_:
        return False
    k = _math.cos(_math.radians(lat)) * 111_320
    gx0, gy0 = int(_math.floor(lon / CELL)), int(_math.floor(lat / CELL))
    best = None  # (d2, cross)
    for ring in range(reach_cells + 1):
        seen: set[tuple[int, int]] = set()
        for gx in range(gx0 - ring, gx0 + ring + 1):
            for gy in range(gy0 - ring, gy0 + ring + 1):
                if max(abs(gx - gx0), abs(gy - gy0)) != ring:
                    continue
                for ci, r0 in grid.get((gx, gy), ()):
                    if (ci, r0) in seen:
                        continue
                    seen.add((ci, r0))
                    pts = chains_[ci]
                    for i in range(r0, min(len(pts) - 1, r0 + RUN)):
                        ax, ay = (pts[i][0] - lon) * k, (pts[i][1] - lat) * 110_540
                        bx, by = (pts[i + 1][0] - lon) * k, (pts[i + 1][1] - lat) * 110_540
                        dx, dy = bx - ax, by - ay
                        L2 = dx * dx + dy * dy or 1e-9
                        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
                        px, py = ax + dx * t, ay + dy * t
                        d2 = px * px + py * py
                        # (the point is at the origin: left of A→B is land)
                        cross = dx * (0 - ay) - dy * (0 - ax)
                        if best is None or d2 < best[0] - 1e-6:
                            best = (d2, cross)
        # (a stretch found within this ring of cells is the nearest once the next ring is farther)
        if best is not None and _math.sqrt(best[0]) < ring * CELL * 110_540 * 0.9:
            break
    return best is not None and best[1] < 0


def works_near(lat: float, lon: float, half_m: float, project) -> list[dict]:
    """The bundled sea works (breakwaters, groynes, piers) reaching within `half_m` of a point,
    projected: [{"kind", "closed", "pts"}]."""
    _load()
    k = _math.cos(_math.radians(lat)) * 111_320
    x0, x1 = lon - half_m / k, lon + half_m / k
    y0, y1 = lat - half_m / 110_540, lat + half_m / 110_540
    return [{"kind": kind, "closed": closed, "pts": [project(x, y) for x, y in pts]}
            for kind, closed, (bx0, by0, bx1, by1), pts in _works if not (bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1)]
