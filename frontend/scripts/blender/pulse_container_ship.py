"""Procedural container ship for the pulse board, built for a physically lit ocean.

    blender -b -P frontend/scripts/blender/pulse_container_ship.py -- <out.glb> [preview.png]

The browser scales one unit to ~8.75 m (a 210 m hull). Everything that reads as "real" at
that scale is here: painted steel textures generated in numpy (weathered container atlas with
corrugation normals, door gear and fictional owner codes; hull plating with seams, welds, rust
runs, scum line, touch-up paint and draft marks), corner castings, lashing rods and bridges with
floodlights, hatch cover panels, forecastle bulwark with chocks, windlasses and anchors, a stepped
accommodation block with individually lit windows, bridge wings, stairs, davits, life rafts,
radar/VSAT/antennas, and a funnel with exhaust uptakes.

The 20 camera-facing logo containers (Blender -Y, tiers 2-3) keep the web contract: each has a
`LogoPlate_NN` plane (UV 0..1) painted by the browser and a `LogoBox_NN` body it tints.
Other named nodes the web runtime drives: Radar, Neon*, Light*, HullName.
Only above-water detail is modelled; the web view clips the hull at the waterline.
"""
import math
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "pulse-ship.glb"
PREVIEW = argv[1] if len(argv) > 1 else None
random.seed(20261109)
RNG = np.random.default_rng(20261109)

