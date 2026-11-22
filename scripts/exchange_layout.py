"""Write frontend/src/exchange/layout.json: the one plan Blender and the browser both read.

v5 "Atrium": a round, 20 m trading atrium (radius 26.6 m, 2,223 m², 672 pyeong) after the
concept boards in /sample — three curved galleries, branching columns under a radial skylight,
a glass light core wrapped in stacked screen rings, curved trading desks in concentric rows.

Coordinates are three.js metres: x east, y up, z south (toward the entrance). Angles (deg) are
measured from +z toward +x, so a point at angle t and radius r is (r sin t, r cos t). A flat
screen faces +z at yaw 0 and +x at yaw 90: a facet on the tower at angle t has yaw t (outward);
a screen on the galleries at angle t faces the centre, yaw t + 180.
Screen kinds: facet/desk/counter (flat), arc (curved, faces the centre: r, a0, a1),
band (inward ticker ribbon on an arc), ring (outward ticker cylinder: w = radius).
"""
import json
from math import asin, cos, degrees, pi, radians, sin
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/src/exchange/layout.json"

R_WALL = 26.6               # outer wall: pi r^2 = 2,223 m^2
R_GALLERY = 21.8            # gallery fronts (slab edge)
R_COLUMN = 22.3             # branching columns, just behind the gallery fronts
R_OFFICE = 26.15            # promenade edge: open up to the oak slat wall (no offices, no glass)
LEVELS = (5.0, 9.5, 14.0)   # gallery slab tops
H = 20.0
COLUMNS = [15 + 30 * k for k in range(12)]          # entrance (0 deg) opens between two columns
AISLES = [0, 60, 120, 180, 240, 300]                # radial aisles, 2.6 m wide
AISLE_W = 2.6
ROWS = (8.2, 11.6, 15.0)                            # desk rows (desk front radius)
LOUNGES = (90, 150, 210, 270)                       # sunken lounges between the outer row and the galleries

STOCKS = [f"s{i}" for i in range(16)]
ASSETS = ["a:KRW=X", "a:GC=F", "a:CL=F", "a:BTC-USD", "a:NQ=F", "a:ES=F", "a:ETH-USD", "a:SI=F"]
SMALL = ["semis", "bigtech", "crypto", "fx", "rates", "metals", "energy", "agri", "futures", "brief"]

screens = []


def pol(r, t):
    return r * sin(radians(t)), r * cos(radians(t))


def add(panel, x, y, z, yaw, w, h, kind, tilt=0.0, **extra):
    screens.append({"id": panel, "x": round(x, 4), "y": round(y, 4), "z": round(z, 4), "yaw": round(yaw, 3),
                    "tilt": tilt, "w": round(w, 4), "h": round(h, 4), "kind": kind, **extra})


def arc(panel, r, mid, span_m, y, h, kind="arc"):
    """A curved screen of arc length span_m centred on angle mid, facing the centre."""
    half = degrees(span_m / r) / 2
    x, z = pol(r, mid)
    add(panel, x, y, z, mid + 180, span_m, h, kind, r=r, a0=round(mid - half, 3), a1=round(mid + half, 3))


# ---- the light core: stacked rings of flat screen facets (outward) and ticker cylinders
def facet_ring(ids, r, y, h, gap=.06, offset=0.0):
    n = len(ids)
    w = 2 * r * sin(pi / n) - gap
    for k, panel in enumerate(ids):
        t = offset + k * 360 / n
        x, z = pol(r, t)
        add(panel, x, y, z, t, w, h, "facet")
    return w


TOWER = {"core": 1.5, "plinth": 2.9, "rings": []}
add("ring", 0, 2.55, 0, 0, 2.45, .62, "ring")                       # base ticker
for y, r, ids, h in (
        (4.35, 3.05, ASSETS + ["fx", "crypto"], 1.1),
        (7.25, 3.45, ["overview", "treemap", "heatgrid", "world", "sectors", "breadth", "histogram", "capshare", "investor", "tri"], 1.26),
        (8.62, 3.45, ["leaders", "gainers", "laggards", "movers", "futures", "semis", "bigtech", "rates", "metals", "energy"], 1.26),
        (11.6, 3.85, STOCKS[:12], 1.12),
        (12.8, 3.85, STOCKS[4:16], 1.12)):
    facet_ring(ids, r, y, h, offset=18 if r > 3.6 else 0)
