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
HW, HULL_ROWS, TRANSOM_ROWS = 4096, 512, 128
HH = HULL_ROWS + TRANSOM_ROWS   # top band: the transom (512 x 128 px), painted separately
TRANSOM_W = 512


def hull_px(x, z):
    return (x - HULL_U0) / (HULL_U1 - HULL_U0) * HW, TRANSOM_ROWS + (1 - (z - HULL_V0) / (HULL_V1 - HULL_V0)) * HULL_ROWS


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
    hull[:, px:px + 2] *= .93
    hull_height[:, px - 1:px + 3] += np.array([.2, .5, .5, .2])[None, :]
for z in (-.32, -.78, -1.45):
    py = int(hull_px(0, z)[1])
    hull[py:py + 2] *= .92
    hull_height[py - 1:py + 3] += np.array([.2, .5, .5, .2])[:, None]
# slight plate "hungry horse" dishing between frames
frames = (np.cos((np.arange(HW) / HW * (HULL_U1 - HULL_U0)) / .62 * 2 * math.pi) * .5 + .5)
hull_height += frames[None, :] * .35
# touch-up paint patches: slightly different blue-black rectangles
for _ in range(70):
    w, h = RNG.uniform(30, 260), RNG.uniform(10, 50)
    x, y = RNG.uniform(0, HW), RNG.uniform(TRANSOM_ROWS + 10, boot_row - 8 - h)
    patch = hull[int(y):int(y + h), int(x):int(x + w)]
    patch[:] = patch * .8 + srgb_to_linear((.1, .22, .52)) * RNG.uniform(.85, 1.1) * .2
# rust runs from deck-edge scuppers, hawse pipe and stern chocks
deck_row = int(hull_px(0, -.05)[1])
rust_streaks(hull, 110, (0, HW), (deck_row - 4, deck_row + 12), (30, 190), (2, 5), strength=.45)
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
# transom: name and port of registry in white, seams, rust weeping from the chocks
tr = srgb_to_linear((.1, .22, .52)) * (.85 + .3 * fbm(TRANSOM_ROWS, TRANSOM_W, 2, 5, 4))[..., None]
for k in range(64, TRANSOM_W, 64):
    tr[:, k:k + 2] *= .93
