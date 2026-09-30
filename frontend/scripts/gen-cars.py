"""Detailed car meshes for the 3D complex view: public/3d/cars.bin + cars.json.

Run inside Blender (tested with 5.2):
  blender -b --factory-startup -P frontend/scripts/gen-cars.py

Each passenger car of sceneCars.ts's CAR_SPECS (its proportions are read from there) is
modelled as a car is: a body shell lofted through sections along the side profile, with
tumblehome and a rounded plan, smoothed by subdivision and cut round the wheels; the glass
set into it (windscreen, side windows split by the pillars, rear screen); head and tail
lamps, grille, number plates, mirrors, door handles; tyres with bulging sidewalls and
five-spoke alloy rims. Then decimated to a budget (~4k triangles).

Colours are the kit's palette swatches by uv (as sceneCars does), so the view's car paint
(ComplexRenderer CAR_PAINT) applies: body -> the instance's paint, glass, dark trim/tyres.
cars.bin per kind: positions f32x3, normals i8x4, uv u16x2, indices u16. Front is +z in the
view (x across, y up), wheels on y = 0.
"""
import json
import math
import re
import struct
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

here = Path(__file__).resolve().parent
src = (here.parent / 'src' / 'components' / 'sceneCars.ts').read_text(encoding='utf-8')
block = src[src.index('export const CAR_SPECS'):]
block = block[block.index('{'):block.index('\n};') + 2]
block = re.sub(r'//[^\n]*', '', block)
block = re.sub(r'([{,]\s*)"?([A-Za-z][\w-]*)"?\s*:', r'\1"\2":', block)
block = re.sub(r',(\s*[}\]])', r'\1', block)
SPECS = json.loads(block)
public = here.parent / 'public' / '3d'

# Parts by uv slot (u = (index + 0.5) / 16): the view's car-model material colours them
# (sceneCars carModelMaterial, ComplexRenderer CAR_MODEL); only the body takes the paint.
PARTS = ['body', 'glass', 'trim', 'rim', 'chrome', 'lamp', 'tail', 'plate', 'signal', 'tyre', 'panel', 'cab']
SWATCH = {name: ((i + 0.5) / 16, 0.5) for i, name in enumerate(PARTS)}
BODY_BUDGET = 2600


def curve(points, t):
    n = len(points)
    i = 0
    while i < n - 2 and points[i + 1][0] < t:
        i += 1
    p0, p1, p2, p3 = points[max(0, i - 1)], points[i], points[i + 1], points[min(n - 1, i + 2)]
    u = max(0.0, min(1.0, (t - p1[0]) / max(1e-6, p2[0] - p1[0])))
    u2, u3 = u * u, u * u * u
    return 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)


def clear():
    MATS.clear()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.materials):
        for b in list(blk):
            if not b.users:
                blk.remove(b)


MATS = {}
def mat(name):
    if name not in MATS:
        MATS[name] = bpy.data.materials.new(name)
    return MATS[name]


def obj_from(bm, name, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat(material))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