TOWER["rings"] = [{"y": 4.35, "r": 3.05, "h": 1.1}, {"y": 7.935, "r": 3.45, "h": 2.6},
                  {"y": 12.2, "r": 3.85, "h": 2.32}]
add("ring", 0, 15.3, 0, 0, 4.35, 1.05, "ring")                       # crown ticker under the oculus
TOWER["crown"] = {"y": 15.3, "r": 4.35, "h": 1.05}

# ---- gallery screens: a giant curved main board on the north fronts, curved panels around
arc("overview", R_GALLERY - .25, 135, 17.0, 11.9, 6.4)              # north-east: clear of the light core seen from the entrance
arc("sign", R_GALLERY - .25, 0, 15.0, 16.0, 1.9)                    # above the entrance, gallery 3 front
arc("clocks", R_GALLERY - .25, 225, 9.4, 11.9, 2.6)
arc("session", R_GALLERY - .25, 268, 9.4, 11.9, 2.6)
arc("treemap", R_GALLERY - .25, 90, 7.4, 7.35, 4.3)                 # east: across gallery 1-2
arc("world", R_GALLERY - .25, 270, 7.4, 7.35, 4.3)                  # west
arc("news", R_GALLERY - .25, 60, 4.45, 7.55, 2.9)          # top edge into the gallery-2 fascia
arc("globaltop", R_GALLERY - .25, 300, 4.45, 7.7, 2.6)
arc("heatgrid", R_GALLERY - .25, 150, 4.45, 7.0, 3.0)
arc("histogram", R_GALLERY - .25, 210, 4.4, 7.7, 2.6)
for k, (t, panel) in enumerate(zip((40, 62, 100, 300), ("investor", "sectors", "capshare", "movers"))):
    arc(panel, R_GALLERY - .25, t, 4.4, 11.9, 2.6)

# ---- live data strips on the columns' inner faces (vertical quote cards, scrolled in the shader)
for t in COLUMNS:
    x, z = pol(R_COLUMN - .585, t)
    add("tickerV", x, 8.6, z, t + 180, .34, 13.4, "strip")

# ---- ticker ribbons on the gallery fascias (inward, continuous except where boards hang)
BANDS = [("tickerA", 4.48, .78, 0, 360),                            # gallery 1: the amber tape, all round
         ("tickerC", 13.48, .78, 150, 210),                           # gallery 3 over the north board
         ("tickerB", 13.48, .78, -50, 50),                            # gallery 3 south, under the sign
         ("tickerD", 8.98, .72, 300, 420)]                            # gallery 2, north-east to north-west via south
for panel, y, h, a0, a1 in BANDS:
    r = R_GALLERY - .085          # just proud of the travertine fascia (R_GALLERY - .06)
    mid = (a0 + a1) / 2
    x, z = pol(r, mid)
    add(panel, x, y, z, mid + 180, radians(a1 - a0) * r, h, "band", r=r, a0=a0, a1=a1)

# ---- the round central counter around the plinth, monitors facing out
COUNTER_R = 5.2
counter = []
# Only over the counter itself: the counter is cut by the six aisles (each gap = aisle width plus the
# monitor's half width), and every monitor faces outward, toward people standing at the counter.
GAP = degrees((AISLE_W / 2 + .45) / COUNTER_R)
for k in range(24):
    t = 7.5 + k * 15
    if any(abs(((t - a + 180) % 360) - 180) < GAP for a in AISLES):
        continue
    counter.append(t)
    x, z = pol(COUNTER_R - .3, t)
    add((STOCKS + ASSETS)[k % 24], x, 1.3, z, t, .58, .34, "counter", tilt=-10)