tr[TRANSOM_ROWS - 22:TRANSOM_ROWS - 20] *= .92
text(tr, "PULSE LINE", (TRANSOM_W - 10 * 6 * 5) // 2, 46, 5, white)
text(tr, "BUSAN", (TRANSOM_W - 5 * 6 * 3) // 2, 92, 3, white)
rust_streaks(tr, 18, (20, TRANSOM_W - 20), (2, 8), (20, 90), (1.5, 3.5), strength=.6)
tr *= (1 - fbm(TRANSOM_ROWS, TRANSOM_W, 1, 3, 20) ** 2 * .2)[..., None]
hull[:TRANSOM_ROWS, :TRANSOM_W] = tr
IMG_HULL = to_image("HullPlating", hull ** (1 / 2.2))
IMG_HULL_N = to_image("HullPlatingNormal", normal_from_height(hull_height, 1.6), True)


# --- tiling paints (box-projected UVs, 1 tile per TILE units)
def tiled(name, color, size=1024, seams=8, rust=.0, streaks=.0, drips=0, normal=1.2, seam_dark=.78):
    img = np.ones((size, size, 3)) * srgb_to_linear(color)[None, None, :]
    img *= (.86 + .25 * fbm(size, size, 4, 6))[..., None]
    height = np.zeros((size, size))
    step = size // seams
    for k in range(0, size, step):
        img[k:k + 2] *= seam_dark
        img[:, k:k + 2] *= seam_dark + .02
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
IMG_WHITE = tiled("SuperstructurePaint", (.88, .89, .89), seams=2, drips=30, streaks=.12, normal=.6, seam_dark=.93)
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
    "bulwark": material("BulwarkPaint", (.01, .045, .25), .5, .3),
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


def mesh_object(name, bm, mats, smooth=False, uv_scale=.5, uv=True):
    """uv=False for untextured or hairline parts: the web merge fills a zero UV, and the GLB stays lean."""
    bm.normal_update()
    if uv:
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


def drop_end_caps(bm, geom, axis):
    """Hairline bars and rods never show their end faces: dropping them saves a third of the vertices."""
    axis = axis.normalized()
    faces = {f for v in geom["verts"] for f in v.link_faces}
    for f in faces:
        f.normal_update()
    caps = [f for f in faces if abs(f.normal.dot(axis)) > .9]
    bmesh.ops.delete(bm, geom=caps, context="FACES_ONLY")


def add_box(bm, center, size, mat_index=0, rot_z=0., rot_y=0., slim=False):
    rot = Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_y, 4, "Y")
    m = Matrix.Translation(Vector(center)) @ rot @ Matrix.Diagonal((*size, 1))
    geom = bmesh.ops.create_cube(bm, size=1., matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
    if slim:
        long = max(range(3), key=lambda i: size[i])
        drop_end_caps(bm, geom, rot.to_3x3() @ Vector([1. if i == long else 0. for i in range(3)]))
    return geom


def add_panel(bm, center, axis, sign, w, h, mat_index=0):
    """One outward-facing quad on a wall (windows, frames): a box would hide five of its six faces."""
    cx, cy, cz = center
    if axis == "x":
        pts = [(cx, cy - w / 2, cz - h / 2), (cx, cy + w / 2, cz - h / 2), (cx, cy + w / 2, cz + h / 2), (cx, cy - w / 2, cz + h / 2)]
        flip = sign < 0
    else:
        pts = [(cx - w / 2, cy, cz - h / 2), (cx + w / 2, cy, cz - h / 2), (cx + w / 2, cy, cz + h / 2), (cx - w / 2, cy, cz + h / 2)]
        flip = sign > 0
    verts = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(list(reversed(verts)) if flip else verts)
    f.material_index = mat_index
    return f


def add_cyl(bm, center, radius, depth, segs=12, mat_index=0, axis="Z"):
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    m = Matrix.Translation(Vector(center)) @ rot
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=depth, matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
        f.smooth = len(f.verts) == 4
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
    if length > thick * 3:
        drop_end_caps(bm, geom, d)


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
    return ((co.x - HULL_U0) / (HULL_U1 - HULL_U0), (co.z - HULL_V0) / (HULL_V1 - HULL_V0) * HULL_ROWS / HH)


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
    ys, zs = [v.co.y for v in rows[0]], [v.co.z for v in rows[0]]
    tw, zt, zb = max(abs(y) for y in ys), max(zs), min(zs)
    for loop in stern.loops:
        co = loop.vert.co
        # viewed from astern the ship's port side (+Y) is on the left
        loop[uv].uv = ((tw - co.y) / (2 * tw) * TRANSOM_W / HW, 1 - (zt - co.z) / (zt - zb) * TRANSOM_ROWS / HH)
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
            add_box(lash, (lx, y, HATCH_TOP + dz + .55), (.045, .045, 1.1), slim=True)
        for h in (.45, 1.0):
            add_box(lash, (lx, 0, HATCH_TOP + dz + h), (.16, span * 2 + .1, .025))  # walkways
            for side in (-1, 1):
                add_box(lash, (lx + side * .08, 0, HATCH_TOP + dz + h + .12), (.01, span * 2 + .1, .01), slim=True)
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
mesh_object("Lashing", lash, [M["dark"]], uv=False)
mesh_object("LogoCastings", logo_castings, [M["dark"]], uv=False)
mesh_object("LightFloods", floods, [M["flood"]], uv=False)

# ================================================================ accommodation, funnel, mast
# A feeder's aft house as built: a wide three-deck base (stores, engine casing, mess rooms) under a
# slim tower of cabins, a full-beam wheelhouse with enclosed wings on brackets, external stair
# flights and landings on the tower's aft face, the funnel standing on the base roof right behind
# the tower, and the mooring deck under it at the stern with a free-fall lifeboat over the transom.
ACC_X1 = -9.3              # front face, flush on every deck
BASE_AFT = -11.6           # aft face of the base decks
TOWER_AFT = -10.85         # aft face of the cabin tower
DECK_H, DECKS, BASE_DECKS = .47, 7, 3
BASE = deck_z(ACC_X1)
BASE_HALF, TOWER_HALF, WING_HALF = 2.05, 1.72, B / 2 + .06
ROOF = BASE + BASE_DECKS * DECK_H      # base roof: the open deck around the tower
BZ = BASE + DECKS * DECK_H             # wheelhouse floor


def lamp(name, mat, loc, r=.06):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=r, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def rrect(cx, cy, hx, hy, r, n=4):
    pts = []
    for sx, sy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (hx - r), cy + sy * (hy - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def loft(bm, sections, mat_index=0, cap_top=True):
    """Rounded-rectangle rings (z, cx, cy, hx, hy, r) joined bottom to top: funnels and casings."""
    rings = [[bm.verts.new((x, y, z)) for x, y in rrect(cx, cy, hx, hy, r)] for z, cx, cy, hx, hy, r in sections]
    faces = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        faces += [bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j])) for j in range(n)]
    if cap_top:
        faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = mat_index
        f.smooth = len(f.verts) == 4
    return faces


