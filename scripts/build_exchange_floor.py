"""Model KOSPIMAP's 400-pyeong trading hall in Blender, bake its lighting and export glTF.

    blender -b --factory-startup --python scripts/build_exchange_floor.py -- <sources> <out dir> [--samples N] [--preview]

Then: python scripts/glb_webp.py <out>/trading-hall-v3.glb <out>/hall-webp.glb and
gltfpack -i <out>/hall-webp.glb -o trading-hall-v3.glb -cc -kn -km -ke -kv -vt 14 -vp 16.

Writes <out>/trading-hall-v3.glb, <out>/lightmap-shell-v3.webp, <out>/lightmap-fixtures-v3.webp and
frontend/src/exchange/bake.json (lightmap scales). Coordinates follow layout.json (three.js metres);
Blender's (x, y, z) = three's (x, -z, y).
"""
import argparse
from collections import defaultdict
import json
from math import atan2, cos, pi, radians, sin, sqrt
from pathlib import Path
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = json.loads((ROOT / "frontend/src/exchange/layout.json").read_text(encoding="utf-8"))
ROOM = LAYOUT["room"]
W, D, H = ROOM["width"], ROOM["depth"], ROOM["height"]
HX, HZ = W / 2, D / 2
GROUPS = defaultdict(list)          # group -> objects (shell / fixtures / emit / bakeonly)
MAT = {}


def P(x, y, z):
    return Vector((x, -z, y))


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


def textured(key, name, root, roughness_scale=1.0, roughness_bias=0.0, metal=0.0, normal=0.6, tint=None):
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
            # Scale and bias are baked into the texture by fetch_exchange_sources.py.
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


def make_materials(src):
    r = src / "materials"
    MAT["floor"] = textured("floor", "Polished verde marble", r, .55, .02, normal=.25)
    MAT["wallstone"] = textured("wallstone", "Honed rosato marble", r, .8, .12, normal=.35)
    MAT["cream"] = textured("cream", "Cream statuary marble", r, .7, .08, normal=.3)
    MAT["gold"] = textured("gold", "Gold leaf", r, .9, .04, metal=1, normal=.5)
    MAT["brass"] = textured("brass", "Brushed brass", r, .8, .05, metal=1, normal=.35)
    MAT["walnut"] = textured("walnut", "Polished walnut", r, .55, .06, normal=.45)
    MAT["carpet"] = textured("carpet", "Navy wool carpet", r, 1, 0, normal=.8)
    MAT["leather"] = textured("leather", "Black aniline leather", r, .9, .05, normal=.6)
    MAT["plaster"] = textured("plaster", "Ivory plaster", r, 1, 0, normal=.4, tint=(.93, .88, .8))
    MAT["steel"] = textured("steel", "Graphite anodised aluminium", r, .7, .06, metal=1, normal=.25, tint=(.32, .33, .36))
    MAT["silver"] = textured("steel", "Satin aluminium", r, .6, .02, metal=1, normal=.2, tint=(.82, .83, .86))
    MAT["black"] = _principled("Piano black", (.006, .006, .008), .12, 0)
    MAT["bezel"] = _principled("Display bezel", (.004, .004, .005), .22, .2)
    MAT["window"] = _principled("Daylight glazing", (.78, .86, 1.0), .2, 0, emit=.7, emit_color=(.8, .87, 1.0))
    MAT["skylight"] = _principled("Laylight glass", (1.0, .93, .8), .3, 0, emit=2.0, emit_color=(1.0, .9, .74))
    MAT["downlight"] = _principled("Downlight lens", (1.0, .86, .66), .3, 0, emit=7, emit_color=(1.0, .84, .62))
    MAT["cove"] = _principled("Warm cove light", (1.0, .75, .45), .4, 0, emit=3.6, emit_color=(1.0, .72, .42))
    MAT["glass"] = _principled("Balustrade glass", (.55, .62, .66), .05, 0, alpha=.25)


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


def emit_object(name, verts, faces, mat, group, matrix, tile=1.0, bevel=0.0, segments=2, world_uv=True, smooth=False, facing=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if len(faces) > 1:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    if bevel:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES",
                        profile=.5, clamp_overlap=True)
        bm.to_mesh(me)
        bm.free()
    me.transform(matrix)
    if facing is not None:
        for poly in me.polygons:
            if poly.normal.dot(Vector(facing)) < 0:
                poly.flip()
        me.update()
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=radians(40))
    if world_uv:
        _uv_box(me, tile)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    me.materials.append(MAT[mat] if isinstance(mat, str) else mat)
    GROUPS[group].append(obj)
    return obj