# Blender frame here: x across, y along the car (front +y), z up; exported as three's
# (x, z, -y) flipped to front +z: (x, z, y) — see export.
def body_shell(sp):
    """The body as a cage of sections (half, mirrored), its faces carrying their part —
    glass, lamps, grille, sills — so the subdivided surface keeps clean boundaries."""
    L, W = sp['length'], sp['width'] / 2
    S = 26
    c0, c1 = sp['cabin']
    b_t = c0 + (c1 - c0) * (0.52 if L > 4.2 else 0.6)
    bm = bmesh.new()
    rows, ts, cab = [], [], []
    # (the band nearest the B pillar's position keeps its body colour)
    stations = [0.5 - 0.5 * math.cos(math.pi * i / S) for i in range(S + 1)]
    mids = [(stations[i] + stations[i + 1]) / 2 for i in range(S)]
    b_band = min(range(S), key=lambda i: abs(mids[i] - b_t))
    for i in range(S + 1):
        t = 0.5 - 0.5 * math.cos(math.pi * i / S)
        y = (t - 0.5) * L
        e = abs(t - 0.5) * 2
        w = max(0.25 * W, W * max(0.0, 1 - e ** 8) ** 0.14)
        top = curve(sp['top'], t)
        bottom = sp['clearance'] + 0.1 * e ** 6
        top = max(top, bottom + 0.12)
        belt = min(top - 0.04, sp['belt'])
        cabin = c0 <= t <= c1 and top > sp['belt'] + 0.08
        gh = max(0.0, top - belt)
        rw = max(0.12, w * sp['roof'])
        if cabin:
            glass_lo, glass_hi = (max(rw, w * 0.97 - sp['tumble'] * gh * 0.25), belt + 0.03), (rw + 0.03, top - 0.05)
            mid = ((glass_lo[0] + glass_hi[0]) / 2, (glass_lo[1] + glass_hi[1]) / 2)
            upper = [glass_lo, mid, glass_hi, (rw * 0.85, top - 0.01), (rw * 0.45, top), (0.0, top + 0.01)]
        else:
            upper = [(w * 0.95, belt + gh * 0.25), (w * 0.88, belt + gh * 0.55), (w * 0.78, belt + gh * 0.85), (w * 0.62, top), (w * 0.3, top + 0.01), (0.0, top + 0.015)]
        # 0 bottom centre, 1 sill corner, 2 sill, 3 lower side, 4 lamp line, 5 upper side,
        # 6 belt, then the upper points (glass or bonnet/boot), ending at the roof centre
        pts = [(0.0, bottom), (w * 0.88, bottom), (w * 0.99, bottom + 0.1), (w, bottom + (belt - bottom) * 0.4),
               (w, bottom + (belt - bottom) * 0.72), (w * 0.995, belt - 0.05), (w * 0.975, belt)] + upper
        rows.append([bm.verts.new((x, y, z)) for (x, z) in pts]); ts.append(t); cab.append(cabin)
    H = len(rows[0])
    for i in range(S):
        a, b = rows[i], rows[i + 1]
        t = (ts[i] + ts[i + 1]) / 2
        steep = abs(curve(sp['top'], ts[i + 1]) - curve(sp['top'], ts[i])) / max(1e-4, abs(b[0].co.y - a[0].co.y)) > 0.38
        for j in range(H - 1):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            part = 'body'
            both_cab = cab[i] and cab[i + 1]
            if j in (0, 1):
                part = 'trim'                                         # underbody and sill
            elif both_cab and j in (7, 8) and i != b_band:
                part = 'glass'                                        # side windows, B pillar between
            elif j >= 9 and steep and (c0 - 0.08 < t < c1 + 0.08):
                part = 'glass'                                        # windscreen and rear screen, pillar to pillar
            elif t > 0.93 and j in (4, 5):
                part = 'lamp'
            elif t > 0.965 and j in (2, 3):
                part = 'trim'                                         # the grille / lower intake
            elif t < 0.06 and j in (4, 5):
                part = 'tail'
            f.material_index = PARTS.index(part)
    for row, flip, front in ((rows[0], True, False), (rows[-1], False, True)):
        c = bm.verts.new((0.0, row[0].co.y + (0.02 if front else -0.02), (row[0].co.z + row[-1].co.z) / 2))
        for j in range(H - 1):
            f = bm.faces.new((c, row[j + 1], row[j]) if flip else (c, row[j], row[j + 1]))
            f.material_index = PARTS.index('body')
    # (every face facing out: the caps' fans were wound the other way)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    me = bpy.data.meshes.new('body')
    bm.to_mesh(me); bm.free()
    for name in PARTS:
        me.materials.append(mat(name))
    o = bpy.data.objects.new('body', me)
    bpy.context.scene.collection.objects.link(o)
    m = o.modifiers.new('mirror', 'MIRROR'); m.use_axis[0] = True; m.use_clip = True
    s_ = o.modifiers.new('subd', 'SUBSURF'); s_.levels = 1; s_.render_levels = 1
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for t in sp['axles']:
        y = (t - 0.5) * L
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=sp['wheel'] + 0.06, depth=sp['width'] + 0.4, location=(0, y, sp['wheel']), rotation=(0, math.pi / 2, 0))
        cut = bpy.context.active_object
        bo = o.modifiers.new('arch', 'BOOLEAN'); bo.object = cut; bo.operation = 'DIFFERENCE'; bo.solver = 'EXACT'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=bo.name)
        bpy.data.objects.remove(cut, do_unlink=True)
    return o


def plane(name, material, corners):
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    bm.faces.new(vs)
    return obj_from(bm, name, material)


def box(name, material, size, loc, bevel=0.0):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 2
        bpy.ops.object.modifier_apply(modifier=b.name)
    o.data.materials.append(mat(material))
    return o


