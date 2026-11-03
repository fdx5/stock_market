"""Corrections applied to a finished drawing analysis, each from evidence in the source image.

The grid analysis can leave three kinds of artefact that show in 3D as walls or spaces the
drawing does not have:

1. A small cell split off a room by a notch (a duct cutting into a bathroom's corner, a column)
   is put in the wrong room — usually the corridor — so a wall stands across the bathroom and
   its basin corner becomes a little empty space. The drawing says which room it belongs to:
   the side with no wall line. A small cell open (no ink) to one room only, and walled off from
   the zone it was given, joins that room.
2. A small cell that is blank paper walled in on every side (a duct, a pipe space, a column) is
   kept as walkable floor. It is taken out: it stands as solid between its walls.
3. A room's outer edge can run past the drawn outline onto the page around the plan. That edge
   is brought back to where the drawing's floor ends. "Page" is white connected to the image's
   border: white inside the walls (a bathroom's tiles, a closet) is never page.

Colour drawings only: a monochrome drawing has white floors, so whiteness proves nothing there.
Walls between rects of one zone are dissolved by "open" openings (as the analysis does), so a
joined cell gets full-length open openings to its new zone's rects.
"""
from __future__ import annotations

import numpy as np

JOINABLE = ("bathroom", "ensuite", "kitchen", "bedroom", "master", "dress", "utility", "entrance")


def _axis_map(rooms: list[dict], pixel_rooms: list[dict], k: int):
    pairs = sorted({(round(p["rect"][k + o], 3), r["rect"][k + o]) for r, p in zip(rooms, pixel_rooms) for o in (0, 2)})
    px = [a for a, _ in pairs]; m = [b for _, b in pairs]
    return lambda v: float(np.interp(v, px, m))