def lerp_section(a, b, z):
    t = (z - a[0]) / (b[0] - a[0])
    return tuple(p + (q - p) * t for p, q in zip(a, b))


def capsule_boat(bm, center, length, beam, depth, canopy, pitch=0., n=14, segs=18):
    """An enclosed lifeboat: rounded hull below the gunwale, a lower canopy above it, bluff ends."""
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(pitch, 4, "Y")
    rings = []
    for i in range(n + 1):
        t = .04 + .92 * i / n
        s = math.sin(math.pi * t) ** .42
        ring = []
        for j in range(segs):
            th = 2 * math.pi * j / segs
            c, sn = math.cos(th), math.sin(th)
            z = (canopy * sn * s ** .5) if sn > 0 else (depth * sn * s ** .8)
            ring.append(bm.verts.new(m @ Vector(((t - .5) * length, beam / 2 * s * c, z))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(segs):
            f = bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
            f.smooth = True
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


def railing(bm, pts, z_at, height=.12, post=.2):
    """Two-course handrail on stanchions along a polyline of (x, y); z_at(x, y) is the deck below."""
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        length = math.hypot(xb - xa, yb - ya)
        if length < 1e-4:
            continue
        ang, mx, my = math.atan2(yb - ya, xb - xa), (xa + xb) / 2, (ya + yb) / 2
        for h, t in ((height, .014), (height * .5, .008)):
            add_box(bm, (mx, my, z_at(mx, my) + h), (length + .012, t, t), rot_z=ang, slim=True)
        steps = max(1, round(length / post))
        for i in range(steps + 1):
            x, y = xa + (xb - xa) * i / steps, ya + (yb - ya) * i / steps
            add_box(bm, (x, y, z_at(x, y) + height / 2), (.011, .011, height), slim=True)


def stair(bm, a, b, width=.11):
    """A ship's stair flight: two stringers, open treads and a handrail each side."""
    a, b = Vector(a), Vector(b)
    d = b - a
    run = Vector((d.x, d.y, 0))
    side = Vector((-run.y, run.x, 0)).normalized() * (width / 2)
    up = Vector((0, 0, .1))
    for s in (-1, 1):
        add_rod(bm, a + side * s, b + side * s, .014)
        add_rod(bm, a + side * s + up, b + side * s + up, .008)
        add_box(bm, b + side * s + up / 2, (.008, .008, .1))
    steps = max(4, int(d.z / .05))
    ang = math.atan2(run.y, run.x)
    for i in range(1, steps):
        add_box(bm, a + d * (i / steps), (.028, width, .006), rot_z=ang, slim=True)


walls, lips, lit, dark, mullions, rails, stairs, gear, dark_parts = (bmesh.new() for _ in range(9))


def windows(axis, plane, sign, a0, a1, count, zc, lit_p=.32, w=.12, h=.15, gap=None):
    """Framed windows on a wall facing sign*axis; `gap` keeps a (lo, hi) span clear."""
    for i in range(count):
        a = a0 + (a1 - a0) * (i + .5) / count
        if gap and gap[0] < a < gap[1]:
            continue
        target = lit if random.random() < lit_p else dark
        if axis == "x":
            add_panel(target, (plane + sign * .008, a, zc), "x", sign, w, h)
            add_panel(mullions, (plane + sign * .003, a, zc), "x", sign, w + .028, h + .028)
        else:
            add_panel(target, (a, plane + sign * .008, zc), "y", sign, w, h)
            add_panel(mullions, (a, plane + sign * .003, zc), "y", sign, w + .028, h + .028)


def door(axis, plane, sign, a, z0):
    size = (.01, .15, .3) if axis == "x" else (.15, .01, .3)
    frame = (.01, .18, .33) if axis == "x" else (.18, .01, .33)
    c = (plane + sign * .005, a, z0 + .17) if axis == "x" else (a, plane + sign * .005, z0 + .17)
    cf = (plane + sign * .002, a, z0 + .175) if axis == "x" else (a, plane + sign * .002, z0 + .175)
    add_box(gear, c, size)
    add_box(mullions, cf, frame)


for k in range(DECKS):
    z0 = BASE + k * DECK_H
    base_deck = k < BASE_DECKS
    x0, half = (BASE_AFT, BASE_HALF) if base_deck else (TOWER_AFT, TOWER_HALF)
    length, cx = ACC_X1 - x0, (ACC_X1 + x0) / 2
    add_box(walls, (cx, 0, z0 + DECK_H / 2), (length, half * 2, DECK_H))
    add_box(lips, (cx, 0, z0 + DECK_H - .012), (length + .03, half * 2 + .03, .024))   # deck line / gutter
    zc = z0 + DECK_H * .56
    if k == 0:
        # stores and engine-room doors, ventilation louvres
        for y in (-1.2, 1.2):
            door("x", ACC_X1, 1, y, z0)
            door("x", BASE_AFT, -1, y, z0)
        for s in (-1, 1):
            door("y", s * half, s, ACC_X1 - .5, z0)
            for i in range(3):
                add_box(dark_parts, (BASE_AFT + .35 + i * .3, s * (half + .004), z0 + .26), (.22, .008, .16))
        continue
    gap = (-.78, .78) if not base_deck else None
    windows("x", ACC_X1, 1, -half + .1, half - .1, int(half * 2 / .3), zc)
    windows("x", x0, -1, -half + .1, half - .1, int(half * 2 / .32), zc, gap=gap)
    for s in (-1, 1):
        windows("y", s * half, s, x0 + .1, ACC_X1 - .1, int(length / .3), zc)

# open deck on the base roof around the tower, with its railing
railing(rails, [(ACC_X1 - .02, -BASE_HALF + .03), (BASE_AFT + .03, -BASE_HALF + .03), (BASE_AFT + .03, BASE_HALF - .03), (ACC_X1 - .02, BASE_HALF - .03)], lambda x, y: ROOF)
for s in (-1, 1):
    # aft landings on the tower with stair flights between them, zig-zagging up each side
    for k in range(BASE_DECKS + 1, DECKS + 1):
        z = BASE + k * DECK_H
        add_box(lips, (TOWER_AFT - .08, s * 1.22, z - .012), (.16, 1.0, .024))
        railing(rails, [(TOWER_AFT, s * .72), (TOWER_AFT - .155, s * .72), (TOWER_AFT - .155, s * 1.72)], lambda x, y, z=z: z)
    for k in range(BASE_DECKS, DECKS):
        z = BASE + k * DECK_H
        ya, yb = (.86, 1.62) if k % 2 else (1.62, .86)
        stair(stairs, (TOWER_AFT - .08, s * ya, z), (TOWER_AFT - .08, s * yb, z + DECK_H))
    # flights up the base's aft face from the mooring deck to the roof, with landings
    for k in range(BASE_DECKS):
        za = deck_z(BASE_AFT) if k == 0 else BASE + k * DECK_H
        ya, yb = (1.15, 1.9) if k % 2 == 0 else (1.9, 1.15)
        stair(stairs, (BASE_AFT - .09, s * ya, za), (BASE_AFT - .09, s * yb, BASE + (k + 1) * DECK_H))
        if k < BASE_DECKS - 1:
            z = BASE + (k + 1) * DECK_H
            add_box(lips, (BASE_AFT - .08, s * 1.55, z - .012), (.16, .95, .024))
            railing(rails, [(BASE_AFT, s * 1.08), (BASE_AFT - .155, s * 1.08), (BASE_AFT - .155, s * 2.02)], lambda x, y, z=z: z)

# wheelhouse: full width, enclosed wings out to the ship's side on brackets, raked windows, sun visor
WH_X0 = TOWER_AFT + .04
add_box(walls, ((WH_X0 + ACC_X1 + .05) / 2, 0, BZ + .27), (ACC_X1 + .05 - WH_X0, TOWER_HALF * 2, .54))
for s in (-1, 1):
    wing = WING_HALF - TOWER_HALF
    add_box(walls, (ACC_X1 - .22, s * (TOWER_HALF + wing / 2), BZ + .27), (.54, wing, .54))
    for xx in (ACC_X1 - .44, ACC_X1 - .02):
        add_rod(gear, (xx, s * TOWER_HALF, BZ - .42), (xx, s * (WING_HALF - .06), BZ - .015), .035)
    add_box(gear, (ACC_X1 - .22, s * (TOWER_HALF + wing / 2), BZ - .02), (.5, wing, .03))
    windows("y", s * WING_HALF, s, ACC_X1 - .44, ACC_X1, 2, BZ + .3, lit_p=.5, w=.15, h=.2)
    windows("x", ACC_X1 - .49, -1, s * (TOWER_HALF + .05), s * (WING_HALF - .05), 2, BZ + .3, lit_p=.5, w=.15, h=.2)
    windows("y", s * TOWER_HALF, s, WH_X0 + .1, ACC_X1 - .55, 3, BZ + .3, lit_p=.6, w=.16, h=.2)
    add_box(gear, (ACC_X1 - .05, s * (WING_HALF + .01), BZ + .5), (.06, .02, .06))   # side-light screen
bglass = bmesh.new()
panes = 15
for i in range(panes):
    y = -WING_HALF + .12 + i * (2 * WING_HALF - .24) / (panes - 1)
    geom = add_box(bglass, (0, 0, 0), (.02, (2 * WING_HALF - .24) / (panes - 1) - .03, .26))
    bmesh.ops.rotate(bglass, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-14), 3, "Y"))
    bmesh.ops.translate(bglass, verts=geom["verts"], vec=(ACC_X1 + .07, y, BZ + .3))
