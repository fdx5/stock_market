"""Model KOSPIMAP's v5 trading atrium in Blender, bake its lighting and export glTF.

    blender -b --factory-startup --python scripts/build_exchange_atrium.py -- <sources> <out dir> [--samples N] [--preview]

Then: python scripts/glb_webp.py <out>/trading-hall-v5.glb <out>/hall-webp.glb and
gltfpack -i <out>/hall-webp.glb -o trading-hall-v5.glb -cc -kn -km -ke -kv -vt 14 -vp 16.

The plan comes from layout.json (scripts/exchange_layout.py), three.js metres, angles from +z
toward +x. Blender's (x, y, z) = three's (x, -z, y). Groups: shell and fixtures are lightmapped
(Cycles bake), emit holds lamps, glass and LED strips, props are lit by the hall panorama,
bakeonly is removed before export (screen stand-ins that light the bake and the previews).
"""
import argparse
from collections import defaultdict
import json
from math import atan2, cos, degrees, hypot, pi, radians, sin, sqrt
from pathlib import Path
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = json.loads((ROOT / "frontend/src/exchange/layout.json").read_text(encoding="utf-8"))
RAD = LAYOUT["radii"]
R_WALL, R_GAL, R_COL, R_OFF = RAD["wall"], RAD["gallery"], RAD["column"], RAD["office"]
H = LAYOUT["room"]["height"]
LEVELS = LAYOUT["levels"]
GROUPS = defaultdict(list)
MAT = {}
VERSION = "v5"
rng = random.Random(5)


def P(x, y, z):
    return Vector((x, -z, y))


def pol(r, t):
    return r * sin(radians(t)), r * cos(radians(t))


def rot(yaw=0.0, tilt=0.0):
    return Matrix.Rotation(radians(yaw), 4, "Z") @ Matrix.Rotation(radians(tilt), 4, "X")


# ---------------------------------------------------------------- materials
def _principled(name, color, roughness, metal=0.0, emit=0.0, emit_color=None, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*(emit_color or color), 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*color, 1)
    m.use_backface_culling = alpha >= 1 and not emit
    return m


def textured(key, name, root, metal=0.0, normal=0.6, tint=None):
    m = _principled(name, (.5, .5, .5), .5, metal)
    nt, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nt.get("Principled BSDF")
    uv = nt.new("ShaderNodeUVMap")
    uv.uv_map = "Surface"
    for channel in ("color", "roughness", "normal"):
        tex = nt.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(root / f"{key}-{channel}.jpg"), check_existing=True)
        links.new(uv.outputs["UV"], tex.inputs["Vector"])
        if channel != "color":
            tex.image.colorspace_settings.name = "Non-Color"
        if channel == "color":
            if tint:
                mix = nt.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1
                mix.inputs[7].default_value = (*tint, 1)
                links.new(tex.outputs["Color"], mix.inputs[6])
                links.new(mix.outputs[2], bsdf.inputs["Base Color"])
            else:
                links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        elif channel == "roughness":
            links.new(tex.outputs["Color"], bsdf.inputs["Roughness"])
        else:
            nm = nt.new("ShaderNodeNormalMap")
            nm.uv_map = "Surface"
            nm.inputs["Strength"].default_value = normal
            links.new(tex.outputs["Color"], nm.inputs["Color"])
            links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metal
    m.use_backface_culling = True
    return m


def emissive_image(name, path, strength, uv_map="Surface"):
    """Black glass whose emission comes from an image (LED strips): exports as an emissive texture."""
    m = _principled(name, (.01, .012, .016), .18)
    nt, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nt.get("Principled BSDF")
    tex = nt.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(path), check_existing=True)
    uv = nt.new("ShaderNodeUVMap")
    uv.uv_map = uv_map
    links.new(uv.outputs["UV"], tex.inputs["Vector"])
    links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = True
    return m


def make_materials(src, out):
    r = src / "materials"
    MAT["stone"] = textured("stone", "Honed light stone", r, normal=.2)
    MAT["trav"] = textured("trav", "Warm travertine", r, normal=.35)
    MAT["oak"] = textured("veneer", "Light oak veneer", r, normal=.55)
    MAT["oakv"] = textured("veneerv", "Light oak veneer, vertical grain", r, normal=.55)
    MAT["deck"] = textured("oak", "Oak floorboards", r, normal=.4)
    MAT["darkoak"] = textured("veneer", "Smoked oak veneer", r, normal=.55, tint=(.5, .45, .4))
    MAT["carpet"] = textured("carpet", "Charcoal carpet tile", r, normal=.8, tint=(.62, .62, .64))
    MAT["weave"] = textured("weave", "Linen weave", r, normal=.6)
    MAT["screenfab"] = textured("weave", "Grey acoustic fabric", r, normal=.6, tint=(.58, .6, .62))
    MAT["plaster"] = textured("plaster", "Soft white plaster", r, normal=.3)
    MAT["leather"] = textured("leather", "Dark leather", r, normal=.6)
    MAT["steel"] = textured("steel", "Graphite metal", r, metal=1, normal=.2, tint=(.3, .3, .32))
    MAT["silver"] = textured("steel", "Satin aluminium", r, metal=1, normal=.2, tint=(.8, .8, .82))
    MAT["white"] = _principled("Warm white laminate", (.82, .8, .76), .38)
    MAT["black"] = _principled("Black metal", (.012, .012, .014), .3, .4)
    MAT["bezel"] = _principled("Display bezel", (.004, .004, .005), .22, .2)
    MAT["mesh"] = textured("carpet", "Black knit mesh", r, normal=1.0, tint=(.16, .16, .17))
    MAT["mesh"].use_backface_culling = False     # upholstery: visible from both sides
    MAT["soil"] = _principled("Planter soil", (.05, .035, .025), .95)
    MAT["water"] = _principled("Reflecting pool", (.03, .07, .075), .04)
    MAT["ceramic"] = _principled("Glazed ceramic", (.86, .84, .8), .22)
    MAT["keys"] = _principled("Keycaps", (.035, .035, .04), .5)
    MAT["artwall"] = textured("plaster", "Gallery wall", r, normal=.25, tint=(.97, .95, .92))
    MAT["framewood"] = textured("veneer", "Frame oak", r, normal=.4, tint=(.42, .36, .3))
    MAT["artcanvas"] = _principled("Artwork canvas", (.5, .5, .5), .6)
    MAT["paper"] = _principled("Notebook cover", (.62, .58, .52), .8)
    MAT["phoneglow"] = _principled("Phone display", (.2, .45, .7), .3, 0, emit=1.5, emit_color=(.35, .6, .95))
    # Emitters (group emit).
    MAT["glass"] = _principled("Balustrade glass", (.6, .66, .68), .04, 0, alpha=.22)
    MAT["officeglass"] = _principled("Office glass", (.55, .6, .62), .05, 0, alpha=.3)
    MAT["skylight"] = _principled("Daylight glazing", (.86, .92, 1.0), .2, 0, emit=2.1, emit_color=(.86, .92, 1.0))
    MAT["cove"] = _principled("Warm cove light", (1.0, .82, .6), .4, 0, emit=4.5, emit_color=(1.0, .8, .58))
    MAT["downlight"] = _principled("Downlight lens", (1.0, .9, .76), .3, 0, emit=8, emit_color=(1.0, .9, .76))
    MAT["officelight"] = _principled("Office ceiling light", (1.0, .95, .88), .3, 0, emit=4.0, emit_color=(1.0, .95, .88))
    MAT["filament"] = _principled("Light core filament", (.7, .92, 1.0), .2, 0, emit=9, emit_color=(.62, .9, 1.0))
    MAT["coreglow"] = _principled("Light core glow", (.5, .8, 1.0), .2, 0, emit=2.4, emit_color=(.45, .78, 1.0))
    MAT["street"] = _principled("Daylight glazing", (.8, .86, .92), .2, 0, emit=1.2, emit_color=(.82, .88, .96))
    MAT["datarain"] = emissive_image("Column data strip", out / "datarain.png", 3.2)


def data_rain(path):
    """A tall LED strip texture: columns of small cyan/blue figure blocks, as on the concept columns."""
    w, h = 64, 1024
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[:] = (.004, .01, .02)
    for col in range(0, w, 8):
        y = 0
        while y < h:
            run = rng.randint(2, 7)
            if rng.random() < .62:
                c = rng.choice([(.25, .75, 1.0), (.15, .45, 1.0), (.6, .95, 1.0), (.1, .9, .75)])
                k = rng.uniform(.35, 1.0)
                for j in range(run):
                    yy = y + j * 5
                    if yy + 3 < h:
                        img[yy:yy + 3, col + 1:col + 6] = [v * k * (1 - j * .08) for v in c]
            y += run * 5 + rng.randint(2, 18)
    bimg = bpy.data.images.new("datarain", w, h, alpha=False)
    rgba = np.concatenate([img[::-1], np.ones((h, w, 1), np.float32)], axis=2)
    bimg.pixels.foreach_set(rgba.ravel())
    bimg.filepath_raw = str(path)
    bimg.file_format = "PNG"
    bimg.save()


# ---------------------------------------------------------------- geometry helpers
def _uv_box(mesh, tile):
    uv = mesh.uv_layers.get("Surface") or mesh.uv_layers.new(name="Surface")
    for face in mesh.polygons:
        n = face.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        u, v = ((1, 2), (0, 2), (0, 1))[axis]
        for li in face.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (co[u] / tile, co[v] / tile)


def emit_object(name, verts, faces, mat, group, matrix, tile=1.0, bevel=0.0, segments=2, world_uv=True, smooth=False,
                uv=None, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if recalc and len(faces) > 1:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    if bevel:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=.5, clamp_overlap=True)
        bm.to_mesh(me)
        bm.free()
    me.transform(matrix)
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=radians(35))
    if uv is not None:
        layer = me.uv_layers.new(name="Surface")
        for poly in me.polygons:
            for li in poly.loop_indices:
                layer.data[li].uv = uv[me.loops[li].vertex_index]
    elif world_uv:
        _uv_box(me, tile)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    me.materials.append(MAT[mat] if isinstance(mat, str) else mat)
    GROUPS[group].append(obj)
    return obj