# ---- trading desks: concentric arcs broken by the aisles; traders face the core
desks, seats = [], []
for row, r in enumerate(ROWS):
    for i, a in enumerate(AISLES):
        b = AISLES[(i + 1) % len(AISLES)] + (360 if i == len(AISLES) - 1 else 0)
        pad = degrees(AISLE_W / 2 / r) + 1.2
        a0, a1 = a + pad, b - pad
        desks.append({"r": r, "a0": round(a0, 3), "a1": round(a1, 3), "row": row})
        pitch = 1.65                                                 # metres per seat along the arc
        n = int(radians(a1 - a0) * r / pitch)
        step = (a1 - a0) / n
        for s in range(n):
            t = a0 + step * (s + .5)
            seats.append({"r": r, "t": round(t, 3), "row": row})
# Monitor rigs, varied per seat so the rows don't read as one repeated unit. Sizes are real panels
# (24" 16:9 .53 x .30, 43" 16:9 .95 x .53, 40" 5K2K .96 x .36, 49" 32:9 1.19 x .34); the big screens
# carry boards whose design aspect matches them (clocks/session 3.6:1, overview 2.66:1, maps 1.7:1).
DESK_TOP, STAND = .77, .15
SMALL_POOL = STOCKS + ASSETS + SMALL
UPPER_POOL = ["leaders", "sectors", "investor", "breadth", "gainers", "laggards", "movers", "tri"]
RIGS = ["triple", "superwide", "big", "triple", "ultrawide", "triple", "big", "superwide", "triple", "ultrawide"]


def monitor(panel, r, t, du, bottom, w, h, yaw_off=0.0, tilt=-4, recess=0.0):
    """du: offset along the desk (m), bottom: lower edge height."""
    x, z = pol(r + .22 + recess, t + degrees(du / (r + .22)))
    add(panel, x, bottom + h / 2, z, t + yaw_off, w, h, "desk", tilt=tilt)


for i, seat in enumerate(seats):
    r, t, row = seat["r"], seat["t"], seat["row"]
    rig = RIGS[(i * 7 + row * 3) % len(RIGS)]
    seat["rig"] = rig
    low = DESK_TOP + STAND
    small = lambda n: SMALL_POOL[(i * 3 + n) % len(SMALL_POOL)]
    upper = lambda n: UPPER_POOL[(i + n) % len(UPPER_POOL)]
    if rig == "triple":
        for k in (-1, 0, 1):
            monitor(small(k + 1), r, t, k * .585, low, .53, .30, k * 16, recess=-abs(k) * .07)
        if row < 2:
            for k in (-1, 0, 1):
                monitor(upper(k + 1), r, t, k * .585, low + .34, .53, .30, k * 16, tilt=6, recess=-abs(k) * .07)
    elif rig == "superwide":                      # 49" 32:9 with a 24" above
        monitor(("clocks", "session")[i % 2], r, t, 0, low, 1.19, .34)
        monitor(small(0), r, t, 0, low + .38, .53, .30, tilt=6)
    elif rig == "big":                            # 43" 4K and one angled 24" beside it
        monitor(("treemap", "world", "heatgrid", "news")[i % 4], r, t, -.22, low - .04, .95, .53)
        monitor(small(1), r, t, .58, low, .53, .30, -18, recess=-.08)
    else:                                         # 40" 5K2K ultrawide with a 24" above
        monitor("overview", r, t, 0, low, .96, .36)
        monitor(upper(0), r, t, 0, low + .4, .53, .30, tilt=6)