def box(name, x, y, z, w, h, d, mat, group="shell", *, bevel=0.0, yaw=0.0, tilt=0.0, tile=1.0, segments=2):
    a, b, c = w / 2, d / 2, h / 2
    # Local three axes (x, y up, z depth) -> Blender (x, -z, y)
    verts = [(sx * a, -sz * b, sy * c) for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 1, 3, 2)[::-1], (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    return emit_object(name, verts, faces, mat, group, Matrix.Translation(P(x, y, z)) @ rot(yaw, tilt),
                       tile, bevel, segments)


def oriented(screen, du, dv, dn, w, h, d, mat, group="fixtures", bevel=0.0):
    """A box placed in a screen's local frame (u right, v up, n out of the face)."""
    r = rot(screen["yaw"], screen.get("tilt", 0))
    local = Vector((du, -dn, dv))  # three (u, v, n) -> blender local (x, -n, v)
    c = P(screen["x"], screen["y"], screen["z"]) + r.to_3x3() @ local
    a, b, cc = w / 2, d / 2, h / 2
    verts = [(sx * a, -sz * b, sy * cc) for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
    faces = [(2, 3, 1, 0), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    return emit_object("screen part", verts, faces, mat, group, Matrix.Translation(c) @ r, .6, bevel)


def lathe(name, x, y, z, profile, mat, group="fixtures", sides=48, tile=1.0, smooth=True, inner_cap=True):
    """Revolve a list of (radius, height) points around the vertical axis at (x, y, z)."""
    verts, faces = [], []
    n = len(profile)
    for i in range(sides):
        t = 2 * pi * i / sides
        for r, h in profile:
            verts.append((cos(t) * r, sin(t) * r, h))
    for i in range(sides):
        j = (i + 1) % sides
        for k in range(n - 1):
            faces.append((i * n + k, j * n + k, j * n + k + 1, i * n + k + 1))
    if profile[0][0] > 1e-4 and inner_cap:
        verts.append((0, 0, profile[0][1]))
        c = len(verts) - 1
        faces += [(c, ((i + 1) % sides) * n, i * n) for i in range(sides)]
    if profile[-1][0] > 1e-4 and inner_cap:
        verts.append((0, 0, profile[-1][1]))
        c = len(verts) - 1
        faces += [(c, i * n + n - 1, ((i + 1) % sides) * n + n - 1) for i in range(sides)]
    return emit_object(name, verts, faces, mat, group, Matrix.Translation(P(x, y, z)), tile, smooth=smooth)


def ring(name, x, y, z, r_out, r_in, h, mat, group="fixtures", sides=64, y0=0.0):
    prof = [(r_in, y0), (r_out, y0), (r_out, y0 + h), (r_in, y0 + h), (r_in, y0)]
    return lathe(name, x, y, z, prof, mat, group, sides, smooth=False, inner_cap=False)


def disc(name, x, y, z, r, h, mat, group="fixtures", sides=48):
    return lathe(name, x, y, z, [(0, 0), (r, 0), (r, h), (0, h)], mat, group, sides, smooth=False, inner_cap=False)


def molding(name, axis, start, end, base, profile, mat, group="shell", out=(0, 0, 1)):
    """Extrude a 2D profile [(up, out)] along a straight run. axis 'x' or 'z'; out is the room-facing normal."""
    verts, faces = [], []
    ox, oz = out[0], out[2]
    for t in (start, end):
        for up, o in profile:
            px = (t if axis == "x" else base[0]) + ox * o
            pz = (t if axis == "z" else base[1]) + oz * o
            verts.append(tuple(P(px, up, pz)))
    n = len(profile)
    for k in range(n - 1):
        faces.append((k, k + 1, n + k + 1, n + k))
    faces.append(tuple(range(n))[::-1])
    faces.append(tuple(range(n, 2 * n)))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), .8)


def arch_band(x, z, nx, r_in, r_out, yc, depth, mat, group="fixtures", segs=32):
    """A semicircular band on a side wall plane (window head / niche frame)."""
    verts, faces = [], []
    for i in range(segs + 1):
        a = pi * i / segs
        for r in (r_in, r_out):
            for d in (0, depth):
                u, v = cos(a) * r, yc + sin(a) * r
                verts.append(tuple(P(x + nx * d, v, z - nx * u)))
    for i in range(segs):
        o, q = i * 4, (i + 1) * 4
        faces += [(o, o + 1, q + 1, q), (o + 2, q + 2, q + 3, o + 3), (o, q, q + 2, o + 2), (o + 1, o + 3, q + 3, q + 1)]
    faces += [(0, 2, 3, 1), (segs * 4, segs * 4 + 1, segs * 4 + 3, segs * 4 + 2)]
    return emit_object("Arch band", verts, faces, mat, group, Matrix.Identity(4), .8)


def arch_window(x, z, normal_x, w, y0, y1, group="shell"):
    """Tall round-headed window on a side wall; glass is emissive daylight."""
    r = w / 2
    pts = [(-r, y0), (r, y0), (r, y1)]
    for i in range(1, 32):
        a = pi * i / 32
        pts.append((cos(a) * r, y1 + sin(a) * r))
    pts.append((-r, y1))
    face = [tuple(P(x + normal_x * .02, v, z - normal_x * u)) for u, v in pts]
    emit_object("Daylight window", face, [tuple(range(len(face)))], "window", "emit", Matrix.Identity(4), 2,
                facing=(normal_x, 0, 0))
    arch_band(x, z, normal_x, r - .02, r + .14, y1, .16, "brass")
    arch_band(x, z, normal_x, r + .14, r + .5, y1, .08, "cream", "shell")
    for i in range(9):
        a = pi * (i + .5) / 9
        box("Voussoir gilt", x + normal_x * .1, y1 + sin(a) * (r + .32), z - normal_x * cos(a) * (r + .32),
            .04, .1, .1, "gold", "shell")
    box("Keystone", x + normal_x * .14, y1 + r + .42, z, .2, .62, .44, "gold", "shell", bevel=.03)
    for u in (-r, r):
        box("Window jamb", x + normal_x * .07, (y0 + y1) / 2, z - normal_x * u, .14, y1 - y0, .16, "brass", "fixtures")
    for k in range(1, 4):
        u = -r + w * k / 4
        top = y1 + sqrt(max(0, r * r - u * u))
        box("Window mullion", x + normal_x * .07, (y0 + top) / 2, z - normal_x * u, .08, top - y0, .06, "brass", "fixtures")
    for k in range(1, 6):
        v = y0 + (y1 - y0) * k / 6
        box("Window transom", x + normal_x * .07, v, z, .07, .05, w, "brass", "fixtures")
    arch_band(x, z, normal_x, r * .45, r * .45 + .06, y1, .1, "brass", segs=20)
    box("Window sill", x + normal_x * .2, y0 - .1, z, .45, .2, w + .5, "cream", "shell", bevel=.03)


def framed_panel(wall, u, y, w, h, mat="cream", frame="gold"):
    """Raised stone panel with a gilded bead frame, on one of the four walls."""
    if wall in "ns":
        zf, s = (-HZ, 1) if wall == "n" else (HZ, -1)
        box("Raised panel", u, y, zf + s * .04, w, h, .08, mat, "shell", bevel=.025, tile=2)
        for dy in (-1, 1):
            box("Panel bead", u, y + dy * (h / 2 - .05), zf + s * .1, w - .06, .05, .05, frame, "shell")
        for dx in (-1, 1):
            box("Panel bead", u + dx * (w / 2 - .05), y, zf + s * .1, .05, h - .06, .05, frame, "shell")
    else:
        xf, s = (-HX, 1) if wall == "w" else (HX, -1)
        box("Raised panel", xf + s * .04, y, u, .08, h, w, mat, "shell", bevel=.025, tile=2)
        for dy in (-1, 1):
            box("Panel bead", xf + s * .1, y + dy * (h / 2 - .05), u, .05, .05, w - .06, frame, "shell")
        for dx in (-1, 1):
            box("Panel bead", xf + s * .1, y, u + dx * (w / 2 - .05), .05, h - .06, .05, frame, "shell")


def sconce(x, y, z, nx, nz):
    box("Sconce backplate", x + nx * .03, y, z + nz * .03, .22 if nz else .05, .5, .05 if nz else .22, "brass", "fixtures", bevel=.015)
    box("Sconce arm", x + nx * .16, y - .02, z + nz * .16, .04 if nz else .26, .04, .26 if nz else .04, "brass", "fixtures")
    lathe("Sconce cup", x + nx * .3, y - .06, z + nz * .3, [(0, 0), (.06, 0), (.11, .1), (.12, .14), (0, .14)], "gold", "fixtures", 20)
    lathe("Sconce globe", x + nx * .3, y + .08, z + nz * .3, [(0, 0), (.1, .03), (.13, .14), (.1, .25), (0, .28)], "downlight", "emit", 20)


def wall_ornament():
    """Raised marble panels, roundels, frieze rosettes and sconces."""
    for wall in "we":
        xf, s = (-HX, 1) if wall == "w" else (HX, -1)
        for z in LAYOUT["bays"]:
            if not (wall == "w" and z == 0):
                framed_panel(wall, z, 4.9, 4.2, 6.9, "cream")
            if wall == "w" and z:
                framed_panel(wall, z, 13.9, 3.4, 2.6, "cream")
        for z in LAYOUT["sidePilasters"]:
            sconce(xf + s * .36, 3.3, z, s, 0)
    for x in (-15.0, -9.0, -3.0, 3.0, 9.0, 15.0):
        framed_panel("s", x, 11.2, 5.4, 3.3, "cream")
        verts, faces = [], []
        prof = [(0, 0), (.62, 0), (.66, .05), (.6, .1), (0, .12)]
        n, sides = len(prof), 40
        for i in range(sides):
            t = 2 * pi * i / sides
            for r, d in prof:
                verts.append(tuple(P(x + cos(t) * r, 14.3 + sin(t) * r, HZ - d)))
        for i in range(sides):
            j = (i + 1) % sides
            for k in range(n - 1):
                faces.append((i * n + k, j * n + k, j * n + k + 1, i * n + k + 1))
        emit_object("Roundel", verts, faces, "gold", "shell", Matrix.Identity(4), .8, smooth=True)
        box("Roundel boss", x, 14.3, HZ - .15, .4, .4, .08, "cream", "shell", bevel=.07, segments=4)
    for x in (-18.1, -12.0, -6.0, 6.0, 12.0, 18.1):
        sconce(x, 3.6, HZ - .36, 0, -1)
    framed_panel("n", 0, 15.3, 17.4, 1.4, "wallstone")
    for axis, base, out, span in (("x", (0, -HZ), (0, 0, 1), HX), ("x", (0, HZ), (0, 0, -1), HX),
                                  ("z", (-HX, 0), (1, 0, 0), HZ), ("z", (HX, 0), (-1, 0, 0), HZ)):
        for t in np.arange(-span + .9, span - .5, 1.75):
            px = float(t) if axis == "x" else base[0] + out[0] * .12
            pz = float(t) if axis == "z" else base[1] + out[2] * .12
            box("Frieze rosette", px, 17.2, pz, .32 if axis == "x" else .08, .32, .08 if axis == "x" else .32, "cream", "shell", bevel=.035, segments=1)
            box("Frieze rosette eye", px + out[0] * .05, 17.2, pz + out[2] * .05, .12 if axis == "x" else .05, .12, .05 if axis == "x" else .12, "gold", "shell")


# ---------------------------------------------------------------- architecture
def build_shell():
    # Floor: verde marble field, cream bands on the coffer grid, brass inlay and a star medallion.
    box("Structural floor", 0, -.2, 0, W + 1, .4, D + 1, "floor", tile=3.5)
    step = 3.5
    for i in range(int(W / step) + 1):
        x = -HX + i * step
        if -HX < x < HX:
            box("Floor band x", x, .002, 0, .22, .004, D, "cream", tile=3.5)
            box("Floor inlay x", x, .005, 0, .025, .004, D, "brass")
    for k in range(int(D / step) + 1):
        z = -HZ + k * step + .0
        if -HZ < z < HZ:
            box("Floor band z", 0, .002, z, W, .004, .22, "cream", tile=3.5)
    mx, mz = 0, -1.2
    for r_out, r_in, mat, h in ((3.0, 2.82, "brass", .006), (2.8, 2.35, "cream", .005), (2.35, 2.3, "brass", .006),
                                (1.2, 1.12, "brass", .007)):
        ring("Medallion ring", mx, 0, mz, r_out, r_in, h, mat, "shell", 96)
    star = []
    for i in range(32):
        a = i * pi / 16
        rr = 2.25 if i % 2 == 0 else .95
        star.append(tuple(P(mx + sin(a) * rr, .006, mz + cos(a) * rr)))
    emit_object("Medallion star", star, [tuple(range(32))], "gold", "shell", Matrix.Identity(4), 1.2, facing=(0, 0, 1))
    disc("Medallion core", mx, 0, mz, 1.1, .008, "floor", "shell", 64)

    # Walls with skirting, walnut wainscot and stone courses.
    for name, x, z, w, d in (("North wall", 0, -HZ - .3, W + 1, .6), ("South wall", 0, HZ + .3, W + 1, .6),
                             ("West wall", -HX - .3, 0, .6, D + 1), ("East wall", HX + .3, 0, .6, D + 1)):
        box(name, x, H / 2, z, w, H, d, "wallstone", tile=2.6)
    for side, (axis, base, out, span) in {
        "n": ("x", (0, -HZ), (0, 0, 1), HX), "s": ("x", (0, HZ), (0, 0, -1), HX),
        "w": ("z", (-HX, 0), (1, 0, 0), HZ), "e": ("z", (HX, 0), (-1, 0, 0), HZ)}.items():
        molding("Skirting", axis, -span, span, base, [(0, 0), (0, .05), (.22, .05), (.26, .03), (.28, 0)], "floor", "shell", out)
        molding("Wainscot", axis, -span, span, base, [(.28, 0), (.28, .045), (1.12, .045), (1.12, 0)], "walnut", "shell", out)
        molding("Chair rail", axis, -span, span, base, [(1.12, 0), (1.12, .07), (1.17, .085), (1.22, .06), (1.24, 0)], "brass", "shell", out)
        molding("String course", axis, -span, span, base, [(8.75, 0), (8.75, .08), (8.85, .1), (8.95, .08), (8.95, 0)], "cream", "shell", out)
        # Entablature: architrave, gilded frieze, dentils and cornice.
        molding("Architrave", axis, -span, span, base, [(16.4, 0), (16.4, .16), (16.75, .16), (16.8, .2), (16.85, .2), (16.85, 0)], "cream", "shell", out)
        molding("Frieze", axis, -span, span, base, [(16.85, 0), (16.85, .1), (17.55, .1), (17.55, 0)], "gold", "shell", out)
        molding("Cornice", axis, -span, span, base, [(17.55, 0), (17.55, .26), (17.72, .3), (17.8, .48), (17.95, .62),
                                                    (18.05, .62), (18.05, 0)], "cream", "shell", out)
        molding("Cove light", axis, -span + .7, span - .7, base, [(18.06, .45), (18.06, .58), (18.09, .58), (18.09, .45)], "cove", "emit", out)
        n = int(span * 2 / .28)
        for i in range(n):
            t = -span + .14 + i * .28
            if axis == "x":
                box("Dentil", t, 17.47, base[1] + out[2] * .22, .14, .16, .12, "cream")
            else:
                box("Dentil", base[0] + out[0] * .22, 17.47, t, .12, .16, .14, "cream")

    # Pilasters: fluted cream marble, gilded capitals.
    def pilaster(x, z, nx, nz, y0=.28, y1=16.4, width=1.1):
        yaw = 0 if nz else 90
        proj = .36
        cx, cz = x + nx * proj / 2, z + nz * proj / 2
        wx, wz = (width, proj) if nz else (proj, width)
        box("Pilaster base", x + nx * .26, y0 + .22, z + nz * .26, wx + (.3 if nz else .16), .44, wz + (.16 if nz else .3), "cream", bevel=.04)
        box("Pilaster torus", x + nx * .22, y0 + .52, z + nz * .22, wx + (.18 if nz else .1), .16, wz + (.1 if nz else .18), "cream", bevel=.06, segments=4)
        box("Pilaster shaft", cx, (y0 + .6 + y1 - .9) / 2, cz, wx, y1 - .9 - y0 - .6, wz, "cream", tile=2.2, bevel=.02)
        for k in range(5):
            off = (k - 2) * width / 5.6
            box("Pilaster flute", x + nx * (proj + .002) + (off if nz else 0), (y0 + 1.0 + y1 - 1.3) / 2,
                z + nz * (proj + .002) + (0 if nz else off), .07 if nz else .01, y1 - 1.3 - y0 - 1.0, .01 if nz else .07, "wallstone")
        for k, (yy, grow, hh, mat) in enumerate(((y1 - .9, .06, .12, "gold"), (y1 - .72, .14, .3, "gold"),
                                                 (y1 - .38, .26, .22, "gold"), (y1 - .12, .34, .14, "cream"))):
            box("Capital", x + nx * (proj + grow) / 2, yy + hh / 2, z + nz * (proj + grow) / 2,
                wx + (grow * 2 if nz else grow), hh, wz + (grow if nz else grow * 2), mat, bevel=.03)
        for s in (-1, 1):
            ux, uz = (s * (width / 2 + .1), 0) if nz else (0, s * (width / 2 + .1))
            lathe("Volute", x + nx * (proj + .14) + ux, y1 - .45, z + nz * (proj + .14) + uz,
                  [(0, 0), (.13, 0), (.15, .1), (.13, .2), (0, .2)], "gold", "shell", 16)

    for z in LAYOUT["sidePilasters"]:
        pilaster(-HX, z, 1, 0)
        pilaster(HX, z, -1, 0)
    for x in (-10.05, 10.05, -20.35, 20.35):
        pilaster(x, -HZ, 0, 1, y0=4.6)
        box("Pilaster corbel", x, 4.48, -HZ + .3, 1.3, .5, .6, "cream", bevel=.05)
    for x in (-18.1, -12.0, -6.0, 6.0, 12.0, 18.1):
        pilaster(x, HZ, 0, -1)

    # North stage under the big board.
    box("Board stage", 0, .2, -HZ + 1.05, 37.6, .4, 2.3, "cream", bevel=.03, tile=2)
    box("Board stage nosing", 0, .41, -HZ + 2.18, 37.6, .03, .06, "brass")
    box("Board stage kick", 0, .2, -HZ + 2.2, 37.4, .32, .02, "cove", "emit")
    box("Board backdrop", 0, 8.0, -HZ + .04, 18.6, 8.6, .08, "black", "fixtures")

    # East: round-headed daylight windows above the commodity desks.
    for z in LAYOUT["bays"]:
        box("Window reveal", HX - .02, 12.2, z, .3, 7.2, 4.6, "cream", bevel=.04)
        arch_window(HX - .2, z, -1, 4.0, 9.3, 13.4)
    # West: niches framing the upper panels.
    for z in LAYOUT["bays"]:
        if z == 0:
            continue
        box("Panel niche", -HX + .03, 11.3, z, .06, 3.3, 5.1, "walnut", "shell", bevel=.02)
        box("Niche gilt frame", -HX + .07, 11.3, z, .05, 3.05, 4.85, "gold", "shell")

    # Bell podium balcony in the west centre bay.
    px0 = -HX + 2.8
    box("Podium slab", (-HX + px0) / 2, 5.15, 0, 2.8, .36, 6.8, "cream", "shell", bevel=.04)
    molding("Podium fascia", "z", -3.4, 3.4, (px0, 0), [(4.92, 0), (4.92, .06), (5.0, .1), (5.34, .1), (5.4, .06), (5.4, 0)], "gold", "shell", (1, 0, 0))
    for s in (-1, 1):
        lathe("Podium column", px0 - .35, 0, s * 3.0, [(.36, 0), (.36, .3), (.3, .42), (.27, .6), (.24, 4.4), (.3, 4.6), (.38, 4.97), (0, 4.97)],
              "cream", "shell", 40)
    for zz in np.arange(-3.25, 3.3, .26):
        lathe("Baluster", px0 - .1, 5.33, zz, [(.05, 0), (.07, .1), (.045, .3), (.08, .55), (.045, .82), (.05, .9), (0, .9)], "cream", "shell", 12)
    box("Podium handrail", px0 - .1, 6.27, 0, .16, .08, 6.8, "brass", "fixtures", bevel=.03)
    for s in (-1, 1):
        box("Podium side rail", (-HX + px0) / 2, 6.27, s * 3.36, 2.8, .08, .14, "brass", "fixtures", bevel=.03)
    lathe("Opening bell", px0 - .9, 6.45, -2.2, [(0, .62), (.08, .6), (.16, .5), (.19, .3), (.25, .08), (.3, 0), (.28, -.02), (0, -.02)], "brass", "fixtures", 40)
    box("Bell yoke", px0 - .9, 7.2, -2.2, .08, .1, .9, "brass", "fixtures")
    for s in (-1, 1):
        box("Bell stand", px0 - .9, 6.2, -2.2 + s * .42, .06, 1.95, .06, "walnut", "fixtures")
    box("Podium lectern", px0 - .7, 5.85, 1.4, .55, 1.0, .7, "walnut", "fixtures", bevel=.03)

    # South visitor gallery and portals.
    gz = HZ - 1.3
    box("Gallery slab", 0, 6.72, gz, W, .76, 2.6, "cream", "shell", bevel=.03)
    molding("Gallery cornice", "x", -HX, HX, (0, HZ - 2.6), [(6.3, 0), (6.3, .05), (6.36, .1), (6.42, .1), (6.42, 0)], "gold", "shell", (0, 0, -1))
    for x in np.arange(-HX + .4, HX - .3, 1.6):
        box("Gallery glass", x, 7.66, HZ - 2.55, 1.56, 1.0, .02, "glass", "emit")
    box("Gallery handrail", 0, 8.2, HZ - 2.55, W, .08, .14, "brass", "fixtures", bevel=.03)
    box("Gallery shoe", 0, 7.15, HZ - 2.55, W, .08, .1, "brass", "fixtures")
    for x in (-18.1, -12.0, -6.0, 6.0, 12.0, 18.1):
        box("Gallery bracket", x, 5.9, HZ - 1.2, .5, .9, 2.4, "cream", "shell", bevel=.05)
    for x, w, h in ((0, 4.4, 5.0), (-9.0, 3.0, 4.4), (9.0, 3.0, 4.4), (-15.05, 3.0, 4.4), (15.05, 3.0, 4.4)):
        box("Portal glazing", x, h / 2, HZ - .02, w, h, .04, "window", "emit")
        box("Portal frame", x, h + .2, HZ - .1, w + .8, .4, .2, "brass", "fixtures", bevel=.03)
        for s in (-1, 1):
            box("Portal jamb", x + s * (w / 2 + .2), h / 2, HZ - .1, .4, h, .2, "brass", "fixtures", bevel=.03)
        box("Portal transom bar", x, h * .78, HZ - .06, w, .06, .06, "brass", "fixtures")

    wall_ornament()

    # Coffered gilded ceiling with a central laylight.
    box("Ceiling slab", 0, H + .2, 0, W + 1, .4, D + 1, "plaster", tile=3)
    cs = 3.5
    nxc, nzc = int(W / cs), int(D / cs)
    for i in range(nxc + 1):
        x = -HX + i * cs
        box("Ceiling beam x", x, H - .55, 0, .62, 1.1, D, "plaster", bevel=.03, tile=2)
        box("Beam soffit gilt", x, H - 1.11, 0, .42, .03, D, "gold")
    for k in range(nzc + 1):
        z = -HZ + k * cs
        box("Ceiling beam z", 0, H - .55, z, W, 1.1, .62, "plaster", bevel=.03, tile=2)
        box("Beam soffit gilt", 0, H - 1.11, z, W, .03, .42, "gold")
    for i in range(nxc):
        for k in range(nzc):
            cx, cz = -HX + (i + .5) * cs, -HZ + (k + .5) * cs
            central = abs(cx) < 7 and -6 < cz < 3
            inner = cs - .62
            for step, (inset, hh, yy, mat) in enumerate(((.0, .18, H - .38, "gold"), (.22, .14, H - .2, "plaster"), (.4, .08, H - .1, "gold"))):
                s = inner - inset * 2
                for u in (-1, 1):
                    box("Coffer step", cx + u * (s / 2 - .06), yy, cz, .12, hh, s, mat)
                    box("Coffer step", cx, yy, cz + u * (s / 2 - .06), s, hh, .12, mat)
            if central:
                box("Laylight", cx, H - .05, cz, inner - .9, .02, inner - .9, "skylight", "emit")
                for u in (-1, 0, 1):
                    box("Laylight leading", cx + u * (inner - .9) / 3 * 1.0, H - .07, cz, .03, .02, inner - .9, "brass", "fixtures")
                    box("Laylight leading", cx, H - .07, cz + u * (inner - .9) / 3, inner - .9, .02, .03, "brass", "fixtures")
            else:
                lathe("Coffer rosette", cx, H - .14, cz, [(0, 0), (.42, 0), (.5, .06), (.36, .12), (0, .14)], "gold", "shell", 24)
                disc("Coffer downlight", cx, H - .16, cz, .13, .02, "downlight", "emit", 20)


# ---------------------------------------------------------------- furniture and fixtures
def build_posts():
    for p, post in enumerate(LAYOUT["posts"]):
        x, z = post["x"], post["z"]
        disc("Post carpet", x, 0, z, 2.95, .012, "carpet", "fixtures", 72)
        ring("Post carpet brass", x, 0, z, 3.0, 2.95, .014, "brass", "fixtures", 72)
        disc("Post plinth", x, 0, z, 2.25, .08, "cream", "fixtures", 72)
        ring("Post kick", x, .08, z, 2.0, 1.25, .16, "steel", "fixtures", 64)
        ring("Post cabinet", x, .24, z, 2.0, 1.25, .84, "walnut", "fixtures", 64)
        for k in range(16):
            a = k * pi / 8 + pi / 16
            box("Cabinet panel", x + sin(a) * 2.005, .66, z + cos(a) * 2.005, .7, .62, .012, "walnut", "fixtures",
                yaw=k * 22.5 + 11.25, bevel=.004)
            box("Cabinet panel gilt", x + sin(a) * 2.012, .66, z + cos(a) * 2.012, .62, .54, .004, "gold", "fixtures",
                yaw=k * 22.5 + 11.25)
        ring("Post brass band", x, 1.06, z, 2.03, 1.24, .03, "brass", "fixtures", 64)
        lathe("Post counter top", x, 1.09, z, [(1.18, 0), (2.12, 0), (2.15, .02), (2.14, .045), (1.18, .045)], "floor", "fixtures", 72, smooth=False, inner_cap=False)
        lathe("Post column", x, 1.13, z, [(.48, 0), (.48, .12), (.42, .18), (.42, 2.6), (.5, 2.72), (.5, 2.82), (0, 2.82)], "walnut", "fixtures", 40)
        for yy in (1.5, 2.6, 3.4):
            ring("Column band", x, yy, z, .44, .40, .04, "brass", "fixtures", 40)
        # Halo frame: ring beam and spokes the monitors hang from.
        ring("Halo ring", x, 3.74, z, 1.84, 1.66, .1, "steel", "fixtures", 64)
        ring("Halo trim", x, 3.84, z, 1.86, 1.64, .02, "brass", "fixtures", 64)
        for k in range(8):
            a = k * pi / 4
            box("Halo spoke", x + sin(a) * 1.05, 3.79, z + cos(a) * 1.05, .07, .07, 1.3, "steel", "fixtures", yaw=k * 45)
        # Crown: cylindrical ticker housing and a gilded canopy with downlights.
        lathe("Crown core", x, 3.96, z, [(1.5, 0), (1.5, .64), (0, .64)], "black", "fixtures", 64, smooth=False)
        ring("Crown band low", x, 3.97, z, 1.63, 1.48, .06, "brass", "fixtures", 64)
        ring("Crown band high", x, 4.55, z, 1.63, 1.48, .06, "brass", "fixtures", 64)
        lathe("Canopy", x, 4.61, z, [(0, 0), (1.95, 0), (2.0, .05), (1.95, .12), (1.7, .2), (0, .22)], "gold", "fixtures", 64)
        for k in range(10):
            a = k * pi / 5
            disc("Canopy downlight", x + sin(a) * 1.78, 4.595, z + cos(a) * 1.78, .07, .016, "downlight", "emit", 16)
        # Post number plate on the counter fascia.
        box("Post plate", x, .9, z + 2.01, .5, .14, .012, "brass", "fixtures")


def monitor_housings():
    for s in LAYOUT["screens"]:
        kind, w, h = s["kind"], s["w"], s["h"]
        if kind == "ring":
            continue
        if kind == "board":
            oriented(s, 0, 0, -.12, w + .14, h + .14, .2, "bezel", bevel=.02)
            oriented(s, 0, 0, -.014, w + .06, h + .06, .012, "bezel")
            oriented(s, 0, -h / 2 - .09, -.05, w + .14, .04, .1, "brass")
            for u in (-.36, 0, .36):
                oriented(s, w * u, 0, -.28, .25, h * .6, .25, "steel")
        elif kind == "ticker":
            oriented(s, 0, 0, -.06, w + .1, h + .12, .1, "bezel", bevel=.01)
            oriented(s, 0, h / 2 + .07, -.02, w + .14, .025, .05, "brass")
            oriented(s, 0, -h / 2 - .07, -.02, w + .14, .025, .05, "brass")
            if abs(s["yaw"]) == 90:
                for u in np.arange(-w / 2 + 1, w / 2, 2.8):
                    oriented(s, float(u), 0, -.26, .06, .06, .38, "steel")
        elif kind == "wall":
            oriented(s, 0, 0, -.014, w + .016, h + .016, .022, "bezel", bevel=.004)
            oriented(s, 0, 0, -.04, w + .006, h + .006, .02, "steel", bevel=.004)
            oriented(s, 0, 0, -.09, w * .4, h * .35, .08, "steel")
            oriented(s, 0, -h / 2 - .02, -.016, .2, .006, .006, "brass")
        else:  # halo, counter, desk: ultra slim OLED monitors
            oriented(s, 0, 0, -.006, w + .008, h + .008, .007, "bezel", bevel=.002)
            oriented(s, 0, -h * .08, -.02, w * .52, h * .56, .022, "steel", bevel=.006)
            if kind == "halo":
                for u in (-.3, .3):
                    oriented(s, w * u, h / 2 + .2, -.02, .02, .4, .02, "steel")
            else:
                base = 1.13 if kind == "counter" else .76
                neck = s["y"] - base
                oriented(s, 0, -neck / 2 - h * .1, -.06, .05, neck, .018, "silver", bevel=.006)
                c = P(s["x"], base, s["z"])
                r = rot(s["yaw"])
                foot = Matrix.Translation(c + r.to_3x3() @ Vector((0, .1, .006)))
                emit_object("Monitor foot", [(-.13, -.09, -.006), (.13, -.09, -.006), (.13, .09, -.006), (-.13, .09, -.006),
                                             (-.13, -.09, .006), (.13, -.09, .006), (.13, .09, .006), (-.13, .09, .006)],
                            [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
                            "silver", "fixtures", foot @ rot(s["yaw"]), .3, .005)


def office_chair(x, z, yaw):
    lathe("Chair column", x, .08, z, [(.03, 0), (.03, .38), (0, .38)], "silver", "fixtures", 16)
    for k in range(5):
        a = radians(yaw + k * 72)
        box("Chair star leg", x + sin(a) * .17, .07, z + cos(a) * .17, .05, .04, .34, "silver", "fixtures", yaw=yaw + k * 72, bevel=.012)
        lathe("Chair caster", x + sin(a) * .32, 0, z + cos(a) * .32, [(0, 0), (.03, 0), (.035, .03), (.03, .06), (0, .06)], "black", "fixtures", 10)
    box("Chair seat", x, .5, z, .52, .1, .5, "leather", "fixtures", yaw=yaw, bevel=.04, segments=3)
    a = radians(yaw)
    bx, bz = x - sin(a) * .25, z - cos(a) * .25
    box("Chair back", bx, .9, bz, .48, .66, .09, "leather", "fixtures", yaw=yaw, tilt=-8, bevel=.04, segments=3)
    box("Chair spine", x - sin(a) * .3, .65, z - cos(a) * .3, .06, .4, .03, "silver", "fixtures", yaw=yaw, bevel=.01)
    for s in (-1, 1):
        ox, oz = cos(a) * s * .28, -sin(a) * s * .28
        box("Chair arm", x + ox, .68, z + oz, .05, .04, .32, "silver", "fixtures", yaw=yaw, bevel=.012)
        box("Chair arm post", x + ox, .6, z + oz - 0, .03, .16, .03, "silver", "fixtures", yaw=yaw)


def build_booths():
    rng = __import__("random").Random(20261121)   # fixed seed: the same natural scatter every build
    for b in LAYOUT["booths"]:
        side, x, z = b["side"], b["x"], b["z"]
        dx = x + side * .18
        box("Desk top", dx, .74, z, .85, .04, 2.5, "walnut", "fixtures", bevel=.012)
        box("Desk leather", dx, .762, z, .55, .004, 1.9, "leather", "fixtures")
        box("Desk modesty", dx + side * .38, .4, z, .03, .66, 2.4, "walnut", "fixtures")
        for s in (-1, 1):
            box("Desk pedestal", dx, .37, z + s * 1.1, .8, .72, .3, "walnut", "fixtures", bevel=.01)
            box("Pedestal pull", dx - side * .405, .55, z + s * 1.1, .005, .02, .16, "brass", "fixtures")
        for k in (-1, 1):
            box("Keyboard", dx - side * .2, .77, z + k * .55, .14, .016, .44, "black", "fixtures", yaw=0, bevel=.004)
        box("Desk phone", dx - side * .1, .79, z + .05, .2, .05, .22, "black", "fixtures", bevel=.01)
        # Chairs left as people left them: swivelled, pulled out, a few rolled toward the neighbour desk.
        swivel = rng.choice((-1, 1)) * rng.uniform(10, 35)
        pull = rng.uniform(.62, 1.05)
        drift = rng.uniform(-.35, .35) if rng.random() < .75 else rng.choice((-1, 1)) * rng.uniform(.5, .8)
        office_chair(x - side * pull, z + drift, -90 * side + swivel)
        box("Booth divider", x + side * .2, .62, z + (1.28 if z > 0 else -1.28), .9, 1.24, .05, "walnut", "fixtures", bevel=.01)


def import_prop(source, identifier, placements, group="props", scale=1.0, lift=0.0):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / identifier / f"{identifier}.gltf"))
    imported = set(bpy.context.scene.objects) - before
    bpy.context.view_layer.update()
    meshes = [(obj, obj.matrix_world.copy()) for obj in imported if obj.type == "MESH"]
    for idx, place in enumerate(placements):
        x, y, z, yaw = place if len(place) == 4 else (place[0], lift, place[1], place[2])
        transform = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(radians(yaw), 4, "Z") @ Matrix.Scale(scale, 4)
        for src, world in meshes:
            dup = bpy.data.objects.new(f"{identifier} {idx + 1}", src.data)
            bpy.context.collection.objects.link(dup)
            dup.matrix_world = transform @ world
            GROUPS[group].append(dup)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)