def glass(sp, body):
    """The glass: a shrunk copy of the cabin's surface, faces kept where the body's
    section is above the belt, split by pillars (a gap at the cabin's ends and in the
    middle for the B pillar)."""
    L = sp['length']
    g = body.copy(); g.data = body.data.copy(); bpy.context.scene.collection.objects.link(g)
    g.data.materials.clear(); g.data.materials.append(mat('glass'))
    bm = bmesh.new(); bm.from_mesh(g.data)
    c0, c1 = (sp['cabin'][0] - 0.5) * L, (sp['cabin'][1] - 0.5) * L
    b_pillar = c0 + (c1 - c0) * (0.52 if sp['length'] > 4.2 else 0.58)
    kill = []
    for f in bm.faces:
        cx, cy, cz = f.calc_center_median()
        n = f.normal
        above = cz > sp['belt'] + 0.05
        inside = c0 + 0.08 < cy < c1 - 0.08
        roof = n.z > 0.85
        pillar = abs(cy - b_pillar) < 0.05 and abs(n.x) > 0.5
        # the windscreen / rear screen: steep faces facing forward or back within the cabin
        screen = abs(n.y) > 0.35 and n.z > 0.15 and above and abs(cx) < sp['width'] * 0.36 and (c0 - 0.45 < cy < c1 + 0.45) and not roof
        side = abs(n.x) > 0.55 and above and inside and not pillar
        if not (side or screen) or roof:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for v in bm.verts:
        v.co += v.normal * 0.004   # (just proud of the body)
    bm.to_mesh(g.data); bm.free()
    return g


def lathe(name, material, profile, segs, axis_loc, out):
    """A solid of revolution about the x axis (a wheel): profile [(r, x)]."""
    bm = bmesh.new()
    rings = []
    for k in range(segs):
        a = k / segs * math.tau
        rings.append([bm.verts.new((axis_loc[0] + x * out, axis_loc[1] + math.cos(a) * r, axis_loc[2] + math.sin(a) * r)) for r, x in profile])
    for k in range(segs):
        a, b = rings[k], rings[(k + 1) % segs]
        for j in range(len(profile) - 1):
            f = (a[j], b[j], b[j + 1], a[j + 1])
            bm.faces.new(f if out > 0 else f[::-1])
    return obj_from(bm, name, material)


def wheel(sp, x, y, side, wdt=0.21):
    R = sp['wheel']
    loc = (x, y, R)
    # tyre: tread and sidewalls bulging out, into the rim
    tyre = lathe('tyre', 'tyre', [(R * 0.66, -wdt / 2), (R * 0.95, -wdt / 2 - 0.006), (R, 0.0), (R * 0.95, wdt / 2 + 0.006), (R * 0.66, wdt / 2)], 22, loc, side)
    # rim face: hub, five spokes and the outer ring in metal, the gaps between spokes dark
    bm = bmesh.new()
    segs, radii = 30, [0.0, R * 0.18, R * 0.52, R * 0.64, R * 0.67]
    face_x = x + side * (wdt / 2 - 0.02)
    grid = [[bm.verts.new((face_x - side * (0.012 if 0 < j < 3 else 0.0), y + math.cos(k / segs * math.tau) * r, R + math.sin(k / segs * math.tau) * r))
             for j, r in enumerate(radii)] for k in range(segs)]
    faces_mat = []
    for k in range(segs):
        a0 = grid[k]; a1 = grid[(k + 1) % segs]
        for j in range(len(radii) - 1):
            vs = [a0[j], a1[j], a1[j + 1], a0[j + 1]] if j else [a0[0], a1[1], a0[1]]
            if j == 0:
                vs = [a0[0], a0[1], a1[1]]
            f = bm.faces.new(vs if side > 0 else vs[::-1])
            spoke = ((k + 0.5) / segs * 5) % 1.0 < 0.34
            f.material_index = 1 if (j == 2 and not spoke) else 0
    me_rim = bpy.data.meshes.new('rim'); bm.to_mesh(me_rim); bm.free()
    me_rim.materials.append(mat('rim')); me_rim.materials.append(mat('tyre'))
    rim = bpy.data.objects.new('rim', me_rim); bpy.context.scene.collection.objects.link(rim)
    parts = [tyre, rim]
    return parts


