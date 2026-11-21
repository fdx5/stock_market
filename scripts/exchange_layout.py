"""Write frontend/src/exchange/layout.json: the one plan Blender and the browser both read.

Coordinates are three.js metres: x east, y up, z south (toward the entrance). A screen's
plane faces +z at yaw 0; yaw 90 faces +x (west wall), -90 faces -x (east wall), 180 faces -z.
"""
import json
from math import cos, radians, sin
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/src/exchange/layout.json"

W, D, H = 42.0, 31.5, 20.0          # 1,323 m² = 400.2 pyeong
HX, HZ = W / 2, D / 2
BAYS = (-11.2, -5.6, 0.0, 5.6, 11.2)  # side wall bay centres (z)
SIDE_PILASTERS = (-14.0, -8.4, -2.8, 2.8, 8.4, 14.0)
POSTS = [(x, z) for z in (-6.0, 3.6) for x in (-12.0, -4.0, 4.0, 12.0)]
STOCKS = [f"s{i}" for i in range(16)]
ASSETS = ["a:KRW=X", "a:GC=F", "a:CL=F", "a:BTC-USD", "a:NQ=F", "a:ES=F", "a:ETH-USD", "a:SI=F"]
POST_THEMES = [("leaders", "gainers"), ("laggards", "breadth"), ("sectors", "movers"), ("semis", "bigtech"),
               ("tri", "futures"), ("investor", "capshare"), ("crypto", "fx"), ("metals", "energy")]

screens = []


def add(panel, x, y, z, yaw, w, h, kind, tilt=0.0, **extra):
    screens.append({"id": panel, "x": round(x, 4), "y": round(y, 4), "z": round(z, 4), "yaw": yaw,
                    "tilt": tilt, "w": w, "h": h, "kind": kind, **extra})


# North wall: the big board composition.
NZ = -HZ + 0.2
add("overview", 0, 7.6, NZ + .05, 0, 17.0, 6.4, "board")
add("treemap", -15.3, 7.25, NZ, 0, 7.4, 4.3, "board")
add("world", 15.3, 7.25, NZ, 0, 7.4, 4.3, "board")
for i, panel in enumerate(("investor", "leaders", "tri", "breadth", "futures", "gainers", "laggards", "brief")):
    add(panel, -16.1 + i * 4.6, 2.75, NZ, 0, 4.2, 2.3, "wall")
add("tickerA", 0, 11.65, -HZ + .62, 0, 39.0, .95, "ticker")   # in front of the pilasters
add("sign", 0, 13.45, -HZ + .62, 0, 15.0, 1.9, "board")
add("clocks", -14.6, 13.6, -HZ + .62, 0, 9.4, 2.6, "board")
add("session", 14.6, 13.6, -HZ + .62, 0, 9.4, 2.6, "board")

# West wall: bell podium in the centre bay.
WX = -HX + .12
for z, panel in zip(BAYS, ("sectors", "histogram", None, "capshare", "movers")):
    if panel:
        add(panel, WX, 4.9, z, 90, 4.4, 2.6, "wall")
for z, panel in zip(BAYS, ("globaltop", "semis", "news", "bigtech", "crypto")):
    add(panel, WX, 11.3 if panel != "news" else 10.0, z, 90, 4.4 if panel != "news" else 4.45,
        2.6 if panel != "news" else 2.9, "wall")
add("rates", WX, 2.75, 0, 90, 4.0, 2.2, "wall")
add("tickerD", WX + .45, 7.75, 0, 90, 30.0, .8, "ticker")

# East wall: commodity and FX desks below a window wall.
EX = HX - .12
for z, panel in zip(BAYS, ("metals", "energy", "heatgrid", "agri", "fx")):
    big = panel == "heatgrid"
    add(panel, EX, 5.0 if big else 4.9, z, -90, 4.45 if big else 4.4, 3.0 if big else 2.6, "wall")
add("tickerC", EX - .45, 7.75, 0, -90, 30.0, .8, "ticker")

# South wall above the visitor gallery, and a ticker on the gallery fascia.
SZ = HZ - .12
for i, panel in enumerate(ASSETS[:6]):
    add(panel, -15.0 + i * 6.0, 11.9, SZ, 180, 5.0, 2.8, "wall")
add("tickerB", 0, 6.72, HZ - 2.62, 180, 34.0, .62, "ticker")