L, B, D = 24.0, 4.8, 1.9          # length, beam, depth (deck z=0, keel z=-D)
WATERLINE = -1.2
X0 = -L / 2

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ================================================================ texture toolkit (numpy, top-left origin)
def upsample(grid, h, w):
    gy, gx = grid.shape
    ys, xs = np.linspace(0, gy - 1, h), np.linspace(0, gx - 1, w)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, gy - 1), np.minimum(x0 + 1, gx - 1)
    ty, tx = (ys - y0)[:, None], (xs - x0)[None, :]
    ty, tx = ty * ty * (3 - 2 * ty), tx * tx * (3 - 2 * tx)
    a, b, c, d = grid[y0][:, x0], grid[y0][:, x1], grid[y1][:, x0], grid[y1][:, x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(h, w, cells=8, octaves=5, aspect=1.0):
    out, amp, total = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        cy, cx = max(2, int(cells * 2 ** o)), max(2, int(cells * 2 ** o * aspect))
        out += upsample(RNG.random((cy + 1, cx + 1)), h, w) * amp
        total += amp
        amp *= .5
    return out / total


def blend(img, mask, color):
    img[:] = img * (1 - mask[..., None]) + np.asarray(color)[None, None, :] * mask[..., None]


FONT = {
    "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "A": "01110 10001 10001 11111 10001 10001 10001", "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01111", "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "01110 00100 00100 00100 00100 00100 01110", "K": "10001 10010 10100 11000 10100 10010 10001",
    "L": "10000 10000 10000 10000 10000 10000 11111", "M": "10001 11011 10101 10101 10001 10001 10001",
    "N": "10001 11001 10101 10011 10001 10001 10001", "O": "01110 10001 10001 10001 10001 10001 01110",
    "P": "11110 10001 10001 11110 10000 10000 10000", "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110", "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110", "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "W": "10001 10001 10001 10101 10101 10101 01010",
    "-": "00000 00000 00000 11111 00000 00000 00000", ".": "00000 00000 00000 00000 00000 00000 00100",
    " ": "00000 00000 00000 00000 00000 00000 00000",
}


def text(img, s, x, y, px, color, spacing=1):
    """Bitmap text, `px` image pixels per font pixel, top-left at (x, y)."""
    h, w = img.shape[:2]
    for ch in s:
        rows = FONT.get(ch, FONT[" "]).split()
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit == "1":
                    y0, x0 = int(y + r * px), int(x + c * px)
                    img[max(0, y0):min(h, y0 + px), max(0, x0):min(w, x0 + px)] = color
        x += (5 + spacing) * px


def rust_streaks(img, count, x_range, y_range, length, width, color=(.33, .14, .05), strength=.75):
    h, w = img.shape[:2]
    for _ in range(count):
        x, y = RNG.uniform(*x_range), RNG.uniform(*y_range)
        ln, wd = RNG.uniform(*length), RNG.uniform(*width)
        x0, x1 = int(max(0, x - wd * 2)), int(min(w, x + wd * 2 + 1))
        y0, y1 = int(max(0, y)), int(min(h, y + ln))
        if x1 <= x0 or y1 <= y0:
            continue
        xs = np.arange(x0, x1)[None, :]
        ys = np.arange(y0, y1)[:, None]
        t = (ys - y) / ln
        wobble = np.sin(ys * .09 + x) * wd * .3
        mask = np.exp(-((xs - x - wobble) ** 2) / (wd * wd)) * (1 - t) ** 1.6 * strength
        mask *= .65 + .35 * RNG.random(mask.shape)
        region = img[y0:y1, x0:x1]
        region[:] = region * (1 - mask[..., None]) + np.asarray(color) * mask[..., None]


def normal_from_height(height, strength):
    """Tangent-space normal map from a top-left height field (returns top-left RGB)."""
    flipped = height[::-1]
    dv, du = np.gradient(flipped)
    n = np.dstack([-du * strength, -dv * strength, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return (n[::-1] * .5 + .5)


def to_image(name, rgb, non_color=False):
    h, w = rgb.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb[::-1], 0, 1)
    img = bpy.data.images.new(name, w, h, alpha=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def srgb_to_linear(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


# ================================================================ textures
# --- container atlas: 4 x 2 variants, each 512 x 512 (side 512x218, door end 240x256, blank end 240x256)
CONTAINER_COLORS = [(.78, .16, .1), (.1, .32, .68), (.12, .55, .45), (.95, .6, .1),
                    (.62, .64, .64), (.9, .89, .85), (.2, .24, .28), (.66, .18, .4)]
OWNER = ["KSHU", "PLSU", "NEOU", "KPMU", "HBXU", "TRGU", "SKLU", "MXPU"]
SIDE, DOOR, BLANK = (0, 0, 512, 218), (0, 240, 240, 256), (264, 240, 240, 256)
ATLAS_W, ATLAS_H = 2048, 1024


def corrugation(w, period, profile=.32):
    x = (np.arange(w) % period) / period
    tri = np.clip((np.abs(x - .5) * 2 - profile) / (1 - 2 * profile), 0, 1)
    return 1 - tri  # 1 on the outer flats, 0 in the grooves


def paint_container(color, owner, dark_text):
    cell = np.zeros((512, 512, 3))
    hcell = np.zeros((512, 512))
    base = srgb_to_linear(color)
    ink = (.03, .03, .03) if dark_text else (.85, .85, .82)
    for (x, y, w, h), kind in ((SIDE, "side"), (DOOR, "door"), (BLANK, "blank")):
        mott = fbm(h, w, 3, 5, w / h)
        img = np.ones((h, w, 3)) * base[None, None, :] * (.82 + .3 * mott[..., None])
        height = np.zeros((h, w))
        rail = max(8, h // 22)
        if kind == "side":
            c = corrugation(w, 15)
            height[:] = c[None, :]
            img *= (.86 + .14 * c)[None, :, None]
        elif kind == "door":
            # two leaves with vertical panel corrugation, four locking bars, hinges, cam keepers
            c = corrugation(w, 11, .38)
            height[:] = c[None, :] * .6
            img *= (.9 + .1 * c)[None, :, None]
            seam = w // 2
            img[:, seam - 1:seam + 2] *= .35
            height[:, seam - 1:seam + 2] = -.5
            for bx in (w * .17, w * .36, w * .64, w * .83):
                bx = int(bx)
                img[rail:h - rail, bx - 3:bx + 4] = img[rail:h - rail, bx - 3:bx + 4] * .4 + .35 * base
                height[rail:h - rail, bx - 3:bx + 4] = 1.6
                for yy in (int(h * .12), int(h * .88)):
                    img[yy - 5:yy + 5, bx - 6:bx + 7] = (.05, .05, .05)
                    height[yy - 5:yy + 5, bx - 6:bx + 7] = 2.
                img[int(h * .55):int(h * .6), bx:bx + 14] = (.08, .08, .08)  # handle
                height[int(h * .55):int(h * .6), bx:bx + 14] = 2.2
            for side_x in (6, w - 12):
                for yy in (.18, .4, .62, .84):
                    yy = int(h * yy)
                    img[yy - 6:yy + 6, side_x:side_x + 7] = (.04, .04, .04)
                    height[yy - 6:yy + 6, side_x:side_x + 7] = 1.4
            text(img, owner, int(w * .55), int(h * .1), 3, ink)
            text(img, str(RNG.integers(100000, 999999)), int(w * .55), int(h * .1) + 26, 2, ink)
            text(img, "22G1", int(w * .55), int(h * .1) + 46, 2, ink)
            img[int(h * .7):int(h * .78), int(w * .08):int(w * .3)] = (.45, .45, .42)  # CSC plate
        else:
            c = corrugation(h, 16)
            height[:] = c[:, None] * .8
            img *= (.88 + .12 * c)[:, None, None]
        # top/bottom rails, corner posts and castings
        for sl in (slice(0, rail), slice(h - rail, h)):
            img[sl] = base * .55
            height[sl] = 1.2
        post = max(10, w // 34)
        for sl in (slice(0, post), slice(w - post, w)):
            img[:, sl] = base * .6
            height[:, sl] = 1.4
        for yy in (0, h - rail - 6):
            for xx in (0, w - post - 4):
                img[yy:yy + rail + 6, xx:xx + post + 4] = (.07, .065, .06)
        # weathering: rust runs from the top rail, grime toward the bottom, scuffs
        rust_streaks(img, int(w / 40), (post, w - post), (rail - 2, rail + 6), (h * .2, h * .8), (1.5, 4))
        grime = np.linspace(0, 1, h)[:, None] ** 3 * .35 * (.6 + .4 * fbm(h, w, 4, 3, w / h))
        img *= (1 - grime)[..., None]
        scuff = (fbm(h, w, 10, 3, w / h) > .72) * .25
        img = img * (1 - scuff[..., None]) + np.array([.18, .1, .06]) * scuff[..., None]
        if kind == "side":
            text(img, owner + " " + str(RNG.integers(100000, 999999)) + " " + str(RNG.integers(0, 9)), int(w * .56), rail + 8, 2, ink)
            text(img, "45G1", int(w * .86), rail + 26, 2, ink)
        cell[y:y + h, x:x + w] = img
        hcell[y:y + h, x:x + w] = height
    return cell, hcell


atlas = np.zeros((ATLAS_H, ATLAS_W, 3))
atlas_h = np.zeros((ATLAS_H, ATLAS_W))
for i, color in enumerate(CONTAINER_COLORS):
    cx, cy = (i % 4) * 512, (i // 4) * 512
    cell, hcell = paint_container(color, OWNER[i], dark_text=i in (5, 3))
    atlas[cy:cy + 512, cx:cx + 512] = cell
    atlas_h[cy:cy + 512, cx:cx + 512] = hcell
IMG_ATLAS = to_image("ContainerAtlas", atlas ** (1 / 2.2))
IMG_ATLAS_N = to_image("ContainerAtlasNormal", normal_from_height(atlas_h, 2.2), True)


def atlas_rect(variant, region):
    x, y, w, h = region
    cx, cy = (variant % 4) * 512 + x, (variant // 4) * 512 + y
    # UV (bottom-left origin) of the region: u0, v0, u1, v1
    return cx / ATLAS_W, 1 - (cy + h) / ATLAS_H, (cx + w) / ATLAS_W, 1 - cy / ATLAS_H


# --- hull: u along the ship (stern overhang .. bow rake), v keel .. sheer top
HULL_U0, HULL_U1 = X0 - 1.5, L / 2 + 2.0
HULL_V0, HULL_V1 = -D, .5
HW, HH = 4096, 512


def hull_px(x, z):
    return (x - HULL_U0) / (HULL_U1 - HULL_U0) * HW, (1 - (z - HULL_V0) / (HULL_V1 - HULL_V0)) * HH


hull = np.ones((HH, HW, 3)) * srgb_to_linear((.1, .22, .52))[None, None, :]  # vivid royal blue topsides
hull *= (.85 + .3 * fbm(HH, HW, 2, 6, 8))[..., None]
hull_height = np.zeros((HH, HW))
wl_row = int(hull_px(0, WATERLINE)[1])
hull[wl_row:] = srgb_to_linear((.62, .08, .07)) * (.85 + .3 * fbm(HH - wl_row, HW, 2, 4, 8)[..., None])
# lower hull paint raised well above the waterline so it shows: vivid red under a thin white boot-top line
boot_row = int(hull_px(0, -.8)[1])
hull[boot_row:] = srgb_to_linear((.72, .07, .06)) * (.85 + .3 * fbm(HH - boot_row, HW, 2, 4, 8)[..., None])
hull[boot_row - 5:boot_row + 1] = srgb_to_linear((.88, .88, .85))
# plate strakes: vertical butts every ~0.6 u, horizontal seams at three heights; welds raised
for x in np.arange(HULL_U0, HULL_U1, .62):
    px = int(hull_px(x, 0)[0])
    if px < 1 or px > HW - 4:
        continue
    hull[:, px:px + 2] *= .86
    hull_height[:, px - 1:px + 3] += np.array([.4, 1, 1, .4])[None, :]
for z in (-.32, -.78, -1.45):
    py = int(hull_px(0, z)[1])
    hull[py:py + 2] *= .84
    hull_height[py - 1:py + 3] += np.array([.4, 1, 1, .4])[:, None]
# slight plate "hungry horse" dishing between frames
frames = (np.cos((np.arange(HW) / HW * (HULL_U1 - HULL_U0)) / .62 * 2 * math.pi) * .5 + .5)
hull_height += frames[None, :] * .35
# touch-up paint patches: slightly different blue-black rectangles
for _ in range(70):
    x, y = RNG.uniform(0, HW), RNG.uniform(10, wl_row - 30)
    w, h = RNG.uniform(30, 260), RNG.uniform(10, 60)
    hull[int(y):int(y + h), int(x):int(x + w)] = hull[int(y):int(y + h), int(x):int(x + w)] * .6 + srgb_to_linear((.12, .25, .56)) * .4
# rust runs from deck-edge scuppers, hawse pipe and stern chocks
deck_row = int(hull_px(0, -.05)[1])
rust_streaks(hull, 150, (0, HW), (deck_row - 4, deck_row + 12), (30, 190), (2, 5), strength=.6)
hx, hy = hull_px(L / 2 - 1.3, -.45)
rust_streaks(hull, 40, (hx - 26, hx + 26), (hy, hy + 10), (60, 260), (3, 8), strength=.85)
for sx in (X0 + .5, X0 + 1.4, L / 2 - 2.6):
    px, py = hull_px(sx, -.12)
    hull[int(py) - 6:int(py) + 6, int(px) - 14:int(px) + 14] = (.01, .01, .012)  # chock opening
    rust_streaks(hull, 12, (px - 12, px + 12), (py + 4, py + 8), (40, 150), (2, 5), strength=.8)
# scum line just above the waterline
scum = np.exp(-((np.arange(HH) - (wl_row - 18)) / 9.) ** 2)[:, None] * (.5 + .5 * fbm(HH, HW, 3, 4, 10))
blend(hull, scum * .35, srgb_to_linear((.32, .33, .28)))
# vertical grime from rain
grime = fbm(HH, HW, 1, 3, 60) ** 2 * .25
hull *= (1 - grime[..., None])
# draft marks (camera side reads left to right), bow thruster and bulb symbols, bow name
white = srgb_to_linear((.86, .86, .82))
for mark_x in (L / 2 - 1.05, X0 + 1.15):
    for k, label in enumerate(["8", "10", "12", "14", "16"]):
        px, py = hull_px(mark_x, -1.75 + k * .28)
        if py < 4:
            continue
        text(hull, label, int(px), int(py), 4, white)
px, py = hull_px(L / 2 - 2.3, -1.0)
yy, xx = np.mgrid[0:HH, 0:HW]
ring = np.abs(np.hypot(xx - px, yy - py) - 26) < 3
cross = (np.abs((xx - px) - (yy - py)) < 3) | (np.abs((xx - px) + (yy - py)) < 3)
hull[ring | (cross & (np.hypot(xx - px, yy - py) < 26))] = white
px, py = hull_px(L / 2 - .9, -.28)
text(hull, "PULSE LINE", int(px) - 300, int(py), 5, white)
IMG_HULL = to_image("HullPlating", hull ** (1 / 2.2))
IMG_HULL_N = to_image("HullPlatingNormal", normal_from_height(hull_height, 1.6), True)


# --- tiling paints (box-projected UVs, 1 tile per TILE units)
def tiled(name, color, size=1024, seams=8, rust=.0, streaks=.0, drips=0, normal=1.2):
    img = np.ones((size, size, 3)) * srgb_to_linear(color)[None, None, :]
    img *= (.86 + .25 * fbm(size, size, 4, 6))[..., None]
    height = np.zeros((size, size))
    step = size // seams
    for k in range(0, size, step):
        img[k:k + 2] *= .78
        img[:, k:k + 2] *= .8
        height[k:k + 3] += 1
        height[:, k:k + 3] += 1
    if rust:
        spots = (fbm(size, size, 12, 4) > 1 - rust) * (.5 + .5 * RNG.random((size, size)))
        blend(img, spots * .7, srgb_to_linear((.36, .17, .07)))
    if drips:
        rust_streaks(img, drips, (0, size), (0, size), (40, 240), (1.5, 4), color=srgb_to_linear((.3, .27, .22)), strength=.5)
    if streaks:
        img *= (1 - fbm(size, size, 1, 3, 40) ** 2 * streaks)[..., None]
    return to_image(name, img ** (1 / 2.2)), to_image(name + "Normal", normal_from_height(height, normal), True)


IMG_DECK = tiled("DeckPaint", (.2, .26, .23), seams=6, rust=.05, streaks=.3)
IMG_HATCH = tiled("HatchPaint", (.36, .39, .39), seams=4, rust=.04, streaks=.25)
IMG_WHITE = tiled("SuperstructurePaint", (.83, .84, .84), seams=5, drips=70, streaks=.2, normal=.8)
IMG_STEEL = tiled("SteelPaint", (.24, .25, .27), size=512, seams=4, rust=.08, streaks=.3)


# ================================================================ materials
def material(name, color=(1, 1, 1), rough=.5, metal=0., emission=None, strength=0., image=None, normal=None, normal_strength=1.):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if normal:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


M = {
    "hull": material("HullTopside", rough=.5, metal=.25, image=IMG_HULL, normal=IMG_HULL_N),
    "deck": material("Deck", rough=.82, metal=.1, image=IMG_DECK[0], normal=IMG_DECK[1]),
    "hatch": material("HatchCover", rough=.7, metal=.2, image=IMG_HATCH[0], normal=IMG_HATCH[1]),
    "steel": material("SteelGrey", rough=.55, metal=.45, image=IMG_STEEL[0], normal=IMG_STEEL[1]),
    "dark": material("DarkSteel", (.035, .037, .042), .55, .6),
    "white": material("Superstructure", rough=.5, metal=.05, image=IMG_WHITE[0], normal=IMG_WHITE[1], normal_strength=.6),
    "glass": material("BridgeGlass", (.01, .015, .025), .06, .3, (1., .8, .55), 1.1),
    "window": material("CabinWindow", (.015, .02, .03), .1, .2, (1., .78, .5), 2.6),
    "windowDark": material("CabinWindowDark", (.012, .016, .024), .06, .4),
    "neon": material("NeonSheer", (.05, .05, .08), .3, 0., (.75, .45, 1.), 6.),
    "funnel": material("FunnelBand", (.05, .04, .08), .35, .2, (.75, .45, 1.), 3.5),
    "orange": material("LifeboatOrange", (.92, .34, .04), .4, 0.),
    "red": material("LightRed", (.4, 0, 0), .3, 0, (1, .05, .05), 18),
    "green": material("LightGreen", (0, .4, .1), .3, 0, (.05, 1, .3), 18),
    "lamp": material("LightWhite", (.6, .6, .6), .3, 0, (1, .95, .85), 14),
    "flood": material("LightFlood", (.7, .7, .6), .3, 0, (1, .9, .7), 9),
    "atlas": material("ContainerSteel", rough=.62, metal=.35, image=IMG_ATLAS, normal=IMG_ATLAS_N),
    "logobody": material("LogoBoxBody", rough=.6, metal=.3, image=IMG_ATLAS, normal=IMG_ATLAS_N),
    "plate": material("LogoPlate", (.9, .9, .9), .45, 0.),
    "frame": material("PlateFrame", (.03, .03, .04), .4, .6),
    "rubber": material("Fender", (.02, .02, .02), .9, 0.),
    "bulwark": material("BulwarkPaint", (.01, .045, .25), .5, .3, normal=IMG_STEEL[1]),
    "yellow": material("SafetyYellow", (.85, .62, .05), .5, .1),
}


# ================================================================ mesh helpers
def link(obj):
    scene.collection.objects.link(obj)
    return obj


def box_uv(bm, scale):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = loop.vert.co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y
            if not loop[uv].uv.length_squared:
                loop[uv].uv = (u * scale, v * scale)


def mesh_object(name, bm, mats, smooth=False, uv_scale=.5):
    bm.normal_update()
    box_uv(bm, uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mat in mats:
        me.materials.append(mat)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    return link(bpy.data.objects.new(name, me))


def add_box(bm, center, size, mat_index=0, rot_z=0., rot_y=0.):
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_y, 4, "Y") @ Matrix.Diagonal((*size, 1))
    geom = bmesh.ops.create_cube(bm, size=1., matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
    return geom


def add_cyl(bm, center, radius, depth, segs=12, mat_index=0, axis="Z"):
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    m = Matrix.Translation(Vector(center)) @ rot
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=depth, matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
        f.smooth = True
    return geom


def add_rod(bm, a, b, thick, mat_index=0):
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((thick, thick, length, 1))
    geom = bmesh.ops.create_cube(bm, size=1., matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index


def bevel(obj, width=.02, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments, mod.limit_method = width, segments, "ANGLE"
    return obj


def smoothstep(a, b, x):
    t = max(0., min(1., (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ================================================================ hull
def half_width(t):
    if t < .07:
        return .66 + .34 * math.sqrt(max(0., 1 - (1 - t / .07) ** 2))
    if t < .72:
        return 1.
    u = (t - .72) / .28
    return max(0., math.cos(u * math.pi / 2)) ** .75


def keel_depth(t):
    return D * (.42 + .58 * smoothstep(0, .14, t))


def fullness(t):
    return 2.3 + 8 * smoothstep(0, .2, t) * (1 - smoothstep(.7, 1, t))


def sheer(t):
    return .38 * smoothstep(.8, 1., t) + .1 * smoothstep(.12, 0., t)


Z_LEVELS = [None, -.05, -.18, -.32, -.55, -.78, -1.05, WATERLINE, -1.4, -1.6, -1.75, -1.85, -1.9]


def station(t):
    hw, dt, n = B / 2 * half_width(t), keel_depth(t), fullness(t)
    flare = .32 * smoothstep(.7, 1., t) + .18 * smoothstep(.15, 0., t)
    rake = 1.05 * smoothstep(.86, 1., t)
    pts = []
    for level in Z_LEVELS:
        z = sheer(t) if level is None else max(level, -dt * .999)
        zn = min(.999, max(0., -z / dt))
        y = hw * (1 - zn ** n) ** (1 / n) * (1 - flare * zn)
        x = X0 + t * L + rake * (1 - zn) - .55 * smoothstep(.1, 0., t) * (1 - zn)
        pts.append(Vector((x, y, z)))
    pts.append(Vector((pts[-1].x, 0., -dt)))
    return pts


def hull_uv(co):
    return ((co.x - HULL_U0) / (HULL_U1 - HULL_U0), (co.z - HULL_V0) / (HULL_V1 - HULL_V0))


TS = sorted(set([i / 200 for i in range(201)] + [1 - (1 - i / 40) ** 2 * .1 for i in range(41)]))


def build_hull():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rows = []
    for t in TS:
        half = station(t)
        side = [Vector((p.x, -p.y, p.z)) for p in half[:-1]] + [half[-1]] + [p.copy() for p in reversed(half[:-1])]
        rows.append([bm.verts.new(p) for p in side])
    for a, b in zip(rows, rows[1:]):
        for j in range(len(a) - 1):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            for loop in f.loops:
                loop[uv].uv = hull_uv(loop.vert.co)
    stern = bm.faces.new(list(reversed(rows[0])))
    for loop in stern.loops:
        loop[uv].uv = (.005, (loop.vert.co.z - HULL_V0) / (HULL_V1 - HULL_V0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hull = mesh_object("Hull", bm, [M["hull"]], smooth=True)
    bpy.context.view_layer.objects.active = hull
    hull.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    except Exception as error:
        print("auto smooth", error)
    hull.select_set(False)
    deck = bmesh.new()
    prev = None
    for t in TS:
        s = station(t)[0]
        port, star = deck.verts.new((s.x, -s.y + .02, s.z - .01)), deck.verts.new((s.x, s.y - .02, s.z - .01))
        if prev:
            deck.faces.new((prev[0], port, star, prev[1]))
        prev = (port, star)
    mesh_object("Deck", deck, [M["deck"]], uv_scale=.35)
    for sign, label in ((-1, "NeonPort"), (1, "NeonStarboard")):
        bm2, prev = bmesh.new(), None
        for t in TS[2:-3]:
            s = station(t)[0]
            o = Vector((s.x, sign * (s.y + .012), s.z - .07))
            pair = (bm2.verts.new(o), bm2.verts.new(o + Vector((0, 0, -.025))))
            if prev:
                bm2.faces.new((prev[0], prev[1], pair[1], pair[0]) if sign < 0 else (prev[0], pair[0], pair[1], prev[1]))
            prev = pair
        mesh_object(label, bm2, [M["neon"]])


build_hull()


def deck_z(x):
    return sheer((x - X0) / L)


def hull_half(x):
    return B / 2 * half_width((x - X0) / L)


# ================================================================ containers
CL, CW, CH = 1.45, .58, .62
HC = .69  # high cube


def container_mesh(name, variant, mat, height=CH, castings=True):
    """Body UV-mapped into the atlas (sides, door end aft, blank end forward) plus corner castings."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    hx, hy = (CL - .02) / 2, (CW - .02) / 2
    geom = add_box(bm, (0, 0, height / 2), (CL - .02, CW - .02, height - .01))
    faces = {f for v in geom["verts"] for f in v.link_faces}
    bm.normal_update()
    for f in faces:
        n = f.normal
        if abs(n.y) > .5:
            u0, v0, u1, v1 = atlas_rect(variant, SIDE)
            for loop in f.loops:
                co = loop.vert.co
                s = (co.x + hx) / (2 * hx) if n.y < 0 else (hx - co.x) / (2 * hx)
                loop[uv].uv = (u0 + (u1 - u0) * s, v0 + (v1 - v0) * (co.z / height))
        elif abs(n.x) > .5:
            u0, v0, u1, v1 = atlas_rect(variant, DOOR if n.x < 0 else BLANK)
            for loop in f.loops:
                co = loop.vert.co
                s = (hy - co.y) / (2 * hy) if n.x < 0 else (co.y + hy) / (2 * hy)
                loop[uv].uv = (u0 + (u1 - u0) * s, v0 + (v1 - v0) * (co.z / height))
        else:
            u0, v0, u1, v1 = atlas_rect(variant, SIDE)
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = (u0 + (u1 - u0) * (co.x + hx) / (2 * hx), v0 + (v1 - v0) * (co.y + hy) / (2 * hy))
    if castings:
        for x in (-1, 1):
            for y in (-1, 1):
                for z in (.02, height - .02):
                    add_box(bm, (x * (CL / 2 - .025), y * (CW / 2 - .025), z), (.05, .05, .045), 1)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    if castings:
        me.materials.append(M["dark"])
    return me


filler_meshes = [container_mesh(f"Container{i}", i, M["atlas"]) for i in range(8)]
filler_hc = [container_mesh(f"ContainerHC{i}", i, M["atlas"], HC) for i in range(8)]
logo_mesh = container_mesh("LogoContainer", 5, M["logobody"], castings=False)

BAYS, ROWS, TIERS = 10, 7, 4
BAY_PITCH, ROW_PITCH = 1.65, .6
CARGO_START = -9.1
HATCH_TOP = .14
logo_index = 0
lash, floods, logo_castings = bmesh.new(), bmesh.new(), bmesh.new()
hatch_bm = bmesh.new()
for bay in range(BAYS):
    x = CARGO_START + bay * BAY_PITCH + CL / 2
    dz = deck_z(x)
    # hatch cover: three panels with raised stiffeners and cleats
    width = ROW_PITCH * ROWS + .08
    for k, py in enumerate((-width / 3, 0, width / 3)):
        add_box(hatch_bm, (x, py, HATCH_TOP / 2 + dz), (CL + .08, width / 3 - .02, HATCH_TOP))
        for sx in np.linspace(-CL / 2 + .1, CL / 2 - .1, 5):
            add_box(hatch_bm, (x + sx, py, HATCH_TOP + dz + .008), (.02, width / 3 - .08, .016))
    add_box(hatch_bm, (x, 0, dz + .04), (CL + .2, width + .12, .08))  # coaming
    if bay:
        # lashing bridge: two-level platform with posts, guard rails and floodlights
        lx = x - CL / 2 - (BAY_PITCH - CL) / 2
        span = ROW_PITCH * ROWS / 2 + .02
        for y in np.linspace(-span, span, ROWS + 1):
            add_box(lash, (lx, y, HATCH_TOP + dz + .55), (.045, .045, 1.1))
        for h in (.45, 1.0):
            add_box(lash, (lx, 0, HATCH_TOP + dz + h), (.16, span * 2 + .1, .025))  # walkways
            for side in (-1, 1):
                add_box(lash, (lx + side * .08, 0, HATCH_TOP + dz + h + .12), (.01, span * 2 + .1, .01))
        for y in (-span, span):
            add_box(lash, (lx, y, HATCH_TOP + dz + 1.25), (.02, .02, .5))
            add_box(floods, (lx, y * .98, HATCH_TOP + dz + 1.5), (.07, .05, .04))
    limit = hull_half(x + CL / 2) - .12
    for row in range(ROWS):
        y = -ROW_PITCH * (ROWS - 1) / 2 + row * ROW_PITCH
        if abs(y) + CW / 2 > limit:
            continue
        outer = row == 0
        tiers = TIERS if outer else random.choice((2, 3, 3, 4, 4, 5))
        z = dz + HATCH_TOP
        for tier in range(tiers):
            if outer and tier >= 2:
                rank = bay + (0 if tier == 3 else BAYS)
                obj = link(bpy.data.objects.new(f"LogoBox_{rank:02d}", logo_mesh))
                obj.location = (x, y, z)
                for cx_ in (-1, 1):
                    for cy_ in (-1, 1):
                        for cz in (.02, CH - .02):
                            add_box(logo_castings, (x + cx_ * (CL / 2 - .025), y + cy_ * (CW / 2 - .025), z + cz), (.05, .05, .045))
                bm = bmesh.new()
                plate_y = y - CW / 2 - .028
                add_box(bm, (x, plate_y + .012, z + CH / 2), (CL - .05, .012, CH - .05))
                mesh_object(f"LogoFrame_{rank:02d}", bm, [M["frame"]])
                pm = bpy.data.meshes.new(f"LogoPlate_{rank:02d}")
                w, h = (CL - .09) / 2, (CH - .09) / 2
                verts = [(x - w, plate_y, z + CH / 2 - h), (x + w, plate_y, z + CH / 2 - h), (x + w, plate_y, z + CH / 2 + h), (x - w, plate_y, z + CH / 2 + h)]
                pm.from_pydata(verts, [], [(0, 1, 2, 3)])
                uvl = pm.uv_layers.new(name="UVMap")
                for loop, coord in zip(uvl.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                    loop.uv = coord
                pm.materials.append(M["plate"])
                link(bpy.data.objects.new(f"LogoPlate_{rank:02d}", pm))
                logo_index += 1
                height = CH
            else:
                high = random.random() < .3 and not outer
                height = HC if high else CH
                variant = random.choice((0, 0, 1, 1, 2, 3, 4, 5, 6, 7))
                obj = link(bpy.data.objects.new(f"Box_{bay}_{row}_{tier}", (filler_hc if high else filler_meshes)[variant]))
                obj.location = (x, y, z)
            # lashing rods from the bridge to the lower two tiers, both ends of the box
            if bay and tier < 2:
                lx = x - CL / 2 - (BAY_PITCH - CL) / 2
                for yy in (y - CW / 2 + .04, y + CW / 2 - .04):
                    add_rod(lash, (lx + .05, yy, HATCH_TOP + dz + .05), (x - CL / 2 + .02, yy, z + height - .03), .012)
            z += height + .005
print("logo containers", logo_index)
mesh_object("HatchCovers", hatch_bm, [M["hatch"]], uv_scale=.6)
mesh_object("Lashing", lash, [M["dark"]])
mesh_object("LogoCastings", logo_castings, [M["dark"]])
mesh_object("LightFloods", floods, [M["flood"]])

# ================================================================ accommodation, funnel, mast
ACC_X0, ACC_X1 = -11.3, -9.3
DECK_H, DECKS = .47, 6
BASE = deck_z(ACC_X1)


def lamp(name, mat, loc, r=.06):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=r, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def cylinder(name, mat, loc, radius, depth, scale=(1, 1, 1), verts=32, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name, obj.scale = name, scale
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


walls, lips, lit, dark, mullions, rails, stairs = (bmesh.new() for _ in range(7))
for k in range(DECKS):
    z0 = BASE + k * DECK_H
    setback = .05 * k
    length, half = ACC_X1 - ACC_X0 - setback, 1.72 - (.1 if k >= 4 else 0)
    cx = ACC_X0 + length / 2
    add_box(walls, (cx, 0, z0 + DECK_H / 2), (length, half * 2, DECK_H - .04))
    add_box(lips, (cx + .06, 0, z0 + DECK_H - .015), (length + .2, half * 2 + .22, .035))
    if k == 0:
        # deck store doors and vents at the base
        for y in (-.9, .9):
            add_box(mullions, (ACC_X0 + length + .006, y, z0 + .17), (.012, .22, .3))
        continue
    zc = z0 + DECK_H * .55
    front = ACC_X0 + length
    # individual window panes on the front and both sides, some lit
    for i in range(10):
        y = -half + .22 + i * (half * 2 - .44) / 9
        target = lit if random.random() < .35 else dark
        add_box(target, (front + .006, y, zc), (.012, .14, .16))
        add_box(mullions, (front + .012, y, zc), (.006, .17, .19))
    for side in (-1, 1):
        for i in range(8):
            x = ACC_X0 + .22 + i * (length - .45) / 7
            target = lit if random.random() < .3 else dark
            add_box(target, (x, side * (half + .006), zc), (.13, .012, .15))
            add_box(mullions, (x, side * (half + .012), zc), (.16, .006, .18))
        add_box(rails, (cx + .06, side * (half + .1), z0 + DECK_H + .1), (length + .16, .012, .012))
        add_box(rails, (cx + .06, side * (half + .1), z0 + DECK_H + .05), (length + .16, .008, .008))
        # external stair flight down to the deck below, alternating fore/aft
        sx = ACC_X0 + (.35 if k % 2 else length - .6)
        add_rod(stairs, (sx, side * (half + .14), z0), (sx + (.4 if k % 2 else -.4), side * (half + .14), z0 + DECK_H - .04), .05)
    add_box(rails, (front + .15, 0, z0 + DECK_H + .1), (.012, half * 2 + .2, .012))
# bridge: full-width wheelhouse, raked windows, open wings with consoles
BZ = BASE + DECKS * DECK_H
add_box(walls, (ACC_X1 - .72, 0, BZ + .27), (1.25, 3.44, .54))
add_box(lips, (ACC_X1 - .66, 0, BZ + .555), (1.45, 3.6, .05))
add_box(lips, (ACC_X1 - .02, 0, BZ + .5), (.18, 3.5, .03))  # sun visor
for side in (-1, 1):
    add_box(lips, (ACC_X1 - .6, side * 2.25, BZ + .02), (.95, 1.25, .045))
    add_box(walls, (ACC_X1 - .52, side * 2.72, BZ + .2), (.45, .32, .38))
    add_box(lit, (ACC_X1 - .29, side * 2.72, BZ + .24), (.012, .26, .16))
    add_box(rails, (ACC_X1 - .6, side * 2.87, BZ + .26), (.95, .012, .012))
    add_box(rails, (ACC_X1 - .14, side * 2.25, BZ + .26), (.012, 1.25, .012))
    for i in range(3):
        add_box(mullions, (ACC_X1 - .95 + i * .35, side * 2.2, BZ - .14), (.03, .9, .03))
bglass = bmesh.new()
for i in range(8):
    y = -1.5 + i * 3 / 7
    geom = add_box(bglass, (0, 0, 0), (.02, .36, .28))
    bmesh.ops.rotate(bglass, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-14), 3, "Y"))
    bmesh.ops.translate(bglass, verts=geom["verts"], vec=(ACC_X1 - .09, y, BZ + .3))
mesh_object("BridgeGlass", bglass, [M["glass"]])
bevel(mesh_object("Accommodation", walls, [M["white"]], uv_scale=.9), .02)
mesh_object("DeckLips", lips, [M["white"]], uv_scale=.9)
mesh_object("CabinWindows", lit, [M["window"]])
mesh_object("CabinWindowsDark", dark, [M["windowDark"]])
mesh_object("Mullions", mullions, [M["steel"]])
mesh_object("DeckRails", rails, [M["white"]])
mesh_object("Stairs", stairs, [M["steel"]])

# lifeboats on gravity davits, both sides, and life-raft canisters on the boat deck
LB_Z = BASE + 2 * DECK_H + .1
for side in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1, location=(ACC_X0 + .9, side * 2.05, LB_Z))
    boat = bpy.context.active_object
    boat.name, boat.scale = f"Lifeboat{side}", (.55, .17, .14)
    boat.data.materials.append(M["orange"])
    bpy.ops.object.shade_smooth()
    cylinder(f"LifeboatCanopy{side}", M["white"], (ACC_X0 + .9, side * 2.05, LB_Z + .1), .1, .7, (1, 1.3, 1), 16, (0, math.radians(90), 0))
    bm = bmesh.new()
    for dx in (-.4, .4):
        add_rod(bm, (ACC_X0 + .9 + dx, side * 1.72, LB_Z - .25), (ACC_X0 + .9 + dx, side * 2.12, LB_Z + .32), .04)
        add_rod(bm, (ACC_X0 + .9 + dx, side * 2.12, LB_Z + .32), (ACC_X0 + .9 + dx, side * 2.05, LB_Z + .1), .012)
    mesh_object(f"Davits{side}", bm, [M["dark"]])
    for i in range(3):
        cylinder(f"LifeRaft{side}{i}", M["white"], (ACC_X1 - .5 - i * .22, side * 1.85, BASE + 4 * DECK_H + .12), .07, .2, verts=12, rot=(math.pi / 2, 0, 0))

# funnel: elliptical stack, black top, neon company band, twin exhausts and a grille
FUN_X = ACC_X0 + .05
cylinder("Funnel", M["white"], (FUN_X, 0, BZ + .55), .62, 2.2, (1.15, .78, 1))
cylinder("FunnelCap", M["dark"], (FUN_X, 0, BZ + 1.55), .64, .4, (1.17, .8, 1))
cylinder("NeonFunnel", M["funnel"], (FUN_X, 0, BZ + 1.1), .63, .2, (1.16, .79, 1))
for y in (-.22, .22):
    cylinder("Exhaust", M["steel"], (FUN_X - .12, y, BZ + 2.0), .09, .55, verts=16)
    cylinder("ExhaustLip", M["dark"], (FUN_X - .12, y, BZ + 2.27), .1, .03, verts=16)
cylinder("Uptake", M["steel"], (FUN_X + .25, 0, BZ + 1.85), .06, .35, verts=12)
bm = bmesh.new()
add_box(bm, (FUN_X + .1, 0, BZ - .2), (1.2, 1.5, .7))
for i in range(6):
    add_box(bm, (FUN_X + .71, -.5 + i * .2, BZ - .2), (.01, .12, .4))  # louvres
bevel(mesh_object("FunnelCasing", bm, [M["white"]], uv_scale=.9), .03)

# mast: lattice tower with yards, two radars, VSAT domes, antennas, horn, searchlights
mast_x = ACC_X1 - .75
bm = bmesh.new()
for dx in (-.05, .05):
    for dy in (-.05, .05):
        add_box(bm, (mast_x + dx, dy, BZ + 1.05), (.022, .022, 1.0))
for h in np.linspace(.6, 1.5, 6):
    add_box(bm, (mast_x, 0, BZ + h), (.12, .12, .012))
add_box(bm, (mast_x, 0, BZ + 1.25), (.05, 1.4, .04))
add_box(bm, (mast_x + .12, 0, BZ + .95), (.04, 1.0, .03))
for y in (-.65, .65):
    add_box(bm, (mast_x, y, BZ + 1.4), (.012, .012, .3))     # whip antennas
add_box(bm, (mast_x - .35, 0, BZ + .75), (.012, .012, .5))
mesh_object("Mast", bm, [M["steel"]])
bm = bmesh.new()
add_box(bm, (0, 0, 0), (.1, 1.05, .05))
radar = mesh_object("Radar", bm, [M["white"]])
radar.location = (mast_x, 0, BZ + 1.62)
bm = bmesh.new()
add_box(bm, (0, 0, 0), (.08, .75, .04))
mesh_object("Radar2", bm, [M["white"]]).location = (mast_x + .12, 0, BZ + 1.0)
for y in (-.5, .5):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=.11, location=(mast_x - .25, y, BZ + .7))
    dome = bpy.context.active_object
    dome.name = "VSAT"
    dome.data.materials.append(M["white"])
    bpy.ops.object.shade_smooth()
lamp("LightPort", M["red"], (ACC_X1 - .5, -2.9, BZ + .35))
lamp("LightStarboard", M["green"], (ACC_X1 - .5, 2.9, BZ + .35))
lamp("LightMast", M["lamp"], (mast_x, 0, BZ + 1.6), .05)
lamp("LightSearch", M["lamp"], (ACC_X1 - .1, -1.6, BZ + .62), .04)

# stern: mooring deck with winches, bollards, fairleads, flag staff, free-fall lifeboat
SZ = deck_z(X0 + .4)
bm = bmesh.new()
for y in (-1.05, 1.05):
    add_box(bm, (X0 + .9, y, SZ + .12), (.36, .36, .24))
    add_cyl(bm, (X0 + .9, y, SZ + .3), .14, .3, 14, axis="Y")
for x, y in ((X0 + .35, -1.55), (X0 + .35, 1.55), (X0 + 1.5, -1.9), (X0 + 1.5, 1.9)):
    add_cyl(bm, (x, y - .07, SZ + .1), .045, .2, 10)
    add_cyl(bm, (x, y + .07, SZ + .1), .045, .2, 10)
add_box(bm, (X0 - .05, 0, SZ + .7), (.035, .035, 1.4))
mesh_object("SternGear", bm, [M["steel"]])
bm = bmesh.new()
add_box(bm, (X0 - .32, 0, SZ + 1.22), (.5, .01, .3))
mesh_object("SternFlag", bm, [M["neon"]])
lamp("LightStern", M["lamp"], (X0 - .05, 0, SZ + 1.45), .05)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(X0 + .55, -.9, SZ + .95))
boat = bpy.context.active_object
boat.name, boat.scale, boat.rotation_euler = "FreeFallBoat", (.72, .22, .2), (0, math.radians(-24), 0)
boat.data.materials.append(M["orange"])
bpy.ops.object.shade_smooth()
cylinder("FreeFallCanopy", M["white"], (X0 + .62, -.9, SZ + 1.1), .14, .5, (1, 1.2, 1), 24, (0, math.radians(66), 0))
bm = bmesh.new()
for y in (-1.12, -.68):
    geom = add_box(bm, (0, 0, 0), (1.5, .05, .06))
    bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-24), 3, "Y"))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(X0 + .55, y, SZ + .72))
    add_box(bm, (X0 + 1.15, y, SZ + .55), (.06, .06, 1.1))
mesh_object("LifeboatRamp", bm, [M["dark"]])
bm = bmesh.new()
add_box(bm, (X0 - .58, 0, SZ - .12), (.012, (hull_half(X0) - .02) * 1.7, .03))
mesh_object("NeonTransom", bm, [M["neon"]])

# ================================================================ forecastle
FX = CARGO_START + BAYS * BAY_PITCH + .1
bm = bmesh.new()
pts = []
for i in range(25):
    x = FX + (L / 2 + .8 - FX) * i / 24
    pts.append((x, hull_half(x) - .05))
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    if ya > .05:
        add_box(bm, ((xa + xb) / 2, 0, deck_z((xa + xb) / 2) + .16), (xb - xa + .02, 2 * min(ya, yb), .32))
mesh_object("Forecastle", bm, [M["deck"]], uv_scale=.35)
# bulwark: a solid wall following the hull edge around the bow, pierced by mooring chocks
bm = bmesh.new()
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    if ya < .05:
        continue
    for side in (-1, 1):
        mid = Vector(((xa + xb) / 2, side * (ya + yb) / 2, deck_z((xa + xb) / 2) + .32 + .14))
        length = math.hypot(xb - xa, yb - ya)
        add_box(bm, mid, (length + .02, .035, .28), rot_z=side * math.atan2(yb - ya, xb - xa))
mesh_object("Bulwark", bm, [M["bulwark"]], uv_scale=.6)
bm = bmesh.new()
for x in (FX + 1.0, FX + 2.4):
    for side in (-1, 1):
        y = side * (hull_half(x) - .02)
        add_box(bm, (x, y, deck_z(x) + .48), (.16, .05, .08))       # chock opening frame
bm2 = bmesh.new()
for side in (-1, 1):
    add_box(bm2, (FX + .45, side * 1.05, deck_z(FX) + .55), (.05, 2.4, .8), rot_z=side * math.radians(-18))
    for k in range(4):
        add_box(bm2, (FX + .25, side * (.35 + k * .45), deck_z(FX) + .45), (.35, .03, .6), rot_z=side * math.radians(-18))  # gussets
bevel(mesh_object("Breakwater", bm2, [M["white"]], uv_scale=.9), .015)
# windlasses with chain gypsies, chain pipes, mooring winches, bollards, fore mast
for side in (-1, 1):
    x = L / 2 - 2.2
    add_box(bm, (x, side * .7, deck_z(x) + .5), (.4, .3, .26))
    add_cyl(bm, (x, side * .7, deck_z(x) + .66), .16, .2, 16, axis="Y")
    add_rod(bm, (x + .15, side * .7, deck_z(x) + .42), (L / 2 - 1.3, side * (hull_half(L / 2 - 1.3) - .1), deck_z(L / 2 - 1.3) + .34), .08)
    for x2 in (FX + 1.4, FX + 2.6):
        add_box(bm, (x2, side * .8, deck_z(x2) + .46), (.3, .28, .22))
        add_cyl(bm, (x2, side * .8, deck_z(x2) + .62), .13, .34, 14, axis="Y")
        add_cyl(bm, (x2 + .5, side * 1.25, deck_z(x2) + .42), .045, .18, 10)
        add_cyl(bm, (x2 + .62, side * 1.25, deck_z(x2) + .42), .045, .18, 10)
add_box(bm, (L / 2 - .6, 0, deck_z(L / 2) + 1.1), (.08, .08, 1.5))
add_box(bm, (L / 2 - .6, 0, deck_z(L / 2) + 1.55), (.04, .5, .03))
mesh_object("ForeDeckGear", bm, [M["steel"]])
lamp("LightFore", M["lamp"], (L / 2 - .6, 0, deck_z(L / 2) + 1.9), .05)
# anchors stowed in their pockets, both sides
bm = bmesh.new()
for side in (-1, 1):
    x = L / 2 - 1.3
    y = side * (hull_half(x) + .02)
    z = deck_z(x) - .5
    add_box(bm, (x, y, z + .05), (.08, .06, .34))                          # shank
    add_box(bm, (x, y, z - .14), (.3, .07, .08))                           # crown
    for dx in (-.13, .13):
        add_box(bm, (x + dx, y, z - .06), (.06, .07, .2), rot_y=math.radians(25 if dx > 0 else -25))  # flukes
mesh_object("Anchors", bm, [M["dark"]])
bm = bmesh.new()
for side in (-1, 1):
    x = L / 2 - 1.3
    add_box(bm, (x, side * (hull_half(x) + .004), deck_z(x) - .45), (.5, .02, .45))
mesh_object("AnchorPockets", bm, [M["rubber"]])

# accommodation ladder stowed along the camera-side hull, by the superstructure
bm = bmesh.new()
add_box(bm, (ACC_X1 + 1.6, -(B / 2 + .045), -.32), (2.2, .05, .12))
for i in range(12):
    add_box(bm, (ACC_X1 + .6 + i * .18, -(B / 2 + .07), -.32), (.02, .02, .12))
mesh_object("AccommodationLadder", bm, [M["steel"]])

# railings along the main deck
bm = bmesh.new()
x = CARGO_START - .2
while x < FX:
    for side in (-1, 1):
        add_box(bm, (x, side * (hull_half(x) - .06), deck_z(x) + .14), (.016, .016, .28))
    x += .4
for side in (-1, 1):
    segs = 40
    for i in range(segs):
        xa = CARGO_START - .2 + (FX - CARGO_START + .2) * i / segs
        xb = CARGO_START - .2 + (FX - CARGO_START + .2) * (i + 1) / segs
        for h in (.27, .14):
            ya, yb = side * (hull_half(xa) - .06), side * (hull_half(xb) - .06)
            mid = Vector(((xa + xb) / 2, (ya + yb) / 2, deck_z((xa + xb) / 2) + h))
            length = math.hypot(xb - xa, yb - ya)
            add_box(bm, mid, (length + .01, .014, .014), rot_z=math.atan2(yb - ya, xb - xa))
mesh_object("Railing", bm, [M["white"]])

# hull-side name board (camera side, flat midbody): the browser paints the market or stock name
HN_X0, HN_X1, HN_Z0, HN_Z1 = -8.6, 5.0, -1.0, -.18
hn = bpy.data.meshes.new("HullName")
hy = -(B / 2) - .006
hn.from_pydata([(HN_X0, hy, HN_Z0), (HN_X1, hy, HN_Z0), (HN_X1, hy, HN_Z1), (HN_X0, hy, HN_Z1)], [], [(0, 1, 2, 3)])
uvl = hn.uv_layers.new(name="UVMap")
for loop, coord in zip(uvl.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
    loop.uv = coord
hn.materials.append(material("HullNameBoard", (.02, .02, .03), .4, 0.))
link(bpy.data.objects.new("HullName", hn))

# ================================================================ apply modifiers, export
for obj in list(scene.objects):
    if obj.type == "MESH" and obj.modifiers:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception as error:
                print("modifier", obj.name, mod.name, error)

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == "MESH")
print("triangles (instances counted)", tris)
export = dict(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
for fmt in ("WEBP", "JPEG", "AUTO"):
    try:
        bpy.ops.export_scene.gltf(**export, export_image_format=fmt)
        print("exported", OUT, fmt)
        break
    except (TypeError, RuntimeError) as error:
        print("export", fmt, error)

if PREVIEW:
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = link(bpy.data.objects.new("cam", cam_data))
    cam.location = (3, -36, 6.5)
    cam.rotation_euler = (math.radians(82), 0, math.radians(4.5))
    scene.camera = cam
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.05, .045, .08, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.
    scene.world = world
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1800, 700
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("preview", PREVIEW)