def details(sp):
    L, W = sp['length'], sp['width'] / 2
    parts = []
    front_y, rear_y = L / 2, -L / 2
    zf, zr = curve(sp['top'], 0.97) - 0.18, curve(sp['top'], 0.03) - 0.16
    # headlamps and tail lamps: thin bars across the corners, just proud of the body
    for sx in (1, -1):
        # mirror
        parts.append(box('mirror', 'body', (0.2, 0.14, 0.11), (sx * (W + 0.07), (sp['cabin'][1] - 0.5) * L - 0.1, sp['belt'] + 0.1), 0.03))
        # door handles
        for t in (0.42, 0.62):
            if sp['cabin'][0] < t < sp['cabin'][1]:
                parts.append(box('handle', 'chrome', (0.02, 0.14, 0.03), (sx * (W - 0.005), (t - 0.5) * L, sp['belt'] - 0.08)))
    # grille and plates
    parts.append(box('plate_f', 'plate', (0.52, 0.03, 0.11), (0, front_y + 0.01, sp['clearance'] + 0.2)))
    parts.append(box('plate_r', 'plate', (0.52, 0.03, 0.11), (0, rear_y - 0.01, sp['clearance'] + 0.35)))
    if sp.get('sign'):
        parts.append(box('sign', 'signal', (0.55, 0.26, 0.16), (0, 0, curve(sp['top'], 0.5) + 0.09), 0.02))
    return parts


def build(kind, sp):
    clear()
    body = body_shell(sp)
    parts = [body] + details(sp)
    for t in sp['axles']:
        for side in (1, -1):
            parts += wheel(sp, side * (sp['width'] / 2 - 0.13), (t - 0.5) * sp['length'], side)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    car = bpy.context.active_object
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40)) if hasattr(bpy.ops.object, 'shade_auto_smooth') else None
    return car


def export(car):
    me = car.data
    me.calc_loop_triangles()
    try:
        me.calc_normals_split()
    except Exception:
        pass
    pos, nor, uv, idx = [], [], [], []
    seen = {}
    names = [(m.name.split('.')[0] if m else 'body') for m in me.materials]
    for tri in me.loop_triangles:
        sw = SWATCH.get(names[tri.material_index] if tri.material_index < len(names) else 'body', SWATCH['body'])
        for li in tri.loops:
            v = me.vertices[me.loops[li].vertex_index].co
            n = me.corner_normals[li].vector if hasattr(me, 'corner_normals') else me.loops[li].normal
            # Blender (x, y front, z up) -> view (x, y up, z front)
            # (a rotation, not a mirror: (x, y, z) -> (-x, z, y) keeps the triangles' winding)
            key = (round(v.x, 4), round(v.y, 4), round(v.z, 4), round(n.x, 2), round(n.y, 2), round(n.z, 2), sw)
            k = seen.get(key)
            if k is None:
                k = seen[key] = len(pos) // 3
                pos += [-v.x, v.z, v.y]; nor += [-n.x, n.z, n.y]; uv += list(sw)
            idx.append(k)
    return pos, nor, uv, idx


# ---------------------------------------------------------------- trucks and buses
# Blender frame: x across, y along (front +y), z up; the vehicle centred on y = 0.

def rbox(name, material, size, loc, bevel=0.06, seg=3):
    """A box with rounded edges (bevel), for cabs, bodies and boxes."""
    return box(name, material, size, loc, bevel) if bevel == 0 else _rbox(name, material, size, loc, bevel, seg)


def _rbox(name, material, size, loc, bevel, seg):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = seg; b.limit_method = 'NONE'
    bpy.ops.object.modifier_apply(modifier=b.name)
    o.data.materials.append(mat(material))
    return o


