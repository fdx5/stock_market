"""Real 3D trees for the complex view: public/3d/trees.bin + trees.json + leafclusters.png.

Run inside Blender (tested with 5.2):
  blender -b --factory-startup -P frontend/scripts/gen-mesh-trees.py -- <work_dir>

The crossed-card impostors show every tree two or three times over from an angle (a
ghost trunk, a boxy crown, leaves floating off it). These are meshes instead, built the
way game foliage is (SpeedTree and co.): the species' skeleton from gen-street-trees.py
(space colonisation in its crown envelope) as bark tubes down to finger-thick branches,
and the foliage as leaf-cluster cards — a pair of crossed quads at the end of each twig
group, textured with a clump of the species' leaves rendered here. Normals lean out
from the crown's centre (lit as a crown, not as cards). 1-3k triangles a tree.

trees.bin: per variant, bark then leaves: positions f32x3, normals i8x4, colours u8x4
(bark only), uv u16x2 (leaves only), indices u16. trees.json: offsets, counts, species,
bounds. leafclusters.png: one 256 px clump per species (alpha), in a row.
"""
import importlib.util
import json
import math
import random
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('trees', here / 'gen-street-trees.py')
trees = importlib.util.module_from_spec(spec)
sys.argv.append('--mesh')
spec.loader.exec_module(trees)

args = sys.argv[sys.argv.index('--') + 1:]
work = Path(args[0])
work.mkdir(parents=True, exist_ok=True)
public = here.parent / 'public' / '3d'

SPECIES = dict(trees.SPECIES)
# 소나무 (Korean red pine): a clear, slightly leaning bole, reddish bark above, an irregular
# flat-topped crown of dark needle clumps; 측백/주목: a dense dark cone.
SPECIES['pine'] = dict(height=8.5, trunk=3.9, envelope=lambda h: 2.9 * math.sqrt(max(0.0, math.sin(math.pi * min(1.0, h * 1.05)))), points=700, up=-0.05,
                       leaf=(0.02, 0.2), leaf_rgb=(0.2, 0.3, 0.12), leaf_var=0.08, per_twig=30, bark=(0.5, 0.27, 0.18), sparse=0.35, lean=0.12)
SPECIES['conifer'] = dict(height=6.0, trunk=0.5, envelope=lambda h: 1.7 * (1 - h) ** 1.05 + 0.12, points=700, up=0.25,
                          leaf=(0.03, 0.12), leaf_rgb=(0.14, 0.24, 0.09), leaf_var=0.06, per_twig=30, bark=(0.34, 0.25, 0.2), sparse=0.0)
# Shrubs (철쭉 azalea mounds, 회양목 boxwood balls, 사철나무 spindle hedges) and a bed of
# flowers, grown the same way at their scale.
SPECIES['azalea'] = dict(height=0.9, trunk=0.04, envelope=lambda h: 0.8 * math.sqrt(max(0.0, 1 - h * h)) + 0.05, points=260, up=0.25,
                         leaf=(0.045, 0.03), leaf_rgb=(0.2, 0.3, 0.1), leaf_var=0.08, per_twig=10, bark=(0.35, 0.28, 0.22), sparse=0.0)
SPECIES['boxwood'] = dict(height=0.75, trunk=0.03, envelope=lambda h: 0.55 * math.sqrt(max(0.0, 1 - (2 * h - 1) ** 2)) + 0.04, points=220, up=0.2,
                          leaf=(0.03, 0.02), leaf_rgb=(0.17, 0.27, 0.09), leaf_var=0.06, per_twig=10, bark=(0.35, 0.3, 0.24), sparse=0.0)
SPECIES['spindle'] = dict(height=1.4, trunk=0.05, envelope=lambda h: 0.55 * math.sqrt(max(0.0, 1 - (2 * h - 1) ** 2)) + 0.05, points=300, up=0.3,
                          leaf=(0.06, 0.035), leaf_rgb=(0.2, 0.34, 0.1), leaf_var=0.07, per_twig=10, bark=(0.33, 0.3, 0.25), sparse=0.0)
