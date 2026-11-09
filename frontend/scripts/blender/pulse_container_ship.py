"""Procedural container ship for the pulse board.

    blender -b -P frontend/scripts/blender/pulse_container_ship.py -- <out.glb> [preview.png]

Stylised so that 20 logo containers stay legible at web scale: a 24-unit hull
carrying ten bays of 20 ft boxes. The camera-facing outer row (Blender -Y) holds
the logo containers on tiers 2 and 3, each with a separate `LogoPlate_NN` plane
(UV 0..1) that the browser paints with the stock's logo, name and change.
Named nodes the web runtime drives: LogoPlate_NN, LogoBox_NN, Radar, Neon*, Light*.
Only above-water detail is modelled with care; the web view clips at the waterline.
"""
import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "pulse-ship.glb"
PREVIEW = argv[1] if len(argv) > 1 else None
random.seed(20261109)

L, B, D = 24.0, 4.8, 1.9          # length, beam, depth (deck z=0, keel z=-D)
WATERLINE = -1.2
X0 = -L / 2

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- materials
def material(name, color, rough=.5, metal=0., emission=None, strength=0.):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


M = {
    "hull": material("HullTopside", (.018, .022, .04), .38, .55),
    "boot": material("HullBootTop", (.32, .025, .035), .55, .1),
    "deck": material("Deck", (.05, .07, .065), .85, .1),
    "steel": material("SteelGrey", (.22, .23, .25), .45, .7),
    "dark": material("DarkSteel", (.04, .042, .05), .5, .6),
    "white": material("Superstructure", (.78, .8, .82), .42, .05),
    "glass": material("BridgeGlass", (.01, .015, .03), .08, .2, (1., .78, .5), 1.4),
    "window": material("CabinWindow", (.015, .02, .03), .15, .1, (1., .82, .6), 2.2),
    "neon": material("NeonSheer", (.05, .05, .08), .3, 0., (.75, .45, 1.), 6.),
    "funnel": material("FunnelBand", (.05, .04, .08), .35, .2, (.75, .45, 1.), 3.5),
    "orange": material("LifeboatOrange", (.9, .32, .03), .45, 0.),
    "red": material("LightRed", (.4, 0, 0), .3, 0, (1, .05, .05), 18),
    "green": material("LightGreen", (0, .4, .1), .3, 0, (.05, 1, .3), 18),
    "lamp": material("LightWhite", (.6, .6, .6), .3, 0, (1, .95, .85), 14),
    "logobody": material("LogoBoxBody", (.07, .075, .1), .5, .45),
    "plate": material("LogoPlate", (.9, .9, .9), .45, 0.),
    "frame": material("PlateFrame", (.03, .03, .04), .4, .6),
}
FILLER = [material(f"Box{i}", c, .62, .35) for i, c in enumerate([
    (.04, .1, .26), (.3, .04, .05), (.03, .17, .18), (.22, .23, .25), (.52, .2, .03), (.12, .07, .2), (.36, .36, .38)])]


def link(obj):
    scene.collection.objects.link(obj)
    return obj