def cab_over(y_front, W, H, depth, z0, paint='body', nose=0.18):
    """A cab-over cab (Porter, Bongo, trucks and their tractors): a rounded block, the
    windscreen raked back over the front, side windows on the doors, grille, lamps,
    bumper and mirrors."""
    parts = []
    yc = y_front - depth / 2
    parts.append(rbox('cab', paint, (W, depth, H), (0, yc, z0 + H / 2), 0.14))
    # windscreen: a glass slab across the upper front, set on the rounded face
    parts.append(rbox('wind', 'glass', (W * 0.93, 0.04, H * 0.5), (0, y_front + 0.005, z0 + H * 0.68), 0.04, 2))
    # side windows (door glass) and the quarter window behind
    for sx in (1, -1):
        parts.append(box('door_glass', 'glass', (0.02, depth * 0.55, H * 0.36), (sx * (W / 2 + 0.005), y_front - depth * 0.36, z0 + H * 0.7)))
        parts.append(box('door_line', 'trim', (0.02, 0.02, H * 0.55), (sx * (W / 2 + 0.006), y_front - depth * 0.7, z0 + H * 0.45)))
        parts.append(box('handle', 'chrome', (0.02, 0.12, 0.03), (sx * (W / 2 + 0.01), y_front - depth * 0.62, z0 + H * 0.48)))
        parts.append(rbox('head', 'lamp', (0.32, 0.04, 0.16), (sx * (W / 2 - 0.26), y_front + 0.01, z0 + H * 0.28), 0.02, 2))
        parts.append(box('signal', 'signal', (0.12, 0.04, 0.08), (sx * (W / 2 - 0.05), y_front + 0.01, z0 + H * 0.28)))
        # mirror on its arm
        parts.append(box('mirror_arm', 'trim', (0.3, 0.03, 0.03), (sx * (W / 2 + 0.14), y_front - 0.12, z0 + H * 0.75)))
        parts.append(rbox('mirror', 'trim', (0.06, 0.14, 0.34), (sx * (W / 2 + 0.3), y_front - 0.1, z0 + H * 0.7), 0.02, 2))
        # step under the door
        parts.append(box('step', 'trim', (0.12, depth * 0.4, 0.05), (sx * (W / 2 - 0.02), y_front - depth * 0.4, z0 - 0.02)))
    parts.append(box('grille', 'trim', (W * 0.44, 0.04, H * 0.18), (0, y_front + 0.012, z0 + H * 0.3)))
    parts.append(rbox('bumper', 'trim', (W + 0.04, 0.16, 0.22), (0, y_front + 0.02, z0 - 0.02), 0.04, 2))
    parts.append(box('plate_f', 'plate', (0.52, 0.03, 0.11), (0, y_front + 0.11, z0 - 0.02)))
    return parts


def fender(x, y, R, side, width=0.3):
    """A black mudguard arching over a wheel: a half ring about the axle."""
    bm = bmesh.new()
    rows = []
    for k in range(13):
        a = math.pi * k / 12
        row = []
        for r, dx in ((R + 0.05, -width / 2), (R + 0.12, -width / 2), (R + 0.12, width / 2), (R + 0.05, width / 2)):
            row.append(bm.verts.new((x + dx * side, y + math.cos(a) * r, R + math.sin(a) * r)))
        rows.append(row)
    for k in range(12):
        a, b = rows[k], rows[k + 1]
        for j in range(3):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from(bm, 'fender', 'trim')


def truck_wheels(axles, R, W, dual_rear=True, wdt=0.24):
    """Wheels on their axles: y positions; the rear ones doubled for trucks and buses."""
    sp = {'wheel': R}
    parts = []
    for k, y in enumerate(axles):
        dual = dual_rear and k > 0
        for side in (1, -1):
            parts.append(fender(side * (W / 2 - 0.2), y, R, side, 0.42 if dual else 0.3))
            x = side * (W / 2 - wdt / 2 - 0.02)
            parts += wheel(sp, x, y, side, wdt)
            if dual:
                parts += wheel(sp, x - side * (wdt + 0.02), y, side, wdt)
    return parts


def chassis(y0, y1, W, z):
    parts = [box('frame_l', 'trim', (0.14, y1 - y0, 0.22), (W * 0.3, (y0 + y1) / 2, z)),
             box('frame_r', 'trim', (0.14, y1 - y0, 0.22), (-W * 0.3, (y0 + y1) / 2, z))]
    parts.append(rbox('tank', 'chrome', (0.34, 0.8, 0.4), (W * 0.4, (y0 + y1) / 2 + 0.3, z - 0.1), 0.1, 3))
    return parts


def tail_end(y, W, z, plate=True):
    parts = []
    for sx in (1, -1):
        parts.append(box('tail', 'tail', (0.22, 0.04, 0.12), (sx * (W / 2 - 0.18), y - 0.01, z)))
    if plate:
        parts.append(box('plate_r', 'plate', (0.52, 0.03, 0.11), (0, y - 0.02, z - 0.12)))
    return parts