def box(name, x, y, z, w, h, d, mat, group="fixtures", *, bevel=0.0, yaw=0.0, tilt=0.0, tile=1.0, segments=2):
    a, b, c = w / 2, d / 2, h / 2
    verts = [(sx * a, -sz * b, sy * c) for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 1, 3, 2)[::-1], (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    return emit_object(name, verts, faces, mat, group, Matrix.Translation(P(x, y, z)) @ rot(yaw, tilt), tile, bevel, segments)


def oriented(screen, du, dv, dn, w, h, d, mat, group="fixtures", bevel=0.0):
    """A box in a flat screen's local frame (u right, v up, n out of the face)."""
    r = rot(screen["yaw"], screen.get("tilt", 0))
    c = P(screen["x"], screen["y"], screen["z"]) + r.to_3x3() @ Vector((du, -dn, dv))
    a, b, cc = w / 2, d / 2, h / 2
    verts = [(sx * a, -sz * b, sy * cc) for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
    faces = [(2, 3, 1, 0), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    return emit_object("screen part", verts, faces, mat, group, Matrix.Translation(c) @ r, .6, bevel)


def lathe(name, x, y, z, profile, mat, group="fixtures", sides=48, tile=1.0, smooth=True, caps=True, cyl=False):
    """Revolve (radius, height) points around the vertical axis at (x, y, z).
    cyl: wrap UVs around the surface (u = arc length, v = height) instead of box projection."""
    verts, faces, uv = [], [], {}
    n = len(profile)
    rings = sides + 1 if cyl else sides
    r_ref = max(r for r, _ in profile) or 1.0
    for i in range(rings):
        t = 2 * pi * i / sides
        for r, h in profile:
            if cyl:
                uv[len(verts)] = (t * r_ref / tile, h / tile)
            verts.append((cos(t) * r, sin(t) * r, h))
    for i in range(sides):
        j = i + 1 if cyl else (i + 1) % sides
        for k in range(n - 1):
            faces.append((i * n + k, j * n + k, j * n + k + 1, i * n + k + 1))
    if caps and profile[0][0] > 1e-4:
        verts.append((0, 0, profile[0][1]))
        c = len(verts) - 1
        uv[c] = (0, 0)
        faces += [(c, ((i + 1) % rings) * n, i * n) for i in range(sides)]
    if caps and profile[-1][0] > 1e-4:
        verts.append((0, 0, profile[-1][1]))
        c = len(verts) - 1
        uv[c] = (0, 0)
        faces += [(c, i * n + n - 1, ((i + 1) % rings) * n + n - 1) for i in range(sides)]
    return emit_object(name, verts, faces, mat, group, Matrix.Translation(P(x, y, z)), tile, smooth=smooth, uv=uv if cyl else None)


def sector(name, r0, r1, y0, y1, a0, a1, mat, group="fixtures", *, step=.6, tile=1.0, faces_on="all", segs=None):
    """Annular sector solid between radii r0..r1, heights y0..y1, angles a0..a1 (deg, from +z toward +x)."""
    full = abs((a1 - a0) - 360) < 1e-6
    n = segs or max(4, int(radians(a1 - a0) * r1 / step))
    verts, faces, uv = [], [], {}
    cols = n + 1
    r_ref, dr, dy = (r0 + r1) / 2, r1 - r0, y1 - y0
    around = (0, dr, dr + dy, 2 * dr + dy)     # perimeter of the section: v across the member
    for i in range(cols):
        t = a0 + (a1 - a0) * i / n
        for k, (r, y) in enumerate(((r0, y0), (r1, y0), (r1, y1), (r0, y1))):
            x, z = pol(r, t)
            uv[len(verts)] = (radians(t) * r_ref / tile, around[k] / tile)
            verts.append(tuple(P(x, y, z)))
    for i in range(n):
        j = i + 1
        o, q = i * 4, j * 4
        quads = {"bottom": (o, q, q + 1, o + 1), "outer": (o + 1, q + 1, q + 2, o + 2),
                 "top": (o + 2, q + 2, q + 3, o + 3), "inner": (o + 3, q + 3, q, o)}
        for key, f in quads.items():
            if faces_on == "all" or key in faces_on:
                faces.append(f)
    if not full and faces_on == "all":
        faces += [(0, 1, 2, 3)[::-1], (n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3)]
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, uv=uv)


def arc_surface(name, r, y0, y1, a0, a1, mat, group, inward=True, step=.5, uv_fit=False):
    """A curved, single-sided surface (glass, screens): normals toward the centre when inward."""
    n = max(3, int(radians(abs(a1 - a0)) * r / step))
    verts, faces, uv = [], [], {}
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        x, z = pol(r, t)
        for k, y in enumerate((y0, y1)):
            verts.append(tuple(P(x, y, z)))
            if uv_fit:
                uv[len(verts) - 1] = ((1 - i / n) if inward else i / n, k)
    for i in range(n):
        o = i * 2
        faces.append((o, o + 2, o + 3, o + 1) if inward else (o, o + 1, o + 3, o + 2))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), 1.0, uv=uv if uv_fit else None, recalc=False)


def sweep(name, pts, w, h, mat, group="shell", closed=False, tile=1.0, smooth=False):
    """Rectangular section (w across, h along the up-ish normal) along a polyline of three-coordinates."""
    vs = [P(*p) for p in pts]
    n = len(vs)
    verts, faces, uv = [], [], {}
    along = [0.0]
    for i in range(1, n):
        along.append(along[-1] + (vs[i] - vs[i - 1]).length)
    around = (0, w, w + h, 2 * w + h)
    for i in range(n):
        t = (vs[min(i + 1, n - 1)] - vs[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = t.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(t).normalized()
        for k, (su, sv) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            uv[len(verts)] = (along[i] / tile, around[k] / tile)
            verts.append(tuple(vs[i] + side * (su * w / 2) + up * (sv * h / 2)))
    m = n if closed else n - 1
    for i in range(m):
        j = (i + 1) % n
        for k in range(4):
            a, b = i * 4 + k, i * 4 + (k + 1) % 4
            c, d = j * 4 + (k + 1) % 4, j * 4 + k
            faces.append((a, b, c, d))
    if not closed:
        faces += [(3, 2, 1, 0), ((n - 1) * 4, (n - 1) * 4 + 1, (n - 1) * 4 + 2, (n - 1) * 4 + 3)]
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, smooth=smooth, uv=uv)


def slat_wall(name, r, y0, y1, a0, a1, mat, group="shell", width=.07, depth=.045, pitch=.15, tile=1.6):
    """Vertical slat cladding on a circle, facing the centre, as one mesh. Grain runs up each slat
    (u = height with the horizontal-grain veneer), v across the slat face."""
    verts, faces, uv = [], [], {}
    n = int(radians(a1 - a0) * r / pitch)
    for i in range(n):
        t = a0 + (a1 - a0) * (i + .5) / n
        sx, sz = sin(radians(t)), cos(radians(t))
        tx, tz = cos(radians(t)), -sin(radians(t))             # tangent
        base = len(verts)
        off = rng.uniform(0, 3)                                 # each slat starts at a different grain spot
        for k, (u_, d_) in enumerate(((-1, 0), (1, 0), (1, 1), (-1, 1))):
            for y in (y0, y1):
                x = (r - d_ * depth) * sx + u_ * width / 2 * tx
                z = (r - d_ * depth) * sz + u_ * width / 2 * tz
                uv[len(verts)] = ((y + off) / tile, (i * pitch + (u_ + 1) / 2 * width + d_ * depth) / tile)
                verts.append(tuple(P(x, y, z)))
        # corners 0..3 each with (bottom, top): index base + 2k (+1 top)
        q = lambda k, top: base + 2 * k + top
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((q(k, 0), q(k2, 0), q(k2, 1), q(k, 1)))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, uv=uv)


# ---------------------------------------------------------------- architecture
def build_floor():
    disc_profile = [(0, 0), (R_WALL + .2, 0), (R_WALL + .2, -.3), (0, -.3)]
    lathe("Ground stone", 0, 0, 0, disc_profile, "stone", "shell", sides=128, tile=1.6, smooth=False)
    aisles, aw = LAYOUT["aisles"], LAYOUT["aisleWidth"]
    # Carpet fields between the aisles, from the plaza ring to the lounges.
    for i, a in enumerate(aisles):
        b = aisles[(i + 1) % len(aisles)] + (360 if i == len(aisles) - 1 else 0)
        for r0, r1 in ((6.9, 17.0),):
            pad = degrees(aw / 2 / r1) + .4
            sector("Carpet field", r0, r1, 0, .012, a + pad + .9, b - pad - .9, "carpet", "shell", tile=1.0, faces_on=("top", "inner", "outer"))
    # Concentric metal inlays and the plaza medallion rings around the core.
    for r in (4.0, 6.85, 17.05):
        sector("Floor inlay", r - .03, r + .03, 0, .004, 0, 360, "silver", "fixtures", faces_on=("top",))
    for r in (3.4, 3.55):
        sector("Plaza ring", r - .05, r + .05, 0, .004, 0, 360, "darkoak", "fixtures", faces_on=("top",))


def build_galleries():
    for li, y in enumerate(LEVELS):
        # Slab, fascia (travertine band) and the warm cove under its lip.
        sector("Gallery slab", R_GAL + .2, R_WALL, y - .42, y, 0, 360, "stone", "shell", tile=1.6, faces_on=("top",))
        sector("Gallery soffit", R_GAL + .2, R_WALL, y - .42, y - .42, 0, 360, "plaster", "shell", faces_on=("bottom",), tile=2)
        sector("Gallery fascia", R_GAL - .06, R_GAL + .2, y - .98, y + .02, 0, 360, "trav", "shell", tile=1.2)
        sector("Fascia cove", R_GAL + .21, R_GAL + .26, y - 1.0, y - .97, 0, 360, "cove", "emit", faces_on=("bottom",))
        # Oak slat ceiling under each gallery (concentric slats), lit by downlights.
        for k in range(16):
            r = R_GAL + .45 + k * .27
            if r > R_WALL - .15:
                break
            sector("Gallery slat", r, r + .1, y - .5, y - .43, 0, 360, "oak", "shell", step=.9, faces_on=("bottom", "inner", "outer"), tile=1.4)
        for t in np.arange(3.75, 360, 7.5):
            x, z = pol(23.2, t)
            box("Gallery downlight", x, y - .505, z, .14, .01, .14, "downlight", "emit")
        # Balustrade: glass, oak handrail, slim posts; open where a landing or an elevator meets the gallery.
        for a0, a1 in rail_runs(li + 1):
            arc_surface("Balustrade", R_GAL + .1, y + .05, y + 1.08, a0, a1, "glass", "emit", inward=True, step=1.2)
            sector("Handrail", R_GAL + .03, R_GAL + .17, y + 1.06, y + 1.13, a0, a1, "oak", "fixtures", step=.8)
            for t in np.arange(a0, a1 + .01, 6 if a1 - a0 > 12 else max(1.0, (a1 - a0) / 2)):
                x, z = pol(R_GAL + .1, t)
                box("Rail post", x, y + .58, z, .035, 1.06, .035, "silver", "fixtures")
        # Office glass fronts with mullions, lit interiors, back walls of oak and plaster.
        top = (LEVELS[li + 1] - .45) if li + 1 < len(LEVELS) else H - .5
        build_offices(y, top, li + 1)
    # Ground floor offices under gallery 1, with the entrance break in the south.
    build_offices(0.0, LEVELS[0] - .45, 0)
    # Outer wall: closes the drum behind the offices.
    arc_surface("Outer wall", R_WALL, 0, H, 0, 360, "plaster", "shell", inward=True, step=1.0)


def rail_runs(level):
    """The balustrade arcs on a gallery level, with the openings (landings, elevator doors) cut out."""
    cuts = sorted((o["a0"], o["a1"]) for o in LAYOUT["openings"] if o["level"] == level)
    runs, start = [], 0.0
    for a0, a1 in cuts:
        if a0 > start:
            runs.append((start, a0))
        start = max(start, a1)
    if start < 360:
        runs.append((start, 360.0))
    return runs


ART_HALF = 3.9   # degrees: half the width of an art bay at the office line (~3.3 m)


def glass_runs(a0, a1, level):
    bays = sorted(w["t"] for w in LAYOUT.get("artWalls", []) if w["level"] == level)
    runs, start = [], a0
    for t in bays:
        if t - ART_HALF > start:
            runs.append((start, t - ART_HALF))
        start = max(start, t + ART_HALF)
    if start < a1:
        runs.append((start, a1))
    return runs