mesh_object("BridgeGlass", bglass, [M["glass"]], uv=False)
add_box(lips, (ACC_X1 + .1, 0, BZ + .49), (.16, WING_HALF * 2 + .02, .025))          # sun visor
add_box(lips, ((WH_X0 + ACC_X1) / 2 + .02, 0, BZ + .555), (ACC_X1 - WH_X0 + .12, TOWER_HALF * 2 + .06, .03))
for s in (-1, 1):
    add_box(lips, (ACC_X1 - .22, s * (TOWER_HALF + (WING_HALF - TOWER_HALF) / 2), BZ + .555), (.6, WING_HALF - TOWER_HALF + .04, .03))
# monkey island: railing, a lattice-topped mast with yard, radars, satcom domes, horn, searchlights
railing(rails, [(ACC_X1, -TOWER_HALF), (WH_X0, -TOWER_HALF), (WH_X0, TOWER_HALF), (ACC_X1, TOWER_HALF), (ACC_X1, -TOWER_HALF)], lambda x, y: BZ + .57, height=.1)
MAST_X = ACC_X1 - .72
for dx in (-.05, .05):
    for dy in (-.05, .05):
        add_rod(gear, (MAST_X + dx * 1.6, dy * 1.6, BZ + .57), (MAST_X + dx, dy, BZ + 1.5), .022)