def truck(kind):
    clear()
    parts = []
    if kind == 'cargo':           # 1-ton cargo truck: cab-over cab, open drop-side bed
        L, W, R = 5.1, 1.75, 0.34
        yf, depth, cabH, z0 = L / 2, 1.55, 1.35, 0.62
        parts += cab_over(yf, W, cabH, depth, z0)
        bed0, bed1 = -L / 2, yf - depth - 0.06
        parts += chassis(-L / 2 + 0.2, yf - 0.4, W, 0.5)
        parts.append(box('bed', 'panel', (W, bed1 - bed0, 0.1), (0, (bed0 + bed1) / 2, z0 + 0.12)))
        for sx in (1, -1):
            parts.append(box('side', 'panel', (0.05, bed1 - bed0, 0.4), (sx * (W / 2 - 0.025), (bed0 + bed1) / 2, z0 + 0.37)))
            for yy in (bed0 + (bed1 - bed0) * f for f in (0.33, 0.66)):
                parts.append(box('hinge', 'trim', (0.06, 0.04, 0.4), (sx * (W / 2 - 0.02), yy, z0 + 0.37)))
        parts.append(box('tailgate', 'panel', (W, 0.05, 0.4), (0, bed0 + 0.025, z0 + 0.37)))
        parts.append(box('headboard', 'panel', (W, 0.05, 0.9), (0, bed1 - 0.02, z0 + 0.6)))
        parts += tail_end(bed0, W, z0 + 0.05)
        parts += truck_wheels([yf - 0.75, -L / 2 + 1.1], R, W, dual_rear=False, wdt=0.2)
    elif kind == 'boxtruck':      # 2.5-ton box truck (탑차): cab and an insulated box
        L, W, R = 6.2, 2.0, 0.4
        yf, depth, cabH, z0 = L / 2, 1.65, 1.55, 0.72
        parts += cab_over(yf, W, cabH, depth, z0)
        b0, b1 = -L / 2, yf - depth - 0.08
        parts += chassis(-L / 2 + 0.2, yf - 0.4, W, 0.58)
        parts.append(rbox('box', 'panel', (W + 0.08, b1 - b0, 2.1), (0, (b0 + b1) / 2, z0 + 0.15 + 1.05), 0.05, 2))
        for yy in (b0 + (b1 - b0) * f for f in (0.2, 0.4, 0.6, 0.8)):
            for sx in (1, -1):
                parts.append(box('rib', 'chrome', (0.02, 0.04, 2.08), (sx * (W / 2 + 0.045), yy, z0 + 1.2)))
        parts.append(box('door_seam', 'trim', (0.02, 0.02, 2.0), (0, b0 - 0.005, z0 + 1.2)))
        parts += tail_end(b0, W, z0 + 0.1)
        parts += truck_wheels([yf - 0.8, -L / 2 + 1.4], R, W)
    elif kind == 'bus':           # city bus: a long low-floor body, glass band, doors
        L, W, H, R = 11.0, 2.5, 3.15, 0.5
        z0 = 0.35
        parts.append(rbox('body', 'body', (W, L, H - z0 - 0.25), (0, 0, z0 + (H - z0 - 0.25) / 2), 0.2, 3))
        parts.append(rbox('roof', 'panel', (W - 0.2, L - 0.4, 0.25), (0, -0.2, H - 0.12), 0.1, 2))
        parts.append(rbox('ac', 'panel', (1.6, 2.4, 0.28), (0, -0.8, H + 0.1), 0.08, 2))
        # windscreen and rear window
        parts.append(rbox('wind', 'glass', (W * 0.92, 0.05, 1.5), (0, L / 2 + 0.01, z0 + 1.65), 0.05, 2))
        parts.append(box('dest', 'lamp', (W * 0.7, 0.05, 0.22), (0, L / 2 + 0.02, H - 0.45)))
        parts.append(box('rear_glass', 'glass', (W * 0.8, 0.05, 0.8), (0, -L / 2 - 0.01, z0 + 1.95)))
        for sx in (1, -1):
            # the window band down each side, pillars between
            n = 7
            for k in range(n):
                y = -L / 2 + 1.3 + k * (L - 2.6) / (n - 1) * 0.92
                parts.append(box('win', 'glass', (0.02, 1.25, 1.05), (sx * (W / 2 + 0.005), y, z0 + 1.75)))
            parts.append(rbox('head', 'lamp', (0.3, 0.04, 0.14), (sx * (W / 2 - 0.3), L / 2 + 0.02, z0 + 0.45), 0.02, 2))
            parts.append(rbox('mirror', 'trim', (0.06, 0.14, 0.36), (sx * (W / 2 + 0.25), L / 2 - 0.05, H - 0.9), 0.02, 2))
        # doors (kerb side, +x for right-hand traffic): glass leaves
        for y in (L / 2 - 1.0, -0.6):
            parts.append(box('door', 'glass', (0.03, 1.1, 2.0), (W / 2 + 0.01, y, z0 + 1.1)))
            parts.append(box('door_seam', 'trim', (0.035, 0.03, 2.0), (W / 2 + 0.012, y, z0 + 1.1)))
        parts.append(box('bumper', 'trim', (W + 0.02, 0.18, 0.3), (0, L / 2 + 0.05, z0 + 0.1)))
        parts.append(box('plate_f', 'plate', (0.52, 0.03, 0.11), (0, L / 2 + 0.15, z0 + 0.1)))
        parts += tail_end(-L / 2, W, z0 + 0.5)
        parts += truck_wheels([L / 2 - 2.4, -L / 2 + 2.9], R, W, dual_rear=True, wdt=0.28)
    elif kind == 'container':     # tractor and a 40 ft container on its trailer
        L, W, R = 16.2, 2.45, 0.5
        yf, depth, cabH, z0 = L / 2, 2.1, 2.2, 1.0
        parts += cab_over(yf, W, cabH, depth, z0, paint='cab')
        parts.append(rbox('fairing', 'cab', (W * 0.9, 1.2, 0.6), (0, yf - 1.0, z0 + cabH + 0.3), 0.15, 2))
        parts += chassis(-L / 2, yf - 0.3, W, 0.95)
        c0, c1 = -L / 2 + 0.05, yf - depth - 0.4
        parts.append(box('trailer', 'trim', (W, c1 - c0, 0.2), (0, (c0 + c1) / 2, 1.3)))
        parts.append(box('container', 'body', (W, c1 - c0, 2.55), (0, (c0 + c1) / 2, 1.4 + 1.28)))
        n = 24
        for k in range(n):
            y = c0 + (k + 0.5) * (c1 - c0) / n
            for sx in (1, -1):
                parts.append(box('rib', 'body', (0.05, 0.12, 2.4), (sx * (W / 2 + 0.02), y, 1.4 + 1.28)))
        for sx in (1, -1):
            parts.append(box('door_bar', 'chrome', (0.04, 0.03, 2.4), (sx * 0.35, c0 - 0.02, 1.4 + 1.28)))
        parts += tail_end(c0, W, 1.15)
        parts += truck_wheels([yf - 1.0, yf - depth - 0.9, -L / 2 + 2.2, -L / 2 + 3.5], R, W)
    elif kind == 'garbage':       # refuse truck: cab and a compactor body
        L, W, R = 7.0, 2.35, 0.48
        yf, depth, cabH, z0 = L / 2, 1.8, 1.9, 0.9
        parts += cab_over(yf, W, cabH, depth, z0, paint='cab')
        parts += chassis(-L / 2 + 0.3, yf - 0.4, W, 0.75)
        b0, b1 = -L / 2 + 0.9, yf - depth - 0.1
        parts.append(rbox('body', 'body', (W, b1 - b0, 2.1), (0, (b0 + b1) / 2, z0 + 1.05 + 0.1), 0.25, 3))
        parts.append(rbox('hopper', 'panel', (W - 0.05, 1.0, 1.9), (0, b0 - 0.45, z0 + 0.95), 0.2, 3))
        parts.append(box('stripe', 'plate', (W + 0.02, b1 - b0 - 0.2, 0.12), (0, (b0 + b1) / 2, z0 + 0.5)))
        parts += tail_end(b0 - 0.95, W, z0 + 0.3)
        parts += truck_wheels([yf - 0.9, -L / 2 + 1.9], R, W)
    elif kind == 'mixer':         # concrete mixer: cab and the tilted drum
        L, W, R = 8.6, 2.39, 0.5
        yf, depth, cabH, z0 = L / 2, 1.8, 1.9, 0.95
        parts += cab_over(yf, W, cabH, depth, z0, paint='cab')
        parts += chassis(-L / 2 + 0.2, yf - 0.4, W, 0.8)
        # drum: lathe about its own axis, tilted up toward the rear
        prof = [(0.3, -3.0), (0.75, -2.7), (1.05, -2.2), (1.18, -1.5), (1.2, -0.8), (1.18, 0.0), (1.12, 0.6), (0.98, 1.3), (0.8, 1.9), (0.35, 2.4)]
        drum = lathe('drum', 'body', [(r, x) for r, x in prof], 40, (0, 0, 0), 1)
        drum.rotation_euler = (0, 0, math.pi / 2)           # its axis from x to y
        drum.location = (0, -0.5, z0 + 1.35)
        bpy.ops.object.select_all(action='DESELECT'); drum.select_set(True); bpy.context.view_layer.objects.active = drum
        bpy.ops.object.transform_apply(location=True, rotation=True)
        drum.rotation_euler = (math.radians(-12), 0, 0)
        bpy.ops.object.transform_apply(rotation=True)
        parts.append(drum)
        for k in range(3):   # the painted spiral bands
            band = lathe('band', 'panel', [(1.21, -0.1 + k * 0.9 - 1.0), (1.21, 0.15 + k * 0.9 - 1.0)], 28, (0, 0, 0), 1)
            band.rotation_euler = (0, 0, math.pi / 2); band.location = (0, -0.5, z0 + 1.35)
            bpy.ops.object.select_all(action='DESELECT'); band.select_set(True); bpy.context.view_layer.objects.active = band
            bpy.ops.object.transform_apply(location=True, rotation=True)
            band.rotation_euler = (math.radians(-12), 0, 0); bpy.ops.object.transform_apply(rotation=True)
            parts.append(band)
        parts.append(box('chute', 'trim', (0.3, 1.0, 0.1), (0, -L / 2 + 0.3, z0 + 0.9)))
        parts += tail_end(-L / 2, W, z0 + 0.2)
        parts += truck_wheels([yf - 0.9, -L / 2 + 2.2, -L / 2 + 1.0], R, W)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    return bpy.context.active_object