def build_art_bay(w, y0, y1):
    """A solid wall bay in the office line: warm plaster, a framed painting and a picture light."""
    t = w["t"]
    sector("Art wall", R_OFF - .02, R_WALL - .05, y0, y1, t - ART_HALF, t + ART_HALF, "artwall", "shell", step=.4)
    sector("Art wall reveal", R_OFF - .03, R_OFF - .02, y0, y0 + .12, t - ART_HALF, t + ART_HALF, "darkoak", "fixtures", step=.4)
    x, z = pol(R_OFF - .05, t)
    yaw = t + 180
    fw, fh = w["w"] + .1, w["h"] + .1
    for du, dv, bw, bh in ((0, fh / 2 - .025, fw, .05), (0, -fh / 2 + .025, fw, .05), (fw / 2 - .025, 0, .05, fh), (-fw / 2 + .025, 0, .05, fh)):
        ox, oz = cos(radians(t + 180 - 90)) * 0, 0
        tx, tz = cos(radians(t)), -sin(radians(t))          # tangent (screen-right when facing the wall)
        box("Art frame", x + tx * du, w["cy"] + dv, z + tz * du, bw, bh, .05, "framewood", "fixtures", yaw=yaw)
    box("Art backing", x, w["cy"], z, fw - .04, fh - .04, .02, "black", "fixtures", yaw=yaw)
    # The canvas: its own node, textured in the browser from art/<id>-1k.webp (and opened in the viewer).
    cx, cz = pol(R_OFF - .085, t)
    a, b = w["w"] / 2, w["h"] / 2
    canvas = emit_object(f"Artwork:{w['id']}", [(-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b)], [(0, 1, 2, 3)], "artcanvas", "props",
                         Matrix.Translation(P(cx, w["cy"], cz)) @ rot(yaw), uv={0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}, recalc=False)
    lx, lz = pol(R_OFF - .28, t)
    box("Picture light", lx, w["cy"] + w["h"] / 2 + .2, lz, min(1.0, w["w"] * .6), .04, .07, "steel", "fixtures", yaw=yaw)
    box("Picture light lens", lx, w["cy"] + w["h"] / 2 + .178, lz, min(.96, w["w"] * .58), .006, .05, "downlight", "emit", yaw=yaw)
    ax, az = pol(R_OFF - .16, t)
    box("Picture light arm", ax, w["cy"] + w["h"] / 2 + .2, az, .02, .02, .22, "steel", "fixtures", yaw=t)


def build_offices(y0, y1, level):
    """The promenade's outer wall: vertical oak slats with art bays and a warm wall-wash line.
    (The glass offices and their tables are gone: the ring is open walking space.)"""
    slat_wall("Promenade slat wall", R_WALL - .04, y0 + .1, y1 - .14, 0, 360, "oak")
    sector("Slat wall shadow gap", R_WALL - .03, R_WALL, y0, y1, 0, 360, "darkoak", "shell", faces_on=("inner",), step=1.2)
    sector("Wall wash line", R_WALL - .35, R_WALL - .3, y1 - .06, y1 - .04, 0, 360, "cove", "emit", faces_on=("bottom",), step=1.2)
    for w in LAYOUT.get("artWalls", []):
        if w["level"] == level:
            build_art_bay(w, y0, y1)

def build_columns():
    for t in LAYOUT["columnAngles"]:
        x, z = pol(R_COL, t)
        lathe("Column base", x, 0, z, [(.7, 0), (.7, .28), (.64, .34), (0, .34)], "trav", "shell", sides=40, tile=1.2)
        lathe("Column", x, .34, z, [(.58, 0), (.56, .7), (.54, 15.66), (.62, 16.06), (.66, 16.26), (0, 16.26)],
              "oakv", "shell", sides=48, tile=2.2, cyl=True)
        for yy in LEVELS:   # slim bronze-dark collars where the galleries meet the column
            lathe("Column collar", x, yy - .5, z, [(.6, 0), (.6, .06), (0, .06)], "steel", "fixtures", sides=40)
        # LED data strip on the column's inner face, as on the concept boards.
        ix, iz = pol(R_COL - .55, t)
        box("Column strip frame", ix, 8.6, iz, .44, 13.8, .06, "black", "fixtures", yaw=t)
        # the LED strip itself is a live screen (layout kind "strip"), drawn by the browser
    # Branching: each column top splits into two pointed arches toward its neighbours and one rib to the oculus.
    cols = LAYOUT["columnAngles"]
    for i, t in enumerate(cols):
        t2 = cols[(i + 1) % len(cols)] + (360 if i == len(cols) - 1 else 0)
        pts = []
        for k in range(25):
            u = k / 24
            a = t + (t2 - t) * u
            y = 16.4 + 3.05 * (sin(pi * u) ** .75)
            r = R_COL - .35 * sin(pi * u)
            x, z = pol(r, a)
            pts.append((x, y, z))
        sweep("Gallery arch", pts, .5, .62, "oak", "shell", tile=2.4)
        # Radial rib to the oculus: rises from the column top, then runs almost level to the centre.
        rib = []
        for k in range(29):
            u = k / 28
            r = R_COL - (R_COL - 5.6) * u
            y = 16.4 + 3.35 * (1 - (1 - min(1, u * 3.2)) ** 2) - .25 * u
            x, z = pol(r, t)
            rib.append((x, y, z))
        sweep("Roof rib", rib, .46, .7, "oak", "shell", tile=2.4)
        # Warm LED line along the underside of each rib.
        line = [(px, py - .36, pz) for px, py, pz in rib]
        sweep("Rib cove", line, .06, .02, "cove", "emit")
        # Secondary rib half-way between columns.
        mid = t + 15
        sec = []
        for k in range(23):
            u = k / 22
            r = 19.0 - (19.0 - 5.6) * u
            x, z = pol(r, mid)
            sec.append((x, 19.3 - .05 * u, z))
        sweep("Roof sub-rib", sec, .22, .34, "oak", "shell", tile=2.4)


def arc_dummy_plane(name, x, y, z, yaw, w, h, mat, group, uv_repeat=(1, 1)):
    a, c = w / 2, h / 2
    verts = [(-a, 0, -c), (a, 0, -c), (a, 0, c), (-a, 0, c)]
    uv = {0: (0, 0), 1: (uv_repeat[0], 0), 2: (uv_repeat[0], uv_repeat[1]), 3: (0, uv_repeat[1])}
    return emit_object(name, verts, [(0, 1, 2, 3)], mat, group, Matrix.Translation(P(x, y, z)) @ rot(yaw), uv=uv, recalc=False)


def build_roof():
    # Ring beam over the galleries and the oculus ring around the light core.
    sector("Ring beam", R_COL - .6, R_WALL, 19.1, 19.75, 0, 360, "trav", "shell", tile=1.4)
    sector("Oculus ring", 5.0, 5.9, 19.2, 19.85, 0, 360, "trav", "shell", tile=1.2)
    sector("Oculus cove", 5.0, 5.08, 19.15, 19.2, 0, 360, "cove", "emit", faces_on=("bottom",))
    # Skylight: glazing between the ribs, with concentric mullions.
    sector("Skylight glazing", 5.9, R_COL - .6, 19.82, 19.86, 0, 360, "skylight", "emit", faces_on=("bottom",), step=1.0)
    for r in np.arange(7.0, R_COL - .6, 1.6):
        sector("Skylight mullion", r - .04, r + .04, 19.62, 19.82, 0, 360, "silver", "shell", step=1.0)
    for t in np.arange(0, 360, 7.5):
        (x0, z0), (x1, z1) = pol(5.9, t), pol(R_COL - .6, t)
        sweep("Skylight radial", [(x0, 19.72, z0), (x1, 19.72, z1)], .07, .18, "silver", "shell")
    # Roof slab above the glass (closes the box for the bake) and the oak soffit over the top gallery.
    sector("Roof slab", 0, R_WALL + .2, 20.0, 20.3, 0, 360, "plaster", "shell", faces_on=("bottom",), step=2.0)
    for k in range(18):
        r = R_COL - .4 + k * .25
        if r > R_WALL - .1:
            break
        sector("Roof slat", r, r + .1, 19.0, 19.08, 0, 360, "oak", "shell", step=.9, faces_on=("bottom", "inner", "outer"), tile=1.4)


def helix(r, a_from, a_to, y_from, y_to, dy=0.0, n=40):
    out = []
    for k in range(n + 1):
        u = k / n
        x, z = pol(r, a_from + (a_to - a_from) * u)
        out.append((x, y_from + (y_to - y_from) * u + dy, z))
    return out


def ribbon(name, path_lo, path_hi, mat, group):
    """A surface between two polylines (glass balustrades along a curved stair)."""
    verts, faces = [], []
    for lo, hi in zip(path_lo, path_hi):
        verts += [tuple(P(*lo)), tuple(P(*hi))]
    for i in range(len(path_lo) - 1):
        o = i * 2
        faces.append((o, o + 2, o + 3, o + 1))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), 1.0, recalc=False)


def build_stairs():
    walk = LAYOUT["walk"]
    for f in walk["flights"]:
        n, a_from, a_to, y0, y1 = f["steps"], f["aFrom"], f["aTo"], f["y0"], f["y1"]
        da, dy = (a_to - a_from) / n, (y1 - y0) / n
        for k in range(n):
            lo, hi = sorted((a_from + da * k, a_from + da * (k + 1)))
            y = y0 + dy * (k + 1)
            sector("Stair tread", f["r0"], f["r1"], y - .045, y, lo - .05, hi + .05, "oak", "fixtures", segs=2, tile=1.2)
            sector("Stair nosing light", f["r0"] + .03, f["r1"] - .03, y - .05, y - .045, lo, lo + (hi - lo) * .12, "cove", "emit",
                   segs=1, faces_on=("bottom",))
        # Folded-plate steel stringers on both edges, glass balustrades with oak rails above them.
        for r in (f["r0"] - .03, f["r1"] + .03):
            sweep("Stair stringer", helix(r, a_from, a_to, y0, y1, -.16), .05, .38, "steel", "fixtures")
            ribbon("Stair glass", helix(r, a_from, a_to, y0, y1, .02), helix(r, a_from, a_to, y0, y1, 1.0), "glass", "emit")
            sweep("Stair handrail", helix(r, a_from, a_to, y0, y1, 1.02), .06, .05, "oak", "fixtures", tile=1.5)
        # Soffit under the flight: a smooth white underside, as in cantilevered gallery stairs.
        lo_path = helix((f["r0"] + f["r1"]) / 2, a_from, a_to, y0, y1, -.36)
        sweep("Stair soffit", lo_path, f["r1"] - f["r0"] + .1, .02, "plaster", "fixtures")
    for L in walk["landings"]:
        y = L["y"]
        sector("Landing", L["r0"], L["r1"], y - .3, y, L["a0"], L["a1"], "stone", "fixtures", tile=1.4)
        sector("Landing edge", L["r0"] - .05, L["r0"], y - .32, y + .02, L["a0"], L["a1"], "trav", "fixtures")
        sector("Landing cove", L["r0"] + .05, L["r0"] + .1, y - .31, y - .3, L["a0"], L["a1"], "cove", "emit", faces_on=("bottom",))
        arc_surface("Landing glass", L["r0"] + .02, y + .02, y + 1.05, L["a0"], L["a1"], "glass", "emit", inward=False)
        sector("Landing rail", L["r0"] - .04, L["r0"] + .08, y + 1.03, y + 1.1, L["a0"], L["a1"], "oak", "fixtures")
        # The far end of the landing (away from the flights) closes with glass to the gallery edge.
        far = L["a0"] if (L["a1"] in (s_["aFrom"] for s_ in walk["flights"]) or L["a1"] in (s_["aTo"] for s_ in walk["flights"])) else L["a1"]
        x0, z0 = pol(L["r0"], far)
        x1, z1 = pol(R_GAL, far)
        ribbon("Landing end glass", [(x0, y + .02, z0), (x1, y + .02, z1)], [(x0, y + 1.05, z0), (x1, y + 1.05, z1)], "glass", "emit")