for h in np.linspace(.75, 1.45, 5):
    add_box(gear, (MAST_X, 0, BZ + h), (.13, .13, .01))
add_box(gear, (MAST_X, 0, BZ + 1.3), (.04, 1.3, .035))             # signal yard
add_box(gear, (MAST_X, 0, BZ + 1.5), (.22, .22, .02))              # radar platform
add_box(gear, (MAST_X, 0, BZ + 1.555), (.07, .07, .09))            # scanner turning unit
for y in (-.62, .62):
    add_box(gear, (MAST_X, y, BZ + 1.42), (.01, .01, .24))          # signal lights / whips
add_box(gear, (MAST_X + .55, 0, BZ + .66), (.12, .12, .18))        # forward radar pedestal
add_box(gear, (MAST_X - .45, 0, BZ + .78), (.008, .008, .42))      # whip antenna
for y in (-1.25, 1.25):
    add_cyl(gear, (WH_X0 + .25, y, BZ + .65), .05, .16, 10)          # satcom pedestals
add_box(gear, (ACC_X1 - .05, -.9, BZ + .62), (.08, .1, .06))       # horn
mesh_object("Mast", gear, [M["steel"]])
bm = bmesh.new()
add_box(bm, (0, 0, 0), (.09, 1.05, .045))
mesh_object("Radar", bm, [M["white"]]).location = (MAST_X, 0, BZ + 1.63)
bm = bmesh.new()
add_box(bm, (0, 0, 0), (.08, .78, .04))
mesh_object("Radar2", bm, [M["white"]]).location = (MAST_X + .55, 0, BZ + .78)
for y in (-1.25, 1.25):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=.11, location=(WH_X0 + .25, y, BZ + .82))
    dome = bpy.context.active_object
    dome.name = "VSAT"
    dome.data.materials.append(M["white"])
    bpy.ops.object.shade_smooth()