# Bedding and border flowers of Korean apartment grounds and street planters:
# name: (colour, head form, head size m, layout, height m)
FLOWERS = {
    'petunia':   ((0.95, 0.42, 0.66), 'five', 0.1, 'mound', 0.25),
    'begonia':   ((0.88, 0.14, 0.16), 'five', 0.085, 'mound', 0.22),
    'pansy':     ((0.5, 0.3, 0.82), 'five', 0.095, 'mound', 0.18),
    'marigold':  ((1.0, 0.62, 0.1), 'cluster', 0.095, 'mound', 0.28),
    'daisy':     ((1.0, 1.0, 1.0), 'daisy', 0.09, 'mound', 0.3),
    'cosmos':    ((0.96, 0.52, 0.72), 'daisy', 0.08, 'tall', 0.75),
    'coreopsis': ((1.0, 0.84, 0.18), 'daisy', 0.06, 'tall', 0.55),
    'tulip_red': ((0.9, 0.12, 0.12), 'bell', 0.09, 'upright', 0.4),
    'tulip_yellow': ((1.0, 0.86, 0.22), 'bell', 0.09, 'upright', 0.4),
    'lavender':  ((0.58, 0.44, 0.86), 'cluster', 0.05, 'spike', 0.5),
    'salvia':    ((0.9, 0.12, 0.1), 'cluster', 0.05, 'spike', 0.45),
    'hydrangea': ((0.56, 0.62, 0.95), 'cluster', 0.2, 'ball', 0.9),
}
# leaves (or needle tufts) a tree carries, and a leaf's size (m): larger than life, fewer of them
LEAVES = {'ginkgo': (1500, 0.14), 'zelkova': (2600, 0.13), 'cherry': (2300, 0.14), 'plane': (2400, 0.22), 'fringe': (1600, 0.13),
          'pine': (900, 0.3), 'conifer': (800, 0.24), 'azalea': (330, 0.07), 'boxwood': (320, 0.055), 'spindle': (420, 0.08)}
NEEDLES = {'pine', 'conifer'}
# twigs a plant carries (and their size against TWIG's stem length)
TWIGS = {'ginkgo': 1800, 'zelkova': 2800, 'cherry': 2400, 'plane': 2000, 'fringe': 1900, 'pine': 1300, 'conifer': 1200,
         'azalea': 320, 'boxwood': 340, 'spindle': 420}
TWIG_SCALE = {'azalea': 1.35, 'boxwood': 1.4, 'spindle': 1.3, 'plane': 1.45, 'pine': 1.25, 'ginkgo': 1.15, 'zelkova': 1.2, 'cherry': 1.2, 'fringe': 1.15, 'conifer': 1.1}
# the twig leaves' colour (linear): greens of the living leaf, not the scans' dry olive
TWIG_RGB = {'ginkgo': (0.2, 0.36, 0.07), 'zelkova': (0.12, 0.24, 0.06), 'cherry': (0.11, 0.21, 0.06), 'plane': (0.13, 0.25, 0.07),
            'fringe': (0.12, 0.23, 0.07), 'azalea': (0.1, 0.19, 0.05), 'boxwood': (0.08, 0.16, 0.04), 'spindle': (0.11, 0.22, 0.06)}
# cluster card size (m) and spacing between clusters (m), per species
CLUSTER = {'ginkgo': (0.8, 0.36), 'zelkova': (0.9, 0.44), 'cherry': (0.9, 0.44), 'plane': (1.1, 0.52), 'fringe': (0.85, 0.42),
           'pine': (0.95, 0.44), 'conifer': (0.75, 0.3)}
VARIANTS = ('a', 'b', 'c')
names = list(SPECIES)
# the photographed leaves (prep-tree-textures.py)
PHOTO = json.loads((work / 'leafphoto.json').read_text())
PHOTO_IMG = bpy.data.images.load(str(work / 'leafphoto.png'))
PHOTO_IMG.alpha_mode = 'STRAIGHT'
# (rect w, h are fractions of the atlas: width over height in texels needs the atlas' aspect)
PHOTO_ASPECT = PHOTO_IMG.size[0] / PHOTO_IMG.size[1]
HEADS = PHOTO['heads']
RECTS = PHOTO['leaves'] + [PHOTO['tuft'], PHOTO['petal']] + [HEADS[k] for k in ('daisy', 'bell', 'cluster')]
HEAD_RECT = {'five': PHOTO['petal'], 'daisy': HEADS['daisy'], 'bell': HEADS['bell'], 'cluster': HEADS['cluster']}
RECT_OF = lambda r: RECTS.index(r)