def build_props(source):
    # Lounges at the south corners.
    for s in (-1, 1):
        cx, cz = s * 16.0, 10.4
        box("Lounge rug", cx, .006, cz, 5.0, .012, 4.0, "carpet", "fixtures", bevel=.004, tile=2)
        box("Lounge rug border", cx, .004, cz, 5.2, .008, 4.2, "brass", "fixtures")
    import_prop(source, "sofa_02", [(s * 16.0, 0, 10.4 + d * 1.35, 180 if d > 0 else 0) for s in (-1, 1) for d in (-1, 1)], scale=1.35)
    import_prop(source, "mid_century_lounge_chair", [(s * 17.9, 0, 10.4, -90 * s) for s in (-1, 1)])
    import_prop(source, "modern_coffee_table_01", [(s * 16.0, 0, 10.4, 0) for s in (-1, 1)], scale=1.2)
    import_prop(source, "potted_plant_02", [(s * 19.3, 0, z, 0) for s in (-1, 1) for z in (8.4, 12.9)] +
                [(s * 18.9, .4, -13.6, 0) for s in (-1, 1)], scale=1.45)
    # Bronze bull on a marble plinth facing the entrance.
    box("Bull plinth", 0, .55, 10.6, 1.1, 1.1, 1.1, "cream", "fixtures", bevel=.03, tile=1)
    box("Bull plinth base", 0, .06, 10.6, 1.4, .12, 1.4, "floor", "fixtures", bevel=.02)
    box("Bull plinth cap", 0, 1.12, 10.6, 1.24, .06, 1.24, "brass", "fixtures", bevel=.015)
    import_prop(source, "bull_head", [(0, 1.15, 10.6, 0)], scale=2.6)
    # Busts flanking the main portal, a grandfather clock on the bell podium.
    for s in (-1, 1):
        box("Bust pedestal", s * 3.4, .6, 15.05, .55, 1.2, .55, "floor", "fixtures", bevel=.02)
    import_prop(source, "marble_bust_01", [(s * 3.4, 1.2, 15.05, 180) for s in (-1, 1)], scale=1.25)
    import_prop(source, "vintage_grandfather_clock_01", [(-HX + .45, 5.33, 2.4, -90)], scale=1.0)
    # Chandeliers hung from the coffers.
    spots = [(x, z) for x in (-8.75, 8.75) for z in (-8.95, 1.55, 8.55)]
    import_prop(source, "Chandelier_03", [(x, 12.4, z, 0) for x, z in spots], scale=3.6)
    for x, z in spots:
        lathe("Chandelier rod", x, 15.9, z, [(.035, 0), (.035, H - 15.9), (0, H - 15.9)], "brass", "fixtures", 12)
        lathe("Ceiling canopy", x, H - 1.2, z, [(0, 0), (.25, 0), (.28, .1), (0, .14)], "gold", "fixtures", 24)


