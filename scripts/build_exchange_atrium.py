"""Model KOSPIMAP's v6 Grand Luminous Trading Atrium in Blender 5.2, bake 4K Cycles GI & export glTF.

    blender -b --factory-startup --python scripts/build_exchange_atrium.py -- <sources> <out dir> [--samples N] [--preview]

Upgrades over v5:
- Monumental sculpted travertine + bronze + champagne-brass tree columns with double-profiled vaulted ribs,
  coffered oak spandrels, recessed continuous 3000K arch cove channels, and a 3-tier sculpted oculus dome.
- 5-tier telescoping holographic light core: suspended wide open halo crown, precision brass-trimmed screen
  drums with structural spoke arms, translucent holographic glass collar (`HoloCoreFX`), and a luminous
  floor glass well with 48 multi-radius crystal fiber-optic filaments.
- Architectural perimeter depth: museum-grade recessed walnut+brass art alcoves (all 31 paintings preserved),
  signature diamond champagne-gold inlaid walnut feature walls behind curved promenade sofas, floor-to-ceiling
  mullioned daylight skyline windows, and refined fluted oak/walnut acoustic accents.
- Bespoke Calacatta marble plaza with dark Emperador marble borders & radial champagne-brass floor inlays.
- Living illuminated reflecting pools (`WaterSurface` node for WebGPU ripple shader) with underwater cyan-gold
  LED lines and low curved glass guards with brass spigots.
- Sculpted fluted-walnut curved trading pods with brass trims, glowing toe-kicks, and a marble-topped central
  command rotunda with circular brass footrail.
- Balanced Nishita daylight + sculpted 3000K architectural coves + cool sapphire core glow for dramatic
  contrast, clean AO, and 2K Cycles HDR reflections while maintaining ~140-165 draw calls at 60fps.
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
VERSION = "v6"
rng = random.Random(6)


def P(x, y, z):
    return Vector((x, -z, y))


def pol(r, t):
    return r * sin(radians(t)), r * cos(radians(t))


def rot(yaw=0.0, tilt=0.0):
    return Matrix.Rotation(radians(yaw), 4, "Z") @ Matrix.Rotation(radians(tilt), 4, "X")


# ---------------------------------------------------------------- materials
def _principled(name, color, roughness, metal=0.0, emit=0.0, emit_color=None, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    if coat and "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*(emit_color or color), 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    m.diffuse_color = (*color, 1)
    m.use_backface_culling = alpha >= 1 and not emit
    return m


def textured(key, name, root, metal=0.0, normal=0.6, tint=None, coat=0.0):
    m = _principled(name, (.5, .5, .5), .5, metal, coat=coat)
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


def emissive_image(name, path, strength, uv_map="Surface", base=(.01, .012, .016), rough=.18):
    m = _principled(name, base, rough)
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
    # Luxury v6 architectural stone & marble hierarchy
    MAT["stone"] = textured("calacatta", "Calacatta light marble", r, normal=.18, coat=.12)
    MAT["darkmarble"] = textured("darkmarble", "Emperador dark marble", r, normal=.18, coat=.18)
    MAT["trav"] = textured("trav", "Architectural warm travertine", r, normal=.28)
    # Woods: light architectural oak + rich American walnut
    MAT["oak"] = textured("veneer", "Light oak veneer", r, normal=.45)
    MAT["oakv"] = textured("veneerv", "Light oak veneer vertical", r, normal=.45)
    MAT["deck"] = textured("oak", "Oak floorboards", r, normal=.35)
    MAT["walnut"] = textured("walnut", "American walnut", r, normal=.42)
    MAT["walnutv"] = textured("walnutv", "American walnut vertical", r, normal=.42)
    MAT["darkoak"] = textured("walnut", "Smoked walnut trim", r, normal=.45, tint=(.62, .58, .55))
    # Fabrics & upholstery
    MAT["carpet"] = textured("carpet", "Charcoal acoustic carpet", r, normal=.75, tint=(.46, .48, .52))
    MAT["weave"] = textured("weave", "Ivory linen weave", r, normal=.55)
    MAT["screenfab"] = textured("weave", "Slate acoustic fabric", r, normal=.55, tint=(.46, .49, .53))
    MAT["pillow_camel"] = textured("weave", "Camel throw cushion", r, normal=.5, tint=(.76, .58, .42))
    MAT["pillow_slate"] = textured("weave", "Slate blue throw cushion", r, normal=.5, tint=(.32, .42, .52))
    MAT["plaster"] = textured("plaster", "Architectural matte plaster", r, normal=.22)
    MAT["leather"] = textured("leather", "Espresso saddle leather", r, normal=.55)
    # Metals: champagne brass, dark architectural bronze, satin titanium
    MAT["brass"] = textured("brass", "Champagne brushed brass", r, metal=.94, normal=.18)
    MAT["bronze"] = textured("steel", "Dark architectural bronze", r, metal=.88, normal=.18, tint=(.24, .21, .19))
    MAT["steel"] = textured("steel", "Graphite brushed steel", r, metal=.92, normal=.18, tint=(.34, .35, .38))
    MAT["silver"] = textured("steel", "Satin titanium aluminium", r, metal=.92, normal=.16, tint=(.82, .83, .85))
    # Finishes & small fixtures
    MAT["white"] = _principled("Honed matte composite", (.86, .84, .80), .32)
    MAT["black"] = _principled("Anodized obsidian metal", (.018, .02, .024), .24, .55)
    MAT["bezel"] = _principled("Display bezel", (.006, .007, .009), .18, .35)
    MAT["mesh"] = textured("carpet", "Carbon knit mesh", r, normal=.95, tint=(.16, .17, .19))
    MAT["mesh"].use_backface_culling = False
    MAT["soil"] = _principled("Planter river pebbles", (.06, .05, .04), .85)
    MAT["water"] = _principled("Reflecting pool water", (.02, .08, .10), .03, .12, coat=1.0)
    MAT["ceramic"] = _principled("Glazed travertine ceramic", (.88, .85, .81), .20)
    MAT["keys"] = _principled("Keycaps", (.03, .032, .036), .45)
    MAT["artwall"] = textured("plaster", "Museum gallery wall", r, normal=.18, tint=(.97, .95, .92))
    MAT["framewood"] = textured("walnut", "Museum frame walnut", r, normal=.35, tint=(.55, .44, .34))
    MAT["artcanvas"] = _principled("Artwork canvas", (.5, .5, .5), .58)
    MAT["paper"] = _principled("Notebook cover", (.66, .62, .56), .78)
    MAT["phoneglow"] = _principled("Phone display", (.2, .48, .78), .25, 0, emit=1.6, emit_color=(.32, .65, 1.0))
    # Glass & luminous architectural emitters
    MAT["glass"] = _principled("Balustrade glass", (.72, .82, .86), .03, 0, alpha=.18)
    MAT["coreglass"] = _principled("Core crystal glass", (.55, .82, .96), .03, 0, alpha=.20)
    MAT["hologlass"] = _principled("Holographic data ring", (.25, .78, 1.0), .06, 0, emit=2.6, emit_color=(.28, .78, 1.0), alpha=.42)
    MAT["skylight"] = _principled("Daylight glazing", (.88, .93, 1.0), .18, 0, emit=2.2, emit_color=(.88, .94, 1.0))
    MAT["skywindow"] = emissive_image("Perimeter daylight window", r / "window_skyline.jpg", .95, base=(.55, .64, .76), rough=.06)
    MAT["cove"] = _principled("Warm 3000K cove", (1.0, .82, .56), .35, 0, emit=5.2, emit_color=(1.0, .80, .54))
    MAT["cove_soft"] = _principled("Soft warm accent", (1.0, .84, .60), .35, 0, emit=3.2, emit_color=(1.0, .82, .58))
    MAT["downlight"] = _principled("Architectural downlight", (1.0, .91, .76), .25, 0, emit=9.5, emit_color=(1.0, .90, .74))
    MAT["filament"] = _principled("Core cyan filament", (.58, .92, 1.0), .15, 0, emit=11.0, emit_color=(.48, .88, 1.0))
    MAT["filament_w"] = _principled("Core white filament", (.88, .97, 1.0), .15, 0, emit=14.0, emit_color=(.84, .96, 1.0))
    MAT["coreglow"] = _principled("Core energy rod", (.35, .78, 1.0), .15, 0, emit=3.8, emit_color=(.32, .76, 1.0))
    MAT["corewell"] = _principled("Core floor light well", (.55, .90, 1.0), .08, 0, emit=6.5, emit_color=(.45, .86, 1.0))
    MAT["cyanglow"] = _principled("Cyan accent LED", (.25, .82, 1.0), .25, 0, emit=4.8, emit_color=(.22, .80, 1.0))
    MAT["waterled"] = _principled("Pool underwater LED", (.32, .85, .95), .25, 0, emit=4.2, emit_color=(.30, .84, .96))
    MAT["datarain"] = emissive_image("Column data strip", out / "datarain.png", 3.4)


def data_rain(path):
    """High-density sapphire/cyan/ice-white holographic data stream texture for column recesses."""
    w, h = 128, 1024
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[:] = (.004, .012, .026)
    for col in range(4, w - 4, 10):
        y = 0
        while y < h:
            run = rng.randint(2, 9)
            if rng.random() < .66:
                c = rng.choice([(.22, .78, 1.0), (.12, .48, 1.0), (.68, .96, 1.0), (.15, .92, .82), (.92, .96, 1.0)])
                k = rng.uniform(.35, 1.0)
                for j in range(run):
                    yy = y + j * 5
                    if yy + 3 < h:
                        img[yy:yy + 3, col:col + 7] = [v * k * (1 - j * .06) for v in c]
            y += run * 5 + rng.randint(3, 20)
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
        me.set_sharp_from_angle(angle=radians(36))
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
    r = rot(screen["yaw"], screen.get("tilt", 0))
    c = P(screen["x"], screen["y"], screen["z"]) + r.to_3x3() @ Vector((du, -dn, dv))
    a, b, cc = w / 2, d / 2, h / 2
    verts = [(sx * a, -sz * b, sy * cc) for sy in (-1, 1) for sz in (-1, 1) for sx in (-1, 1)]
    faces = [(2, 3, 1, 0), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    return emit_object("screen part", verts, faces, mat, group, Matrix.Translation(c) @ r, .6, bevel)


def lathe(name, x, y, z, profile, mat, group="fixtures", sides=48, tile=1.0, smooth=True, caps=True, cyl=False):
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


def sector(name, r0, r1, y0, y1, a0, a1, mat, group="fixtures", *, step=.6, tile=1.0, faces_on="all", segs=None, smooth=False):
    full = abs((a1 - a0) - 360) < 1e-6
    n = segs or max(4, int(radians(a1 - a0) * r1 / step))
    verts, faces, uv = [], [], {}
    cols = n + 1
    r_ref, dr, dy = (r0 + r1) / 2, r1 - r0, y1 - y0
    around = (0, dr, dr + dy, 2 * dr + dy)
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
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, uv=uv, smooth=smooth)


def arc_surface(name, r, y0, y1, a0, a1, mat, group, inward=True, step=.5, uv_fit=False):
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


def sweep_profile(name, pts, profile_2d, mat, group="shell", tile=1.8, smooth=True):
    """Sweep a custom closed 2D profile [(u, v), ...] along a 3D polyline (for sculpted I-beam/coffered arches)."""
    vs = [P(*p) for p in pts]
    n = len(vs)
    m = len(profile_2d)
    verts, faces, uv = [], [], {}
    along = [0.0]
    for i in range(1, n):
        along.append(along[-1] + (vs[i] - vs[i - 1]).length)
    perim = [0.0]
    for k in range(1, m):
        perim.append(perim[-1] + hypot(profile_2d[k][0] - profile_2d[k - 1][0], profile_2d[k][1] - profile_2d[k - 1][1]))
    for i in range(n):
        t = (vs[min(i + 1, n - 1)] - vs[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = t.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(t).normalized()
        for k, (pu, pv) in enumerate(profile_2d):
            uv[len(verts)] = (along[i] / tile, perim[k] / tile)
            verts.append(tuple(vs[i] + side * pu + up * pv))
    for i in range(n - 1):
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, (i + 1) * m + k2, (i + 1) * m + k))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, smooth=smooth, uv=uv)


def slat_wall(name, r, y0, y1, a0, a1, mat, group="shell", width=.065, depth=.055, pitch=.14, tile=1.6):
    """Vertical architectural acoustic slats on an arc."""
    verts, faces, uv = [], [], {}
    n = max(1, int(radians(a1 - a0) * r / pitch))
    for i in range(n):
        t = a0 + (a1 - a0) * (i + .5) / n
        sx, sz = sin(radians(t)), cos(radians(t))
        tx, tz = cos(radians(t)), -sin(radians(t))
        base = len(verts)
        off = rng.uniform(0, 3)
        for k, (u_, d_) in enumerate(((-1, 0), (1, 0), (1, 1), (-1, 1))):
            for y in (y0, y1):
                x = (r - d_ * depth) * sx + u_ * width / 2 * tx
                z = (r - d_ * depth) * sz + u_ * width / 2 * tz
                uv[len(verts)] = ((y + off) / tile, (i * pitch + (u_ + 1) / 2 * width + d_ * depth) / tile)
                verts.append(tuple(P(x, y, z)))
        q = lambda k, top: base + 2 * k + top
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((q(k, 0), q(k2, 0), q(k2, 1), q(k, 1)))
    return emit_object(name, verts, faces, mat, group, Matrix.Identity(4), tile, uv=uv)


# ---------------------------------------------------------------- architecture
def build_floor():
    # Grand Calacatta marble plaza disc
    disc_profile = [(0, 0), (R_WALL + .2, 0), (R_WALL + .2, -.3), (0, -.3)]
    lathe("Ground marble", 0, 0, 0, disc_profile, "stone", "shell", sides=128, tile=2.2, smooth=False)
    aisles, aw = LAYOUT["aisles"], LAYOUT["aisleWidth"]
    # Charcoal acoustic carpet fields under the curved trading desk zones + bronze edge binder
    for i, a in enumerate(aisles):
        b = aisles[(i + 1) % len(aisles)] + (360 if i == len(aisles) - 1 else 0)
        pad = degrees(aw / 2 / 17.0) + .4
        a0, a1 = a + pad + .9, b - pad - .9
        sector("Carpet field", 6.92, 16.98, 0, .012, a0, a1, "carpet", "shell", tile=1.1, faces_on=("top", "inner", "outer"))
        # Crisp champagne-brass trim edging the carpet borders
        sector("Carpet brass inner", 6.88, 6.92, 0, .013, a0, a1, "brass", "fixtures", faces_on=("top",))
        sector("Carpet brass outer", 16.98, 17.02, 0, .013, a0, a1, "brass", "fixtures", faces_on=("top",))
    # Concentric Emperador dark marble architectural border bands & champagne-brass inlays
    for r0, r1 in ((3.22, 3.62), (5.58, 5.82), (6.68, 6.84), (17.06, 17.24), (21.45, 21.75)):
        sector("Dark marble ring", r0, r1, 0, .003, 0, 360, "darkmarble", "shell", tile=1.8, faces_on=("top",))
    for r in (3.20, 3.64, 4.15, 5.56, 5.84, 6.66, 6.86, 17.04, 17.26, 21.43, 21.77, 24.40):
        sector("Floor brass inlay", r - .018, r + .018, 0, .0045, 0, 360, "brass", "fixtures", faces_on=("top",), step=.5)
    # Radial champagne-brass & dark-marble aisle runner lines leading straight to the luminous core!
    for a in aisles:
        for side in (-1, 1):
            ang = a + side * degrees(1.12 / 12.0)
            p0, p1 = pol(5.85, ang), pol(21.42, ang)
            sweep("Aisle brass line", [(p0[0], .004, p0[1]), (p1[0], .004, p1[1])], .032, .003, "brass", "fixtures")
        # Subtle central Emperador stone medallion strips along the 6 radial avenues
        for r_mid in (7.8, 11.4, 15.2, 19.2):
            x, z = pol(r_mid, a)
            box("Aisle medallion", x, .002, z, .36, .003, .36, "darkmarble", "shell", yaw=a + 45)
            box("Aisle medallion brass", x, .0035, z, .42, .002, .42, "brass", "fixtures", yaw=a + 45)


def rail_runs(level):
    cuts = sorted((o["a0"], o["a1"]) for o in LAYOUT["openings"] if o["level"] == level)
    runs, start = [], 0.0
    for a0, a1 in cuts:
        if a0 > start:
            runs.append((start, a0))
        start = max(start, a1)
    if start < 360:
        runs.append((start, 360.0))
    return runs


def build_galleries():
    for li, y in enumerate(LEVELS):
        # Honed Calacatta marble gallery deck + perimeter brass inlay
        sector("Gallery slab", R_GAL + .2, R_WALL, y - .42, y, 0, 360, "stone", "shell", tile=2.0, faces_on=("top",))
        sector("Gallery brass inlay", R_GAL + .55, R_GAL + .59, y, y + .004, 0, 360, "brass", "fixtures", faces_on=("top",))
        sector("Gallery dark border", R_GAL + .22, R_GAL + .54, y, y + .003, 0, 360, "darkmarble", "shell", tile=1.6, faces_on=("top",))
        sector("Gallery soffit", R_GAL + .2, R_WALL, y - .44, y - .42, 0, 360, "plaster", "shell", faces_on=("bottom",), tile=2)

        # Sculpted 3-tier stepped travertine gallery fascia with champagne-brass trim & continuous cove channel
        sector("Fascia upper bullnose", R_GAL - .09, R_GAL + .22, y - .12, y + .03, 0, 360, "trav", "shell", tile=1.2)
        sector("Fascia top brass", R_GAL - .105, R_GAL - .085, y - .04, y + .02, 0, 360, "brass", "fixtures", step=.5)
        sector("Fascia main band", R_GAL - .06, R_GAL + .22, y - .88, y - .12, 0, 360, "trav", "shell", tile=1.2)
        sector("Fascia lower bronze trim", R_GAL - .075, R_GAL + .12, y - .94, y - .88, 0, 360, "bronze", "fixtures", step=.5)
        sector("Fascia cove lip", R_GAL - .04, R_GAL + .26, y - 1.02, y - .94, 0, 360, "trav", "shell", tile=1.2)
        # Continuous 3000K recessed warm cove ribbon under every gallery ring
        sector("Fascia cove LED", R_GAL + .02, R_GAL + .18, y - 1.03, y - 1.01, 0, 360, "cove", "emit", faces_on=("bottom",))
        # Subtle upward warm wash along the lower fascia reveal
        sector("Fascia accent line", R_GAL - .08, R_GAL - .065, y - .96, y - .94, 0, 360, "cove_soft", "emit", faces_on=("inner",))

        # Concentric acoustic oak ceiling slats under each gallery + recessed bronze downlight cans
        for k in range(15):
            r = R_GAL + .50 + k * .28
            if r > R_WALL - .22:
                break
            sector("Gallery slat", r, r + .09, y - .51, y - .44, 0, 360, "oak", "shell", step=.9, faces_on=("bottom", "inner", "outer"), tile=1.5)
        for t in np.arange(3.75, 360, 7.5):
            x, z = pol(23.5, t)
            lathe("Downlight bezel", x, y - .52, z, [(.095, 0), (.095, .02), (.072, .02), (.072, 0)], "bronze", "fixtures", sides=14, caps=False)
            lathe("Downlight lens", x, y - .515, z, [(.07, 0), (.07, .005), (0, .005)], "downlight", "emit", sides=14)

        # Luxury glass balustrade: bronze shoe channel, clear glass, brass clamp posts, sculpted oak rail + LED
        for a0, a1 in rail_runs(li + 1):
            sector("Balustrade shoe", R_GAL + .06, R_GAL + .15, y + .01, y + .09, a0, a1, "bronze", "fixtures", step=.6)
            sector("Balustrade shoe brass", R_GAL + .055, R_GAL + .065, y + .06, y + .085, a0, a1, "brass", "fixtures", step=.6)
            arc_surface("Balustrade", R_GAL + .105, y + .09, y + 1.07, a0, a1, "glass", "emit", inward=True, step=1.0)
            sector("Handrail oak", R_GAL + .04, R_GAL + .17, y + 1.06, y + 1.13, a0, a1, "oak", "fixtures", step=.6)
            sector("Handrail brass groove", R_GAL + .08, R_GAL + .13, y + 1.048, y + 1.062, a0, a1, "brass", "fixtures", step=.6, faces_on=("bottom",))
            step_t = 5.0 if a1 - a0 > 12 else max(1.0, (a1 - a0) / 2)
            for t in np.arange(a0, a1 + .01, step_t):
                x, z = pol(R_GAL + .105, t)
                box("Rail post", x, y + .57, z, .028, 1.00, .042, "bronze", "fixtures", yaw=t)
                box("Rail clamp", x, y + .24, z, .046, .06, .052, "brass", "fixtures", yaw=t)
                box("Rail clamp top", x, y + .92, z, .046, .06, .052, "brass", "fixtures", yaw=t)

        top = (LEVELS[li + 1] - .45) if li + 1 < len(LEVELS) else H - .5
        build_perimeter(y, top, li + 1)

    build_perimeter(0.0, LEVELS[0] - .45, 0)
    # Outer structural drum behind all bays
    arc_surface("Outer wall", R_WALL, 0, H, 0, 360, "plaster", "shell", inward=True, step=1.0)


ART_HALF = 4.1   # degrees: museum gallery alcove half-width (~3.7m)


def build_art_bay(w, y0, y1):
    """Museum-grade recessed gallery alcove: crisp warm plaster niche, walnut pilasters, hairline brass trim,
    double-stepped walnut+brass museum frame, brushed brass picture lamp, and dark marble skirting."""
    t = w["t"]
    # Recessed gallery niche plaster wall
    sector("Art wall", R_OFF - .02, R_WALL - .04, y0, y1, t - ART_HALF, t + ART_HALF, "artwall", "shell", step=.4)
    # Dark marble baseboard & brass top reveal
    sector("Art skirting", R_OFF - .04, R_OFF - .015, y0, y0 + .14, t - ART_HALF, t + ART_HALF, "darkmarble", "fixtures", step=.4)
    sector("Art skirting brass", R_OFF - .045, R_OFF - .015, y0 + .14, y0 + .155, t - ART_HALF, t + ART_HALF, "brass", "fixtures", step=.4)
    # Flanking walnut pilasters & brass hairline vertical reveal frames
    for side in (-1, 1):
        a_edge = t + side * ART_HALF
        a_lo, a_hi = sorted((a_edge, a_edge - side * .55))
        sector("Art pilaster", R_OFF - .08, R_OFF + .02, y0, y1, a_lo, a_hi, "walnutv", "fixtures", segs=2)
        b_lo, b_hi = sorted((a_edge - side * .55, a_edge - side * .62))
        sector("Art brass reveal", R_OFF - .065, R_OFF - .015, y0 + .14, y1 - .08, b_lo, b_hi, "brass", "fixtures", segs=1)
    # Upper gallery niche warm wash cove
    sector("Art niche header", R_OFF - .08, R_OFF + .02, y1 - .14, y1, t - ART_HALF, t + ART_HALF, "walnut", "fixtures", step=.4)
    sector("Art niche cove", R_OFF - .06, R_OFF - .02, y1 - .15, y1 - .14, t - ART_HALF + .6, t + ART_HALF - .6, "cove_soft", "emit", faces_on=("bottom",))

    # Double-stepped museum painting frame (outer walnut moulding + inner champagne brass fillet)
    x, z = pol(R_OFF - .05, t)
    yaw = t + 180
    tx, tz = cos(radians(t)), -sin(radians(t))
    fw, fh = w["w"] + .14, w["h"] + .14
    for du, dv, bw, bh in ((0, fh / 2 - .03, fw, .06), (0, -fh / 2 + .03, fw, .06),
                           (fw / 2 - .03, 0, .06, fh), (-fw / 2 + .03, 0, .06, fh)):
        box("Art frame outer", x + tx * du, w["cy"] + dv, z + tz * du, bw, bh, .06, "framewood", "fixtures", yaw=yaw)
    # Inner champagne-gold museum fillet
    ix, iz = pol(R_OFF - .072, t)
    iw, ih = w["w"] + .036, w["h"] + .036
    for du, dv, bw, bh in ((0, ih / 2 - .009, iw, .018), (0, -ih / 2 + .009, iw, .018),
                           (iw / 2 - .009, 0, .018, ih), (-iw / 2 + .009, 0, .018, ih)):
        box("Art frame brass", ix + tx * du, w["cy"] + dv, iz + tz * du, bw, bh, .022, "brass", "fixtures", yaw=yaw)
    box("Art backing", x, w["cy"], z, fw - .06, fh - .06, .02, "black", "fixtures", yaw=yaw)

    # Artwork canvas node (exact naming preserved for ArtViewer & lazy 1K texture loader!)
    cx, cz = pol(R_OFF - .09, t)
    a, b = w["w"] / 2, w["h"] / 2
    emit_object(f"Artwork:{w['id']}", [(-a, 0, -b), (a, 0, -b), (a, 0, b), (-a, 0, b)], [(0, 1, 2, 3)], "artcanvas", "props",
                Matrix.Translation(P(cx, w["cy"], cz)) @ rot(yaw), uv={0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}, recalc=False)

    # Brushed champagne-brass gallery picture light
    lx, lz = pol(R_OFF - .30, t)
    lamp_w = min(1.05, w["w"] * .62)
    box("Picture light", lx, w["cy"] + w["h"] / 2 + .22, lz, lamp_w, .036, .06, "brass", "fixtures", yaw=yaw)
    box("Picture light lens", lx, w["cy"] + w["h"] / 2 + .20, lz, lamp_w - .04, .006, .042, "downlight", "emit", yaw=yaw)
    for side in (-1, 1):
        ax, az = pol(R_OFF - .17, t + side * degrees((lamp_w * .32) / R_OFF))
        box("Picture light arm", ax, w["cy"] + w["h"] / 2 + .22, az, .018, .018, .24, "brass", "fixtures", yaw=t)


def build_diamond_feature_wall(t_center, span_deg, y0, y1):
    """Signature concept-board feature wall: deep American walnut panels inlaid with geometric
    champagne-brass diamond & chevron lines, framed by architectural bronze reveals and warm cove wash."""
    a0, a1 = t_center - span_deg / 2, t_center + span_deg / 2
    r_face = R_WALL - .12
    # Deep walnut backing wall
    sector("Feature walnut wall", r_face, R_WALL - .02, y0, y1, a0, a1, "walnutv", "shell", step=.4, tile=1.8)
    # Dark marble plinth & champagne brass top/bottom borders
    sector("Feature plinth", r_face - .03, r_face, y0, y0 + .16, a0, a1, "darkmarble", "fixtures", step=.4)
    sector("Feature brass base", r_face - .035, r_face, y0 + .16, y0 + .18, a0, a1, "brass", "fixtures", step=.4)
    sector("Feature brass head", r_face - .035, r_face, y1 - .14, y1 - .12, a0, a1, "brass", "fixtures", step=.4)
    # Geometric diamond-chevron brass inlay lattice (directly inspired by the concept board!)
    y_lo, y_hi = y0 + .22, y1 - .18
    y_mid = (y_lo + y_hi) / 2
    r_bar = r_face - .016
    # Outer diamond & intersecting chevron diagonals
    pts_sets = [
        [(a0 + .8, y_mid), (t_center, y_hi), (a1 - .8, y_mid), (t_center, y_lo), (a0 + .8, y_mid)],
        [(a0 + .8, y_lo), (t_center - span_deg * .16, y_mid), (a0 + .8, y_hi)],
        [(a1 - .8, y_lo), (t_center + span_deg * .16, y_mid), (a1 - .8, y_hi)],
        [(t_center - span_deg * .25, y_lo), (t_center + span_deg * .25, y_hi)],
        [(t_center + span_deg * .25, y_lo), (t_center - span_deg * .25, y_hi)],
    ]
    for poly in pts_sets:
        world_pts = []
        for idx in range(len(poly) - 1):
            (ta, ya), (tb, yb) = poly[idx], poly[idx + 1]
            for k in range(5):
                u = k / 4
                px, pz = pol(r_bar, ta + (tb - ta) * u)
                world_pts.append((px, ya + (yb - ya) * u, pz))
            sweep("Feature brass inlay", world_pts, .028, .024, "brass", "fixtures")
            world_pts = []
    # Vertical flanking warm architectural glow strips
    for edge in (a0 + .2, a1 - .2):
        ex, ez = pol(r_face - .025, edge)
        box("Feature side glow", ex, (y0 + y1) / 2, ez, .025, y1 - y0 - .4, .025, "cove_soft", "emit", yaw=edge)


def build_daylight_window_bay(a0, a1, y0, y1):
    """Floor-to-ceiling mullioned architectural daylight window bay looking out to soft sunlit sky."""
    if a1 - a0 < 2.5:
        return
    r_glass = R_WALL - .06
    r_mull = R_WALL - .14
    # Luminous skyline daylight glazing
    arc_surface("Daylight window", r_glass, y0 + .18, y1 - .16, a0 + .2, a1 - .2, "skywindow", "emit", inward=True, step=.5, uv_fit=True)
    # Deep architectural travertine sill & header reveals
    sector("Window sill", r_mull - .04, R_WALL - .02, y0, y0 + .20, a0, a1, "darkmarble", "fixtures", step=.5)
    sector("Window sill brass", r_mull - .045, r_mull - .01, y0 + .19, y0 + .21, a0, a1, "brass", "fixtures", step=.5)
    sector("Window header", r_mull - .04, R_WALL - .02, y1 - .18, y1, a0, a1, "bronze", "fixtures", step=.5)
    # Intermediate horizontal transom bar at 68% height
    y_trans = y0 + (y1 - y0) * .68
    sector("Window transom", r_mull, r_glass, y_trans - .035, y_trans + .035, a0, a1, "bronze", "fixtures", step=.5)
    # Slender vertical dark-bronze curtain-wall mullions
    arc_m = radians(a1 - a0) * r_mull
    n_panes = max(2, int(round(arc_m / 1.55)))
    for k in range(n_panes + 1):
        t = a0 + (a1 - a0) * k / n_panes
        mx, mz = pol((r_mull + r_glass) / 2, t)
        box("Window mullion", mx, (y0 + y1) / 2, mz, .065, y1 - y0 - .22, .12, "bronze", "fixtures", yaw=t)


def build_perimeter(y0, y1, level):
    """Rhythmic luxury perimeter composition:
    - Museum-grade recessed art alcoves (all 31 paintings preserved at exact layout coordinates)
    - Diamond champagne-gold inlaid walnut feature walls behind curved promenade sofas (0/120/240 deg)
    - Grand illuminated entrance portal at 0 deg on Ground floor
    - Floor-to-ceiling mullioned daylight skyline windows in open structural bays (massive spatial depth!)
    - Refined vertical walnut/oak acoustic slats flanking columns & bays
    """
    # Collect occupied angular intervals so nothing overlaps!
    art_list = [w for w in LAYOUT.get("artWalls", []) if w["level"] == level]
    occupied = []

    # 1. Museum Art Alcoves
    for w in art_list:
        build_art_bay(w, y0, y1)
        occupied.append((w["t"] - ART_HALF - .2, w["t"] + ART_HALF + .2))

    # 2. Diamond Champagne-Gold Feature Walls (behind curved sofas at 120, 240, and 0 on upper levels)
    feature_angles = (120.0, 240.0) if level == 0 else (0.0, 120.0, 240.0)
    for ft in feature_angles:
        build_diamond_feature_wall(ft, 13.0, y0, y1)
        occupied.append((ft - 6.7, ft + 6.7))

    # 3. Ground floor Grand Entrance Portal at 0 deg
    if level == 0:
        build_daylight_window_bay(-9.0, 9.0, y0, y1)
        # Grand bronze & champagne-brass entry portal framing
        for side in (-1, 1):
            px, pz = pol(R_WALL - .22, side * 9.2)
            box("Portal pier", px, (y0 + y1) / 2, pz, .42, y1 - y0, .38, "trav", "shell", yaw=side * 9.2)
            bx, bz = pol(R_WALL - .40, side * 9.2)
            box("Portal brass strip", bx, (y0 + y1) / 2, bz, .06, y1 - y0 - .2, .06, "brass", "fixtures", yaw=side * 9.2)
        occupied.append((-9.6, 9.6))

    # 4. Fill remaining perimeter spans with alternating Floor-to-Ceiling Daylight Windows & Fluted Walnut Slats
    # Normalize intervals into [0, 360]
    norm_occ = []
    for a0, a1 in occupied:
        if a0 < 0:
            norm_occ.append((0.0, a1))
            norm_occ.append((a0 + 360.0, 360.0))
        elif a1 > 360:
            norm_occ.append((a0, 360.0))
            norm_occ.append((0.0, a1 - 360.0))
        else:
            norm_occ.append((a0, a1))
    norm_occ.sort()
    merged_occ = []
    for a0, a1 in norm_occ:
        if merged_occ and a0 <= merged_occ[-1][1]:
            merged_occ[-1] = (merged_occ[-1][0], max(merged_occ[-1][1], a1))
        else:
            merged_occ.append((a0, a1))

    gaps = []
    cur = 0.0
    for a0, a1 in merged_occ:
        if a0 > cur + .2:
            gaps.append((cur, a0))
        cur = max(cur, a1)
    if cur < 359.8:
        gaps.append((cur, 360.0))

    for g0, g1 in gaps:
        span = g1 - g0
        if span >= 8.5:
            # Slat flanks + large floor-to-ceiling daylight window in the center!
            flank = min(3.2, span * .22)
            slat_wall("Flank walnut slats", R_WALL - .04, y0 + .12, y1 - .14, g0, g0 + flank, "walnut", width=.06, depth=.055, pitch=.14)
            sector("Flank shadow", R_WALL - .03, R_WALL, y0, y1, g0, g0 + flank, "darkoak", "shell", faces_on=("inner",), step=.8)
            build_daylight_window_bay(g0 + flank, g1 - flank, y0, y1)
            slat_wall("Flank walnut slats", R_WALL - .04, y0 + .12, y1 - .14, g1 - flank, g1, "walnut", width=.06, depth=.055, pitch=.14)
            sector("Flank shadow", R_WALL - .03, R_WALL, y0, y1, g1 - flank, g1, "darkoak", "shell", faces_on=("inner",), step=.8)
        else:
            # Refined vertical oak & walnut acoustic slat bay
            slat_wall("Promenade slats", R_WALL - .04, y0 + .12, y1 - .14, g0, g1, "oak", width=.065, depth=.055, pitch=.145)
            sector("Slat shadow", R_WALL - .03, R_WALL, y0, y1, g0, g1, "darkoak", "shell", faces_on=("inner",), step=.8)

    # Continuous subtle upper wall-wash cove along the outer perimeter
    sector("Wall wash cove", R_WALL - .32, R_WALL - .26, y1 - .06, y1 - .04, 0, 360, "cove_soft", "emit", faces_on=("bottom",), step=1.2)


def build_columns():
    """12 Monumental Sculpted Tree Columns:
    - Stepped Emperador dark marble + travertine plinth with champagne-brass uplight reveal
    - Sculpted travertine architectural pier flanked by curved bronze reveal flutes & vertical brass pinstripes
    - Recessed front holographic ticker channel with bronze housing & cyan cap accents
    - Triple-layered double-profiled Gothic-modern branching arches & radial roof ribs with recessed LED coves!
    """
    for t in LAYOUT["columnAngles"]:
        x, z = pol(R_COL, t)
        # 3-stepped monumental base plinth
        lathe("Column plinth dark", x, 0, z, [(.80, 0), (.80, .14), (.74, .18), (0, .18)], "darkmarble", "shell", sides=36, tile=1.4)
        lathe("Column plinth brass", x, .18, z, [(.745, 0), (.745, .035), (.71, .035), (0, .035)], "brass", "fixtures", sides=36)
        lathe("Column plinth trav", x, .215, z, [(.71, 0), (.68, .28), (.61, .36), (0, .36)], "trav", "shell", sides=36, tile=1.2)
        # Sculpted main travertine pier (tall, noble, slightly tapered with flaring capital)
        lathe("Column shaft", x, .57, z, [(.57, 0), (.55, .8), (.54, 14.7), (.60, 15.25), (.69, 15.7), (.76, 15.95), (0, 15.95)],
              "trav", "shell", sides=40, tile=2.0, cyl=True)
        # Architectural bronze side ribs & champagne-brass vertical pinstripes running the full 15.5m height!
        for side in (-1, 1):
            tx, tz = cos(radians(t)), -sin(radians(t))
            # Sculpted side flange fin
            fx, fz = x + tx * side * .52, z + tz * side * .52
            box("Column bronze flute", fx, 8.2, fz, .10, 15.1, .28, "bronze", "fixtures", yaw=t)
            bx, bz = x + tx * side * .575, z + tz * side * .575
            box("Column brass stripe", bx, 8.2, bz, .024, 15.0, .06, "brass", "fixtures", yaw=t)
        # Stepped champagne-brass & bronze collar rings at each gallery slab intersection
        for yy in LEVELS:
            lathe("Column collar bronze", x, yy - .54, z, [(.62, 0), (.62, .10), (.58, .12), (0, .12)], "bronze", "fixtures", sides=32)
            lathe("Column collar brass", x, yy - .44, z, [(.63, 0), (.63, .03), (0, .03)], "brass", "fixtures", sides=32)
        # Recessed inner data-strip architectural frame (live vertical ticker tickerV sits cleanly on front!)
        ix, iz = pol(R_COL - .55, t)
        box("Column strip housing", ix, 8.6, iz, .48, 13.85, .06, "bronze", "fixtures", yaw=t)
        # Twin vertical champagne-brass edge trim beside the live ticker strip
        tx, tz = cos(radians(t)), -sin(radians(t))
        for side in (-1, 1):
            box("Column strip brass", ix + tx * side * .23, 8.6, iz + tz * side * .23, .022, 13.85, .072, "brass", "fixtures", yaw=t)
        # Subtle cyan glowing top & bottom end-caps on the column data channel
        for cy in (1.65, 15.55):
            box("Column strip cap", ix, cy, iz, .42, .05, .075, "cyanglow", "emit", yaw=t)

    # Sculpted branching arches & triple-profiled radial vault ribs
    cols = LAYOUT["columnAngles"]
    # I-beam / coffered travertine arch profile (u: width, v: vertical height)
    arch_profile = [
        (-.28, -.32), (.28, -.32), (.28, -.20), (.20, -.16), (.20, .18),
        (.32, .24), (.32, .36), (-.32, .36), (-.32, .24), (-.20, .18), (-.20, -.16), (-.28, -.20)
    ]
    rib_profile = [
        (-.24, -.36), (.24, -.36), (.24, -.24), (.17, -.18), (.17, .20),
        (.28, .28), (.28, .40), (-.28, .40), (-.28, .28), (-.17, .20), (-.17, -.18), (-.24, -.24)
    ]

    for i, t in enumerate(cols):
        t2 = cols[(i + 1) % len(cols)] + (360 if i == len(cols) - 1 else 0)
        # Pointed vaulted arch bridging neighboring columns
        pts = []
        for k in range(25):
            u = k / 24
            a = t + (t2 - t) * u
            y = 16.35 + 3.05 * (sin(pi * u) ** .72)
            r = R_COL - .38 * sin(pi * u)
            x, z = pol(r, a)
            pts.append((x, y, z))
        sweep_profile("Gallery arch vault", pts, arch_profile, "trav", "shell", tile=2.2)
        # Warm recessed LED cove strip following the underside of each vaulted arch!
        arch_cove = [(px, py - .33, pz) for px, py, pz in pts[1:-1]]
        sweep("Arch cove LED", arch_cove, .065, .02, "cove", "emit")
        # Crisp brass edge accent along the lower arch lip
        arch_brass = [(px, py - .305, pz) for px, py, pz in pts[1:-1]]
        sweep("Arch brass trim", arch_brass, .14, .016, "brass", "fixtures")

        # Main sweeping radial vault rib from column capital to the 3-tier oculus
        rib = []
        for k in range(29):
            u = k / 28
            r = R_COL - (R_COL - 5.95) * u
            y = 16.35 + 3.45 * (1 - (1 - min(1, u * 2.9)) ** 2.2) - .22 * u
            x, z = pol(r, t)
            rib.append((x, y, z))
        sweep_profile("Roof main rib", rib, rib_profile, "trav", "shell", tile=2.2)
        # Continuous warm 3000K recessed LED channel along the rib belly + bronze reveal
        rib_bronze = [(px, py - .37, pz) for px, py, pz in rib[1:]]
        sweep("Rib bronze channel", rib_bronze, .14, .022, "bronze", "fixtures")
        rib_cove = [(px, py - .385, pz) for px, py, pz in rib[1:]]
        sweep("Rib cove LED", rib_cove, .07, .016, "cove", "emit")

        # Secondary sculptural oak + bronze rib halfway between columns (forming grand coffered skylight bays)
        mid = t + 15
        sec = []
        for k in range(23):
            u = k / 22
            r = 19.6 - (19.6 - 6.0) * u
            x, z = pol(r, mid)
            sec.append((x, 19.48 - .06 * u, z))
        sweep("Roof sub-rib trav", sec, .26, .32, "trav", "shell", tile=2.2)
        sec_cove = [(px, py - .175, pz) for px, py, pz in sec]
        sweep("Roof sub-rib brass", sec_cove, .08, .018, "brass", "fixtures")


def build_roof():
    """Cathedral-Grade Coffered Skylight & 3-Tier Sculpted Luminous Oculus Crown."""
    # Perimeter structural ring beam & warm oak acoustic coffered ceiling over top gallery
    sector("Ring beam", R_COL - .75, R_WALL, 19.15, 19.85, 0, 360, "trav", "shell", tile=1.4)
    sector("Ring beam brass", R_COL - .77, R_COL - .72, 19.16, 19.24, 0, 360, "brass", "fixtures", step=.6)
    sector("Ring beam cove", R_COL - .70, R_COL - .55, 19.12, 19.15, 0, 360, "cove", "emit", faces_on=("bottom",))

    # 3-Tier Sculpted Floating Oculus Halo Dome (Concept #1 & #3 hero centerpiece!)
    # Tier 1 (Outer sculptural ring, r=5.4..6.65)
    lathe("Oculus outer crown", 0, 19.05, 0, [
        (5.45, 0.0), (6.55, 0.0), (6.70, 0.14), (6.70, 0.85), (5.30, 0.85), (5.30, 0.12)
    ], "trav", "shell", sides=96, tile=1.5, caps=False)
    sector("Oculus outer brass", 5.38, 5.46, 19.04, 19.08, 0, 360, "brass", "fixtures", step=.4)
    sector("Oculus outer cove", 5.20, 5.42, 19.16, 19.20, 0, 360, "cove", "emit", faces_on=("bottom",), step=.4)

    # Tier 2 (Suspended floating inner halo ring, r=4.35..5.10, dropped gracefully below)
    lathe("Oculus inner halo", 0, 18.65, 0, [
        (4.35, 0.0), (5.05, 0.0), (5.14, 0.10), (5.14, 0.42), (4.26, 0.42), (4.26, 0.10)
    ], "trav", "shell", sides=96, tile=1.4, caps=False)
    sector("Oculus halo brass", 4.30, 4.38, 18.64, 18.68, 0, 360, "brass", "fixtures", step=.4)
    sector("Oculus halo cove", 4.40, 4.98, 18.62, 18.65, 0, 360, "cove", "emit", faces_on=("bottom",), step=.4)
    sector("Oculus halo uplight", 4.38, 5.02, 19.07, 19.10, 0, 360, "cove_soft", "emit", faces_on=("top",), step=.4)

    # Inner dark-bronze louvered core drum inside oculus
    lathe("Oculus core drum", 0, 19.10, 0, [(3.65, 0.0), (3.65, 0.90), (2.20, 0.90), (2.20, 0.0)],
          "bronze", "fixtures", sides=72, caps=False)
    sector("Oculus inner cyan halo", 2.05, 2.22, 19.08, 19.12, 0, 360, "cyanglow", "emit", faces_on=("bottom",), step=.4)

    # Deeply recessed skylight glazing & precision dark-bronze architectural mullion grid
    sector("Skylight glazing", 5.8, R_COL - .6, 20.08, 20.12, 0, 360, "skylight", "emit", faces_on=("bottom",), step=1.0)
    for r in np.arange(7.2, R_COL - .6, 1.55):
        sector("Skylight mullion", r - .045, r + .045, 19.78, 20.08, 0, 360, "bronze", "shell", step=1.0)
        sector("Skylight mullion cap", r - .025, r + .025, 19.76, 19.78, 0, 360, "brass", "fixtures", step=1.0)
    for t in np.arange(0, 360, 7.5):
        (x0, z0), (x1, z1) = pol(6.55, t), pol(R_COL - .65, t)
        sweep("Skylight radial", [(x0, 19.90, z0), (x1, 19.90, z1)], .065, .24, "bronze", "shell")

    # Roof cap closing light leak + concentric oak acoustic slats over 4F promenade
    sector("Roof slab", 0, R_WALL + .2, 20.25, 20.55, 0, 360, "plaster", "shell", faces_on=("bottom",), step=2.0)
    for k in range(18):
        r = R_COL - .4 + k * .25
        if r > R_WALL - .1:
            break
        sector("Roof slat", r, r + .095, 19.04, 19.12, 0, 360, "oak", "shell", step=.9, faces_on=("bottom", "inner", "outer"), tile=1.5)


def build_tower():
    """5-Tier Telescoping Holographic Light Core:
    - Stepped Emperador marble + travertine plinth with illuminated cyan glass floor well
    - 48 multi-radius crystal fiber-optic filaments + glass crystal drum with 12 delicate bronze fins
    - Dedicated `HoloCoreFX` translucent holographic glass collar at y=5.55m (animated in WebGPU shader!)
    - Precision champagne-brass trimmed ring housings anchored by visible cantilevered structural spokes
    - Iconic wide open suspended halo crown at y=15.3m with 12 brushed-titanium tension suspension rods!
    """
    tw = LAYOUT["tower"]
    # Sculpted circular plinth with recessed brass toe-kick & glowing cyan floor light-well
    lathe("Core plinth dark", 0, 0, 0, [(tw["plinth"] + .06, 0), (tw["plinth"] + .06, .12), (tw["plinth"], .16), (0, .16)],
          "darkmarble", "fixtures", sides=72)
    sector("Core plinth cove", tw["plinth"] + .02, tw["plinth"] + .065, .02, .05, 0, 360, "cove", "emit", faces_on=("outer",), step=.4)
    lathe("Core plinth trav", 0, .16, 0, [(tw["plinth"], 0), (tw["plinth"], .18), (tw["plinth"] - .08, .24), (0, .24)],
          "trav", "fixtures", sides=72)
    sector("Plinth brass collar", tw["plinth"] - .12, tw["plinth"] - .07, .39, .41, 0, 360, "brass", "fixtures", faces_on=("top",), step=.4)
    lathe("Core base drum", 0, .40, 0, [(1.92, 0), (1.92, .46), (1.76, .58), (0, .58)], "black", "fixtures", sides=64)
    sector("Core base brass", 1.76, 1.92, .57, .60, 0, 360, "brass", "fixtures", faces_on=("top", "outer"), step=.4)
    # Illuminated circular crystal light well where the cyan fiber-optic core emerges!
    lathe("Core light well", 0, .96, 0, [(1.62, 0), (1.62, .04), (0, .04)], "corewell", "emit", sides=64)

    # Crystal borosilicate glass core drum + 12 delicate bronze vertical structural fins
    arc_surface("Core glass", tw["core"] + .04, 1.0, H, 0, 360, "coreglass", "emit", inward=False, step=.3)
    for k in range(12):
        t = k * 30
        fx, fz = pol(tw["core"] + .06, t)
        box("Core glass fin", fx, H / 2 + .5, fz, .022, H - 1.0, .06, "bronze", "fixtures", yaw=t)
    # Horizontal precision stainless tension collars around the crystal core
    for hy in (1.5, 3.3, 5.2, 6.2, 10.1, 14.1, 17.5):
        sector("Core collar ring", tw["core"] + .03, tw["core"] + .09, hy, hy + .045, 0, 360, "brass", "fixtures", step=.35)

    # 48 Multi-radius layered luminous cyan & pure-white fiber-optic filaments:
    # kept in `bakeonly` so they illuminate the Cycles 4K lightmap & 2K HDR identically,
    # while the browser renders 48 live individually 360°-rotating neon rods via InstancedMesh!
    for k in range(48):
        t = k * 360 / 48 + rng.uniform(-2.5, 2.5)
        r = rng.uniform(.35, 1.38)
        x, z = pol(r, t)
        y0 = 1.0 + rng.uniform(0, 1.8)
        y1 = H - rng.uniform(0, 2.2)
        mat_fil = "filament_w" if k % 3 == 0 else "filament"
        w_fil = .024 if k % 3 == 0 else .034
        box("Core filament", x, (y0 + y1) / 2, z, w_fil, y1 - y0, w_fil, mat_fil, "bakeonly")
    # Soft luminous central sapphire energy column
    lathe("Core energy rod", 0, 1.0, 0, [(.38, 0), (.38, H - 1.0)], "coreglow", "emit", sides=28, caps=False)

    # Dedicated translucent holographic glass data ring (y=5.2..6.25, r=2.65) -> animated by WebGPU TSL shader!
    holo_outer = arc_surface("HoloCoreFX", 2.65, 5.20, 6.25, 0, 360, "hologlass", "holo", inward=False, step=.28, uv_fit=True)
    holo_inner = arc_surface("HoloCoreFX_inner", 2.20, 5.40, 6.05, 0, 360, "hologlass", "holo", inward=False, step=.28, uv_fit=True)
    for hy in (5.18, 6.25):
        sector("Holo brass rim", 2.58, 2.68, hy, hy + .035, 0, 360, "brass", "fixtures", step=.35)
        sector("Holo cyan edge", 2.66, 2.685, hy + .005, hy + .03, 0, 360, "cyanglow", "emit", faces_on=("outer",), step=.35)

    # Telescoping multi-tier screen ring housings with champagne-brass lips, warm/cyan edge halos & structural spokes
    for idx, ring in enumerate(tw["rings"]):
        y0, y1 = ring["y"] - ring["h"] / 2 - .10, ring["y"] + ring["h"] / 2 + .10
        r_in = ring["r"] - .52
        r_out = ring["r"] - .10
        lathe("Ring housing", 0, y0, 0, [(r_in, 0), (r_out, 0), (r_out, y1 - y0), (r_in, y1 - y0)],
              "black", "fixtures", sides=72, smooth=False)
        for yy in (y0 - .04, y1):
            sector("Ring bezel lip", r_out - .05, ring["r"] + .17, yy, yy + .04, 0, 360, "bronze", "fixtures", step=.35)
            sector("Ring brass trim", ring["r"] + .14, ring["r"] + .18, yy + .008, yy + .032, 0, 360, "brass", "fixtures", step=.35)
            led_mat = "cyanglow" if idx == 0 else "cove"
            sector("Ring halo LED", ring["r"] + .16, ring["r"] + .182, yy, yy + .012, 0, 360, led_mat, "emit", faces_on=("outer", "bottom"), step=.35)
        # 6 Radial cantilevered structural spoke arms anchoring the screen ring to the central core drum
        for sk in range(6):
            st = sk * 60 + 30
            sx, sz = pol((tw["core"] + r_in) / 2, st)
            box("Ring spoke arm", sx, ring["y"], sz, .08, .12, r_in - tw["core"] + .1, "bronze", "fixtures", yaw=st)

    # Top Wide Open Suspended Halo Crown (y=15.3, r=4.35) + Base Ticker Drum (y=2.55, r=2.45)
    cr, cy, ch = tw["crown"]["r"], tw["crown"]["y"], tw["crown"]["h"]
    # Open architectural crown ring (hollow interior so you look right through up to the glowing oculus!)
    lathe("Crown open ring", 0, cy - ch / 2 - .09, 0,
          [(cr - .38, 0), (cr - .05, 0), (cr - .05, ch + .18), (cr - .38, ch + .18)],
          "bronze", "fixtures", sides=84, smooth=False)
    for yy in (cy - ch / 2 - .12, cy + ch / 2 + .09):
        sector("Crown brass lip", cr - .42, cr + .04, yy, yy + .04, 0, 360, "brass", "fixtures", step=.35)
        sector("Crown LED ring", cr - .43, cr - .38, yy, yy + .03, 0, 360, "cove", "emit", faces_on=("inner", "bottom"), step=.35)
    # Base ticker drum
    br, by, bh = 2.45, 2.55, .62
    lathe("Base ticker drum", 0, by - bh / 2 - .07, 0,
          [(br - .38, 0), (br - .05, 0), (br - .05, bh + .14), (br - .38, bh + .14)],
          "bronze", "fixtures", sides=72, smooth=False)
    for yy in (by - bh / 2 - .09, by + bh / 2 + .07):
        sector("Base ticker brass", br - .06, br + .03, yy, yy + .025, 0, 360, "brass", "fixtures", step=.35)
        sector("Base ticker cyan", br + .01, br + .035, yy, yy + .02, 0, 360, "cyanglow", "emit", faces_on=("outer",), step=.35)

    # 12 Brushed-titanium tension suspension rods from oculus down through the crown and rings
    for k in range(12):
        t = k * 30 + 15
        x, z = pol(4.15, t)
        box("Crown hanger", x, 17.2, z, .022, 3.8, .022, "silver", "fixtures")
    for k in range(6):
        t = k * 60 + 30
        x, z = pol(3.35, t)
        box("Core hanger", x, 11.4, z, .026, 15.2, .026, "silver", "fixtures")


def build_counter():
    """Central Command Rotunda: fluted American walnut body, Calacatta marble top, champagne-brass
    footrail on brackets, and continuous warm under-counter & toe-kick indirect glow."""
    rc = LAYOUT["radii"]["counter"]
    aisles, aw = LAYOUT["aisles"], LAYOUT["aisleWidth"]
    for i, a in enumerate(aisles):
        b = aisles[(i + 1) % len(aisles)] + (360 if i == len(aisles) - 1 else 0)
        pad = degrees(aw / 2 / rc)
        a0, a1 = a + pad, b - pad
        sector("Counter body", rc - .48, rc - .03, .08, 1.01, a0, a1, "walnut", "fixtures", tile=1.2)
        # Fluted vertical walnut ribs on outer face of command counter
        slat_wall("Counter flutes", rc + .01, .12, .98, a0 + .4, a1 - .4, "walnut", "fixtures", width=.042, depth=.035, pitch=.09, tile=1.2)
        # Honed Calacatta marble counter top overhang + non-coplanar brass edge trim
        sector("Counter marble top", rc - .58, rc + .08, 1.01, 1.07, a0 - .3, a1 + .3, "stone", "fixtures", tile=1.2)
        sector("Counter brass lip", rc + .081, rc + .094, 1.012, 1.036, a0 - .22, a1 + .22, "brass", "fixtures")
        # Warm under-counter floating glow & toe-kick illumination (cleanly offset below 1.01)
        sector("Counter under glow", rc - .02, rc + .04, .988, 1.005, a0, a1, "cove", "emit", faces_on=("bottom",))
        sector("Counter kick plinth", rc - .45, rc - .06, 0, .078, a0, a1, "darkmarble", "fixtures")
        sector("Counter kick LED", rc - .055, rc - .015, .02, .068, a0 + .15, a1 - .15, "cove", "emit", faces_on=("outer",))
        # Circular champagne-brass footrail
        sector("Counter footrail", rc + .12, rc + .155, .17, .205, a0 + .6, a1 - .6, "brass", "fixtures", step=.35)


# ---------------------------------------------------------------- vertical circulation
def helix(r, a_from, a_to, y_from, y_to, dy=0.0, n=40):
    out = []
    for k in range(n + 1):
        u = k / n
        x, z = pol(r, a_from + (a_to - a_from) * u)
        out.append((x, y_from + (y_to - y_from) * u + dy, z))
    return out


def ribbon(name, path_lo, path_hi, mat, group):
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
            sector("Stair tread", f["r0"], f["r1"], y - .048, y, lo - .05, hi + .05, "oak", "fixtures", segs=2, tile=1.2)
            sector("Stair nosing brass", f["r0"] + .02, f["r1"] - .02, y - .01, y + .002, lo, lo + (hi - lo) * .08, "brass", "fixtures", segs=1, faces_on=("top",))
            sector("Stair nosing light", f["r0"] + .03, f["r1"] - .03, y - .054, y - .048, lo, lo + (hi - lo) * .12, "cove", "emit", segs=1, faces_on=("bottom",))
        for r in (f["r0"] - .03, f["r1"] + .03):
            sweep("Stair stringer", helix(r, a_from, a_to, y0, y1, -.16), .055, .38, "bronze", "fixtures")
            sweep("Stair stringer brass", helix(r, a_from, a_to, y0, y1, -.34), .06, .02, "brass", "fixtures")
            ribbon("Stair glass", helix(r, a_from, a_to, y0, y1, .02), helix(r, a_from, a_to, y0, y1, 1.0), "glass", "emit")
            sweep("Stair handrail", helix(r, a_from, a_to, y0, y1, 1.02), .06, .05, "oak", "fixtures", tile=1.5)
        lo_path = helix((f["r0"] + f["r1"]) / 2, a_from, a_to, y0, y1, -.36)
        sweep("Stair soffit", lo_path, f["r1"] - f["r0"] + .1, .02, "plaster", "fixtures")
    for L in walk["landings"]:
        y = L["y"]
        sector("Landing", L["r0"], L["r1"], y - .3, y, L["a0"], L["a1"], "stone", "fixtures", tile=1.4)
        sector("Landing edge", L["r0"] - .06, L["r0"], y - .32, y + .02, L["a0"], L["a1"], "trav", "fixtures")
        sector("Landing brass", L["r0"] - .068, L["r0"] - .055, y - .04, y + .015, L["a0"], L["a1"], "brass", "fixtures")
        sector("Landing cove", L["r0"] + .05, L["r0"] + .12, y - .31, y - .3, L["a0"], L["a1"], "cove", "emit", faces_on=("bottom",))
        arc_surface("Landing glass", L["r0"] + .02, y + .02, y + 1.05, L["a0"], L["a1"], "glass", "emit", inward=False)
        sector("Landing rail", L["r0"] - .04, L["r0"] + .08, y + 1.03, y + 1.1, L["a0"], L["a1"], "oak", "fixtures")
        far = L["a0"] if (L["a1"] in (s_["aFrom"] for s_ in walk["flights"]) or L["a1"] in (s_["aTo"] for s_ in walk["flights"])) else L["a1"]
        x0, z0 = pol(L["r0"], far)
        x1, z1 = pol(R_GAL, far)
        ribbon("Landing end glass", [(x0, y + .02, z0), (x1, y + .02, z1)], [(x0, y + 1.05, z0), (x1, y + 1.05, z1)], "glass", "emit")


def build_elevators():
    """Two panoramic glass elevators framed in architectural bronze & champagne brass."""
    for e in LAYOUT["elevators"]:
        x, z, t, rc = e["x"], e["z"], e["t"], e["r"]
        for side in (-1, 1):
            rx, rz = pol(LAYOUT["radii"]["gallery"] - .32, t + side * degrees(.55 / 20.25))
            # Stop rails cleanly below the shaft cap (17.16) and inset brass strip to avoid coplanar caps
            box("Elevator rail", rx, 8.56, rz, .12, 17.12, .16, "bronze", "fixtures", yaw=t)
            box("Elevator rail brass", rx, 8.56, rz, .032, 17.08, .172, "brass", "fixtures", yaw=t)
        # Stacked shaft cap: strictly separated vertical & radial tiers (zero coplanar z-fighting!)
        lathe("Elevator cap", x, 17.185, z, [(rc + .16, 0), (rc + .16, .34), (0, .34)], "bronze", "fixtures", sides=48)
        lathe("Elevator cap brass", x, 17.142, z, [(rc + .175, 0), (rc + .175, .038), (rc + .125, .038), (rc + .125, 0)], "brass", "fixtures", sides=48, caps=False)
        lathe("Elevator cap ring", x, 17.105, z, [(rc + .112, 0), (rc + .112, .030), (rc - .10, .030), (rc - .10, 0)], "cove", "emit", sides=48, caps=False)
        lathe("Elevator pit", x, 0, z, [(rc + .22, 0), (rc + .22, .02), (0, .02)], "darkmarble", "fixtures", sides=48)
        lathe("Elevator pit brass", x, .022, z, [(rc + .235, 0), (rc + .235, .006), (rc + .19, .006), (rc + .19, 0)], "brass", "fixtures", sides=48, caps=False)
        for th in (q for q in LAYOUT["walk"]["thresholds"] if q["elevator"] == e["id"]):
            sector("Elevator threshold", th["r0"], th["r1"], th["y"] - .3, th["y"], th["a0"], th["a1"], "stone", "fixtures")
            for edge in (th["a0"], th["a1"]):
                xa, za = pol(th["r0"], edge)
                xb, zb = pol(LAYOUT["radii"]["gallery"], edge)
                ribbon("Threshold glass", [(xa, th["y"], za), (xb, th["y"], zb)], [(xa, th["y"] + 1.05, za), (xb, th["y"] + 1.05, zb)], "glass", "emit")
        cabin = bpy.data.objects.new(f"Elevator cabin {e['id']}", None)
        bpy.context.collection.objects.link(cabin)
        cabin.location = P(x, 0, z)
        group = f"cabin{e['id']}"
        door = t
        # Every cabin ring, ceiling disc, light ring, and floor is strictly separated by >=4mm (zero z-fighting!)
        parts = [
            lathe("Cabin floor", x, .032, z, [(rc, 0), (rc, .09), (0, .09)], "darkmarble", group, sides=48),
            lathe("Cabin ceiling", x, 2.585, z, [(rc + .01, 0), (rc + .01, .135), (0, .135)], "trav", group, sides=48),
            lathe("Cabin light", x, 2.556, z, [(rc - .09, 0), (rc - .09, .022), (rc - .29, .022), (rc - .29, 0)], "downlight", group, sides=48, caps=False),
            lathe("Cabin underglow", x, .022, z, [(rc - .07, 0), (rc - .07, .008), (rc - .23, .008), (rc - .23, 0)], "cove", group, sides=48, caps=False),
            lathe("Cabin base ring", x, .126, z, [(rc + .02, 0), (rc + .02, .076), (rc - .02, .076), (rc - .02, 0)], "bronze", group, sides=48, caps=False),
            lathe("Cabin base brass", x, .206, z, [(rc + .028, 0), (rc + .028, .022), (rc - .014, .022), (rc - .014, 0)], "brass", group, sides=48, caps=False),
            lathe("Cabin top brass", x, 2.444, z, [(rc + .028, 0), (rc + .028, .022), (rc - .014, .022), (rc - .014, 0)], "brass", group, sides=48, caps=False),
            lathe("Cabin top ring", x, 2.470, z, [(rc + .02, 0), (rc + .02, .108), (rc - .02, .108), (rc - .02, 0)], "bronze", group, sides=48, caps=False),
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
            parts.append(sweep("Cabin handrail", hand, .045, .045, "brass", group))
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
            leaf.append(box("Cabin door edge", x + ex, 1.34, z + ez, .03, 2.24, .03, "brass", group))
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


# ---------------------------------------------------------------- furniture & desks
def _bevelled(obj, width=.012, segments=1, subdiv=0):
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
    """Executive ergonomic task chair: brushed titanium base, sculpted lumbar shell, knit mesh & headrest."""
    g = "chairsrc"
    parts = []
    for k in range(5):
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
    back = []
    for k in range(9):
        u = k / 8
        y = .5 + .5 * u
        bend = -.2 - .06 * sin(pi * u)
        back.append((0, y, bend - .07 * u))
    for side in (-1, 1):
        parts.append(sweep("Back frame", [(side * .23, y, z) for (_, y, z) in back], .022, .03, "silver", g, smooth=True))
    w, th = .22, .025
    front = [tuple(P(sx * w, y, z)) for (_, y, z) in back for sx in (-1, 1)]
    rear = [tuple(P(sx * w, y, z - th)) for (_, y, z) in back for sx in (-1, 1)]
    verts = front + rear
    n = len(back)
    faces = []
    for k in range(n - 1):
        a0, a1, b0, b1 = 2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3
        faces.append((a0, a1, b1, b0))
        o = 2 * n
        faces.append((o + a0, o + b0, o + b1, o + a1))
        faces.append((a0, b0, o + b0, o + a0))
        faces.append((a1, o + a1, o + b1, b1))
    faces.append((0, 2 * n, 2 * n + 1, 1))
    faces.append((2 * n - 2, 2 * n - 1, 4 * n - 1, 4 * n - 2))
    parts.append(emit_object("Back cushion", verts, faces, "mesh", g, Matrix.Identity(4), recalc=True))
    shell = [(0, y, z - th - .012) for (_, y, z) in back]
    parts.append(sweep("Back shell", shell, 2 * w + .03, .012, "black", g, smooth=True))
    parts.append(sweep("Back top rail", [(-.23, 1.0, -.27), (0, 1.02, -.28), (.23, 1.0, -.27)], .025, .03, "silver", g, smooth=True))
    parts.append(sweep("Back spine", [(0, .38, -.12), (0, .48, -.24), (0, .62, -.27)], .05, .02, "silver", g, smooth=True))
    parts.append(_bevelled(box("Lumbar pad", 0, .66, -.24, .34, .1, .03, "black", g, tilt=-6), .012, 2))
    parts.append(_bevelled(box("Headrest", 0, 1.12, -.29, .3, .12, .05, "mesh", g, tilt=-10), .02, 2))
    parts.append(box("Headrest post", 0, 1.04, -.285, .03, .1, .02, "silver", g))
    for side in (-1, 1):
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
    for x, y, z, yaw in placements:
        obj = bpy.data.objects.new(name, source.data)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(radians(yaw), 4, "Z")
        GROUPS[group].append(obj)


CHAIRS, CUPS = [], []


def build_desks():
    """Bespoke Curved Trading Pods: American walnut ribbed outer cladding, honed matte stone desktop,
    champagne-brass trim rails, slate acoustic privacy screens, and glowing warm recessed toe-kicks."""
    for d in LAYOUT["desks"]:
        r, a0, a1 = d["r"], d["a0"], d["a1"]
        end_deg = degrees(.045 / r)
        # Honed matte composite desktop + non-coplanar walnut edge band & brass trim (zero corner z-fighting!)
        sector("Desk top", r - .05, r + .778, .73, .77, a0, a1, "white", "fixtures", step=.5)
        sector("Desk edge band", r + .780, r + .798, .726, .774, a0 - .02, a1 + .02, "walnut", "fixtures", step=.5)
        sector("Desk edge brass", r + .7995, r + .806, .742, .758, a0 + .08, a1 - .08, "brass", "fixtures", step=.5)
        sector("Cable tray", r + .05, r + .25, .60, .62, a0 + end_deg + .3, a1 - end_deg - .3, "bronze", "fixtures", step=.5)
        # Sculpted American walnut front modesty shell strictly between end cheeks
        sector("Desk front", r - .055, r + .01, .074, .728, a0 + end_deg + .02, a1 - end_deg - .02, "walnut", "fixtures", step=.5, tile=1.2)
        sector("Desk kick base", r - .03, r + .02, .013, .072, a0 + end_deg + .1, a1 - end_deg - .1, "bronze", "fixtures", step=.5)
        sector("Desk kick glow", r - .05, r - .032, .022, .056, a0 + end_deg + .2, a1 - end_deg - .2, "cove_soft", "emit", faces_on=("inner",), step=.5)
        # Horizontal champagne-brass mid-reveal cleanly in front of Desk front
        sector("Desk front brass", r - .066, r - .0565, .38, .405, a0 + end_deg + .12, a1 - end_deg - .12, "brass", "fixtures", step=.5)
        # Slate acoustic privacy screen & cap strictly above Desk top (.77) with zero shared planes
        sector("Desk screen", r - .10, r - .04, .772, 1.038, a0 + .03, a1 - .03, "screenfab", "fixtures", step=.5)
        sector("Desk screen cap", r - .11, r - .03, 1.040, 1.066, a0, a1, "brass", "fixtures", step=.5)
        # Solid walnut end-cheeks strictly BELOW Desk top (.728 < .73) and inside edge band (.768 < .778)
        for end_a0, end_a1 in ((a0, a0 + end_deg), (a1 - end_deg, a1)):
            sector("Desk end", r - .052, r + .768, .013, .728, end_a0, end_a1, "walnut", "fixtures", segs=1)
    for s in LAYOUT["seats"]:
        r, t = s["r"], s["t"]
        box("Pedestal", *pol(r + .25, t + degrees(.42 / r))[:1], .3, pol(r + .25, t + degrees(.42 / r))[1], .4, .58, .5, "walnut", "fixtures", yaw=t)
        cx, cz = pol(r + 1.18, t)
        CHAIRS.append((cx, 0, cz, t + 180 + rng.uniform(-14, 14)))
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
        # (no desk lamps per owner's request)


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
            reach = s["y"] - .77
            oriented(s, 0, -reach / 2, -.065, .042, reach, .028, "bronze")
            oriented(s, 0, -reach + .005, -.08, min(.3, w * .4), .012, .18, "bronze")
        elif kind == "arc":
            r = s["r"] + .06
            pad = degrees(.13 / r)
            # Sleek precision bronze housing + champagne-brass perimeter reveal + warm indirect back-glow
            sector("Board backing", r, r + .14, s["y"] - s["h"] / 2 - .12, s["y"] + s["h"] / 2 + .12, s["a0"] - pad, s["a1"] + pad, "bezel", "fixtures", step=.4)
            sector("Board brass top", r - .015, r + .02, s["y"] + s["h"] / 2 + .11, s["y"] + s["h"] / 2 + .14, s["a0"] - pad, s["a1"] + pad, "brass", "fixtures", step=.4)
            sector("Board brass bot", r - .015, r + .02, s["y"] - s["h"] / 2 - .14, s["y"] - s["h"] / 2 - .11, s["a0"] - pad, s["a1"] + pad, "brass", "fixtures", step=.4)
            sector("Board light", r - .005, r + .02, s["y"] - s["h"] / 2 - .15, s["y"] - s["h"] / 2 - .13, s["a0"] - pad, s["a1"] + pad, "cove", "emit", step=.4, faces_on=("bottom", "inner"))
            top = s["y"] + s["h"] / 2 + .14
            sector("Board top rail", r - .02, R_GAL + .05, top, top + .07, s["a0"] - pad, s["a1"] + pad, "bronze", "fixtures", step=.4)
            above = min((lv - 1.0 for lv in LEVELS if lv - 1.0 >= top), default=None)
            for edge in (s["a0"] + 1.2, s["a1"] - 1.2):
                hx, hz = pol(r + .07, edge)
                if above is not None and above - top > .05:
                    box("Board hanger", hx, (top + above) / 2, hz, .032, above - top, .032, "silver", "fixtures")
                bx, bz = pol((r + R_GAL) / 2, edge)
                box("Board bracket", bx, top - .3, bz, .055, .48, R_GAL - r + .1, "bronze", "fixtures", yaw=edge)


def curved_sofa(r, a0, a1, y=.14):
    """Luxury curved modular sectional sofa: walnut plinth, ivory linen cushions & tailored throw pillows."""
    sector("Sofa plinth", r - .55, r + .32, y, y + .09, a0, a1, "walnut", "fixtures", step=.3)
    sector("Sofa brass strip", r - .555, r - .54, y + .07, y + .09, a0, a1, "brass", "fixtures", step=.3)
    sector("Sofa base", r - .52, r + .30, y + .09, y + .40, a0, a1, "weave", "fixtures", step=.3, tile=.3)
    n = max(3, int(radians(a1 - a0) * r / .95))
    gap = degrees(.028 / r)
    for k in range(n):
        c0 = a0 + (a1 - a0) * k / n + gap
        c1 = a0 + (a1 - a0) * (k + 1) / n - gap
        _bevelled(sector("Sofa cushion", r - .51, r + .05, y + .40, y + .545, c0, c1, "weave", "fixtures", step=.28, tile=.3), .024, 1)
        _bevelled(sector("Sofa back cushion", r + .05, r + .27, y + .54, y + .92, c0, c1, "weave", "fixtures", step=.28, tile=.3), .024, 1)
        # Accent tailored throw cushions on alternate seats!
        if k % 2 == 0:
            pt = (c0 + c1) / 2
            px, pz = pol(r - .04, pt)
            pmat = "pillow_camel" if (k // 2) % 2 == 0 else "pillow_slate"
            box("Throw pillow", px, y + .66, pz, .38, .34, .11, pmat, "fixtures", yaw=pt + 180 + rng.uniform(-10, 10), tilt=-14, bevel=.028, segments=1)
    sector("Sofa back", r + .27, r + .33, y + .09, y + .95, a0, a1, "weave", "fixtures", step=.3, tile=.3)
    for a in (a0, a1 - degrees(.18 / r)):
        sector("Sofa arm", r - .52, r + .30, y + .09, y + .67, a, a + degrees(.18 / r), "weave", "fixtures", segs=2, tile=.3)


def build_landscape():
    """Stepped Biophilic Lounges with glowing step LEDs & Living Illuminated Reflecting Pools."""
    for L in LAYOUT["lounges"]:
        t = L["t"]
        # 2-stepped oak lounge deck with glowing warm step strips
        sector("Lounge deck", 17.1, 20.7, 0, .15, t - 11, t + 11, "deck", "fixtures", tile=1.2)
        sector("Lounge step", 16.88, 17.1, 0, .075, t - 11, t + 11, "trav", "fixtures")
        sector("Lounge step glow 1", 16.86, 16.89, .055, .075, t - 10.8, t + 10.8, "cove", "emit", faces_on=("inner",))
        sector("Lounge step glow 2", 17.08, 17.11, .125, .148, t - 10.8, t + 10.8, "cove", "emit", faces_on=("inner",))
        sector("Lounge rug", 17.65, 20.15, .152, .166, t - 7.2, t + 7.2, "weave", "fixtures", tile=1.5, faces_on=("top", "inner", "outer"))
        # Sculpted travertine planter trough with champagne-brass coping trim
        sector("Lounge planter rim", 20.30, 20.38, .15, .80, t - 11, t + 11, "trav", "fixtures")
        sector("Lounge planter rim", 20.62, 20.70, .15, .80, t - 11, t + 11, "trav", "fixtures")
        sector("Lounge planter brass", 20.29, 20.39, .80, .82, t - 11, t + 11, "brass", "fixtures")
        sector("Lounge planter brass", 20.61, 20.71, .80, .82, t - 11, t + 11, "brass", "fixtures")
        for edge in (t - 11, t + 11 - degrees(.08 / 20.5)):
            sector("Lounge planter end", 20.38, 20.62, .15, .80, edge, edge + degrees(.08 / 20.5), "trav", "fixtures", segs=1)
        sector("Lounge planter soil", 20.38, 20.62, .15, .74, t - 10.8, t + 10.8, "soil", "fixtures")
        curved_sofa(19.55, t - 7.5, t + 7.5, y=.15)
    for so in LAYOUT.get("sofas", []):
        curved_sofa(so["r"], so["t"] - so["span"] / 2, so["t"] + so["span"] / 2, y=so["y"])

    # Living Illuminated Reflecting Pools (dedicated `water` group -> WebGPU ripple/caustics shader!)
    for w in LAYOUT["water"]:
        r0, r1, a0, a1 = w["r0"], w["r1"], w["a0"], w["a1"]
        # Stepped travertine & dark Emperador marble coping
        sector("Pool outer wall", r0 - .14, r0, 0, .42, a0 - .5, a1 + .5, "trav", "fixtures", step=.35)
        sector("Pool outer wall", r1, r1 + .14, 0, .42, a0 - .5, a1 + .5, "trav", "fixtures", step=.35)
        for edge in (a0 - .5, a1):
            sector("Pool end wall", r0 - .14, r1 + .14, 0, .42, edge, edge + .5, "trav", "fixtures", segs=2)
        sector("Pool brass rim", r0 - .15, r0 + .01, .42, .44, a0 - .5, a1 + .5, "brass", "fixtures", step=.35)
        sector("Pool brass rim", r1 - .01, r1 + .15, .42, .44, a0 - .5, a1 + .5, "brass", "fixtures", step=.35)
        # Dark slate-marble submerged basin floor
        sector("Pool basin", r0, r1, .02, .12, a0, a1, "darkmarble", "fixtures", faces_on=("top",), step=.35)
        # Underwater luminous cyan-aquamarine LED strips running inside the rim!
        sector("Pool underwater LED", r0 + .01, r0 + .04, .28, .31, a0 + .2, a1 - .2, "waterled", "emit", faces_on=("outer", "top"), step=.35)
        sector("Pool underwater LED", r1 - .04, r1 - .01, .28, .31, a0 + .2, a1 - .2, "waterled", "emit", faces_on=("inner", "top"), step=.35)
        # Subtle warm base toe-kick around the pool plinth
        sector("Pool base glow", r0 - .145, r0 - .135, .02, .05, a0 - .4, a1 + .4, "cove_soft", "emit", faces_on=("inner",), step=.4)
        # Low curved glass splash guard with brass spigots (straight from concept board!)
        arc_surface("Pool glass guard", r0 - .07, .44, .76, a0 - .2, a1 + .2, "glass", "emit", inward=False, step=.4)
        for gt in (a0 + .8, (a0 + a1) / 2, a1 - .8):
            gx, gz = pol(r0 - .07, gt)
            box("Pool glass spigot", gx, .48, gz, .035, .08, .045, "brass", "fixtures", yaw=gt)
        # Water surface mesh in dedicated group "water" (exported as named node `WaterSurface`)
        sector("Pool water surface", r0, r1, .355, .365, a0, a1, "water", "water", faces_on=("top",), step=.35)


# ---------------------------------------------------------------- props & flowers
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
                if o.data.shape_keys:
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
    corners = [w @ Vector(c) for o, w in meshes for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    band = lo.z + max(.02, (hi.z - lo.z) * .03)
    foot = [w @ v.co for o, w in meshes for v in o.data.vertices if (w @ v.co).z <= band]
    fx = sum(v.x for v in foot) / len(foot) if foot else (lo.x + hi.x) / 2
    fy = sum(v.y for v in foot) / len(foot) if foot else (lo.y + hi.y) / 2
    pivot = Matrix.Translation(-Vector((fx, fy, lo.z)))
    if fit:
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
        bpy.context.view_layer.update()
        pts = [d.matrix_world @ v.co for d in dups for v in d.data.vertices]
        low = min(v.z for v in pts)
        top = max(v.z for v in pts)
        feet = [v for v in pts if v.z <= low + (top - low) * .03]
        fx, fy = sum(v.x for v in feet) / len(feet), sum(v.y for v in feet) / len(feet)
        target = P(x, y, z)
        off = ((fx - target.x) ** 2 + (fy - target.y) ** 2) ** .5
        if off > .05:
            for d in dups:
                d.matrix_world = Matrix.Translation(Vector((target.x - fx, target.y - fy, 0))) @ d.matrix_world
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)


def build_props(source):
    chairs, tables, ferns = [], [], []
    for L in LAYOUT["lounges"]:
        t = L["t"]
        for dt in (-3.4, 3.4):
            x, z = pol(17.75, t + dt)
            chairs.append((x, .15, z, t + dt * .6))
        x, z = pol(18.5, t)
        tables.append((x, .15, z, 0))
        for dt in (-10, -8.6, 8.6, 10):
            x, z = pol(20.55, t + dt)
            ferns.append((x, .82, z, rng.uniform(0, 360)))
    import_prop(source, "mid_century_lounge_chair", chairs, max_tris=3500)
    import_prop(source, "coffee_table_round_01", tables, max_tris=2000)
    trees = [(p["x"], 0.0, p["z"], rng.uniform(0, 360)) for p in LAYOUT["planters"]]
    import_prop(source, "potted_plant_02", trees, scale=2.4, max_tris=6000)
    chair = make_task_chair()
    place_instances(chair, CHAIRS, "Task chair")
    bpy.data.objects.remove(chair, do_unlink=True)
    mug = lathe("Cup", 0, 0, 0, [(.03, 0), (.04, .005), (.042, .09), (.038, .09), (.036, .012), (0, .012)], "ceramic", "cupsrc", sides=20)
    place_instances(mug, CUPS, "Coffee cup")
    bpy.data.objects.remove(mug, do_unlink=True)
    GROUPS["cupsrc"] = []
    pots = [(gp["x"], [0.0, *LEVELS][gp["level"]], gp["z"], rng.uniform(0, 360)) for gp in LAYOUT["galleryPots"]]
    import_prop(source, "potted_plant_02", pots, scale=1.35, max_tris=2500)
    foliage = build_flowers()
    # Museum-grade travertine + dark Emperador marble + champagne-brass sculpture pedestals
    fits = {"marble_bust_01": .7, "horse_statue_01": .95, "gothic_statue": 1.2, "bronze_whale_statue": .6, "bronze_ray_statue": .55,
            "horse_head": .7, "lion_head": .6, "carved_wooden_elephant": .6, "antique_ceramic_vase_01": .75}
    for sc in LAYOUT.get("sculptures", []):
        plinth_h = 1.05 if fits.get(sc["id"], .7) < 1 else .55
        box("Sculpture plinth base", sc["x"], sc["y"] + .04, sc["z"], .62, .08, .62, "darkmarble", "fixtures", yaw=sc["t"])
        box("Sculpture plinth", sc["x"], sc["y"] + plinth_h / 2, sc["z"], .56, plinth_h - .06, .56, "trav", "fixtures", yaw=sc["t"], bevel=.01)
        box("Plinth brass collar", sc["x"], sc["y"] + plinth_h - .015, sc["z"], .58, .022, .58, "brass", "fixtures", yaw=sc["t"])
        box("Plinth top", sc["x"], sc["y"] + plinth_h + .005, sc["z"], .58, .016, .58, "darkmarble", "fixtures", yaw=sc["t"])
        if (source / sc["id"]).exists():
            import_prop(source, sc["id"], [(sc["x"], sc["y"] + plinth_h + .013, sc["z"], sc["t"] + 180)], fit=fits.get(sc["id"], .7), max_tris=8000)
    import_prop(source, "fern_02", foliage + ferns, scale=.55, max_tris=1200)


# ---------------------------------------------------------------- flowers (20 species, 1 vertex-color material)
FLOWER_SPECS = {
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
    for _ in range(stems):
        a = r.uniform(0, 2 * pi)
        d = r.uniform(.02, .16)
        base = Vector((cos(a) * d, sin(a) * d, 0))
        h = height * r.uniform(.75, 1.1)
        lean = Vector((cos(a) * r.uniform(.02, .12), sin(a) * r.uniform(.02, .12), 0))
        top = base + Vector((0, 0, h)) + lean
        for ang in (0, pi / 2):
            off = Vector((cos(ang), sin(ang), 0)) * .004
            add_quad(base - off, base + off, top + off, top - off, 3)
        for _ in range(3):
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
                    scale = 1 - layer * (.22 if kind == "cup" else .1)
                    petal(head, dirv, Vector((0, 0, 1)), plen * scale, pwid * scale, lc * .6 if kind != "star" else -.35, 0)
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
        else:
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
    palette = [lin(col), lin(ccol), (.05, .18, .04), (.07, .20, .04)]
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    for poly, m in zip(me.polygons, mats):
        c = palette[m]
        shade = .9 + .2 * ((poly.index * 37) % 11) / 10
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
    meshes = {name: [build_flower_mesh(f"{name} {v}", FLOWER_SPECS[name], sum(map(ord, name)) * 7 + v) for v in range(2)] for name in FLOWER_SPECS}
    def plant(species, x, y, z, k):
        me = meshes[species][k % 2]
        obj = bpy.data.objects.new(f"Flowers {species}", me)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation(P(x, y, z)) @ Matrix.Rotation(rng.uniform(0, 2 * pi), 4, "Z") @ Matrix.Scale(rng.uniform(.85, 1.15), 4)
        GROUPS["props"].append(obj)
    names = list(FLOWER_SPECS)
    foliage = []
    for j, L in enumerate(LAYOUT["lounges"]):
        for k, dt in enumerate(np.arange(-7.2, 7.3, 1.45)):
            x, z = pol(20.5, L["t"] + dt)
            plant(names[(j * 7 + k * 3) % len(names)], x, .74, z, k)
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
    """Crisp dark financial terminal textures for realistic Cycles GI bounce and previews (never exported)."""
    paths = []
    for v in range(6):
        w, h = 512, 300
        img = np.zeros((h, w, 3), dtype=np.float32)
        img[:] = (.008, .016, .036)
        img[:20] = (.02, .06, .14)
        for k in range(rng.randint(2, 4)):
            x0, y0 = rng.randint(10, 240), rng.randint(36, 170)
            pts = np.cumsum(np.array([rng.uniform(-6, 6) for _ in range(210)]))
            c = rng.choice([(.15, .92, .55), (1.0, .30, .36), (.28, .72, 1.0), (.98, .78, .25)])
            for i, p in enumerate(pts):
                xx, yy = x0 + i, int(y0 + 55 - p)
                if 0 <= xx < w and 0 <= yy < h:
                    img[max(0, yy - 1):yy + 2, xx] = c
        for row in range(28, h - 10, 11):
            if rng.random() < .6:
                x = rng.randint(295, 340)
                img[row:row + 4, x:x + rng.randint(45, 155)] = rng.choice([(.18, .85, .50), (.95, .28, .35), (.45, .75, 1.0)])
        bimg = bpy.data.images.new(f"dash{v}", w, h, alpha=False)
        bimg.pixels.foreach_set(np.concatenate([img[::-1], np.ones((h, w, 1), np.float32)], axis=2).ravel())
        path = out / f"preview-dash{v}.png"
        bimg.filepath_raw = str(path)
        bimg.file_format = "PNG"
        bimg.save()
        paths.append(path)
    return [emissive_image(f"Screen stand-in {i}", p, 2.2) for i, p in enumerate(paths)]


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


# ---------------------------------------------------------------- lighting & bake
def bake_lights():
    """Sculpted architectural lighting:
    - Dramatic sunlit Nishita sunshaft cutting diagonally across the marble & galleries
    - Warm 3000K architectural gallery & promenade wash pools
    - Cool sapphire-cyan holographic glow radiating from the central light core onto the plaza & desks
    """
    extra = []

    def add(obj):
        bpy.context.collection.objects.link(obj)
        extra.append(obj)

    # Golden-daylight architectural sun casting crisp skylight rib patterns across the atrium
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy, sun.angle, sun.color = 4.6, radians(1.6), (1.0, .93, .82)
    o = bpy.data.objects.new("Sun", sun)
    o.rotation_euler = (radians(42), 0, radians(38))
    add(o)

    # Skylight soft directional pools (sculpted so shadows & AO keep rich architectural depth!)
    for t in np.arange(0, 360, 30):
        x, z = pol(12.5, t)
        data = bpy.data.lights.new("SkylightWash", "AREA")
        data.energy, data.size, data.color = 520, 3.6, (1.0, .95, .88)
        lo = bpy.data.objects.new("SkylightWash", data)
        lo.location = P(x, 18.8, z)
        add(lo)

    # Central holographic core sapphire-cyan point lights casting cool modern glow onto the central marble plaza!
    for cy, energy in ((1.8, 520), (5.6, 680), (10.5, 480)):
        data = bpy.data.lights.new("CoreSapphire", "POINT")
        data.energy, data.shadow_soft_size, data.color = energy, 1.4, (.32, .80, 1.0)
        lo = bpy.data.objects.new("CoreSapphire", data)
        lo.location = P(0, cy, 0)
        add(lo)

    # Warm 3000K gallery promenade & art-alcove grazing accents
    tops = [LEVELS[0] - .45] + [LEVELS[i + 1] - .45 for i in range(len(LEVELS) - 1)] + [H - .5]
    for top in tops:
        for t in np.arange(0, 360, 20):
            x, z = pol((R_GAL + R_WALL) / 2, t)
            data = bpy.data.lights.new("PromenadeWarm", "AREA")
            data.energy, data.size, data.color = 260, 1.8, (1.0, .88, .72)
            lo = bpy.data.objects.new("PromenadeWarm", data)
            lo.location = P(x, top - .28, z)
            lo.rotation_euler = (0, 0, 0)
            add(lo)
    return extra


def join(group, name=None):
    objs = GROUPS[group]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name or group
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
    scene.cycles.glossy_bounces = 4
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = radians(48)
        sky.sun_rotation = radians(38)
    except (AttributeError, TypeError):
        pass
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = .52
    scene.world = world
    for gname in ("emit", "holo"):
        for obj in GROUPS[gname]:
            obj.visible_shadow = False


def environment(out_dir, samples=160):
    """High-fidelity 2K Cycles equirectangular HDR environment map for crisp marble, brass & glass reflections."""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("env")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("env", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = P(0, 3.6, 8.5)
    cam.rotation_euler = (radians(90), 0, radians(-90))
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 2048, 1024
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
        "concept": ((8.2, 7.2, 19.6), (-.5, 6.8, -1.8), 14),
        "spawn": ((0, 1.68, 22.6), (0, 6.5, 0), 16),
        "desk": ((9.5, 1.6, 9.0), (0, 4.0, 0), 18),
        "ceiling": ((0, 1.7, 12.0), (0, 19.5, -4.0), 14),
        "lounge": ((*pol(15.8, 200)[:1], 1.65, pol(15.8, 200)[1]), (*pol(19.6, 211)[:1], .5, pol(19.6, 211)[1]), 20),
        "promenade": ((*pol(22.6, 100)[:1], 1.65, pol(22.6, 100)[1]), (*pol(25.0, 125)[:1], 1.6, pol(25.0, 125)[1]), 18),
        "art": ((*pol(21.0, 24)[:1], 1.65, pol(21.0, 24)[1]), (*pol(25.8, 30)[:1], 1.8, pol(25.8, 30)[1]), 22),
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
    keep = ("Artwork", ) + tuple(sc["id"] for sc in LAYOUT.get("sculptures", []))
    buckets = defaultdict(list)
    for o in GROUPS["props"]:
        if o.name.startswith(keep) or o.type != "MESH" or o.parent is not None:
            continue
        c = o.matrix_world.translation
        q = int((degrees(atan2(c.x, -c.y)) % 360) // 45) % 8
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
    parser.add_argument("--samples", type=int, default=320)
    parser.add_argument("--shell-size", type=int, default=4096)
    parser.add_argument("--fixture-size", type=int, default=4096)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--preview-only", action="store_true")
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
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for g in ("shell", "fixtures", "emit", "props", "water", "holo") for o in GROUPS[g])
    print("triangles (before instancing):", tris, {g: len(GROUPS[g]) for g in GROUPS}, flush=True)
    if opts.preview or opts.preview_only:
        preview(out, opts.preview_samples, set(filter(None, opts.shots.split(","))))
    if opts.preview_only:
        sys.exit(0)
    merge_props()
    for g in ("shell", "fixtures", "emit"):
        join(g)
    join("water", name="WaterSurface")
    join("holo", name="HoloCoreFX")
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