# Leafy twigs: the unit the crowns are built of. A stem with its photographed leaves (or
# needle tufts) spreading off it, rendered from the front, 0.6 m tall: a tree carries a
# thousand or so, which fills a crown the way single leaves never could at this cost.
TWIG = {  # leaves a twig, leaf length (m), twig length (m)
    'ginkgo': (18, 0.065, 0.5), 'zelkova': (24, 0.06, 0.55), 'cherry': (20, 0.08, 0.55), 'plane': (12, 0.14, 0.6), 'fringe': (20, 0.07, 0.5),
    'pine': (7, 0.0, 0.5), 'conifer': (9, 0.0, 0.45), 'azalea': (16, 0.045, 0.35), 'boxwood': (26, 0.022, 0.3), 'spindle': (18, 0.05, 0.4)}
TWIG_ORDER = [f'{sp}_{k}' for sp in TWIG for k in (0, 1)]
TWIG_H = 0.6   # the render frame: 0.6 m tall, 0.3 m wide


def render_twig(sname, sp, k):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    rnd = random.Random(f'twig-{sname}-{k}')
    count, leafL, stemL = TWIG[sname]
    needle = sname in NEEDLES
    lv, lf, lc, lu = [], [], [], []
    def quad(c, ax, side, L, W, r, col):
        kk = len(lv)
        lv.extend([c - side * W, c + side * W, c + side * W + ax * L, c - side * W + ax * L])
        lf.append((kk, kk + 1, kk + 2, kk + 3))
        lu.append([(r['x'], 1 - r['y'] - r['h']), (r['x'] + r['w'], 1 - r['y'] - r['h']), (r['x'] + r['w'], 1 - r['y']), (r['x'], 1 - r['y'])])
        lc.append(col)
    stem_dir = Vector((rnd.gauss(0, 0.08), 0, 1)).normalized()
    base = Vector((0, 0, 0.02))
    # the main stem and two or three side shoots, each carrying leaves: a spray, not a rod
    shoots = [(base, stem_dir, stemL)]
    for sgn in ([1, -1, 1] if rnd.random() < 0.5 else [-1, 1])[:3]:
        t0 = rnd.uniform(0.25, 0.6)
        d = (stem_dir + Vector((sgn * rnd.uniform(0.6, 1.1), 0, 0))).normalized()
        shoots.append((base + stem_dir * stemL * t0, d, stemL * rnd.uniform(0.35, 0.55)))
    per = [max(3, int(count * (0.5 if n == 0 else 0.5 / (len(shoots) - 1)) * 1.4)) for n in range(len(shoots))]
    jobs = [(sb, sd, sl, j, pc) for (sb, sd, sl), pc in zip(shoots, per) for j in range(pc)]
    for (sb, sd, sl, j, pc) in jobs:
        t = 0.15 + 0.85 * (j + rnd.random() * 0.6) / pc
        at = sb + sd * sl * t
        side_sign = 1 if j % 2 == 0 else -1
        stem_here = sd
        v = sp['leaf_var']
        if needle:
            r = PHOTO['tuft']
            ax = (stem_here + Vector((side_sign * rnd.uniform(0.2, 0.9), rnd.gauss(0, 0.3), 0.2))).normalized()
            side = ax.cross(Vector((0, 1, 0))).normalized()
            L = rnd.uniform(0.14, 0.2)
            tint = [ch * 0.5 * (0.8 + 0.4 * rnd.random()) / 0.33 for ch in sp['leaf_rgb']]
            quad(at, ax, side, L, L * 0.5, r, tint)
        else:
            r = PHOTO['leaves'][rnd.randrange(len(PHOTO['leaves']))]
            ang = side_sign * rnd.uniform(0.8, 1.45)
            perp = Vector((stem_here.z, 0, -stem_here.x))
            ax = (stem_here * math.cos(ang) + perp * math.sin(ang) + Vector((0, rnd.gauss(0, 0.35), 0))).normalized()
            side = ax.cross(Vector((rnd.gauss(0, 0.4), 1, rnd.gauss(0, 0.2)))).normalized()
            L = leafL * 1.3 * rnd.uniform(0.8, 1.2)
            W = L * (r['w'] / max(r['h'], 1e-3)) * PHOTO_ASPECT * 0.5
            want = [ch * (0.75 + 0.5 * rnd.random()) * (1 + rnd.uniform(-v, v)) for ch in TWIG_RGB.get(sname, sp['leaf_rgb'])]
            quad(at, ax, side, L, W, r, [w_ / max(0.05, av) * 1.3 for w_, av in zip(want, r['avg'])])
    # the stems: thin dark strips
    for (sb, sd, sl) in shoots:
        kk = len(lv)
        s0, s1 = sb, sb + sd * sl
        wv = Vector((sd.z, 0, -sd.x)) * 0.0022
        lv.extend([s0 - wv * 2, s0 + wv * 2, s1 + wv, s1 - wv]); lf.append((kk, kk + 1, kk + 2, kk + 3)); lu.append(None); lc.append([0.1, 0.075, 0.06])
    # (all of it inside the frame, a margin clear of the edges: a leaf cut straight at the
    # cell's border would show the card)
    mx = max(abs(p.x) for p in lv) or 1.0
    mz = max(p.z for p in lv) or 1.0
    k = min(1.0, (TWIG_H * 0.25 - 0.008) / mx, (TWIG_H - 0.012) / mz)
    lv = [Vector((p.x * k, p.y * k, p.z * k)) for p in lv]
    me = bpy.data.meshes.new('twig')
    me.from_pydata([tuple(p) for p in lv], [], lf)
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    uvl = me.uv_layers.new(name='UV')
    for poly, col, uvs in zip(me.polygons, lc, lu):
        for j, li in enumerate(poly.loop_indices):
            attr.data[li].color = (*col, 1.0)
            uvl.data[li].uv = uvs[j] if uvs else (PHOTO['petal']['x'] + PHOTO['petal']['w'] / 2, 1 - PHOTO['petal']['y'] - PHOTO['petal']['h'] / 2)
    mat = bpy.data.materials.new('twig')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = PHOTO_IMG; tex.interpolation = 'Cubic'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs['A']); nt.links.new(vc.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.7
    me.materials.append(mat)
    ob = bpy.data.objects.new('twig', me)
    bpy.context.scene.collection.objects.link(ob)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = 256, 512
    scene.view_settings.view_transform = 'Standard'
    world = scene.world or bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.85, 0.88, 0.92, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2.0
    sun.rotation_euler = (math.radians(70), 0, math.radians(-20)); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.type = 'ORTHO'; cam.data.ortho_scale = TWIG_H
    cam.location = (0, -5, TWIG_H / 2); cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.collection.objects.link(cam); scene.camera = cam
    path = work / f'twig_{sname}_{k}.png'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def mesh_tree(sname, sp, rnd):
    nodes, parent, children, radius = trees.grow(sp, rnd)
    if sp.get('lean'):
        # a pine's bole leans and bends a little
        ang = rnd.uniform(0, math.tau)
        lean = Vector((math.cos(ang), math.sin(ang), 0)) * sp['lean']
        nodes = [n + lean * (n.z / sp['height']) ** 1.5 * sp['height'] for n in nodes]
    H = sp['height']
    crown_c = Vector((0, 0, sp['trunk'] + (H - sp['trunk']) * 0.5))
    def bark_mesh(min_r):
        # ---- bark: tubes down to finger thickness, straight runs merged
        keep = [i == 0 or radius[i] >= min_r for i in range(len(nodes))]
        for i in range(1, len(nodes)):
            # (a node with one child, in line with its parent and child, adds nothing)
            if keep[i] and len(children[i]) == 1 and parent[i] >= 0 and i % 2 == 1 and radius[i] < 0.15:
                keep[i] = False
        # each node's thickest kept child (the one that continues its stem)
        main_child = {}
        for i in range(1, len(nodes)):
            if not keep[i]:
                continue
            q = parent[i]
            while q > 0 and not keep[q]:
                q = parent[q]
            if q not in main_child or radius[i] > radius[main_child[q]]:
                main_child[q] = i
        def up_to_kept(i):
            while i > 0 and not keep[i]:
                i = parent[i]
            return i
        bv, bn, bc, bi, bu = [], [], [], [], []
        ring_of = {}
        along = [0.0] * len(nodes)
        for i in range(1, len(nodes)):
            along[i] = along[parent[i]] + (nodes[i] - nodes[parent[i]]).length
        bark = sp['bark']
        def sides_of(r):
            return 7 if r > 0.1 else 5 if r > 0.055 else 4
        def ring(i, d, r=None, sides=None, cache=True):
            if cache and i in ring_of:
                return ring_of[i]
            r = max(radius[i], 0.012) * 1.2 if r is None else r
            sides = sides_of(r) if sides is None else sides
            a = d.orthogonal().normalized(); b = d.cross(a).normalized()
            base = len(bv) // 3
            tone = rnd.uniform(0.85, 1.1)
            for k in range(sides + 1):   # (the seam doubled: the bark's u wraps round)
                t = k / sides * math.tau
                n = a * math.cos(t) + b * math.sin(t)
                p = nodes[i] + n * r
                bv.extend(p); bn.extend(n)
                bu.extend([k / sides * max(0.3, math.tau * r), along[i]])
                # pine: grey-brown low, orange-red up the stem
                c = bark
                if sname == 'pine' and nodes[i].z > 2.0:
                    c = (0.62, 0.3, 0.17)
                # (the scanned bark carries the colour: a tone per ring, a warm cast up a pine)
                warm = (1.25, 0.9, 0.75) if (sname == 'pine' and nodes[i].z > 2.0) else (1.0, 1.0, 1.0)
                bc.extend([min(255, int(255 * tone * w_ * (0.9 + 0.15 * rnd.random()))) for w_ in warm])
            if cache:
                ring_of[i] = (base, sides)
            return (base, sides)
        for i in range(1, len(nodes)):
            if not keep[i]:
                continue
            p = up_to_kept(parent[i])
            d = nodes[i] - nodes[p]
            if d.length < 1e-4:
                continue
            d.normalize()
            a1, s1 = ring(i, d)
            # The thickest kept child carries its parent's ring on; a side branch (or a change
            # of ring size) starts a ring of its own at the parent, at its own thickness, and
            # grows out of the stem as branches do.
            main = main_child.get(p)
            if main == i and p in ring_of and ring_of[p][1] == s1:
                a0, s0 = ring_of[p]
            else:
                r_start = (max(radius[p], 0.012) * 1.2) if main == i else max(radius[i], 0.012) * 1.25
                a0, s0 = ring(p, d, r=r_start, sides=s1, cache=False)
            for k in range(s1):
                bi.extend([a0 + k, a0 + k + 1, a1 + k + 1, a0 + k, a1 + k + 1, a1 + k])
        return bv, bn, bc, bi, bu
    bv, bn, bc, bi, bu = bark_mesh(0.04)
    lod_bark = bark_mesh(0.1)
    # ---- foliage: leafy twigs at the ends of the branches, pointing on out of them, rolled at
    # random about their own stems; lighter outside the crown than inside
    count = TWIGS[sname]
    tips = [i for i in range(len(nodes)) if radius[i] < 0.035 and nodes[i].z > sp['trunk'] * 0.9] or list(range(1, len(nodes)))
    recs = []
    top = max(n.z for n in nodes)
    stemL = TWIG[sname][2] * TWIG_SCALE.get(sname, 1.0)
    for q in range(count):
        i = tips[rnd.randrange(len(tips))]
        grow_dir = (nodes[i] - nodes[parent[i]]) if parent[i] >= 0 else Vector((0, 0, 1))
        grow_dir = grow_dir.normalized() if grow_dir.length > 1e-5 else Vector((0, 0, 1))
        out = (nodes[i] - crown_c); out.z *= 0.5
        out = out.normalized() if out.length > 1e-3 else Vector((0, 0, 1))
        ax = (grow_dir * 0.5 + out * 0.5 + Vector((rnd.gauss(0, 0.45), rnd.gauss(0, 0.45), rnd.gauss(0, 0.35) - 0.1))).normalized()
        roll = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1)))
        side = ax.cross(roll).normalized()
        L = stemL * rnd.uniform(0.8, 1.2) / 0.6 * TWIG_H   # (the frame is TWIG_H tall for a stemL twig)
        c = nodes[i] + Vector((rnd.gauss(0, 0.08), rnd.gauss(0, 0.08), rnd.gauss(0, 0.06)))
        n_shade = (out * 0.75 + Vector((0, 0, 0.4))).normalized()
        hf = min(1.0, max(0.0, (c.z - sp['trunk']) / max(0.3, top - sp['trunk'])))
        edge = sp['envelope'](hf)
        depth = max(0.0, min(1.0, Vector((c.x, c.y)).length / max(0.2, edge)))
        lit = 0.55 + 0.45 * depth ** 1.3 + 0.15 * hf
        tone = [min(255, int(255 * lit * rnd.uniform(0.9, 1.08))) for _ in range(3)]
        k = rnd.randrange(2)
        recs.append((c, side * L * 0.25, ax * L, n_shade, tone, 128 + TWIG_ORDER.index(f'{sname}_{k}')))
    return (np.array(bv, np.float32), np.array(bn, np.float32), np.array(bc, np.uint8), np.array(bi, np.uint32), np.array(bu, np.float32), recs,
            [np.array(x, t) for x, t in zip(lod_bark, (np.float32, np.float32, np.uint8, np.uint32, np.float32))])