def build_elevators():
    """Two round panoramic cabins on guide rails at the gallery fronts. Cabins are separate nodes
    ("Elevator cabin N") that the browser moves; rails, caps and thresholds are static."""
    for e in LAYOUT["elevators"]:
        x, z, t, rc = e["x"], e["z"], e["t"], e["r"]
        out = 1                                                     # rails sit on the gallery side
        for side in (-1, 1):
            rx, rz = pol(LAYOUT["radii"]["gallery"] - .32, t + side * degrees(.55 / 20.25))
            box("Elevator rail", rx, 8.6, rz, .12, 17.2, .16, "steel", "fixtures", yaw=t)
        lathe("Elevator cap", x, 17.15, z, [(rc + .15, 0), (rc + .15, .35), (0, .35)], "steel", "fixtures", sides=48)
        sector("Elevator cap light", rc - .2, rc + .14, 17.14, 17.15, 0, 360, "cove", "emit", faces_on=("bottom",), segs=48) \
            if False else lathe("Elevator cap ring", x, 17.12, z, [(rc + .16, 0), (rc + .16, .03), (rc - .1, .03), (rc - .1, 0)], "cove", "emit", sides=48, caps=False)
        lathe("Elevator pit", x, 0, z, [(rc + .2, 0), (rc + .2, .02), (0, .02)], "steel", "fixtures", sides=48)
        for th in (q for q in LAYOUT["walk"]["thresholds"] if q["elevator"] == e["id"]):
            sector("Elevator threshold", th["r0"], th["r1"], th["y"] - .3, th["y"], th["a0"], th["a1"], "stone", "fixtures")
            for edge in (th["a0"], th["a1"]):
                xa, za = pol(th["r0"], edge)
                xb, zb = pol(LAYOUT["radii"]["gallery"], edge)
                ribbon("Threshold glass", [(xa, th["y"], za), (xb, th["y"], zb)], [(xa, th["y"] + 1.05, za), (xb, th["y"] + 1.05, zb)], "glass", "emit")
        # The cabin: floor, glass drum (open toward the gallery), ceiling with a light ring, handrail.
        cabin = bpy.data.objects.new(f"Elevator cabin {e['id']}", None)
        bpy.context.collection.objects.link(cabin)
        cabin.location = P(x, 0, z)
        group = f"cabin{e['id']}"
        door = t                                                    # opening faces the gallery (outward)
        parts = [
            lathe("Cabin floor", x, 0, z, [(rc, 0), (rc, .12), (0, .12)], "stone", group, sides=48),
            lathe("Cabin ceiling", x, 2.56, z, [(rc, 0), (rc, .14), (0, .14)], "white", group, sides=48),
            lathe("Cabin light", x, 2.55, z, [(rc - .1, 0), (rc - .1, .012), (rc - .3, .012), (rc - .3, 0)], "downlight", group, sides=48, caps=False),
            lathe("Cabin base ring", x, .12, z, [(rc + .02, 0), (rc + .02, .1), (rc - .02, .1), (rc - .02, 0)], "steel", group, sides=48, caps=False),
            lathe("Cabin top ring", x, 2.46, z, [(rc + .02, 0), (rc + .02, .1), (rc - .02, .1), (rc - .02, 0)], "steel", group, sides=48, caps=False),
        ]
        for a0, a1 in ((door + 32, door + 360 - 32),):
            def local_arc(r, y0, y1, mat, name):
                n = 28
                verts, faces = [], []
                for i in range(n + 1):
                    tt = a0 + (a1 - a0) * i / n
                    px, pz = pol(r, tt)
                    verts += [tuple(P(x + px, y0, z + pz)), tuple(P(x + px, y1, z + pz))]
                for i in range(n):
                    o = i * 2
                    faces.append((o, o + 2, o + 3, o + 1))
                return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), 1.0, recalc=False)
            parts.append(local_arc(rc - .01, .22, 2.46, "glass", "Cabin glass"))
            hand = [(x + pol(rc - .1, a0 + (a1 - a0) * i / 24)[0], .95, z + pol(rc - .1, a0 + (a1 - a0) * i / 24)[1]) for i in range(25)]
            parts.append(sweep("Cabin handrail", hand, .05, .05, "oak", group))
        doors = []
        for side, (d0, d1) in (("L", (door - 31, door)), ("R", (door, door + 31))):
            pivot = bpy.data.objects.new(f"Elevator door{side} {e['id']}", None)
            bpy.context.collection.objects.link(pivot)
            pivot.matrix_world = Matrix.Translation(P(x, 0, z))
            leaf = []
            n = 10
            verts, faces = [], []
            for i in range(n + 1):
                tt = d0 + (d1 - d0) * i / n
                px, pz = pol(rc - .05, tt)
                verts += [tuple(P(x + px, .22, z + pz)), tuple(P(x + px, 2.46, z + pz))]
            for i in range(n):
                o = i * 2
                faces.append((o, o + 2, o + 3, o + 1))
            leaf.append(emit_object("Cabin door glass", verts, faces, "glass", group, Matrix.Identity(4), 1.0, recalc=False))
            ex, ez = pol(rc - .05, d0 if side == "L" else d1)
            leaf.append(box("Cabin door edge", x + ex, 1.34, z + ez, .03, 2.24, .03, "silver", group))
            bpy.context.view_layer.update()
            for part in leaf:
                world = part.matrix_world.copy()
                part.parent = pivot
                part.matrix_parent_inverse = pivot.matrix_world.inverted()
                part.matrix_world = world
            doors.append(pivot)
        cabin.matrix_world = Matrix.Translation(P(x, 0, z))
        bpy.context.view_layer.update()
        for pivot in doors:
            world = pivot.matrix_world.copy()
            pivot.parent = cabin
            pivot.matrix_parent_inverse = cabin.matrix_world.inverted()
            pivot.matrix_world = world
        for part in parts:
            world = part.matrix_world.copy()
            part.parent = cabin
            part.matrix_parent_inverse = cabin.matrix_world.inverted()
            part.matrix_world = world
        GROUPS["cabins"].append(cabin)


def build_tower():
    tw = LAYOUT["tower"]
    lathe("Core plinth", 0, 0, 0, [(tw["plinth"], 0), (tw["plinth"], .3), (tw["plinth"] - .08, .38), (0, .38)], "trav", "fixtures", sides=72)
    sector("Plinth inlay", tw["plinth"] - .04, tw["plinth"] - .02, .3, .381, 0, 360, "cove", "emit", faces_on=("top",))
    lathe("Core base", 0, .38, 0, [(1.75, 0), (1.75, .5), (1.6, .62), (0, .62)], "black", "fixtures", sides=64)
    # Glass core with light filaments and a soft inner glow column.
    arc_surface("Core glass", tw["core"], 1.0, H, 0, 360, "glass", "emit", inward=False, step=.3)
    for k in range(28):
        t = k * 360 / 28 + rng.uniform(-3, 3)
        r = rng.uniform(.55, 1.3)
        x, z = pol(r, t)
        y0, y1 = 1.0 + rng.uniform(0, 1.5), H - rng.uniform(0, 2.0)
        box("Core filament", x, (y0 + y1) / 2, z, .035, y1 - y0, .035, "filament", "emit")
    lathe("Core glow", 0, 1.0, 0, [(.32, 0), (.32, H - 1.0)], "coreglow", "emit", sides=24, caps=False)
    # Ring housings behind the screen facets, with warm edge lines.
    for ring in tw["rings"]:
        y0, y1 = ring["y"] - ring["h"] / 2 - .08, ring["y"] + ring["h"] / 2 + .08
        lathe("Ring housing", 0, y0, 0, [(ring["r"] - .55, 0), (ring["r"] - .1, 0), (ring["r"] - .1, y1 - y0), (ring["r"] - .55, y1 - y0)],
              "black", "fixtures", sides=72, smooth=False)
        for yy in (y0 - .03, y1):
            sector("Ring lip", ring["r"] - .1, ring["r"] + .16, yy, yy + .03, 0, 360, "black", "fixtures", step=.4)
            sector("Ring light", ring["r"] + .15, ring["r"] + .165, yy, yy + .03, 0, 360, "cove", "emit", faces_on=("outer",), step=.4)
    for cr, cy, ch in ((LAYOUT["tower"]["crown"]["r"], LAYOUT["tower"]["crown"]["y"], LAYOUT["tower"]["crown"]["h"]), (2.45, 2.55, .62)):
        lathe("Ticker drum", 0, cy - ch / 2 - .06, 0, [(cr - .4, 0), (cr - .05, 0), (cr - .05, ch + .12), (cr - .4, ch + .12)], "black", "fixtures", sides=72, smooth=False)
    # Hangers: slender rods from the oculus ring to the rings.
    for k in range(6):
        t = k * 60 + 30
        x, z = pol(4.2, t)
        box("Hanger", x, 12.0, z, .03, 15.6, .03, "silver", "fixtures")


def build_counter():
    rc = LAYOUT["radii"]["counter"]
    aisles, aw = LAYOUT["aisles"], LAYOUT["aisleWidth"]
    for i, a in enumerate(aisles):
        b = aisles[(i + 1) % len(aisles)] + (360 if i == len(aisles) - 1 else 0)
        pad = degrees(aw / 2 / rc)
        sector("Counter body", rc - .5, rc, 0, 1.02, a + pad, b - pad, "oak", "fixtures", tile=1.0)
        sector("Counter top", rc - .58, rc + .06, 1.02, 1.07, a + pad - .3, b - pad + .3, "white", "fixtures")
        sector("Counter kick", rc - .02, rc + .005, .02, .1, a + pad, b - pad, "cove", "emit", faces_on=("outer",))


# ---------------------------------------------------------------- furniture
def chair(x, z, yaw):
    """Task chair: five-star base, column, mesh seat and back."""
    a = radians(yaw)
    for k in range(5):
        b = yaw + k * 72
        dx, dz = pol(.2, b)
        box("Chair leg", x + dx, .06, z + dz, .045, .035, .38, "silver", "fixtures", yaw=b)
    box("Chair column", x, .27, z, .05, .38, .05, "black", "fixtures")
    box("Chair seat", x, .49, z, .5, .07, .48, "mesh", "fixtures", yaw=yaw, bevel=.02)
    bx, bz = x - sin(a) * .25, z - cos(a) * .25
    box("Chair back", bx, .86, bz, .48, .56, .05, "mesh", "fixtures", yaw=yaw, tilt=-8, bevel=.02)
    for s in (-1, 1):
        ox, oz = cos(a) * .27 * s, -sin(a) * .27 * s
        box("Chair arm", x + ox, .66, z + oz, .05, .04, .3, "black", "fixtures", yaw=yaw)