def refine(result: dict, image: np.ndarray) -> dict:
    rooms, pixel, openings = result.get("rooms"), result.get("pixelRooms"), result.get("openings")
    if not rooms or not pixel or openings is None or len(rooms) != len(pixel):
        return result
    import cv2
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    x0, y0, x1, y1 = result["pixelBounds"]
    if float((hsv[y0:y1, x0:x1, 1] > 25).mean()) < .15:
        return result
    white = ((gray > 243) & (hsv[:, :, 1] < 14)).astype(np.uint8)
    # (the page: white reaching the image's edge)
    n, labels = cv2.connectedComponents(white, connectivity=4)
    edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    page = np.isin(labels, list(edge)) if edge else np.zeros_like(white, bool)
    inner_white = white.astype(bool) & ~page
    # (walls are bold: a counter's outline, a door's swing, hatching are thin and are no wall)
    ink = cv2.morphologyEx((gray < 120).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    sx, sy = result["scale"]["xMetresPerPixel"], result["scale"]["zMetresPerPixel"]
    to_x, to_z = _axis_map(rooms, pixel, 0), _axis_map(rooms, pixel, 1)
    prect = {p["id"]: [float(v) for v in p["rect"]] for p in pixel}
    byid = {r["id"]: r for r in rooms}
    zone_type: dict[str, str] = {}
    for r in sorted(rooms, key=lambda q: -((q["rect"][2] - q["rect"][0]) * (q["rect"][3] - q["rect"][1]))):
        if r["type"] != "hall": zone_type.setdefault(r["zone"], r["type"])
    log: list[str] = []

    def area_m(rid):
        a, b, c, d = byid[rid]["rect"]; return (c - a) * (d - b)

    def frac(mask, rid):
        a, b, c, d = map(int, map(round, prect[rid]))
        w = mask[b + 2:d - 2, a + 2:c - 2]
        return float(w.mean()) if w.size else 0.

    def shared(r, q):
        a, b = prect[r], prect[q]
        for axis, i, j in (("x", 0, 2), ("x", 2, 0), ("z", 1, 3), ("z", 3, 1)):
            if abs(a[i] - b[j]) <= 1.5:
                k0, k1 = (1, 3) if axis == "x" else (0, 2)
                lo, hi = max(a[k0], b[k0]), min(a[k1], b[k1])
                if hi - lo > 2: return axis, a[i], lo, hi
        return None

    def ink_on(axis, at, lo, hi):
        p, a, b = int(round(at)), int(round(lo)) + 2, int(round(hi)) - 2
        if b <= a: return 1.
        band = ink[a:b, max(0, p - 3):p + 4] if axis == "x" else ink[max(0, p - 3):p + 4, a:b]
        return float((band.max(axis=1 if axis == "x" else 0) > 0).mean()) if band.size else 1.

    def doors_of(rid):
        return [o for o in openings if rid in (o["a"], o["b"]) and o["type"] in ("door", "front_door")]

    # --- 1 and 2: small cells
    removed: set[str] = set()
    for r in list(rooms):
        rid = r["id"]
        # (a corridor cell up to 6 m2 — a strip of a bedroom cut off by its door's swing or its
        # wardrobe's outline, which the grid read as a partition; never one holding the 현관문)
        if r["type"] != "hall" or area_m(rid) >= 6.0 or any(o["type"] == "front_door" and rid in (o["a"], o["b"]) for o in openings): continue
        if zone_type.get(r["zone"]) not in (None, "hall", "corridor"): continue
        edges = []
        for q in rooms:
            if q["id"] == rid: continue
            e = shared(rid, q["id"])
            if e: edges.append((q, e, ink_on(*e)))
        if not edges: continue
        # (open: no bold line along at least 0.6 m of the shared edge — a corner's touch is not a side)
        open_e = [(q, e) for q, e, k in edges if k < .25 and (e[3] - e[2]) * (sy if e[0] == "x" else sx) >= .6]
        # (blank: nearly all paper — a 현관's checker tiles are half white; never next to the 현관, never
        # with a door or a window of its own: the door's swing outside the front door is not a duct)
        near_entry = any(zone_type.get(q["zone"]) == "entrance" or q["type"] == "entrance" for q, _, _ in edges)
        has_opening = any(rid in (o["a"], o["b"]) and o["type"] != "open" for o in openings)
        if not open_e and not near_entry and not has_opening and not doors_of(rid) and frac(inner_white, rid) > .7 and area_m(rid) < 1.2:
            removed.add(rid); log.append(f"solid {rid} ({area_m(rid):.2f} m2, blank, walled in)")
            continue
        zones_open = {q["zone"] for q, _ in open_e}
        if len(zones_open) != 1: continue
        z = next(iter(zones_open))
        if z == r["zone"] or zone_type.get(z) not in JOINABLE: continue
        # (walled off from the zone it was given: every edge to its old zone-mates is inked)
        # (walled off from the zone it was given: its edges to its old zone-mates carry the bold line —
        # a door in it is the room's door, which stays — while it lies open to the room)
        if any(q["zone"] == r["zone"] and k < (.45 if doors_of(rid) else .6) for q, _, k in edges): continue
        # (a small cell must lie open to its room along most of its side; a big one wholly)
        if area_m(rid) >= 1.6 and not any(zone_type.get(q["zone"]) in ("bedroom", "master", "dress") for q, _ in open_e): continue
        old = r["zone"]; r["zone"] = z
        # its old 'open' joins are walls in the drawing; full open joins to its new zone's rects
        openings[:] = [o for o in openings if not (o["type"] == "open" and rid in (o["a"], o["b"]) and byid.get(o["b"] if o["a"] == rid else o["a"], {}).get("zone") == old)]
        for q, e in open_e:
            axis, at, lo, hi = e
            to_at, to_al = (to_x, to_z) if axis == "x" else (to_z, to_x)
            a_m, b_m = to_al(lo), to_al(hi)
            if any(o["type"] == "open" and {o["a"], o["b"]} == {rid, q["id"]} for o in openings): continue
            openings.append({"type": "open", "a": q["id"], "b": rid, "axis": axis, "at": round(to_at(at), 4), "center": round((a_m + b_m) / 2, 4),
                             "width": round(b_m - a_m, 4), "height": 2.7, "sill": 0, "hinge": "start", "swingInto": q["id"]})
        log.append(f"join {rid} -> {zone_type.get(z)} ({area_m(rid):.2f} m2)")
    # --- 2b: dead-end pockets no furniture fits (balconies aside): a hall rect under 1.2 m2 reached
    # from one side only. A slot under 0.45 m wide (between stepped walls) no one can stand in is
    # wall; a wider pocket that is blank paper or the page is a duct or outside. A pocket in the
    # corridor's own floor (a shoe-cupboard niche) stays. Never one with a door or a window.
    links: dict[str, set] = {}
    for o in openings:
        if o["b"] == "out" or o["type"] == "window": continue
        links.setdefault(o["a"], set()).add(o["b"]); links.setdefault(o["b"], set()).add(o["a"])
    for r in rooms:
        rid = r["id"]
        if rid in removed or r["type"] != "hall": continue
        x0m, z0m, x1m, z1m = r["rect"]; a_m, short = (x1m - x0m) * (z1m - z0m), min(x1m - x0m, z1m - z0m)
        if a_m >= 1.2 or len(links.get(rid, ())) > 1 or doors_of(rid): continue
        if any(rid in (o["a"], o["b"]) and o["type"] not in ("open",) for o in openings): continue
        blank = frac(inner_white, rid) > .7 or frac(page, rid) > .5
        if blank:
            removed.add(rid); log.append(f"solid {rid} (dead-end pocket {a_m:.2f} m2, {short:.2f} m wide, blank)")
            continue
        if short >= .45: continue
        # (a slot of floor: the drawing's floor goes on into the room it lies open to — part of it)
        edges = []
        for q in rooms:
            if q["id"] == rid or q["id"] in removed: continue
            e = shared(rid, q["id"])
            if e: edges.append((q, e, ink_on(*e)))
        open_e = [(q, e) for q, e, k in edges if k < .25 and q["zone"] != r["zone"] and q["type"] != "balcony"]
        zs = {q["zone"] for q, _ in open_e}
        # (walled in on its other sides, a slot no one can step into: wall)
        if not zs and sum(k > .6 for _, _, k in edges) >= len(edges) - 1:
            removed.add(rid); log.append(f"solid {rid} (slot {short:.2f} m wide, walled in)"); continue
        if len(zs) != 1: continue
        old = r["zone"]; r["zone"] = next(iter(zs))
        openings[:] = [o for o in openings if not (o["type"] == "open" and rid in (o["a"], o["b"]) and byid.get(o["b"] if o["a"] == rid else o["a"], {}).get("zone") == old
                                                and ink_on(*(shared(rid, o["b"] if o["a"] == rid else o["a"]) or ("x", 0, 0, 0))) > .6)]
        for q, e in open_e:
            axis, at, lo, hi = e
            to_at, to_al = (to_x, to_z) if axis == "x" else (to_z, to_x)
            a0, b0 = to_al(lo), to_al(hi)
            openings.append({"type": "open", "a": q["id"], "b": rid, "axis": axis, "at": round(to_at(at), 4), "center": round((a0 + b0) / 2, 4),
                             "width": round(b0 - a0, 4), "height": 2.7, "sill": 0, "hinge": "start", "swingInto": q["id"]})
        log.append(f"join slot {rid} ({short:.2f} m wide) -> {zone_type.get(r['zone'], 'room')}")
    if removed:
        keep = [i for i, r in enumerate(rooms) if r["id"] not in removed]
        result["rooms"] = rooms = [rooms[i] for i in keep]
        result["pixelRooms"] = pixel = [pixel[i] for i in keep]
        openings[:] = [o for o in openings if o["a"] not in removed and o["b"] not in removed]
    result["openings"] = openings

    # --- 2c: one room's own rects are one floor. The 3D builder walls every side of every rect save
    # its openings, so two rects of one zone sharing an edge with no "open" between them stand as two
    # rooms: a wall across the living room, a boxed-in strip beside a bedroom. Every run of a
    # same-zone seam with no bold line in the drawing is opened; a drawn wall stays a wall.
    byid = {r["id"]: r for r in rooms}
    seams = 0
    for i, a in enumerate(rooms):
        for b in rooms[i + 1:]:
            if a["zone"] != b["zone"] or a["type"] == "balcony" or b["type"] == "balcony": continue
            e = shared(a["id"], b["id"])
            if not e: continue
            axis, at, lo, hi = e
            p_, l0, l1 = int(round(at)), int(round(lo)), int(round(hi))
            band = ink[l0:l1, max(0, p_ - 3):p_ + 4] if axis == "x" else ink[max(0, p_ - 3):p_ + 4, l0:l1]
            if not band.size: continue
            solid = band.max(axis=1 if axis == "x" else 0) > 0
            scale = sy if axis == "x" else sx
            to_at, to_al = (to_x, to_z) if axis == "x" else (to_z, to_x)
            have = [(o["center"] - o["width"] / 2, o["center"] + o["width"] / 2) for o in openings
                    if o["type"] in ("open", "door") and {o["a"], o["b"]} == {a["id"], b["id"]}]
            k = 0
            while k < len(solid):
                if solid[k]: k += 1; continue
                j = k
                while j < len(solid) and not solid[j]: j += 1
                if (j - k) * scale >= .25:
                    a_m, b_m = to_al(l0 + k), to_al(l0 + j)
                    if not any(h0 <= a_m + .05 and h1 >= b_m - .05 for h0, h1 in have):
                        openings.append({"type": "open", "a": a["id"], "b": b["id"], "axis": axis, "at": round(to_at(at), 4), "center": round((a_m + b_m) / 2, 4),
                                         "width": round(b_m - a_m, 4), "height": 2.7, "sill": 0, "hinge": "start", "swingInto": a["id"]}); seams += 1
                k = j
    if seams: log.append(f"opened {seams} seams inside rooms")
    # --- 3: an outer edge over the page
    for r, p in zip(rooms, pixel):
        if r["type"] == "balcony": continue
        rid = r["id"]; rect = prect[rid]
        for side in range(4):
            axis = "x" if side in (0, 2) else "z"
            at = rect[side]
            k0, k1 = (1, 3) if axis == "x" else (0, 2)
            if any(q["id"] != rid and (e := shared(rid, q["id"])) and e[0] == axis and abs(e[1] - at) <= 1.5 for q in rooms): continue
            inward = 1 if side in (0, 1) else -1
            span = rect[side + 2] - at if side < 2 else at - rect[side - 2]
            limit = min(span * .4, 1.0 / (sx if axis == "x" else sy))
            moved = 0
            lo, hi = int(round(rect[k0])) + 3, int(round(rect[k1])) - 3
            while moved < limit and hi > lo:
                c = int(round(at + inward * (moved + 2)))
                band = page[lo:hi, c] if axis == "x" else page[c, lo:hi]
                if band.size == 0 or band.mean() < .7: break
                moved += 1
            if moved >= 4:
                rect[side] = at + inward * moved
                log.append(f"trim {rid} {'wnes'[side]} {moved * (sx if axis == 'x' else sy):.2f} m over the page")
        p["rect"] = rect
    for r, p in zip(rooms, pixel):
        a, b, c, d = p["rect"]
        nr = [round(to_x(a), 4), round(to_z(b), 4), round(to_x(c), 4), round(to_z(d), 4)]
        if nr != r["rect"]:
            old = r["rect"]
            for o in openings:
                if o["a"] != r["id"] or o["b"] != "out": continue
                for side, axis in ((0, "x"), (2, "x"), (1, "z"), (3, "z")):
                    if o["axis"] == axis and abs(o["at"] - old[side]) < .002: o["at"] = nr[side]
            r["rect"] = nr
    if log:
        result.setdefault("corrections", []).extend(log)
    return result