def flower_bed(spec, rnd):
    """A clump of flowers: leaves low, heads by the species' form and layout; no bark."""
    rgb, form, size, layout, height = spec
    recs = []
    def quad(center, ax, side, L, r, col, nrm):
        recs.append((center, side * L * 0.5, ax * L, Vector(nrm), [min(255, int(c)) for c in col], RECT_OF(r)))
    leafR = 0.14 if layout != 'ball' else 0.32
    for _ in range(40 if layout != 'ball' else 70):
        c = Vector((rnd.gauss(0, leafR * 0.8), rnd.gauss(0, leafR * 0.8), rnd.uniform(0.0, height * (0.35 if layout in ('mound', 'upright') else 0.6))))
        ax = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.uniform(0.3, 1.2) if layout != 'upright' else rnd.uniform(1.5, 3))).normalized()
        side = ax.cross(Vector((0, 0, 1))).normalized() if abs(ax.z) < 0.99 else Vector((1, 0, 0))
        r = PHOTO['leaves'][rnd.randrange(len(PHOTO['leaves']))]
        L = (0.09 if layout != 'ball' else 0.16) * rnd.uniform(0.8, 1.2) * (1.6 if layout == 'upright' else 1)
        quad(c, ax, side, L, r, [255 * 0.62 * ch / max(0.05, av) for ch, av in zip((0.11, 0.22, 0.06), r['avg'])], (ax + Vector((0, 0, 1))).normalized())
    hr = HEAD_RECT[form]
    heads = {'mound': 26, 'tall': 9, 'upright': 7, 'spike': 8, 'ball': 7}[layout]
    for _ in range(heads):
        tone = rnd.uniform(0.85, 1.05)
        col = [255 * ch * tone * 0.92 for ch in rgb]
        if layout == 'spike':
            # an upright spike of small florets: crossed narrow cards up a stem
            c = Vector((rnd.gauss(0, 0.07), rnd.gauss(0, 0.07), height * rnd.uniform(0.45, 0.6)))
            yaw = rnd.uniform(0, math.pi)
            for k in range(2):
                side = Vector((math.cos(yaw + k * math.pi / 2), math.sin(yaw + k * math.pi / 2), 0))
                quad(c, Vector((0, 0, 1)), side * 0.35, height * 0.45, hr, col, (0, 0, 1))
            continue
        if layout == 'ball':
            c = Vector((rnd.gauss(0, 0.2), rnd.gauss(0, 0.2), height * rnd.uniform(0.65, 0.95)))
        else:
            z = height * (rnd.uniform(0.75, 1.0) if layout != 'mound' else rnd.uniform(0.6, 1.0))
            c = Vector((rnd.gauss(0, 0.1 if layout == 'mound' else 0.08), rnd.gauss(0, 0.1 if layout == 'mound' else 0.08), z))
        if form == 'bell':
            yaw = rnd.uniform(0, math.pi)
            for k in range(2):
                side = Vector((math.cos(yaw + k * math.pi / 2), math.sin(yaw + k * math.pi / 2), 0))
                quad(c - Vector((0, 0, size * 0.5)), Vector((0, 0, 1)), side, size * 1.2, hr, col, (0, 0, 1))
            continue
        # a head facing up, tilted a little; balls get a crossing card as well
        tilt = Vector((rnd.gauss(0, 0.25), rnd.gauss(0, 0.25), 1)).normalized()
        a_ = tilt.orthogonal().normalized(); b_ = tilt.cross(a_).normalized()
        quad(c - b_ * size * 0.5, b_, a_, size, hr, col, tuple(tilt))
        if layout == 'ball':
            quad(c - Vector((0, 0, size * 0.5)), Vector((0, 0, 1)), Vector((1, 0, 0)), size, hr, col, (0, 0, 1))
    e = np.zeros(0, np.float32)
    return (e, e, np.zeros(0, np.uint8), np.zeros(0, np.uint32), e, recs, None)