# ---------------------------------------------------------------- bake
def bake_lights():
    """Lights that only exist for baking: area lights at the coffers, posts and boards, screen glow."""
    extra = []

    def area(name, loc, size, energy, color, rot_euler=(0, 0, 0), shape="SQUARE", size_y=None):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.color, data.shape, data.size = energy, color, shape, size
        if size_y:
            data.shape, data.size_y = "RECTANGLE", size_y
        obj = bpy.data.objects.new(name, data)
        obj.location, obj.rotation_euler = loc, rot_euler
        bpy.context.collection.objects.link(obj)
        extra.append(obj)

    for post in LAYOUT["posts"]:
        area("Post light", P(post["x"], 4.55, post["z"]), 3.6, 210, (1, .86, .68))
    for x, z in [(x, z) for x in (-8.75, 8.75) for z in (-8.95, 1.55, 8.55)]:
        data = bpy.data.lights.new("Chandelier", "POINT")
        data.energy, data.color, data.shadow_soft_size = 1600, (1, .8, .55), .9
        obj = bpy.data.objects.new("Chandelier", data)
        obj.location = P(x, 14.2, z)
        bpy.context.collection.objects.link(obj)
        extra.append(obj)
    for x in np.arange(-17.5, 18, 5.0):
        area("Floor wash", P(float(x), 17.2, -4.0), 2.5, 1900, (1, .9, .78), size_y=16)
        area("Floor wash", P(float(x), 17.2, 9.5), 2.5, 1000, (1, .9, .78), size_y=8)
    for side in (-1, 1):   # wall washers keep the marble walls and boards' surroundings lit
        area("Wall wash", P(side * 17.5, 15.5, 0), 2.0, 1400, (1, .92, .82), (radians(-30 * side), 0, radians(90)), size_y=26)
    area("Board wash", P(0, 15.5, -11.5), 3.0, 1500, (1, .92, .84), (radians(35), 0, 0), size_y=30)
    # Screens glow onto the stone: emissive stand-ins removed before export.
    glow = _principled("Screen glow stand-in", (.1, .2, .4), .5, 0, emit=1.4, emit_color=(.25, .45, .95))
    for s in LAYOUT["screens"]:
        if s["kind"] in ("board", "wall", "ticker"):
            r = rot(s["yaw"], s.get("tilt", 0))
            c = P(s["x"], s["y"], s["z"]) + r.to_3x3() @ Vector((0, -.003, 0))
            a, b = s["w"] / 2, s["h"] / 2
            obj = emit_object("glow", [(-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b)], [(0, 1, 2, 3)], glow, "bakeonly",
                              Matrix.Translation(c) @ r, world_uv=False)
            extra.append(obj)
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