def mesh_object(name, bm, mats, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mat in mats:
        me.materials.append(mat)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    return link(bpy.data.objects.new(name, me))


def add_box(bm, center, size, mat_index=0, rot_z=0.):
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((*size, 1))
    geom = bmesh.ops.create_cube(bm, size=1., matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
    return geom


def bevel(obj, width=.02, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments, mod.limit_method = width, segments, "ANGLE"
    return obj


def smoothstep(a, b, x):
    t = max(0., min(1., (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- hull
def half_width(t):
    if t < .07:
        # rounded transom corners rather than a flat cut
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


Z_LEVELS = [None, -.1, -.3, -.55, -.8, -1.05, WATERLINE, -1.4, -1.6, -1.75, -1.85, -1.9]


def station(t):
    """Starboard half-section (deck edge -> keel) at length fraction t."""
    hw, dt, n = B / 2 * half_width(t), keel_depth(t), fullness(t)
    flare = .32 * smoothstep(.7, 1., t) + .18 * smoothstep(.15, 0., t)
    rake = 1.05 * smoothstep(.86, 1., t)
    pts = []
    for k, level in enumerate(Z_LEVELS):
        z = sheer(t) if level is None else max(level, -dt * .999)
        zn = min(.999, max(0., -z / dt))
        y = hw * (1 - zn ** n) ** (1 / n) * (1 - flare * zn)
        x = X0 + t * L + rake * (1 - zn) - .55 * smoothstep(.1, 0., t) * (1 - zn)
        pts.append(Vector((x, y, z)))
    pts.append(Vector((pts[-1].x, 0., -dt)))
    return pts


def build_hull():
    ts = [i / 160 for i in range(161)]
    ts = sorted(set(ts + [1 - (1 - i / 40) ** 2 * .1 for i in range(41)]))
    bm = bmesh.new()
    rows = []
    for t in ts:
        half = station(t)
        side = [Vector((p.x, -p.y, p.z)) for p in half[:-1]] + [half[-1]] + [p.copy() for p in reversed(half[:-1])]
        rows.append([bm.verts.new(p) for p in side])
    for a, b in zip(rows, rows[1:]):
        for j in range(len(a) - 1):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            zc = sum(v.co.z for v in f.verts) / 4
            f.material_index = 0 if zc > -1.05 else 1
    stern = bm.faces.new(list(reversed(rows[0])))
    stern.material_index = 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hull = mesh_object("Hull", bm, [M["hull"], M["boot"]], smooth=True)
    bpy.context.view_layer.objects.active = hull
    hull.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    except Exception as error:
        print("auto smooth", error)
    # deck plate and the neon sheer line just under the gunwale
    deck, neon = bmesh.new(), bmesh.new()
    prev = None
    for t in ts:
        s = station(t)[0]
        port, star = deck.verts.new((s.x, -s.y + .02, s.z - .01)), deck.verts.new((s.x, s.y - .02, s.z - .01))
        if prev:
            deck.faces.new((prev[0], port, star, prev[1]))
        prev = (port, star)
    link_mesh = mesh_object("Deck", deck, [M["deck"]])
    for sign, label in ((-1, "NeonPort"), (1, "NeonStarboard")):
        bm2, prev = bmesh.new(), None
        for t in ts[2:-3]:
            s = station(t)[0]
            o = Vector((s.x, sign * (s.y + .012), s.z - .09))
            pair = (bm2.verts.new(o), bm2.verts.new(o + Vector((0, 0, -.035))))
            if prev:
                bm2.faces.new((prev[0], prev[1], pair[1], pair[0]) if sign < 0 else (prev[0], pair[0], pair[1], prev[1]))
            prev = pair
        mesh_object(label, bm2, [M["neon"]])
    return hull, link_mesh


build_hull()


def deck_z(x):
    return sheer((x - X0) / L)


def hull_half(x):
    return B / 2 * half_width((x - X0) / L)


# ---------------------------------------------------------------- containers
CL, CW, CH = 1.45, .58, .62  # 20 ft proportions at ship scale


def container_mesh(name, mat):
    bm = bmesh.new()
    add_box(bm, (0, 0, CH / 2), (CL - .02, CW - .03, CH - .02))
    ribs = 18
    for side in (-1, 1):  # corrugated long sides
        for i in range(ribs):
            x = -CL / 2 + .06 + (CL - .12) * (i + .5) / ribs
            add_box(bm, (x, side * (CW / 2 - .012), CH / 2), (.035, .022, CH - .06))
    for x in (-CL / 2 + .015, CL / 2 - .015):  # door bars and end frames
        for y in (-.18, -.06, .06, .18):
            add_box(bm, (x + (.012 if x > 0 else -.012), y, CH / 2), (.012, .018, CH - .08))
    for x in (-1, 1):  # corner posts and castings
        for y in (-1, 1):
            add_box(bm, (x * (CL / 2 - .02), y * (CW / 2 - .02), CH / 2), (.045, .045, CH))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return me


filler_meshes = [container_mesh(f"Container{i}", mat) for i, mat in enumerate(FILLER)]
logo_mesh = container_mesh("LogoContainer", M["logobody"])

BAYS, ROWS, TIERS = 10, 7, 4
BAY_PITCH, ROW_PITCH = 1.65, .6
CARGO_START = -9.1
HATCH_TOP = .14
logo_index = 0
for bay in range(BAYS):
    x = CARGO_START + bay * BAY_PITCH + CL / 2
    # hatch cover and lashing bridge for every bay
    bm = bmesh.new()
    add_box(bm, (x, 0, HATCH_TOP / 2 + deck_z(x)), (CL + .08, ROW_PITCH * ROWS + .08, HATCH_TOP))
    hatch = bevel(mesh_object(f"Hatch{bay}", bm, [M["steel"]]), .015)
    if bay:
        bm = bmesh.new()
        lx = x - CL / 2 - (BAY_PITCH - CL) / 2
        for y in (-1, 1):
            for h in (0, 1):
                add_box(bm, (lx, y * (ROW_PITCH * ROWS / 2 + .02), HATCH_TOP + .35 + h * .55), (.06, .05, .05))
            add_box(bm, (lx, y * (ROW_PITCH * ROWS / 2 + .02), HATCH_TOP + .5), (.05, .05, 1.))
        for k in range(ROWS + 1):
            add_box(bm, (lx, -ROW_PITCH * ROWS / 2 + k * ROW_PITCH, HATCH_TOP + .95), (.05, .035, .05))
        add_box(bm, (lx, 0, HATCH_TOP + .95), (.04, ROW_PITCH * ROWS + .1, .04))
        mesh_object(f"Lashing{bay}", bm, [M["dark"]])
    limit = hull_half(x + CL / 2) - .12
    for row in range(ROWS):
        y = -ROW_PITCH * (ROWS - 1) / 2 + row * ROW_PITCH
        if abs(y) + CW / 2 > limit:
            continue
        outer = row == 0
        tiers = TIERS if outer else random.choice((2, 3, 3, 4, 4))
        for tier in range(tiers):
            z = deck_z(x) + HATCH_TOP + tier * (CH + .005)
            if outer and tier >= 2:
                # The camera-facing logo boxes: tier 3 holds ranks 1-10, tier 2 ranks 11-20.
                rank = bay + (0 if tier == 3 else BAYS)
                obj = link(bpy.data.objects.new(f"LogoBox_{rank:02d}", logo_mesh))
                obj.location = (x, y, z)
                bm = bmesh.new()
                plate_y = y - CW / 2 - .028
                # frame sits behind the plate (front face 6 mm back) so the two never share a plane
                add_box(bm, (x, plate_y + .012, z + CH / 2), (CL - .05, .012, CH - .05))
                frame = mesh_object(f"LogoFrame_{rank:02d}", bm, [M["frame"]])
                pm = bpy.data.meshes.new(f"LogoPlate_{rank:02d}")
                w, h = (CL - .09) / 2, (CH - .09) / 2
                verts = [(x - w, plate_y, z + CH / 2 - h), (x + w, plate_y, z + CH / 2 - h), (x + w, plate_y, z + CH / 2 + h), (x - w, plate_y, z + CH / 2 + h)]
                pm.from_pydata(verts, [], [(0, 1, 2, 3)])
                uv = pm.uv_layers.new(name="UVMap")
                for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                    loop.uv = coord
                pm.materials.append(M["plate"])
                link(bpy.data.objects.new(f"LogoPlate_{rank:02d}", pm))
                logo_index += 1
            else:
                obj = link(bpy.data.objects.new(f"Box_{bay}_{row}_{tier}", random.choice(filler_meshes)))
                obj.location = (x, y, z)
print("logo containers", logo_index)

# ---------------------------------------------------------------- accommodation, funnel, mast
ACC_X0, ACC_X1 = -11.3, -9.3          # deckhouse aft / front faces
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


# deckhouse: stepped decks, each with a walkway lip that throws a crisp shadow line
walls, lips, glass, mullions, rails = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
for k in range(DECKS):
    z0 = BASE + k * DECK_H
    setback = .05 * k                      # each deck steps back slightly: a raked front
    length, half = ACC_X1 - ACC_X0 - setback, 1.72 - (.1 if k >= 4 else 0)
    cx = ACC_X0 + length / 2
    add_box(walls, (cx, 0, z0 + DECK_H / 2), (length, half * 2, DECK_H - .04))
    add_box(lips, (cx + .06, 0, z0 + DECK_H - .015), (length + .2, half * 2 + .22, .035))
    if k == 0:
        continue
    zc = z0 + DECK_H * .55
    front = ACC_X0 + length
    add_box(glass, (front + .006, 0, zc), (.012, half * 2 - .3, .19))
    for i in range(9):
        add_box(mullions, (front + .014, -half + .25 + i * (half * 2 - .5) / 8, zc), (.01, .025, .2))
    for side in (-1, 1):
        add_box(glass, (cx + .1, side * (half + .006), zc), (length - .55, .012, .17))
        for i in range(7):
            add_box(mullions, (ACC_X0 + .35 + i * (length - .55) / 6, side * (half + .014), zc), (.025, .01, .18))
        add_box(rails, (cx + .06, side * (half + .1), z0 + DECK_H + .1), (length + .16, .015, .015))
    add_box(rails, (front + .15, 0, z0 + DECK_H + .1), (.015, half * 2 + .2, .015))
# bridge: full-width wheelhouse, raked glass, open wings with small wing cabins
BZ = BASE + DECKS * DECK_H
add_box(walls, (ACC_X1 - .72, 0, BZ + .27), (1.25, 3.44, .54))
add_box(lips, (ACC_X1 - .66, 0, BZ + .555), (1.45, 3.6, .05))
for side in (-1, 1):
    add_box(lips, (ACC_X1 - .6, side * 2.25, BZ + .02), (.95, 1.25, .045))
    add_box(walls, (ACC_X1 - .52, side * 2.72, BZ + .2), (.45, .32, .38))
    add_box(glass, (ACC_X1 - .29, side * 2.72, BZ + .24), (.012, .26, .16))
    add_box(rails, (ACC_X1 - .6, side * 2.87, BZ + .26), (.95, .015, .015))
    add_box(rails, (ACC_X1 - .14, side * 2.25, BZ + .26), (.015, 1.25, .015))
    for i in range(3):
        add_box(mullions, (ACC_X1 - .95 + i * .35, side * 2.2, BZ - .14), (.03, .9, .03))
bglass = bmesh.new()
geom = add_box(bglass, (0, 0, 0), (.02, 3.2, .3))
bmesh.ops.rotate(bglass, verts=geom["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-14), 3, "Y"))
bmesh.ops.translate(bglass, verts=geom["verts"], vec=(ACC_X1 - .09, 0, BZ + .3))
mesh_object("BridgeGlass", bglass, [M["glass"]])
bevel(mesh_object("Accommodation", walls, [M["white"]]), .02)
mesh_object("DeckLips", lips, [M["steel"]])
mesh_object("CabinWindows", glass, [M["window"]])
mesh_object("Mullions", mullions, [M["white"]])
mesh_object("DeckRails", rails, [M["white"]])

# funnel: elliptical stack with a black cap, neon company band and twin exhausts
FUN_X = ACC_X0 + .05
cylinder("Funnel", M["dark"], (FUN_X, 0, BZ + .55), .62, 2.2, (1.15, .78, 1))
cylinder("FunnelCap", M["dark"], (FUN_X, 0, BZ + 1.7), .64, .12, (1.17, .8, 1))
cylinder("NeonFunnel", M["funnel"], (FUN_X, 0, BZ + 1.2), .63, .24, (1.16, .79, 1))
for y in (-.2, .2):
    cylinder("Exhaust", M["steel"], (FUN_X - .12, y, BZ + 2.0), .09, .55, verts=16)
bm = bmesh.new()
add_box(bm, (FUN_X + .1, 0, BZ - .2), (1.2, 1.5, .7))
bevel(mesh_object("FunnelCasing", bm, [M["white"]]), .04)

# radar mast on the bridge roof
mast_x = ACC_X1 - .75
bm = bmesh.new()
add_box(bm, (mast_x, 0, BZ + 1.05), (.07, .07, 1.0))
add_box(bm, (mast_x, 0, BZ + 1.25), (.06, 1.4, .05))
add_box(bm, (mast_x + .12, 0, BZ + .95), (.05, 1.0, .04))
mesh_object("Mast", bm, [M["steel"]])
bm = bmesh.new()
add_box(bm, (0, 0, 0), (.12, 1.05, .05))
radar = mesh_object("Radar", bm, [M["white"]])
radar.location = (mast_x, 0, BZ + 1.62)
lamp("LightPort", M["red"], (ACC_X1 - .5, -2.9, BZ + .35))
lamp("LightStarboard", M["green"], (ACC_X1 - .5, 2.9, BZ + .35))
lamp("LightMast", M["lamp"], (mast_x, 0, BZ + 1.6), .05)

# stern: mooring deck, flag staff, free-fall lifeboat on its ramp
SZ = deck_z(X0 + .4)
bm = bmesh.new()
for y in (-1.05, 1.05):
    add_box(bm, (X0 + .9, y, SZ + .12), (.36, .36, .24))
for x, y in ((X0 + .35, -1.55), (X0 + .35, 1.55), (X0 + 1.5, -1.9), (X0 + 1.5, 1.9)):
    add_box(bm, (x, y - .07, SZ + .1), (.09, .09, .2))
    add_box(bm, (x, y + .07, SZ + .1), (.09, .09, .2))
add_box(bm, (X0 - .05, 0, SZ + .7), (.035, .035, 1.4))
mesh_object("SternGear", bm, [M["steel"]])
bm = bmesh.new()
add_box(bm, (X0 - .32, 0, SZ + 1.22), (.5, .01, .3))
mesh_object("SternFlag", bm, [M["neon"]])
lamp("LightStern", M["lamp"], (X0 - .05, 0, SZ + 1.45), .05)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(X0 + .55, -.9, SZ + .95))
boat = bpy.context.active_object
boat.name, boat.scale, boat.rotation_euler = "Lifeboat", (.72, .22, .2), (0, math.radians(-24), 0)
boat.data.materials.append(M["orange"])
bpy.ops.object.shade_smooth()
cylinder("LifeboatCanopy", M["white"], (X0 + .62, -.9, SZ + 1.1), .14, .5, (1, 1.2, 1), 24, (0, math.radians(66), 0))
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

# ---------------------------------------------------------------- forecastle
FX = CARGO_START + BAYS * BAY_PITCH + .1
bm = bmesh.new()
pts = []
for i in range(25):
    x = FX + (L / 2 + .8 - FX) * i / 24
    pts.append((x, hull_half(x) - .05))
for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
    if ya > .05:
        add_box(bm, ((xa + xb) / 2, 0, deck_z((xa + xb) / 2) + .16), (xb - xa + .02, 2 * min(ya, yb), .32))
mesh_object("Forecastle", bm, [M["deck"]])
bm = bmesh.new()
for side in (-1, 1):  # V-shaped breakwater shielding the first bay
    add_box(bm, (FX + .45, side * 1.05, deck_z(FX) + .55), (.05, 2.4, .8), rot_z=side * math.radians(-18))
breakwater = bevel(mesh_object("Breakwater", bm, [M["white"]]), .015)
bm = bmesh.new()
for x in (FX + 1.4, FX + 2.4):
    for side in (-1, 1):
        add_box(bm, (x, side * .8, deck_z(x) + .48), (.32, .32, .3))      # winches
        add_box(bm, (x + .5, side * 1.2, deck_z(x) + .42), (.1, .1, .2))  # bollards
add_box(bm, (L / 2 - .6, 0, deck_z(L / 2) + 1.1), (.08, .08, 1.5))         # fore mast
mesh_object("ForeDeckGear", bm, [M["steel"]])
lamp("LightFore", M["lamp"], (L / 2 - .6, 0, deck_z(L / 2) + 1.9), .05)
bm = bmesh.new()  # anchor pockets near the bow, both sides
for side in (-1, 1):
    x = L / 2 - 1.3
    add_box(bm, (x, side * (hull_half(x) + .005), deck_z(x) - .45), (.42, .05, .3))
mesh_object("AnchorPockets", bm, [M["dark"]])

# ---------------------------------------------------------------- railings along the main deck
bm = bmesh.new()
x = CARGO_START - .2
while x < FX:
    for side in (-1, 1):
        y = side * (hull_half(x) - .06)
        add_box(bm, (x, y, deck_z(x) + .14), (.02, .02, .28))
    x += .45
for side in (-1, 1):
    segs = 40
    for i in range(segs):
        xa = CARGO_START - .2 + (FX - CARGO_START + .2) * i / segs
        xb = CARGO_START - .2 + (FX - CARGO_START + .2) * (i + 1) / segs
        for h in (.27, .14):
            ya, yb = side * (hull_half(xa) - .06), side * (hull_half(xb) - .06)
            mid = Vector(((xa + xb) / 2, (ya + yb) / 2, deck_z((xa + xb) / 2) + h))
            length = math.hypot(xb - xa, yb - ya)
            add_box(bm, mid, (length + .01, .018, .018), rot_z=math.atan2(yb - ya, xb - xa))
mesh_object("Railing", bm, [M["white"]])

# hull-side name board (camera side, flat midbody): the browser paints the market or stock name
HN_X0, HN_X1, HN_Z0, HN_Z1 = -8.6, 5.0, -1.0, -.18
hn = bpy.data.meshes.new("HullName")
hy = -(B / 2) - .006
hn.from_pydata([(HN_X0, hy, HN_Z0), (HN_X1, hy, HN_Z0), (HN_X1, hy, HN_Z1), (HN_X0, hy, HN_Z1)], [], [(0, 1, 2, 3)])
uv = hn.uv_layers.new(name="UVMap")
for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
    loop.uv = coord
hn.materials.append(material("HullNameBoard", (.02, .02, .03), .4, 0.))
link(bpy.data.objects.new("HullName", hn))

# draft marks at bow and stern, camera side
bm = bmesh.new()
for x in (L / 2 - .9, X0 + 1.2):
    for k in range(4):
        z = WATERLINE + .08 + k * .2
        add_box(bm, (x, -(hull_half(x) * .99 + .01), z), (.1, .01, .05))
mesh_object("DraftMarks", bm, [M["white"]])

# ---------------------------------------------------------------- apply modifiers, export
for obj in list(scene.objects):
    if obj.type == "MESH" and obj.modifiers:
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception as error:
                print("modifier", obj.name, mod.name, error)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_extras=False)
print("exported", OUT)

if PREVIEW:
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = link(bpy.data.objects.new("cam", cam_data))
    cam.location = (3, -36, 6.5)
    cam.rotation_euler = (math.radians(82), 0, math.radians(4.5))
    scene.camera = cam
    sun = link(bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.03, .025, .06, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = .8
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