# ---- meshes -> trees.bin / trees.json
blob = bytearray()
meta = {'species': names, 'variants': []}
def put(arr):
    global blob
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob += arr.tobytes()
    return off
for name in TWIG_ORDER:
    sn, k = name.rsplit('_', 1)
    render_twig(sn, SPECIES[sn], int(k))
(work / 'twigs.json').write_text(json.dumps(TWIG_ORDER))
ALL = list(SPECIES.items()) + [(f, None) for f in FLOWERS]
meta['species'] = [n for n, _ in ALL]
for sname, sp in ALL:
    for v in VARIANTS:
        rnd = random.Random(f'mesh-{sname}-{v}')
        bv, bn, bc, bi, bu, recs, lod = mesh_tree(sname, sp, rnd) if sp else flower_bed(FLOWERS[sname], rnd)
        # a leaf: base (f16 x3), across and along half-extents (f16 x3 each), shading normal
        # (i8 x3 + pad), tint (u8 x3 + pad), its atlas rectangle (u8 + pad): 32 bytes
        rec = np.zeros(len(recs), dtype=[('p', '<f2', 3), ('w', '<f2', 3), ('h', '<f2', 3), ('n', 'i1', 4), ('c', 'u1', 4), ('r', 'u1', 4), ('pad', 'u1', 2)])
        for j, (bp, wv, hv, ns, tint, ri) in enumerate(recs):
            rec[j] = (tuple(bp), tuple(wv), tuple(hv), (*[int(round(x * 127)) for x in ns], 0), (*tint, 255), (ri, 0, 0, 0), (0, 0))
        lv = np.array([list(r[0]) for r in recs] or [[0, 0, 0]], np.float32)
        q = lambda n: np.clip(np.round(n.reshape(-1, 3) * 127), -127, 127).astype(np.int8)
        nb = np.concatenate([q(bn), np.zeros((len(bn) // 3, 1), np.int8)], 1)
        cb = np.concatenate([bc.reshape(-1, 3), np.full((len(bc) // 3, 1), 255, np.uint8)], 1)

        all_p = np.concatenate([bv.reshape(-1, 3), lv.reshape(-1, 3)])

        entry = dict(species=sname, variant=v, height=round(float(all_p[:, 2].max()), 3), width=round(float(np.ptp(all_p[:, :2], 0).max()), 3),
                     bark=dict(verts=len(bv) // 3, index=len(bi), pos=put(bv), nor=put(nb), col=put(cb), uv=put(bu), idx=put(bi.astype(np.uint16) if len(bv) // 3 < 65536 else bi)),
                     leaves=dict(count=len(recs), rec=put(rec)))
        if lod is not None and len(lod[0]):
            lbv, lbn, lbc, lbi, lbu = lod
            entry['barkLod'] = dict(verts=len(lbv) // 3, index=len(lbi), pos=put(lbv), nor=put(np.concatenate([q(lbn), np.zeros((len(lbn) // 3, 1), np.int8)], 1)),
                                    col=put(np.concatenate([lbc.reshape(-1, 3), np.full((len(lbc) // 3, 1), 255, np.uint8)], 1)), uv=put(lbu), idx=put(lbi.astype(np.uint16)))
        meta['variants'].append(entry)
        print('mesh', sname, v, 'bark tris', len(bi) // 3, 'leaves', len(recs), 'h', entry['height'], flush=True)
(public / 'trees.bin').write_bytes(bytes(blob))
meta['twigs'] = TWIG_ORDER
meta['rects'] = [[round(r['x'], 5), round(1 - r['y'] - r['h'], 5), round(r['x'] + r['w'], 5), round(1 - r['y'], 5)] for r in RECTS]
(public / 'trees.json').write_text(json.dumps(meta, separators=(',', ':')))
print('trees.bin', len(blob), 'bytes')