def bake(obj, size, samples, out_path):
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
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=10)
    for m, n, uv in nodes:
        m.node_tree.nodes.remove(n)
        m.node_tree.nodes.remove(uv)
    obj.data.uv_layers.active = obj.data.uv_layers["Surface"]
    pix = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    rgb = pix.reshape(size, size, 4)[::-1, :, :3]
    # Light denoise: small separable blur (islands are padded by the bake margin).
    k = np.array([.06, .24, .4, .24, .06], dtype=np.float32)
    for axis in (0, 1):
        rgb = sum(np.roll(rgb, i - 2, axis=axis) * k[i] for i in range(5))
    lum = rgb.mean(axis=2)
    scale = float(np.percentile(lum[lum > 1e-4], 99.6)) * 1.15 or 1.0
    enc = np.clip(rgb / scale, 0, 1) ** (1 / 2.2)
    return enc, scale


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
    scene.cycles.use_denoising = True
    world = bpy.data.worlds.new("Hall")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.02, .02, .025, 1)
    scene.world = world


def build(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials(source)
    build_shell()
    build_posts()
    monitor_housings()
    build_booths()
    build_props(source)


def environment(out_dir, samples=160):
    """Equirectangular HDR of the hall from its centre: the browser's reflection environment, so
    polished stone and display glass reflect this room rather than a stock photo."""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("env")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("env", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = P(0, 3.2, -1.0)
    cam.rotation_euler = (radians(90), 0, radians(-90))   # image centre faces +x, as three.js expects
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512   # reflections only: ~1.6 MB
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.render.image_settings.file_format = "HDR"
    scene.render.image_settings.color_depth = "32"
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = str(out_dir / "hall-env-v3.hdr")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def preview(out_dir, samples=48):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.cycles.samples = samples
    for name, (x, y, z, yaw, pitch) in {
            "spawn": (0, 1.66, 13.6, 0, 6), "post": (-8, 1.66, 0, 60, 8), "east": (6, 1.66, 2, -70, 14),
            "ceiling": (0, 1.66, 5, 0, 48)}.items():
        cam_data = bpy.data.cameras.new(name)
        cam_data.lens = 18
        cam = bpy.data.objects.new(name, cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = P(x, y, z)
        cam.rotation_euler = (radians(90 + pitch), 0, radians(yaw))
        scene.camera = cam
        scene.render.filepath = str(out_dir / f"preview-{name}.png")
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--samples", type=int, default=384)
    parser.add_argument("--shell-size", type=int, default=4096)
    parser.add_argument("--fixture-size", type=int, default=4096)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--blend", type=Path)
    opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = opts.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    build(opts.sources.resolve())
    setup_cycles()
    for g in ("shell", "fixtures", "emit"):
        join(g)
    lightmap_uv(GROUPS["shell"][0], .0015)
    lightmap_uv(GROUPS["fixtures"][0], .0015)
    extra = bake_lights()
    environment(out)
    if opts.preview:
        preview(out)
    meta = {}
    for g, size in (("shell", opts.shell_size), ("fixtures", opts.fixture_size)):
        enc, scale = bake(GROUPS[g][0], size, opts.samples, out)
        save_lightmap(enc, out / f"lightmap-{g}-v3.webp")
        meta[g] = {"scale": round(scale, 5), "file": f"lightmap-{g}-v3.webp"}
        print(g, "baked, scale", scale, flush=True)
    for obj in extra:
        bpy.data.objects.remove(obj, do_unlink=True)
    (ROOT / "frontend/src/exchange/bake.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    if opts.blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(opts.blend.resolve()))
    bpy.ops.export_scene.gltf(filepath=str(out / "trading-hall-v3.glb"), export_format="GLB", export_yup=True,
                              export_image_format="AUTO", export_cameras=False,
                              export_lights=False, export_materials="EXPORT", export_extras=False,
                              export_meshopt_compression_enable=False, export_gpu_instances=True,
                              export_texcoords=True, export_normals=True, export_apply=True)
    print("exported", flush=True)