TRUCKS = ['cargo', 'boxtruck', 'bus', 'container', 'garbage', 'mixer']

blob = bytearray()
meta = {'kinds': {}}
def put(b):
    global blob
    while len(blob) % 4:
        blob.append(0)
    off = len(blob); blob += b; return off
import os
PREVIEW = os.environ.get('CAR_PREVIEW')
def preview(car, path):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = 900, 500
    colours = {'body': (0.8, 0.8, 0.82, 1), 'glass': (0.05, 0.07, 0.1, 1), 'trim': (0.03, 0.03, 0.03, 1), 'rim': (0.6, 0.6, 0.62, 1), 'chrome': (0.7, 0.7, 0.72, 1),
               'lamp': (1, 0.95, 0.8, 1), 'tail': (0.8, 0.05, 0.05, 1), 'plate': (1, 1, 1, 1), 'signal': (1, 0.8, 0.2, 1), 'tyre': (0.02, 0.02, 0.02, 1), 'panel': (0.78, 0.8, 0.82, 1), 'cab': (0.92, 0.92, 0.9, 1)}
    for m in car.data.materials:
        if not m: continue
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = colours.get(m.name.split('.')[0], (1, 0, 1, 1))
    world = scene.world or bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.9, 0, 0.6); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    import mathutils
    r = max(car.dimensions) * 0.95
    cam.location = (r * 0.8, r * 1.0, r * 0.45)
    d = Vector((0, 0, car.dimensions.z * 0.4)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
for kind, sp in list(SPECS.items()) + [(t, None) for t in TRUCKS]:
    if PREVIEW and kind != PREVIEW: continue
    car = build(kind, sp) if sp else truck(kind)
    if PREVIEW:
        preview(car, os.environ['CAR_PREVIEW_OUT']); break
    pos, nor, uv, idx = export(car)
    n = len(pos) // 3
    # (flat per-triangle arrays; indices kept for the format)
    P = struct.pack(f'<{len(pos)}f', *pos)
    N = b''.join(struct.pack('<4b', *(max(-127, min(127, int(round(c * 127)))) for c in nor[i * 3:i * 3 + 3]), 0) for i in range(n))
    U = struct.pack(f'<{len(uv)}H', *(int(round(max(0, min(1, c)) * 65535)) for c in uv))
    I = struct.pack(f'<{len(idx)}H', *idx) if n < 65536 else None
    meta['kinds'][kind] = dict(verts=n, index=len(idx), pos=put(P), nor=put(N), uv=put(U), idx=put(I))
    print('car', kind, 'tris', len(idx) // 3, flush=True)
(public / 'cars.bin').write_bytes(bytes(blob))
(public / 'cars.json').write_text(json.dumps(meta, separators=(',', ':')))
print('cars.bin', len(blob))