# starboard (camera side, Blender -Y) green, port red
lamp("LightStarboard", M["green"], (ACC_X1 - .08, -(WING_HALF + .03), BZ + .5))
lamp("LightPort", M["red"], (ACC_X1 - .08, WING_HALF + .03, BZ + .5))
lamp("LightMast", M["lamp"], (MAST_X, 0, BZ + 1.72), .045)
lamp("LightSearch", M["lamp"], (ACC_X1 - .05, -1.4, BZ + .64), .04)

# funnel: rounded casing raked aft, soot-black top, company band, exhaust uptakes, louvred intakes
FUN_X = (BASE_AFT + TOWER_AFT) / 2
F0 = (ROOF, FUN_X + .01, 0, .36, .66, .17)
F1 = (BZ + .78, FUN_X - .13, 0, .33, .6, .16)
F2 = (BZ + 1.05, FUN_X - .17, 0, .325, .59, .16)
fb = bmesh.new()
loft(fb, [F0, F1], 0, cap_top=False)
loft(fb, [F1, F2], 1)
for s in (-1, 1):
    for i in range(7):
        add_box(fb, (FUN_X - .2 + i * .065, s * .655, ROOF + .45), (.03, .012, .3), 1)   # intake louvres
f = mesh_object("Funnel", fb, [M["white"], M["dark"]])
bm = bmesh.new()
b0, b1 = lerp_section(F0, F1, BZ + .42), lerp_section(F0, F1, BZ + .58)
loft(bm, [(b0[0], b0[1], 0, b0[3] + .008, b0[4] + .008, b0[5]), (b1[0], b1[1], 0, b1[3] + .008, b1[4] + .008, b1[5])], 0, cap_top=False)
mesh_object("NeonFunnel", bm, [M["funnel"]])
bm = bmesh.new()
top_x = F2[1]
for (dx, y, r, h) in ((-.09, -.19, .085, .3), (-.09, .19, .085, .3), (.13, -.27, .05, .22), (.13, .27, .05, .22), (.16, 0, .04, .18)):
    add_cyl(bm, (top_x + dx, y, F2[0] + h / 2 - .02), r, h, 16)
    add_cyl(bm, (top_x + dx, y, F2[0] + h - .02), r + .012, .025, 16, 1)
mesh_object("Exhausts", bm, [M["steel"], M["dark"]])
# engine-room fans and the emergency generator room on the base roof
bm = bmesh.new()
for s in (-1, 1):
    add_box(bm, (BASE_AFT + .3, s * 1.45, ROOF + .14), (.36, .3, .28))
    add_cyl(bm, (BASE_AFT + .3, s * 1.45, ROOF + .32), .09, .08, 12)
bevel(mesh_object("RoofHouses", bm, [M["white"]], uv_scale=.9), .015)