# ---- walkable floor and obstacles
obstacles = []        # axis boxes (x, z, w, d)
arcs = [{"r0": d["r"] - .45, "r1": d["r"] + .95, "a0": d["a0"], "a1": d["a1"], "h": 1.3} for d in desks]   # desk + chair zone
arcs.append({"r0": COUNTER_R - .55, "r1": COUNTER_R + .05, "a0": 0, "a1": 360, "h": 1.15, "gaps": AISLES, "gap": AISLE_W})
circles = [{"x": 0, "z": 0, "r": TOWER["plinth"] + .1}]
columns = [{"x": round(pol(R_COLUMN, t)[0], 3), "z": round(pol(R_COLUMN, t)[1], 3), "r": .75} for t in COLUMNS]
circles += columns
lounges = []
for t in LOUNGES:
    lounges.append({"t": t, "r": 18.9, "w": 7.4, "d": 3.8})
    arcs.append({"r0": 17.1, "r1": 20.7, "a0": t - 11, "a1": t + 11, "h": .9})
water = [{"r0": 19.9, "r1": 20.5, "a0": t - 22, "a1": t - 13} for t in LOUNGES] + \
        [{"r0": 19.9, "r1": 20.5, "a0": t + 13, "a1": t + 22} for t in LOUNGES]
arcs += [{**w, "h": .5} for w in water]
# A few trees only, on the ground promenade near the wall, clear of columns, paintings and benches.
planters = [{"x": round(pol(25.15, t)[0], 3), "z": round(pol(25.15, t)[1], 3), "r": .9, "t": t} for t in (52, 172, 232, 292)]
circles += [{"x": p["x"], "z": p["z"], "r": p["r"] + .05, "level": 0} for p in planters]

# ---- vertical circulation: a switchback stair in the void along the north-west gallery fronts and
# two round panoramic glass elevators. Everything walkable is a surface with a height: the ground
# disc, the three gallery rings, stair flights (height runs with the angle), landings and cabins.
INNER, OUTER = (18.9, 20.1), (20.2, 21.4)               # stair lanes (radii)
STAIR_LOW, STAIR_HIGH = 352.0, 328.0                      # angles at the bottom/top of the inner lane
flights = [
    {"r0": INNER[0], "r1": INNER[1], "aFrom": STAIR_LOW, "aTo": STAIR_HIGH, "y0": 0.0, "y1": LEVELS[0]},
    {"r0": OUTER[0], "r1": OUTER[1], "aFrom": STAIR_HIGH, "aTo": STAIR_LOW, "y0": LEVELS[0], "y1": LEVELS[1]},
    {"r0": INNER[0], "r1": INNER[1], "aFrom": STAIR_LOW, "aTo": STAIR_HIGH, "y0": LEVELS[1], "y1": LEVELS[2]},
]
for f in flights:   # riser/tread for the model and the docs
    run = radians(abs(f["aTo"] - f["aFrom"])) * (f["r0"] + f["r1"]) / 2
    f["steps"] = round((f["y1"] - f["y0"]) / .17)
    f["tread"] = round(run / f["steps"], 3)
LAND_W = 6.0
landings = [   # platforms that carry each flight onto its gallery (and turn the switchback)
    {"r0": INNER[0], "r1": R_GALLERY + .9, "a0": STAIR_HIGH - LAND_W, "a1": STAIR_HIGH, "y": LEVELS[0]},
    {"r0": INNER[0], "r1": R_GALLERY + .9, "a0": STAIR_LOW, "a1": STAIR_LOW + LAND_W, "y": LEVELS[1]},
    {"r0": INNER[0], "r1": R_GALLERY + .9, "a0": STAIR_HIGH - LAND_W, "a1": STAIR_HIGH, "y": LEVELS[2]},
]
# Under the stair on the ground: blocked except the foot of the first flight.
# Under the stair: open wherever there is head room. Only the low end of the first flight (its
# underside below 2.1 m) is closed off; everything else above is at least 5 m up.
_headroom = (2.1 + .36) / (LEVELS[0] / (STAIR_LOW - STAIR_HIGH))      # degrees from the foot
arcs.append({"r0": INNER[0] - .1, "r1": INNER[1] + .1, "a0": STAIR_LOW - _headroom, "a1": STAIR_LOW - .3, "h": 2.2, "level": 0})