def _bevelled(obj, width=.012, segments=1, subdiv=0):
    """Round off a part: bevel its edges (and optionally subdivide) so it catches light like a product."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=width, segments=segments, affect="EDGES", profile=.5, clamp_overlap=True)
    if subdiv:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=subdiv, use_grid_fill=True, smooth=1.0)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=radians(50))
    return obj


def make_task_chair():
    """Ergonomic task chair at the origin facing +z: five-star base on casters, gas lift, padded seat,
    curved mesh back on an aluminium frame with lumbar pad and headrest, padded T-arms."""
    g = "chairsrc"
    parts = []
    for k in range(5):                                   # five-star base: tapered arms + casters
        a = k * 72
        tip = pol(.31, a)
        parts.append(sweep("Chair base arm", [(0, .1, 0), (tip[0] * .6, .085, tip[1] * .6), (tip[0], .065, tip[1])], .045, .035, "silver", g, smooth=True))
        cx, cz = pol(.31, a)
        parts.append(lathe("Chair caster", cx, .0, cz, [(0, 0), (.028, .005), (.03, .03), (.026, .052), (0, .056)], "black", g, sides=12))
        parts.append(box("Caster fork", cx, .062, cz, .018, .03, .05, "black", g, yaw=a))
    parts.append(lathe("Chair hub", 0, .07, 0, [(.06, 0), (.065, .03), (.04, .06), (0, .06)], "silver", g, sides=20))
    parts.append(lathe("Gas lift", 0, .12, 0, [(.026, 0), (.026, .2), (0, .2)], "silver", g, sides=16))
    parts.append(lathe("Lift cover", 0, .12, 0, [(.04, 0), (.035, .14), (0, .14)], "black", g, sides=16))
    parts.append(_bevelled(box("Seat mechanism", 0, .34, 0, .24, .05, .26, "black", g), .01, 2))
    parts.append(_bevelled(box("Seat pan", 0, .38, .01, .5, .045, .48, "black", g), .015, 2))
    parts.append(_bevelled(box("Seat cushion", 0, .425, .02, .48, .06, .46, "mesh", g), .025, 2))
    # Back: curved mesh panel in a frame, slightly reclined.
    back = []
    for k in range(9):
        u = k / 8
        y = .5 + .5 * u
        bend = -.2 - .06 * sin(pi * u)                       # lumbar curve
        back.append((0, y, bend - .07 * u))
    for side in (-1, 1):
        parts.append(sweep("Back frame", [(side * .23, y, z) for (_, y, z) in back], .022, .03, "silver", g, smooth=True))
    # Back: an upholstered panel with thickness (front and back faces, closed edges) and a black
    # moulded shell behind it, so the back reads solid from every side.
    w, th = .22, .025
    front = [tuple(P(sx * w, y, z)) for (_, y, z) in back for sx in (-1, 1)]
    rear = [tuple(P(sx * w, y, z - th)) for (_, y, z) in back for sx in (-1, 1)]
    verts = front + rear
    n = len(back)
    faces = []
    for k in range(n - 1):
        a0, a1, b0, b1 = 2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3
        faces.append((a0, a1, b1, b0))                                  # upholstered front
        o = 2 * n
        faces.append((o + a0, o + b0, o + b1, o + a1))                  # rear face
        faces.append((a0, b0, o + b0, o + a0))                          # left edge
        faces.append((a1, o + a1, o + b1, b1))                          # right edge
    faces.append((0, 2 * n, 2 * n + 1, 1))                              # bottom edge
    faces.append((2 * n - 2, 2 * n - 1, 4 * n - 1, 4 * n - 2))          # top edge
    parts.append(emit_object("Back cushion", verts, faces, "mesh", g, Matrix.Identity(4), recalc=True))
    shell = [(0, y, z - th - .012) for (_, y, z) in back]
    parts.append(sweep("Back shell", shell, 2 * w + .03, .012, "black", g, smooth=True))
    parts.append(sweep("Back top rail", [(-.23, 1.0, -.27), (0, 1.02, -.28), (.23, 1.0, -.27)], .025, .03, "silver", g, smooth=True))
    parts.append(sweep("Back spine", [(0, .38, -.12), (0, .48, -.24), (0, .62, -.27)], .05, .02, "silver", g, smooth=True))
    parts.append(_bevelled(box("Lumbar pad", 0, .66, -.24, .34, .1, .03, "black", g, tilt=-6), .012, 2))
    parts.append(_bevelled(box("Headrest", 0, 1.12, -.29, .3, .12, .05, "mesh", g, tilt=-10), .02, 2))
    parts.append(box("Headrest post", 0, 1.04, -.285, .03, .1, .02, "silver", g))
    for side in (-1, 1):                                   # T-arms
        parts.append(box("Arm post", side * .25, .52, -.02, .03, .18, .05, "black", g))
        parts.append(_bevelled(box("Arm pad", side * .25, .62, .01, .08, .03, .26, "black", g), .012, 2))
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    chair = bpy.context.view_layer.objects.active
    chair.name = chair.data.name = "Task chair"
    GROUPS[g] = []
    return chair


def place_instances(source, placements, name, group="props"):
    """Linked duplicates of one mesh (exported as GPU instances): (x, y, z, yaw) in three space."""
    for x, y, z, yaw in placements:
        obj = bpy.data.objects.new(name, source.data)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(radians(yaw), 4, "Z")
        GROUPS[group].append(obj)


CHAIRS, CUPS, LAMPS = [], [], []


def build_desks():
    for d in LAYOUT["desks"]:
        r, a0, a1 = d["r"], d["a0"], d["a1"]
        sector("Desk top", r - .05, r + .78, .73, .77, a0, a1, "white", "fixtures", step=.5)
        sector("Desk edge band", r + .77, r + .79, .725, .775, a0, a1, "darkoak", "fixtures", step=.5)
        sector("Cable tray", r + .05, r + .25, .6, .62, a0 + .5, a1 - .5, "steel", "fixtures", step=.5)
        sector("Desk front", r - .05, r + .01, .06, .73, a0 + .3, a1 - .3, "oak", "fixtures", step=.5, tile=1.0)
        sector("Desk screen", r - .1, r - .04, .77, 1.04, a0, a1, "screenfab", "fixtures", step=.5)
        sector("Desk screen cap", r - .11, r - .03, 1.04, 1.06, a0, a1, "silver", "fixtures", step=.5)
        sector("Desk end", r - .05, r + .78, 0, .73, a0, a0 + degrees(.04 / r), "oak", "fixtures", segs=1)
        sector("Desk end", r - .05, r + .78, 0, .73, a1 - degrees(.04 / r), a1, "oak", "fixtures", segs=1)
    for s in LAYOUT["seats"]:
        r, t = s["r"], s["t"]
        x, z = pol(r + .38, t)
        box("Pedestal", *pol(r + .25, t + degrees(.42 / r))[:1], .3, pol(r + .25, t + degrees(.42 / r))[1], .4, .58, .5, "white", "fixtures", yaw=t)
        cx, cz = pol(r + 1.18, t)
        CHAIRS.append((cx, 0, cz, t + 180 + rng.uniform(-14, 14)))   # facing the desk
        # Desk life: keyboard (keycaps), mouse on a pad, desk phone, notebook, cup; a lamp at some seats.
        kx, kz = pol(r + .45, t)
        box("Keyboard", kx, .776, kz, .44, .018, .14, "black", "fixtures", yaw=t, bevel=.004)
        box("Keycaps", kx, .787, kz, .41, .006, .11, "keys", "fixtures", yaw=t)
        mx, mz = pol(r + .47, t - degrees(.33 / r))
        box("Mouse pad", mx, .771, mz, .22, .004, .19, "black", "fixtures", yaw=t)
        box("Mouse", mx, .784, mz, .06, .025, .1, "black", "fixtures", yaw=t, bevel=.01)
        px, pz = pol(r + .45, t + degrees(.5 / r))
        box("Desk phone", px, .8, pz, .2, .05, .18, "black", "fixtures", yaw=t + 12, bevel=.008)
        box("Phone display", px, .826, pz, .08, .004, .05, "phoneglow", "emit", yaw=t + 12)
        if rng.random() < .7:
            nx, nz = pol(r + .62, t + degrees(.62 / r))
            box("Notebook", nx, .78, nz, .21, .016, .29, rng.choice(["leather", "paper"]), "fixtures", yaw=t + rng.uniform(-20, 20), bevel=.003)
        if rng.random() < .6:
            ux, uz = pol(r + .58, t - degrees(.6 / r))
            CUPS.append((ux, .77, uz, rng.uniform(0, 360)))
        # (no desk lamps: removed at the owner's request)


def build_monitors():
    for s in LAYOUT["screens"]:
        kind = s["kind"]
        if kind in ("desk", "counter", "facet"):
            w, h = s["w"], s["h"]
            if kind == "facet":
                oriented(s, 0, 0, -.05, w + .05, h + .05, .08, "bezel")
                continue
            oriented(s, 0, 0, -.02, w + .03, h + .03, .03, "bezel", bevel=.004)
            oriented(s, 0, 0, -.045, w * .3, h * .3, .03, "black")
            # Every monitor stands on the desk: pole behind the screen down to a foot plate
            # (upper-tier poles pass behind the screen below them).
            reach = s["y"] - .77
            oriented(s, 0, -reach / 2, -.065, .045, reach, .03, "silver")
            oriented(s, 0, -reach + .005, -.08, min(.3, w * .4), .01, .18, "silver")
        elif kind == "arc":
            # Curved boards: a black backing a little larger than the picture.
            r = s["r"] + .06
            pad = degrees(.12 / r)
            sector("Board backing", r, r + .14, s["y"] - s["h"] / 2 - .12, s["y"] + s["h"] / 2 + .12, s["a0"] - pad, s["a1"] + pad, "bezel", "fixtures", step=.4)
            sector("Board light", r - .01, r, s["y"] - s["h"] / 2 - .13, s["y"] - s["h"] / 2 - .1, s["a0"] - pad, s["a1"] + pad, "cove", "emit", step=.4, faces_on=("inner",))
            # Visible mounting: a steel top rail tied back to the gallery fascia, and hanger rods up to
            # the slab above, so no board reads as floating.
            top = s["y"] + s["h"] / 2 + .12
            sector("Board top rail", r - .02, R_GAL + .05, top, top + .08, s["a0"] - pad, s["a1"] + pad, "steel", "fixtures", step=.4)
            above = min((lv - 1.0 for lv in LEVELS if lv - 1.0 >= top), default=None)
            for edge in (s["a0"] + 1.2, s["a1"] - 1.2):
                hx, hz = pol(r + .07, edge)
                if above is not None and above - top > .05:
                    box("Board hanger", hx, (top + above) / 2, hz, .035, above - top, .035, "silver", "fixtures")
                bx, bz = pol((r + R_GAL) / 2, edge)
                box("Board bracket", bx, top - .3, bz, .06, .5, R_GAL - r + .1, "steel", "fixtures", yaw=edge)


def curved_sofa(r, a0, a1, y=.14):
    """A curved modern sectional on the lounge arc, facing the centre: plinth, cushions, back, arms."""
    sector("Sofa plinth", r - .55, r + .32, y, y + .08, a0, a1, "darkoak", "fixtures", step=.3)
    sector("Sofa base", r - .52, r + .3, y + .08, y + .4, a0, a1, "weave", "fixtures", step=.3, tile=.3)
    n = max(3, int(radians(a1 - a0) * r / .95))
    gap = degrees(.025 / r)
    for k in range(n):
        c0 = a0 + (a1 - a0) * k / n + gap
        c1 = a0 + (a1 - a0) * (k + 1) / n - gap
        sector("Sofa cushion", r - .5, r + .05, y + .4, y + .53, c0, c1, "weave", "fixtures", step=.2, tile=.3)
        sector("Sofa back cushion", r + .05, r + .27, y + .53, y + .92, c0, c1, "weave", "fixtures", step=.2, tile=.3)
    sector("Sofa back", r + .27, r + .32, y + .08, y + .95, a0, a1, "weave", "fixtures", step=.3, tile=.3)
    for a in (a0, a1 - degrees(.18 / r)):
        sector("Sofa arm", r - .52, r + .3, y + .08, y + .66, a, a + degrees(.18 / r), "weave", "fixtures", segs=2, tile=.3)


def build_landscape():
    # Lounges: oak decks with sofas, lounge chairs, round tables and rugs, edged by low planters.
    for L in LAYOUT["lounges"]:
        t = L["t"]
        sector("Lounge deck", 17.1, 20.7, 0, .14, t - 11, t + 11, "deck", "fixtures", tile=1.2)
        sector("Lounge step", 16.95, 17.1, 0, .07, t - 11, t + 11, "trav", "fixtures")
        sector("Lounge rug", 17.7, 20.1, .142, .156, t - 7, t + 7, "weave", "fixtures", tile=1.5, faces_on=("top", "inner", "outer"))
        # Trough = rim walls around a lower soil bed (no coplanar faces: they flickered).
        sector("Lounge planter rim", 20.3, 20.38, .14, .8, t - 11, t + 11, "trav", "fixtures")
        sector("Lounge planter rim", 20.62, 20.7, .14, .8, t - 11, t + 11, "trav", "fixtures")
        for edge in (t - 11, t + 11 - degrees(.08 / 20.5)):
            sector("Lounge planter end", 20.38, 20.62, .14, .8, edge, edge + degrees(.08 / 20.5), "trav", "fixtures", segs=1)
        sector("Lounge planter soil", 20.38, 20.62, .14, .74, t - 10.8, t + 10.8, "soil", "fixtures")
        curved_sofa(19.55, t - 7.5, t + 7.5)
    for so in LAYOUT.get("sofas", []):
        curved_sofa(so["r"], so["t"] - so["span"] / 2, so["t"] + so["span"] / 2, y=so["y"])
    for w in LAYOUT["water"]:
        sector("Pool rim", w["r0"] - .12, w["r1"] + .12, 0, .42, w["a0"] - .5, w["a1"] + .5, "trav", "fixtures")
        sector("Pool water", w["r0"], w["r1"], .36, .37, w["a0"], w["a1"], "water", "fixtures", faces_on=("top",))
    # (the potted trees bring their own pots)


def import_prop(source, identifier, placements, group="props", scale=1.0, max_tris=None, fit=None):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / identifier / f"{identifier}.gltf"))
    imported = set(bpy.context.scene.objects) - before
    bpy.context.view_layer.update()
    meshes = [(obj, obj.matrix_world.copy()) for obj in imported if obj.type == "MESH"]
    if max_tris:
        total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o, _ in meshes)
        if total > max_tris:
            ratio = max_tris / total
            for o, _ in meshes:
                if o.data.shape_keys:          # decimation cannot apply over shape keys
                    o.shape_key_clear()
                bm = bmesh.new()
                bm.from_mesh(o.data)
                bmesh.ops.triangulate(bm, faces=bm.faces)
                bm.to_mesh(o.data)
                bm.free()
                mod = o.modifiers.new("decimate", "DECIMATE")
                mod.ratio = ratio
                bpy.context.view_layer.objects.active = o
                with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                    bpy.ops.object.modifier_apply(modifier=mod.name)
            print(f"{identifier}: {total} tris -> {int(total * ratio)}", flush=True)
    # Pivot = the model's base centre. Poly Haven files carry their own node offsets; without this the
    # offset is scaled and rotated with each copy and plants land metres from their planters.
    corners = [w @ Vector(c) for o, w in meshes for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    # Base = centroid of the lowest vertices (the trunk foot or the pot bottom), not the bounding-box
    # centre: leaning plants have their canopy metres off the trunk.
    band = lo.z + max(.02, (hi.z - lo.z) * .03)
    foot = [w @ v.co for o, w in meshes for v in o.data.vertices if (w @ v.co).z <= band]
    fx = sum(v.x for v in foot) / len(foot) if foot else (lo.x + hi.x) / 2
    fy = sum(v.y for v in foot) / len(foot) if foot else (lo.y + hi.y) / 2
    pivot = Matrix.Translation(-Vector((fx, fy, lo.z)))
    if fit:                                  # scale so the model stands fit metres tall
        scale = fit / max(1e-3, hi.z - lo.z)
    for idx, (x, y, z, yaw) in enumerate(placements):
        transform = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(radians(yaw), 4, "Z") @ Matrix.Scale(scale, 4) @ pivot
        dups = []
        for src, world in meshes:
            dup = bpy.data.objects.new(f"{identifier} {idx + 1}", src.data)
            bpy.context.collection.objects.link(dup)
            dup.matrix_world = transform @ world
            GROUPS[group].append(dup)
            dups.append(dup)
        # Verify: the model's foot (lowest 3 % of its height) must stand on the placement point.
        bpy.context.view_layer.update()
        pts = [d.matrix_world @ v.co for d in dups for v in d.data.vertices]
        low = min(v.z for v in pts)
        top = max(v.z for v in pts)
        feet = [v for v in pts if v.z <= low + (top - low) * .03]
        fx, fy = sum(v.x for v in feet) / len(feet), sum(v.y for v in feet) / len(feet)
        target = P(x, y, z)
        off = ((fx - target.x) ** 2 + (fy - target.y) ** 2) ** .5
        if off > .05:
            print(f"PLACEMENT {identifier} #{idx}: foot off by {off:.2f} m (target r={hypot(x, z):.2f}); correcting", flush=True)
            for d in dups:
                d.matrix_world = Matrix.Translation(Vector((target.x - fx, target.y - fy, 0))) @ d.matrix_world
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)


def build_props(source):
    chairs, tables, ferns = [], [], []
    for L in LAYOUT["lounges"]:
        t = L["t"]
        for dt in (-3.4, 3.4):            # lounge chairs on the inner side, facing the curved sofa
            x, z = pol(17.75, t + dt)
            chairs.append((x, .14, z, t + dt * .6))   # front faces outward, toward the sofa
        x, z = pol(18.5, t)
        tables.append((x, .14, z, 0))
        for dt in (-10, -8.6, 8.6, 10):
            x, z = pol(20.55, t + dt)
            ferns.append((x, .8, z, rng.uniform(0, 360)))
    import_prop(source, "mid_century_lounge_chair", chairs, max_tris=3500)
    import_prop(source, "coffee_table_round_01", tables, max_tris=2000)
    # Multi-stem money trees: two or three stems per planter, each turned and leaning a little, so the
    # canopy is full and branched; trunks start in the planter soil. (The decimated tree_small_02 lost
    # its trunk and floated: it is gone.)
    # Trees: a potted tree model with its pot in the same file, so a tree can only ever stand in its pot.
    # (pachira_aquatica_01 is gone: its leaf objects landed metres from the trunk, among the desks.)
    trees = [(p["x"], 0.0, p["z"], rng.uniform(0, 360)) for p in LAYOUT["planters"]]
    import_prop(source, "potted_plant_02", trees, scale=2.3, max_tris=6000)
    chair = make_task_chair()
    place_instances(chair, CHAIRS, "Task chair")
    bpy.data.objects.remove(chair, do_unlink=True)
    mug = lathe("Cup", 0, 0, 0, [(.03, 0), (.04, .005), (.042, .09), (.038, .09), (.036, .012), (0, .012)], "ceramic", "cupsrc", sides=20)
    place_instances(mug, CUPS, "Coffee cup")
    bpy.data.objects.remove(mug, do_unlink=True)
    GROUPS["cupsrc"] = []
    if LAMPS:
        import_prop(source, "desk_lamp_arm_01", LAMPS, scale=.9, max_tris=1500)
    # Potted plants along the galleries and the ground-floor walkway (same spots on every floor).
    pots = [(gp["x"], [0.0, *LEVELS][gp["level"]], gp["z"], rng.uniform(0, 360)) for gp in LAYOUT["galleryPots"]]
    import_prop(source, "potted_plant_02", pots, scale=1.3, max_tris=2500)
    foliage = build_flowers()
    fits = {"marble_bust_01": .7, "horse_statue_01": .95, "gothic_statue": 1.2, "bronze_whale_statue": .6, "bronze_ray_statue": .55,
            "horse_head": .7, "lion_head": .6, "carved_wooden_elephant": .6, "antique_ceramic_vase_01": .75}
    for sc in LAYOUT.get("sculptures", []):
        plinth_h = 1.05 if fits.get(sc["id"], .7) < 1 else .55
        box("Sculpture plinth", sc["x"], sc["y"] + plinth_h / 2, sc["z"], .56, plinth_h, .56, "trav", "fixtures", yaw=sc["t"], bevel=.01)
        box("Plinth top", sc["x"], sc["y"] + plinth_h + .005, sc["z"], .58, .01, .58, "stone", "fixtures", yaw=sc["t"])
        if (source / sc["id"]).exists():
            import_prop(source, sc["id"], [(sc["x"], sc["y"] + plinth_h + .01, sc["z"], sc["t"] + 180)], fit=fits.get(sc["id"], .7), max_tris=8000)
    import_prop(source, "fern_02", foliage, scale=.55, max_tris=1200)


# ---------------------------------------------------------------- flowers
FLOWER_SPECS = {
    # kind, petals, layers, petal length/width (m), cup, colour (sRGB 0-1), centre colour, stem height
    "rose": ("cup", 9, 4, .045, .04, .7, (.74, .05, .1), (.5, .03, .06), .55),
    "peony": ("cup", 11, 4, .06, .055, .55, (.96, .62, .72), (.98, .85, .5), .5),
    "lily": ("star", 6, 1, .09, .03, -.25, (.99, .97, .93), (.75, .8, .3), .65),
    "tulip_yellow": ("cup", 6, 1, .06, .035, 1.1, (.99, .82, .12), (.35, .3, .05), .45),
    "tulip_red": ("cup", 6, 1, .06, .035, 1.1, (.88, .08, .1), (.2, .05, .05), .45),
    "lavender": ("spike", 16, 1, .012, .012, 0, (.58, .45, .84), (.4, .3, .6), .55),
    "hydrangea_blue": ("ball", 34, 1, .02, .02, 0, (.5, .64, .96), (.4, .5, .9), .5),
    "hydrangea_pink": ("ball", 34, 1, .02, .02, 0, (.97, .64, .78), (.9, .5, .65), .5),
    "sunflower": ("ray", 22, 2, .07, .025, .1, (.99, .78, .08), (.22, .12, .04), .8),
    "daisy": ("ray", 20, 1, .035, .01, .05, (.99, .99, .97), (.98, .82, .15), .4),
    "gerbera": ("ray", 18, 2, .05, .016, .1, (.99, .45, .12), (.25, .14, .05), .45),
    "orchid_purple": ("orchid", 7, 1, .04, .035, .1, (.78, .3, .78), (.95, .9, .5), .6),
    "orchid_white": ("orchid", 7, 1, .04, .035, .1, (.98, .97, .97), (.85, .3, .55), .6),
    "cosmos": ("ray", 8, 1, .04, .025, .15, (.96, .52, .76), (.98, .8, .15), .55),
    "poppy": ("cup", 5, 1, .045, .045, .45, (.92, .14, .07), (.05, .05, .05), .45),
    "delphinium": ("spike", 14, 1, .022, .02, 0, (.25, .36, .92), (.95, .95, .98), .75),
    "marigold": ("ball", 26, 1, .016, .016, 0, (.99, .58, .05), (.9, .4, .03), .35),
    "allium": ("ball", 44, 1, .012, .006, 0, (.64, .36, .88), (.5, .25, .7), .75),
    "zinnia": ("ray", 16, 3, .035, .016, .2, (.9, .15, .52), (.95, .75, .1), .45),
    "anemone": ("cup", 6, 1, .04, .036, .25, (.99, .98, .96), (.08, .08, .18), .4),
}


def lin(c):
    return tuple(v ** 2.2 for v in c)


def build_flower_mesh(name, spec, seed):
    """One clump of 5-8 stems with blooms and leaves, as a single mesh with petal/centre/leaf/stem materials."""
    kind, petals, layers, plen, pwid, cup, col, ccol, height = spec
    plen, pwid = plen * 1.35, pwid * 1.35
    r = random.Random(seed)
    verts, faces, mats = [], [], []
    def add_quad(a, b, c, d, m):
        o = len(verts)
        verts.extend([a, b, c, d])
        faces.append((o, o + 1, o + 2, o + 3))
        mats.append(m)
    def petal(origin, direction, up, length, width, curve, m):
        # a 3-segment curved petal strip; curve bends it toward 'up'
        side = direction.cross(up).normalized()
        prev_l = prev_r = None
        for k in range(4):
            u = k / 3
            w = width * (.35 + .9 * sin(pi * min(1, u * 1.1 + .05)))
            pos = origin + direction * (length * u) + up * (curve * length * u * u)
            l, rr = pos - side * (w / 2), pos + side * (w / 2)
            if prev_l is not None:
                add_quad(prev_l, prev_r, rr, l, m)
            prev_l, prev_r = l, rr
    def leaf(base, direction, length, width):
        petal(base, direction, Vector((0, 0, 1)), length, width, .25, 2)
    stems = r.randint(5, 7)
    for s_ in range(stems):
        a = r.uniform(0, 2 * pi)
        d = r.uniform(.02, .16)
        base = Vector((cos(a) * d, sin(a) * d, 0))
        h = height * r.uniform(.75, 1.1)
        lean = Vector((cos(a) * r.uniform(.02, .12), sin(a) * r.uniform(.02, .12), 0))
        top = base + Vector((0, 0, h)) + lean
        # stem: a thin 2-quad cross
        for ang in (0, pi / 2):
            off = Vector((cos(ang), sin(ang), 0)) * .004
            add_quad(base - off, base + off, top + off, top - off, 3)
        for k in range(3):
            la = r.uniform(0, 2 * pi)
            leaf(base + (top - base) * r.uniform(.05, .5), Vector((cos(la), sin(la), .35)).normalized(), r.uniform(.12, .2), r.uniform(.035, .06))
        head = top
        if kind in ("cup", "star", "ray"):
            for layer in range(layers):
                n = petals + layer * 2
                lc = cup * (1 + layer * .25)
                for k in range(n):
                    pa = 2 * pi * (k + layer * .5) / n + r.uniform(-.08, .08)
                    dirv = Vector((cos(pa), sin(pa), 0))
                    if kind == "cup":
                        dirv = (dirv * (1 - layer * .18) + Vector((0, 0, .9 + lc * .4))).normalized()
                    elif kind == "star":
                        dirv = (dirv + Vector((0, 0, .5))).normalized()
                    else:
                        dirv = (dirv + Vector((0, 0, .08 + lc * .3))).normalized()
                    up = Vector((0, 0, 1))
                    scale = 1 - layer * (.22 if kind == "cup" else .1)
                    petal(head, dirv, up, plen * scale, pwid * scale, lc * .6 if kind != "star" else -.35, 0)
            # centre disc / bud
            cr = plen * (.45 if kind == "ray" and petals > 18 else .22)
            for k in range(8):
                a0, a1 = 2 * pi * k / 8, 2 * pi * (k + 1) / 8
                add_quad(head + Vector((0, 0, .012)), head + Vector((cos(a0) * cr, sin(a0) * cr, .004)),
                         head + Vector((cos(a1) * cr, sin(a1) * cr, .004)), head + Vector((0, 0, .012)), 1)
        elif kind == "spike":
            for k in range(petals):
                u = k / petals
                pos = head + Vector((0, 0, -h * .35 * (1 - u)))
                pa = k * 2.4
                petal(pos, Vector((cos(pa), sin(pa), .6)).normalized(), Vector((0, 0, 1)), plen * (1.2 - u * .6), pwid, .3, 0)
        elif kind == "ball":
            br = plen * (2.0 if petals > 30 else 1.7) * (1.5 if name.startswith("allium") else 1)
            centre = head + Vector((0, 0, br * .7))
            for k in range(petals):
                # Fibonacci sphere florets, upper 80 %
                yk = 1 - (k / (petals - 1)) * 1.6
                rad = sqrt(max(0, 1 - yk * yk))
                th = k * 2.39996
                nrm = Vector((cos(th) * rad, sin(th) * rad, yk))
                pos = centre + nrm * br
                tangent = nrm.cross(Vector((0, 0, 1)) if abs(nrm.z) < .9 else Vector((1, 0, 0))).normalized()
                for q in range(4 if name != "allium" else 3):
                    pa = q * pi / 2
                    dirv = (tangent * cos(pa) + nrm.cross(tangent) * sin(pa)).normalized()
                    petal(pos, dirv, nrm, plen * .9, pwid, .1, 0)
        else:   # orchid: an arching spray of flat five-petal blooms
            for k in range(petals):
                u = k / petals
                pos = head + Vector((u * .18 * cos(a), u * .18 * sin(a), .06 * sin(pi * u) - u * .08))
                face = Vector((cos(a), sin(a), .3)).normalized()
                side = face.cross(Vector((0, 0, 1))).normalized()
                upv = side.cross(face).normalized()
                for q in range(5):
                    pa = 2 * pi * q / 5 + .3
                    dirv = (side * cos(pa) + upv * sin(pa)).normalized()
                    petal(pos, dirv, face, plen * (.8 if q in (3, 4) else 1), pwid * (1.2 if q < 3 else .8), .1, 0)
                add_quad(pos, pos + upv * .01, pos + face * .015, pos - upv * .01, 1)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    # One material for every flower: the part colours live in a vertex colour attribute (one draw call).
    palette = [lin(col), lin(ccol), (.06, .2, .05), (.08, .22, .05)]
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    for poly, m in zip(me.polygons, mats):
        c = palette[m]
        shade = .9 + .2 * ((poly.index * 37) % 11) / 10        # slight variation from petal to petal
        for li in poly.loop_indices:
            attr.data[li].color = (min(1, c[0] * shade), min(1, c[1] * shade), min(1, c[2] * shade), 1)
    me.materials.append(MAT["flower"])
    me.shade_smooth()
    return me


def build_flowers():
    m = _principled("Flowers", (1, 1, 1), .55)
    nt = m.node_tree
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    m.use_backface_culling = False
    MAT["flower"] = m
    MAT["leaf"] = _principled("Flower leaf", (.06, .2, .05), .55)
    MAT["leaf"].use_backface_culling = False
    MAT["stem"] = _principled("Flower stem", (.08, .22, .05), .6)
    meshes = {name: [build_flower_mesh(f"{name} {v}", FLOWER_SPECS[name], sum(map(ord, name)) * 7 + v) for v in range(2)] for name in FLOWER_SPECS}
    def plant(species, x, y, z, k):
        me = meshes[species][k % 2]
        obj = bpy.data.objects.new(f"Flowers {species}", me)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(rng.uniform(0, 2 * pi), 4, "Z") @ Matrix.Scale(rng.uniform(.85, 1.15), 4)
        GROUPS["props"].append(obj)
    names = list(FLOWER_SPECS)
    foliage = []
    # Under-planting in the tree planters (soil at 0.68), a ring around the trunks.
    for i, p in enumerate([]):
        for k in range(4):
            a = k * 90 + rng.uniform(-10, 10)
            ox, oz = pol(rng.uniform(.45, .65), a)
            plant(names[(i * 5 + k) % len(names)], p["x"] + ox, .68, p["z"] + oz, k)
            pass
    # The lounge troughs (soil at 0.8), between the sofa ends.
    for j, L in enumerate(LAYOUT["lounges"]):
        for k, dt in enumerate(np.arange(-7.2, 7.3, 1.45)):
            x, z = pol(20.5, L["t"] + dt)
            plant(names[(j * 7 + k * 3) % len(names)], x, .74, z, k)
            pass
    # Ceramic bowls of mixed flowers on every floor.
    for b in LAYOUT["bowls"]:
        r = b["r"]
        lathe("Flower bowl", b["x"], b["y"], b["z"], [(r * .55, 0), (r * .8, .06), (r, .28), (r * .97, .42), (r * .9, .42), (r * .9, .38), (0, .38)],
              "ceramic", "fixtures", sides=40)
        for k, sp in enumerate(b["species"] * 2):
            a = k * 360 / (len(b["species"]) * 2) + rng.uniform(-10, 10)
            ox, oz = pol(rng.uniform(0, r * .55), a)
            plant(sp, b["x"] + ox, b["y"] + .38, b["z"] + oz, k)
        foliage.append((b["x"], b["y"] + .38, b["z"], rng.uniform(0, 360)))
    return foliage


# ---------------------------------------------------------------- bake-only screen stand-ins
def dashboard_textures(out):
    """A few dark financial-UI images for previews and screen glow (never exported)."""
    paths = []
    for v in range(6):
        w, h = 512, 300
        img = np.zeros((h, w, 3), dtype=np.float32)
        img[:] = (.01, .02, .05)
        img[:18] = (.03, .07, .16)
        for k in range(rng.randint(2, 4)):
            x0, y0 = rng.randint(10, 260), rng.randint(30, 160)
            pts = np.cumsum(np.array([rng.uniform(-6, 6) for _ in range(200)]))
            c = rng.choice([(.2, .9, .5), (1.0, .3, .35), (.35, .65, 1.0), (.95, .8, .3)])
            for i, p in enumerate(pts):
                xx, yy = x0 + i, int(y0 + 60 - p)
                if 0 <= xx < w and 0 <= yy < h:
                    img[max(0, yy - 1):yy + 1, xx] = c
        for row in range(24, h - 8, 11):
            if rng.random() < .55:
                x = rng.randint(300, 340)
                img[row:row + 4, x:x + rng.randint(40, 160)] = rng.choice([(.2, .8, .45), (.9, .3, .35), (.6, .7, .9)])
        bimg = bpy.data.images.new(f"dash{v}", w, h, alpha=False)
        bimg.pixels.foreach_set(np.concatenate([img[::-1], np.ones((h, w, 1), np.float32)], axis=2).ravel())
        path = out / f"preview-dash{v}.png"
        bimg.filepath_raw = str(path)
        bimg.file_format = "PNG"
        bimg.save()
        paths.append(path)
    return [emissive_image(f"Screen stand-in {i}", p, 1.6) for i, p in enumerate(paths)]


def screen_standins(mats):
    for i, s in enumerate(LAYOUT["screens"]):
        m = mats[i % len(mats)]
        kind = s["kind"]
        if kind in ("desk", "counter", "facet"):
            r = rot(s["yaw"], s.get("tilt", 0))
            c = P(s["x"], s["y"], s["z"]) + r.to_3x3() @ Vector((0, -.012, 0))
            a, b = s["w"] / 2, s["h"] / 2
            emit_object("standin", [(-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b)], [(0, 1, 2, 3)], m, "bakeonly",
                        Matrix.Translation(c) @ r, uv={0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}, recalc=False)
        elif kind in ("arc", "band"):
            arc_surface("standin", s["r"] - .01, s["y"] - s["h"] / 2, s["y"] + s["h"] / 2, s["a0"], s["a1"], m, "bakeonly", inward=True, uv_fit=True)
        elif kind == "ring":
            arc_surface("standin", s["w"] + .01, s["y"] - s["h"] / 2, s["y"] + s["h"] / 2, 0, 360, m, "bakeonly", inward=False, uv_fit=True, step=.3)


# ---------------------------------------------------------------- bake
def bake_lights():
    extra = []

    def add(obj):
        bpy.context.collection.objects.link(obj)
        extra.append(obj)

    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy, sun.angle, sun.color = 3.2, radians(2.5), (1.0, .96, .9)
    o = bpy.data.objects.new("Sun", sun)
    o.rotation_euler = (radians(38), 0, radians(35))
    add(o)
    for t in np.arange(0, 360, 30):           # gallery-front washers keep the trading floor even
        x, z = pol(13.0, t)
        data = bpy.data.lights.new("Wash", "AREA")
        data.energy, data.size, data.color = 900, 4.0, (1.0, .93, .84)
        lo = bpy.data.objects.new("Wash", data)
        lo.location = P(x, 18.6, z)
        add(lo)
    tops = [LEVELS[0] - .45] + [LEVELS[i + 1] - .45 for i in range(len(LEVELS) - 1)] + [H - .5]
    for top in tops:                          # offices: warm fill behind the glass
        for t in np.arange(0, 360, 20):
            x, z = pol((R_OFF + R_WALL) / 2, t)
            data = bpy.data.lights.new("Office", "AREA")
            data.energy, data.size, data.color = 300, 2.2, (1.0, .9, .78)
            lo = bpy.data.objects.new("Office", data)
            lo.location = P(x, top - .3, z)
            lo.rotation_euler = (0, 0, 0)
            add(lo)
    return extra


def join(group):
    objs = GROUPS[group]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = group
    GROUPS[group] = [obj]
    return obj


def lightmap_uv(obj, margin):
    me = obj.data
    lm = me.uv_layers.new(name="Lightmap")
    me.uv_layers.active = lm
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=radians(55), island_margin=margin, area_weight=1.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method="AABB")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers["Surface"].active_render = True


def bake(obj, size, samples):
    img = bpy.data.images.new(obj.name + " lightmap", size, size, float_buffer=True, alpha=False)
    nodes = []
    for slot in obj.material_slots:
        m = slot.material
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        uv = m.node_tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "Lightmap"
        m.node_tree.links.new(uv.outputs["UV"], n.inputs["Vector"])
        m.node_tree.nodes.active = n
        nodes.append((m, n, uv))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.uv_layers.active = obj.data.uv_layers["Lightmap"]
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.margin = 10
    scene.render.bake.margin_type = "EXTEND"
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=10)
    for m, n, uv in nodes:
        m.node_tree.nodes.remove(n)
        m.node_tree.nodes.remove(uv)
    obj.data.uv_layers.active = obj.data.uv_layers["Surface"]
    pix = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    rgb = pix.reshape(size, size, 4)[::-1, :, :3]
    k = np.array([.06, .24, .4, .24, .06], dtype=np.float32)
    for axis in (0, 1):
        rgb = sum(np.roll(rgb, i - 2, axis=axis) * k[i] for i in range(5))
    lum = rgb.mean(axis=2)
    scale = float(np.percentile(lum[lum > 1e-4], 99.6)) * 1.15 or 1.0
    return np.clip(rgb / scale, 0, 1) ** (1 / 2.2), scale


def save_lightmap(enc, path):
    size = enc.shape[0]
    img = bpy.data.images.new(path.stem, size, size, alpha=False)
    rgba = np.concatenate([enc[::-1], np.ones((size, size, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "WEBP"
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 92
    img.save_render(str(path), scene=scene)


def setup_cycles():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            if any(d.type == backend for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == backend
                scene.cycles.device = "GPU"
                print("Cycles device:", backend, flush=True)
                break
        except TypeError:
            continue
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = radians(52)
        sky.sun_rotation = radians(35)
    except (AttributeError, TypeError):
        pass
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = .55
    scene.world = world
    # Glazing emits daylight but must not shadow the sun or the sky.
    for obj in GROUPS["emit"]:
        obj.visible_shadow = False


def environment(out_dir, samples=160):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("env")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("env", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = P(0, 3.2, 9.0)
    cam.rotation_euler = (radians(90), 0, radians(-90))
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.render.image_settings.file_format = "HDR"
    scene.render.image_settings.color_depth = "32"
    view = scene.view_settings.view_transform
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = str(out_dir / f"hall-env-{VERSION}.hdr")
    bpy.ops.render.render(write_still=True)
    scene.view_settings.view_transform = view
    bpy.data.objects.remove(cam, do_unlink=True)


def look(cam, target):
    d = (target - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def preview(out_dir, samples=64, shots=None):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.cycles.samples = samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    cams = {
        # The concept boards' view: from the first gallery, south-west, across the floor to the core.
        "concept": ((-6.5, 8.4, 20.3), (1.0, 6.4, -2.0), 14),
        "concept2": ((8.0, 6.4, 19.8), (-.5, 7.4, -1.5), 14),
        "spawn": ((0, 1.68, 22.6), (0, 6.5, 0), 16),
        "desk": ((9.5, 1.6, 9.0), (0, 4.0, 0), 18),
        "ceiling": ((0, 1.7, 12.0), (0, 19.5, -4.0), 14),
        "counter": ((*pol(8.2, 20)[:1], 1.6, pol(8.2, 20)[1]), (*pol(5.0, 30)[:1], 1.0, pol(5.0, 30)[1]), 18),
        "birdS": ((0, 15.6, 23.0), (0, 0, -4.0), 12),
        "birdN": ((0, 15.6, -23.0), (0, 0, 4.0), 12),
        "birdE": ((23.0, 15.6, 0), (-4.0, 0, 0), 12),
        "birdW": ((-23.0, 15.6, 0), (4.0, 0, 0), 12),
        "lounge": ((*pol(15.8, 200)[:1], 1.65, pol(15.8, 200)[1]), (*pol(19.6, 211)[:1], .5, pol(19.6, 211)[1]), 20),
        "column": ((*pol(17.5, 40)[:1], 1.7, pol(17.5, 40)[1]), (*pol(22.3, 45)[:1], 6.0, pol(22.3, 45)[1]), 22),
        "stairs": ((*pol(14.5, 330)[:1], 1.7, pol(14.5, 330)[1]), (*pol(20.3, 340)[:1], 6.5, pol(20.3, 340)[1]), 16),
        "elevator": ((*pol(15.0, 112)[:1], 2.4, pol(15.0, 112)[1]), (*pol(20.25, 120)[:1], 5.0, pol(20.25, 120)[1]), 16),
        "flowers": ((*pol(18.0, 50)[:1], 1.4, pol(18.0, 50)[1]), (*pol(20.6, 45)[:1], .7, pol(20.6, 45)[1]), 30),
        "promenade": ((*pol(22.6, 100)[:1], 1.65, pol(22.6, 100)[1]), (*pol(25.0, 130)[:1], 1.2, pol(25.0, 130)[1]), 18),
        "tree": ((*pol(22.0, 165)[:1], 1.6, pol(22.0, 165)[1]), (*pol(25.15, 172)[:1], 1.6, pol(25.15, 172)[1]), 20),
        "art": ((*pol(20.0, 30)[:1], 1.65, pol(20.0, 30)[1]), (*pol(24.2, 36)[:1], 1.6, pol(24.2, 36)[1]), 24),
        "chairs": ((*pol(10.2, 28)[:1], 1.5, pol(10.2, 28)[1]), (*pol(8.6, 20)[:1], .7, pol(8.6, 20)[1]), 24),
        "chairback": ((*pol(10.6, 15)[:1], 1.3, pol(10.6, 15)[1]), (*pol(9.4, 17)[:1], .75, pol(9.4, 17)[1]), 35),
        "wall": ((*pol(21.0, 100)[:1], 1.6, pol(21.0, 100)[1]), (*pol(26.5, 112)[:1], 2.4, pol(26.5, 112)[1]), 24),
    }
    for name, (loc, tgt, lens) in cams.items():
        if shots and name not in shots:
            continue
        cam_data = bpy.data.cameras.new(name)
        cam_data.lens = lens
        cam = bpy.data.objects.new(name, cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = P(*loc)
        look(cam, P(*tgt))
        scene.camera = cam
        scene.render.filepath = str(out_dir / f"preview-{name}.png")
        bpy.ops.render.render(write_still=True)


def overlap_report():
    """Plants must not stand on seats, sofas, desks or walkways: flag any prop whose footprint does."""
    seats = [(*pol(s["r"] + 1.18, s["t"]), .7) for s in LAYOUT["seats"]]
    for L in LAYOUT["lounges"]:
        seats += [(*pol(17.75, L["t"] + d), .6) for d in (-3.4, 3.4)] + [(*pol(19.3, L["t"] + d), .55) for d in np.arange(-6, 6.1, 2)]
    bad = 0
    for o in GROUPS["props"]:
        if not o.name.startswith(("pachira", "potted", "Flowers", "fern")):
            continue
        mw = o.matrix_world
        pts = [mw @ v.co for v in o.data.vertices]
        low = min(v.z for v in pts)
        foot = [v for v in pts if v.z <= low + .05] or pts
        x, z = sum(v.x for v in foot) / len(foot), -sum(v.y for v in foot) / len(foot)
        for sx, sz, sr in seats:
            if hypot(x - sx, z - sz) < sr + .25:
                bad += 1
                print("overlap:", o.name, round(x, 2), round(z, 2), flush=True)
                break
    print("plant/seat overlaps:", bad, flush=True)


def merge_props():
    """Static props (plants, flowers, chairs, cups, lounge furniture) as eight sector meshes:
    one draw per material per quadrant instead of one per object, and still culled by view.
    Paintings, sculptures and cabins keep their own nodes (the browser textures, picks or moves them)."""
    keep = ("Artwork", ) + tuple(sc["id"] for sc in LAYOUT.get("sculptures", []))
    buckets = defaultdict(list)
    for o in GROUPS["props"]:
        if o.name.startswith(keep) or o.type != "MESH" or o.parent is not None:
            continue
        c = o.matrix_world.translation
        q = int((degrees(atan2(c.x, -c.y)) % 360) // 45) % 8        # eight sectors: culled with the view
        buckets[q].append(o)
    kept = [o for o in GROUPS["props"] if o.name.startswith(keep) or o.type != "MESH" or o.parent is not None]
    merged = []
    for q, objs in sorted(buckets.items()):
        for o in objs:
            if o.data.users > 1:
                o.data = o.data.copy()
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = obj.data.name = f"Props {q}"
        merged.append(obj)
    GROUPS["props"] = kept + merged
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in merged)
    print(f"props merged into {len(merged)} quadrants, {tris} triangles", flush=True)


def build(source, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data_rain(out / "datarain.png")
    make_materials(source, out)
    build_floor()
    build_galleries()
    build_columns()
    build_roof()
    build_tower()
    build_counter()
    build_desks()
    build_monitors()
    build_landscape()
    build_stairs()
    build_elevators()
    build_props(source)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples", type=int, default=384)
    parser.add_argument("--shell-size", type=int, default=4096)
    parser.add_argument("--fixture-size", type=int, default=4096)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--preview-only", action="store_true", help="render the previews and stop (no bake/export)")
    parser.add_argument("--preview-samples", type=int, default=64)
    parser.add_argument("--shots", default="")
    opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = opts.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    build(opts.sources.resolve(), out)
    setup_cycles()
    standins = dashboard_textures(out)
    screen_standins(standins)
    extra = bake_lights()
    overlap_report()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for g in ("shell", "fixtures", "emit", "props") for o in GROUPS[g])
    print("triangles (before instancing):", tris, {g: len(GROUPS[g]) for g in GROUPS}, flush=True)
    if opts.preview or opts.preview_only:
        preview(out, opts.preview_samples, set(filter(None, opts.shots.split(","))))
    if opts.preview_only:
        sys.exit(0)
    merge_props()
    for g in ("shell", "fixtures", "emit"):
        join(g)
    # Cabin parts keep their own objects under their "Elevator cabin N" node (the browser moves them).
    lightmap_uv(GROUPS["shell"][0], .0012)
    lightmap_uv(GROUPS["fixtures"][0], .0012)
    environment(out)
    meta = {}
    for g, size in (("shell", opts.shell_size), ("fixtures", opts.fixture_size)):
        enc, scale = bake(GROUPS[g][0], size, opts.samples)
        save_lightmap(enc, out / f"lightmap-{g}-{VERSION}.webp")
        meta[g] = {"scale": round(scale, 5), "file": f"lightmap-{g}-{VERSION}.webp"}
        print(g, "baked, scale", scale, flush=True)
    for obj in extra:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in GROUPS["bakeonly"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    (ROOT / "frontend/src/exchange/bake.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    bpy.ops.export_scene.gltf(filepath=str(out / f"trading-hall-{VERSION}.glb"), export_format="GLB", export_yup=True,
                              export_image_format="AUTO", export_cameras=False, export_lights=False, export_materials="EXPORT",
                              export_extras=False, export_meshopt_compression_enable=False, export_gpu_instances=True,
                              export_texcoords=True, export_normals=True, export_apply=True)
    print("exported", flush=True)