# rescue boat on a slewing davit (camera side) and life-raft canisters in cradles (both sides)
boats = bmesh.new()
capsule_boat(boats, (TOWER_AFT + .55, -(BASE_HALF - .16), ROOF + .17), .62, .24, .09, .05)
capsule_boat(boats, (BASE_AFT - .42, 0, BASE + 2 * DECK_H + .05), .95, .3, .12, .19, pitch=math.radians(-24))
bmesh.ops.recalc_face_normals(boats, faces=boats.faces)
mesh_object("Lifeboats", boats, [M["orange"]])
bm = bmesh.new()
add_cyl(bm, (TOWER_AFT - .1, -1.78, ROOF + .45), .03, .9, 10)
add_rod(bm, (TOWER_AFT - .1, -1.78, ROOF + .88), (TOWER_AFT + .55, -(BASE_HALF - .16), ROOF + .5), .03)
# free-fall launching ramp: two skid rails and an A-frame hoist off the base's aft face
for y in (-.1, .1):
    geom = add_box(bm, (0, 0, 0), (1.05, .03, .04))
    bmesh.ops.rotate(bm, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-24), 3, "Y"))
    bmesh.ops.translate(bm, verts=geom["verts"], vec=(BASE_AFT - .4, y, BASE + 2 * DECK_H - .07))
    add_rod(bm, (BASE_AFT, y * 4, BASE + 2 * DECK_H + .45), (BASE_AFT - .62, y * 4, BASE + 2 * DECK_H + .12), .03)
    add_rod(bm, (BASE_AFT - .62, y * 4, BASE + 2 * DECK_H + .12), (BASE_AFT - .7, y * 4, BASE + DECK_H * .5), .03)
add_box(bm, (BASE_AFT - .62, 0, BASE + 2 * DECK_H + .12), (.03, .44, .03))
for s in (-1, 1):
    for i in range(2):
        add_box(bm, (BASE_AFT + .25 + i * .26, s * (BASE_HALF - .15), ROOF + .04), (.2, .14, .03))   # raft cradles
mesh_object("BoatGear", bm, [M["dark"]], uv=False)
bm = bmesh.new()
for s in (-1, 1):
    for i in range(2):
        add_cyl(bm, (BASE_AFT + .25 + i * .26, s * (BASE_HALF - .15), ROOF + .11), .065, .2, 12, axis="X")
mesh_object("LifeRafts", bm, [M["white"]])

bevel(mesh_object("Accommodation", walls, [M["white"]], uv_scale=.9), .012)
mesh_object("DeckLips", lips, [M["white"]], uv_scale=.9)
mesh_object("CabinWindows", lit, [M["window"]], uv=False)
mesh_object("CabinWindowsDark", dark, [M["windowDark"]], uv=False)
mesh_object("Mullions", mullions, [M["dark"]], uv=False)
mesh_object("DeckRails", rails, [M["white"]], uv=False)
mesh_object("Stairs", stairs, [M["steel"]], uv=False)
mesh_object("HouseVents", dark_parts, [M["dark"]], uv=False)

# stern: mooring deck under the house with a bulwark round the transom, winches, bitts, fairleads
SZ = deck_z(X0 + .2)
stern_t = [t for t in TS if station(t)[0].x < BASE_AFT + .05]
edge = [station(t)[0] for t in stern_t]
pts = [(p.x, -(p.y - .03)) for p in reversed(edge)] + [(p.x, p.y - .03) for p in edge]
bm = bmesh.new()
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    length = math.hypot(xb - xa, yb - ya)
    if length < 1e-4:
        continue
    mx, my = (xa + xb) / 2, (ya + yb) / 2
    add_box(bm, (mx, my, deck_z(mx) + .13), (length + .02, .03, .26), rot_z=math.atan2(yb - ya, xb - xa))
mesh_object("SternBulwark", bm, [M["bulwark"]], uv=False)
bm = bmesh.new()
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    length = math.hypot(xb - xa, yb - ya)
    if length < 1e-4:
        continue
    mx, my = (xa + xb) / 2, (ya + yb) / 2
    add_box(bm, (mx, my, deck_z(mx) + .27), (length + .02, .06, .02), rot_z=math.atan2(yb - ya, xb - xa))  # cap rail