ELEVATOR_R, CABIN_R = 20.25, 1.05
elevators = []
for k, t in enumerate((120.0, 240.0)):
    x, z = pol(ELEVATOR_R, t)
    elevators.append({"id": k, "t": t, "x": round(x, 3), "z": round(z, 3), "r": CABIN_R, "levels": [0.0] + list(LEVELS)})
    circles.append({"x": round(x, 3), "z": round(z, 3), "r": CABIN_R + .15, "level": 0, "cabin": k})   # shaft base when the cabin is away
thresholds = [{"r0": ELEVATOR_R + CABIN_R - .35, "r1": R_GALLERY + .9, "a0": e["t"] - 2.4, "a1": e["t"] + 2.4, "y": y, "elevator": e["id"]}
              for e in elevators for y in LEVELS]
# Balustrade openings: where landings and thresholds meet the gallery edge.
openings = [{"level": 1, "a0": STAIR_HIGH - LAND_W, "a1": STAIR_HIGH}, {"level": 2, "a0": STAIR_LOW, "a1": STAIR_LOW + LAND_W},
            {"level": 3, "a0": STAIR_HIGH - LAND_W, "a1": STAIR_HIGH}] + \
           [{"level": li + 1, "a0": e["t"] - 2.4, "a1": e["t"] + 2.4} for e in elevators for li in range(len(LEVELS))]

# Gallery walkways: between the balustrade and the office glass; columns and gallery pots in the way.
# Walkway furniture sits at the office glass, half-way between columns (8 deg clear of every column),
# so the gallery ring keeps a clear lane between the balustrade and the furniture on every floor.
SPOTS = [37, 97, 157, 217, 277, 337]
SPOT_R = R_WALL - .75
spot_kind = {0: ["sculpture", "none", "sculpture", "none", "sculpture", "none"]}
for _lv in (1, 2, 3):
    spot_kind[_lv] = ["sculpture", "none", "pot", "none", "sculpture", "none"]
gallery_pots = []      # (pots on every floor where the kind is "pot")
for _lv, kinds in spot_kind.items():
    for t, kind in zip(SPOTS, kinds):
        if kind == "pot":
            x, z = pol(SPOT_R, t)
            gallery_pots.append({"x": round(x, 3), "z": round(z, 3), "r": .42, "t": t, "level": _lv})
galleries = [{"r0": R_GALLERY + .42, "r1": R_WALL - .5, "y": y} for y in LEVELS]

# Benches: curved sofas against the slat wall on every floor, facing the atrium.
sofas = [{"t": t, "level": lv, "y": [0.0, *LEVELS][lv], "r": R_WALL - .95, "span": 6.0}
         for lv in range(len(LEVELS) + 1) for t in ((120, 240) if lv == 0 else (0, 120, 240))]
arcs += [{"r0": s_["r"] - .6, "r1": R_WALL, "a0": s_["t"] - s_["span"] / 2, "a1": s_["t"] + s_["span"] / 2, "h": 1.0, "level": s_["level"]} for s_ in sofas]

# Flowers: 20 species in the tree planters (under-planting), the lounge troughs and round bowls.
FLOWERS = ["rose", "peony", "lily", "tulip_yellow", "tulip_red", "lavender", "hydrangea_blue", "hydrangea_pink", "sunflower",
           "daisy", "gerbera", "orchid_purple", "orchid_white", "cosmos", "poppy", "delphinium", "marigold", "allium", "zinnia", "anemone"]
bowls = []
for i, t in enumerate((22, 142, 202, 262)):   # four ground bowls on the promenade
    if any(abs(((t - L) + 180) % 360 - 180) < 13 for L in LOUNGES) or any(abs(((t - e["t"]) + 180) % 360 - 180) < 6 for e in elevators):
        continue
    x, z = pol(SPOT_R if "SPOT_R" in dir() else 25.85, t)
    bowls.append({"x": round(x, 3), "z": round(z, 3), "r": .5, "y": 0.0, "species": [FLOWERS[(i * 5 + k) % 20] for k in range(3)]})