# Trading posts: halo monitors, counter monitors and a cylindrical crown ticker.
for p, (px, pz) in enumerate(POSTS):
    a, b = POST_THEMES[p]
    halo = [STOCKS[2 * p], a, STOCKS[2 * p + 1], b] * 2
    for k, panel in enumerate(halo):
        ang = radians(k * 45 + 22.5)
        add(panel, px + sin(ang) * 1.78, 3.32, pz + cos(ang) * 1.78, round(k * 45 + 22.5, 2), 1.34, .76, "halo", tilt=9)
    counter = [STOCKS[2 * p], ASSETS[p], STOCKS[2 * p + 1], ASSETS[(p + 3) % 8],
               STOCKS[(2 * p + 2) % 16], ASSETS[(p + 5) % 8], STOCKS[(2 * p + 3) % 16], a]
    for k, panel in enumerate(counter):
        ang = radians(k * 45)
        add(panel, px + sin(ang) * 1.86, 1.33, pz + cos(ang) * 1.86, k * 45, .62, .35, "counter", tilt=-14)
    add("ring", px, 4.28, pz, 0, 1.56, .5, "ring", post=p)

# Broker booths against the side walls: three-monitor desks facing the wall screens.
booths = []
for side in (-1, 1):
    for z in BAYS:
        if side < 0 and z == 0:
            continue  # under the bell podium stairs
        for dz in (-1.3, 1.3):
            booths.append({"x": side * (HX - 1.35), "z": z + dz, "side": side})
for i, booth in enumerate(booths):
    face = 90 if booth["side"] > 0 else -90       # monitors face the wall, toward the trader's view
    yaw = -face
    bx, bz = booth["x"] + booth["side"] * .18, booth["z"]
    for k, dz in enumerate((-.66, 0, .66)):
        side_yaw = yaw + (k - 1) * -14 * booth["side"]
        panel = (STOCKS + ASSETS)[(i * 3 + k) % 24] if k != 1 else ("treemap", "heatgrid", "world", "news")[i % 4]
        add(panel, bx - booth["side"] * abs(dz) * .12, 1.27, bz + dz, side_yaw, .64, .37, "desk", tilt=-4)

room = {"width": W, "depth": D, "height": H, "pyeong": round(W * D / 3.305785, 1)}
obstacles = [
    {"x": 0, "z": -HZ + 1.05, "w": 37.0, "d": 2.3},          # north stage
    {"x": -HX + 1.4, "z": 0, "w": 2.8, "d": 6.8},            # bell podium stair base
    {"x": 0, "z": 10.6, "w": 1.5, "d": 1.5},                 # bull plinth
]
for side in (-1, 1):
    obstacles.append({"x": side * 16.0, "z": 10.4, "w": 5.4, "d": 4.4})   # lounges
for b in booths:
    obstacles.append({"x": b["x"], "z": b["z"], "w": 2.3, "d": 2.5})
for side in (-1, 1):
    for z in SIDE_PILASTERS:
        obstacles.append({"x": side * (HX - .35), "z": z, "w": .9, "d": 1.3})
circles = [{"x": x, "z": z, "r": 2.42} for x, z in POSTS]

stations = [
    {"id": "overview", "ko": "빅 보드", "en": "Big board", "x": 0, "z": 2.4, "yaw": 0, "pitch": .3},
    {"id": "treemap", "ko": "시장 지도", "en": "Market map", "x": -12.5, "z": -10.6, "yaw": 22, "pitch": .36},
    {"id": "world", "ko": "세계 지수", "en": "World indices", "x": 12.5, "z": -10.6, "yaw": -22, "pitch": .36},
    {"id": "podium", "ko": "벨 포디움", "en": "Bell podium", "x": -13.0, "z": 0, "yaw": 90, "pitch": .32},
    {"id": "heatgrid", "ko": "원자재 · 환율", "en": "Commodities & FX", "x": 13.6, "z": 0, "yaw": -90, "pitch": .24},
    {"id": "posts", "ko": "거래 포스트", "en": "Trading posts", "x": 0, "z": -.9, "yaw": 90, "pitch": .14},
    {"id": "gallery", "ko": "자산 시세판", "en": "Asset boards", "x": 0, "z": 1.6, "yaw": 180, "pitch": .42},
]
spawn = {"x": 2.4, "z": 13.4, "yaw": 5, "pitch": .1}   # the bull frames the view from the side

layout = {"room": room, "spawn": spawn, "stations": stations, "posts": [{"x": x, "z": z} for x, z in POSTS],
          "bays": list(BAYS), "sidePilasters": list(SIDE_PILASTERS), "booths": booths,
          "screens": screens, "obstacles": obstacles, "circles": circles,
          "walk": {"x": HX - 2.75, "zMin": -HZ + 2.55, "zMax": HZ - 1.1}}
OUT.write_text(json.dumps(layout, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{len(screens)} screens, {len({s['id'] for s in screens})} panels, {room['pyeong']} pyeong")