mesh_object("SternCapRail", bm, [M["white"]], uv=False)
bm = bmesh.new()
for s in (-1, 1):
    # mooring winch: bedplate, split drum with flanges, warping head, motor
    add_box(bm, (X0 + .05, s * 1.05, SZ + .05), (.42, .5, .1))
    add_cyl(bm, (X0 + .05, s * 1.0, SZ + .24), .13, .32, 16, axis="Y")
    for dy in (-.17, .17, 0):
        add_cyl(bm, (X0 + .05, s * 1.0 + dy, SZ + .24), .2, .025, 16, axis="Y")
    add_cyl(bm, (X0 + .05, s * 1.38, SZ + .24), .08, .14, 12, axis="Y")
    add_box(bm, (X0 + .05, s * .68, SZ + .2), (.22, .16, .2))
    # double bitts and pedestal fairleads near the quarters
    for x, y in ((X0 - .3, s * 1.2), (X0 + .25, s * 1.72)):
        for dx in (-.07, .07):
            add_cyl(bm, (x + dx, y, SZ + .1), .045, .2, 10)
            add_cyl(bm, (x + dx, y, SZ + .2), .06, .02, 10)
        add_box(bm, (x, y, SZ + .015), (.3, .12, .03))
    add_cyl(bm, (X0 - .1, s * .55, SZ + .12), .06, .14, 10)
add_box(bm, (X0 - .45, 0, SZ + .55), (.03, .03, 1.1))   # ensign staff
mesh_object("SternGear", bm, [M["steel"]])
bm = bmesh.new()
for x, y in ((X0 - .52, -.9), (X0 - .52, .9), (X0 - .1, -1.55), (X0 - .1, 1.55)):
    near = min(pts, key=lambda p: (p[0] - x) ** 2 + (abs(p[1]) - abs(y)) ** 2)
    add_box(bm, (near[0], math.copysign(abs(near[1]), y), deck_z(near[0]) + .14), (.14, .14, .09))   # panama chocks
mesh_object("SternChocks", bm, [M["dark"]], uv=False)
bm = bmesh.new()
add_box(bm, (X0 - .7, 0, SZ + .96), (.42, .01, .26))
mesh_object("SternFlag", bm, [M["neon"]])
lamp("LightStern", M["lamp"], (X0 - .45, 0, SZ + 1.14), .045)
bm = bmesh.new()
add_box(bm, (X0 - .565, 0, SZ - .045), (.012, (hull_half(X0) - .02) * 1.8, .025))
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
mesh_object("Bulwark", bm, [M["bulwark"]], uv=False)
bm = bmesh.new()
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    if ya < .05:
        continue
    for side in (-1, 1):
        mx = (xa + xb) / 2
        ang = side * math.atan2(yb - ya, xb - xa)
        length = math.hypot(xb - xa, yb - ya)
        add_box(bm, (mx, side * (ya + yb) / 2, deck_z(mx) + .32 + .29), (length + .02, .07, .02), rot_z=ang)   # cap rail
        inner = side * ((ya + yb) / 2 - .05)
        add_box(bm, (mx, inner, deck_z(mx) + .32 + .14), (.02, .07, .26), rot_z=ang)                        # stay
mesh_object("BulwarkRail", bm, [M["white"]], uv=False)
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
mesh_object("Anchors", bm, [M["dark"]], uv=False)
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
        add_box(bm, (x, side * (hull_half(x) - .06), deck_z(x) + .14), (.016, .016, .28), slim=True)
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
            add_box(bm, mid, (length + .01, .014, .014), rot_z=math.atan2(yb - ya, xb - xa), slim=True)
mesh_object("Railing", bm, [M["white"]], uv=False)

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
    # broadside (the default file), plus a stern three-quarter and a close look at the house: the views the voyage shows
    cam_data = bpy.data.cameras.new("cam")
    cam = link(bpy.data.objects.new("cam", cam_data))
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
    views = [("", 50, (3, -36, 6.5), (82, 0, 4.5), (1800, 700)),
             ("_stern", 50, (-30, -22, 12), (70, 0, -55), (1600, 1000)),
             ("_house", 50, (-19, -9, 6.5), (75, 0, -60), (1600, 1000)),
             ("_bow", 50, (24, -16, 7), (72, 0, 55), (1600, 1000)),
             ("_aft", 50, (-20, -7, 4), (75, 0, -52), (1600, 1000)),
             ("_transom", 50, (-26, 0, 1.2), (90, 0, -90), (1200, 900))]
    for suffix, lens, loc, rot, res in views:
        cam_data.lens = lens
        cam.location = loc
        cam.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = PREVIEW.replace(".png", suffix + ".png")
        bpy.ops.render.render(write_still=True)
        print("preview", scene.render.filepath)