for li, y in enumerate(LEVELS):            # and on every gallery, at the glass spots
    for k, (t, kind) in enumerate(zip(SPOTS, spot_kind[li + 1])):
        if kind != "bowl":
            continue
        x, z = pol(SPOT_R, t)
        bowls.append({"x": round(x, 3), "z": round(z, 3), "r": .42, "y": y, "species": [FLOWERS[(li * 7 + k * 2 + j) % 20] for j in range(2)]})
circles += [{"x": b["x"], "z": b["z"], "r": b["r"] + .05, "level": [0.0, *LEVELS].index(b["y"])} for b in bowls]
circles += [{"x": p["x"], "z": p["z"], "r": p["r"] + .05, "level": p["level"]} for p in gallery_pots]

# ---- the art walk: 8 art walls per floor set into the office glass line, sculptures on plinths between
ART = json.loads((ROOT / "frontend/src/exchange/art.json").read_text(encoding="utf-8")) if (ROOT / "frontend/src/exchange/art.json").exists() else {"paintings": [], "sculptures": []}
ART_ANGLES = [30, 60, 90, 150, 180, 210, 270, 330]
art_walls = []
floors = [0.0] + list(LEVELS)
for i, painting in enumerate(ART["paintings"]):
    level, slot = i // 8, i % 8
    if level >= len(floors):
        break
    t = ART_ANGLES[slot] + (0 if level % 2 == 0 else 22.5) * 0      # same bays on every floor
    ceiling = (LEVELS[0] - .45) if level == 0 else ((LEVELS[level] - .45) if level < len(LEVELS) else H - .5)
    room_h = ceiling - floors[level]
    w = min(2.5, painting["width"] * 1.15)
    h = w / painting["aspect"]
    if h > min(2.1, room_h - 1.4):
        h = min(2.1, room_h - 1.4)
        w = h * painting["aspect"]
    x, z = pol(R_OFFICE - .07, t)
    art_walls.append({"id": painting["id"], "level": level, "y": floors[level], "t": t, "x": round(x, 3), "z": round(z, 3),
                      "w": round(w, 3), "h": round(h, 3), "cy": round(floors[level] + max(1.55, .9 + h / 2), 3)})
sculpture_spots = [(lv, t) for lv, kinds in spot_kind.items() for t, kind in zip(SPOTS, kinds) if kind == "sculpture"]
sculptures = []
for i, key in enumerate(ART["sculptures"]):
    if i >= len(sculpture_spots):
        break
    level, t = sculpture_spots[i]
    x, z = pol(SPOT_R, t)
    sculptures.append({"id": key, "level": level, "y": floors[level], "t": t, "x": round(x, 3), "z": round(z, 3)})
    circles.append({"x": round(x, 3), "z": round(z, 3), "r": .42, "level": level})

room = {"shape": "round", "radius": R_WALL, "height": H, "width": 2 * R_WALL, "depth": 2 * R_WALL,
        "area": round(pi * R_WALL ** 2), "pyeong": round(pi * R_WALL ** 2 / 3.305785, 1)}
walk = {"r": R_WALL - .5, "galleries": galleries, "flights": flights, "landings": landings, "thresholds": thresholds}

# Picking: what can hide a screen from the eye (cylinders, sector solids, horizontal slabs).
occluders = {
    "cylinders": [{"x": 0, "z": 0, "r": TOWER["plinth"], "y0": 0, "y1": .4},
                  {"x": 0, "z": 0, "r": TOWER["core"] + .1, "y0": 0, "y1": H}]
                 + [{"x": c["x"], "z": c["z"], "r": .7, "y0": 0, "y1": H} for c in columns],
    # Real desk solids, not the walking zone: the zone reaches 1.3 m over the chairs, which hid
    # every lower-tier monitor (0.92-1.26 m) from clicks. Desktop to 0.78 m, privacy screen to 1.06 m.
    "arcs": [s for d in desks for s in (
                 {"r0": d["r"] - .05, "r1": d["r"] + .78, "a0": d["a0"], "a1": d["a1"], "y0": 0, "y1": .78},
                 {"r0": d["r"] - .11, "r1": d["r"] - .03, "a0": d["a0"], "a1": d["a1"], "y0": .78, "y1": 1.06})]
            + [{"r0": COUNTER_R - .58, "r1": COUNTER_R + .06, "a0": 0, "a1": 360, "y0": 0, "y1": 1.07}]
            + [{"r0": 17.1, "r1": 20.7, "a0": L["t"] - 11, "a1": L["t"] + 11, "y0": 0, "y1": .9} for L in lounges]
            + [{**w, "y0": 0, "y1": .42} for w in water],
    "slabs": [{"r0": R_GALLERY, "r1": R_WALL, "y0": y - .95, "y1": y + .08} for y in LEVELS],
}

def station(id_, ko, en, x, z, tx, tz, pitch):
    """A jump point at (x, z) looking at (tx, tz). Camera yaw 0 looks toward -z; forward = (-sin, -cos)."""
    from math import atan2
    return {"id": id_, "ko": ko, "en": en, "x": round(x, 2), "z": round(z, 2),
            "yaw": round(degrees(atan2(-(tx - x), -(tz - z))), 1), "pitch": pitch}


stations = [
    station("tower", "라이트 코어", "Light core", 0, 6.6, 0, 0, .42),
    station("overview", "메인 보드", "Main board", *pol(6.2, 135), *pol(21.5, 135), .36),
    station("treemap", "시장 지도", "Market map", 10.0, 0, 21.5, 0, .3),
    station("world", "세계 지수", "World indices", -10.0, 0, -21.5, 0, .3),
    station("desks", "트레이딩 데스크", "Trading desks", *pol(13.3, 30), 0, 0, .02),
    station("lounge", "라운지", "Lounge", *pol(16.55, 196), *pol(19.4, 212), .04),
    station("clocks", "세계 시각", "World clocks", *pol(9, 45), *pol(21.5, 225), .5),
    {**station("gallery2", "2층 갤러리", "Gallery 2F", *pol(22.9, 60), 0, 0, -.05), "y": LEVELS[0]},
    {**station("gallery4", "4층 전망", "Top gallery 4F", *pol(22.9, 15), 0, 0, -.2), "y": LEVELS[2]},
    {**station("elevator", "엘리베이터", "Glass elevator", *pol(16.6, 120), *pol(20.25, 120), .25)},
    {**station("stairs", "계단", "Stairs", *pol(16.8, 338), *pol(20.0, 336), .32)},
    station("art", "아트 갤러리", "Art walk", *pol(22.5, 30), *pol(24.2, 34), .02),
]
spawn = {"x": 0, "z": 22.6, "yaw": 0, "pitch": .14}

layout = {"version": 5, "room": room, "spawn": spawn, "stations": stations, "levels": list(LEVELS),
          "radii": {"wall": R_WALL, "gallery": R_GALLERY, "column": R_COLUMN, "office": R_OFFICE, "counter": COUNTER_R},
          "columnAngles": COLUMNS, "aisles": AISLES, "aisleWidth": AISLE_W, "rows": list(ROWS), "tower": TOWER,
          "desks": desks, "seats": seats, "counterSeats": counter, "lounges": lounges, "water": water, "planters": planters,
          "screens": screens, "obstacles": obstacles, "circles": circles, "arcs": arcs, "columns": columns,
          "occluders": occluders, "walk": walk, "elevators": elevators, "openings": openings, "flowers": FLOWERS,
          "bowls": bowls, "galleryPots": gallery_pots, "artWalls": art_walls, "sculptures": sculptures, "sofas": sofas}
OUT.write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{len(screens)} screens, {len({s['id'] for s in screens})} panels, {len(seats)} seats, {room['area']} m2 = {room['pyeong']} pyeong")
