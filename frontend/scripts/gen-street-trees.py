"""Street trees of Korean roads, grown procedurally for the plant atlas.

Run inside Blender (tested with 5.2):
  blender -b --factory-startup -P frontend/scripts/gen-street-trees.py -- <out_dir>
Writes <out_dir>/<species>_<variant>.glb, one tree each, then bake them as the other cells:
  blender -b --factory-startup -P frontend/scripts/bake-plants.py -- <bake_dir> <out_dir>/*.glb
  python frontend/scripts/bake-plants-pack.py <bake_dir> ginkgo_a:street ...
  python frontend/scripts/plants-bc7.py

Each tree is grown by space colonisation (Runions et al. 2007): attraction points fill the
species' crown envelope and the skeleton grows toward them, so the silhouette and the
branching follow the species (a ginkgo's narrow cone, a zelkova's vase, a cherry's spread,
a plane's big dome, a fringe tree's ball). Branch radii by the pipe model; leaves as small
coloured quads clustered on the twigs (a whole tree is one 320 px cell: the crown's
texture, not single leaves, is what reads). CC0, made here.
"""
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['.']
out = Path(args[0])

# Crown envelope: max radius (m) at height fraction h through the crown (0 base, 1 top).
SPECIES = {
    # 은행나무: young street ginkgos are narrow cones with tiers of upright branches
    'ginkgo': dict(height=10.5, trunk=3.0, envelope=lambda h: 2.3 * (1 - h) ** 0.85 + 0.2, points=900, up=0.35,
                   leaf=(0.2, 0.16), leaf_rgb=(0.46, 0.6, 0.12), leaf_var=0.1, per_twig=14, bark=(0.33, 0.29, 0.25), sparse=0.25),
    # 느티나무: vase — branches rise and spread from a short trunk into a broad fine crown
    'zelkova': dict(height=10.0, trunk=2.4, envelope=lambda h: (1.2 + 4.0 * math.sqrt(h)) * (1 - max(0.0, h - 0.8) ** 2 * 6), points=1300, up=0.12,
                    leaf=(0.1, 0.07), leaf_rgb=(0.3, 0.4, 0.1), leaf_var=0.08, per_twig=26, bark=(0.42, 0.4, 0.37), sparse=0.0),
    # 벚나무: wide spreading crown on a short trunk, dark bark
    'cherry': dict(height=7.5, trunk=1.9, envelope=lambda h: 4.2 * math.sqrt(max(0.0, 1 - ((h - 0.38) / 0.62) ** 2)), points=1100, up=0.05,
                   leaf=(0.13, 0.08), leaf_rgb=(0.27, 0.36, 0.1), leaf_var=0.08, per_twig=20, bark=(0.2, 0.15, 0.13), sparse=0.05),
    # 양버즘나무(플라타너스): tall trunk, big rounded dome, large leaves, pale mottled bark
    'plane': dict(height=12.0, trunk=3.4, envelope=lambda h: 4.4 * math.sin(math.pi * min(1.0, h * 0.95 + 0.05)) ** 0.7, points=1300, up=0.1,
                  leaf=(0.26, 0.24), leaf_rgb=(0.32, 0.42, 0.11), leaf_var=0.09, per_twig=12, bark=(0.62, 0.6, 0.5), sparse=0.0),
    # 이팝나무: compact round crown
    'fringe': dict(height=7.0, trunk=2.0, envelope=lambda h: 2.8 * math.sqrt(max(0.0, 1 - (2 * h - 1) ** 2)), points=900, up=0.08,
                   leaf=(0.12, 0.06), leaf_rgb=(0.29, 0.39, 0.12), leaf_var=0.08, per_twig=22, bark=(0.36, 0.33, 0.3), sparse=0.0),
}
VARIANTS = ('a', 'b')


def grow(sp, rnd):
    H, T = sp['height'], sp['trunk']
    crown = H - T
    # attraction points inside the envelope (a slightly lumpy one: no perfect solid of revolution)
    pts = []
    lump = [rnd.uniform(0.8, 1.15) for _ in range(8)]
    while len(pts) < sp['points']:
        h = rnd.random()
        r = sp['envelope'](h)
        a = rnd.random() * math.tau
        k = lump[int(a / math.tau * 8) % 8]
        d = math.sqrt(rnd.random()) * r * k
        if rnd.random() < sp['sparse'] and d < r * 0.5:
            continue  # (an open crown: few points near the axis)
        pts.append(Vector((math.cos(a) * d, math.sin(a) * d, T + h * crown)))
    # skeleton: nodes (position, parent)
    nodes = [Vector((0, 0, 0))]
    parent = [-1]
    step = 0.28
    # the trunk up to the crown
    while nodes[-1].z < T:
        nodes.append(nodes[-1] + Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), step)))
        parent.append(len(nodes) - 2)
    influence, kill = 2.4, 0.55
    alive = list(range(len(pts)))
    for _ in range(160):
        if not alive:
            break
        kd = KDTree(len(nodes))
        for i, n in enumerate(nodes):
            kd.insert(n, i)
        kd.balance()
        pull = {}
        still = []
        for ai in alive:
            p = pts[ai]
            co, idx, dist = kd.find(p)
            if dist < kill:
                continue
            still.append(ai)
            if dist < influence:
                pull.setdefault(idx, Vector()).__iadd__((p - co).normalized())
        alive = still
        if not pull:
            break
        for idx, v in pull.items():
            d = (v.normalized() + Vector((0, 0, sp['up']))).normalized()
            nodes.append(nodes[idx] + d * step)
            parent.append(idx)
    # pipe model radii from the tips down
    n = len(nodes)
    children = [[] for _ in range(n)]
    for i in range(1, n):
        children[parent[i]].append(i)
    radius = [0.0] * n
    for i in range(n - 1, -1, -1):
        radius[i] = 0.016 if not children[i] else sum(radius[c] ** 2.15 for c in children[i]) ** (1 / 2.15)
    return nodes, parent, children, radius


def build(name, sp, rnd):
    nodes, parent, children, radius = grow(sp, rnd)
    verts, faces, cols_bark = [], [], []
    SIDES = 6
    ring = {}

    def ring_at(i, direction):
        if i in ring:
            return ring[i]
        c, r = nodes[i], max(radius[i], 0.01) * 1.15
        a = direction.orthogonal().normalized()
        b = direction.cross(a).normalized()
        base = len(verts)
        for k in range(SIDES):
            t = k / SIDES * math.tau
            verts.append(c + (a * math.cos(t) + b * math.sin(t)) * r)
        ring[i] = base
        return base

    for i in range(1, len(nodes)):
        if radius[i] < 0.018 and children[i]:
            pass
        p = parent[i]
        d = (nodes[i] - nodes[p])
        if d.length < 1e-5:
            continue
        d.normalize()
        a0, a1 = ring_at(p, d), ring_at(i, d)
        for k in range(SIDES):
            faces.append((a0 + k, a0 + (k + 1) % SIDES, a1 + (k + 1) % SIDES, a1 + k))
    bark = bpy.data.meshes.new(name + '_bark')
    bark.from_pydata([tuple(v) for v in verts], [], faces)
    bark.update()
    # leaves on the twigs
    lv, lf, lc = [], [], []
    base_rgb = sp['leaf_rgb']
    for i in range(1, len(nodes)):
        if radius[i] > 0.05 or nodes[i].z < sp['trunk'] * 0.95:
            continue
        count = int(sp['per_twig'] * 1.7) if not children[i] else sp['per_twig'] // 2
        for _ in range(count):
            c = nodes[i] + Vector((rnd.gauss(0, 0.26), rnd.gauss(0, 0.26), rnd.gauss(0, 0.2)))
            w, h = sp['leaf'][0] * 0.62 * rnd.uniform(0.8, 1.25), sp['leaf'][1] * 0.62 * rnd.uniform(0.8, 1.25)
            nrm = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), abs(rnd.gauss(0, 1)) + 0.6)).normalized()
            a = nrm.orthogonal().normalized()
            b = nrm.cross(a).normalized()
            k = len(lv)
            # a pointed leaf blade: stalk end, two shoulders, tip, two lower shoulders
            lv += [c - b * h, c - b * h * 0.2 + a * w, c + b * h * 0.5 + a * w * 0.7, c + b * h * 1.3,
                   c + b * h * 0.5 - a * w * 0.7, c - b * h * 0.2 - a * w]
            lf.append((k, k + 1, k + 2, k + 3, k + 4, k + 5))
            v = sp['leaf_var']
            # Crown depth: leaves deep inside (near the axis, low in the crown) get less light
            # (the self-shadow a leaf-card bake otherwise lacks); outer, upper ones catch it.
            hf = min(1.0, max(0.0, (c.z - sp['trunk']) / max(1.0, sp['height'] - sp['trunk'])))
            edge = sp['envelope'](hf)
            depth = max(0.0, min(1.0, c.xy.length / max(0.3, edge)))
            lit = 0.3 + 0.62 * depth ** 1.6 + 0.22 * hf
            # (as dark and olive as the photoscanned cells beside them in the atlas)
            col = tuple(max(0.0, min(1.0, ch * 0.34 * lit * (1 + rnd.uniform(-v, v) * 1.6))) for ch in base_rgb)
            lc.append(col)
    leaves = bpy.data.meshes.new(name + '_leaves')
    leaves.from_pydata([tuple(v) for v in lv], [], lf)
    leaves.update()
    attr = leaves.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly, col in zip(leaves.polygons, lc):
        for li in poly.loop_indices:
            attr.data[li].color = (*col, 1.0)
    # materials
    mb = bpy.data.materials.new(name + '_bark')
    mb.use_nodes = True
    bsdf = mb.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*(c * 0.45 for c in sp["bark"]), 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    bark.materials.append(mb)
    ml = bpy.data.materials.new(name + '_leaf')
    ml.use_nodes = True
    nt = ml.node_tree
    bsdf = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.75
    leaves.materials.append(ml)
    root = bpy.data.objects.new(name, bark)
    bpy.context.scene.collection.objects.link(root)
    lo = bpy.data.objects.new(name + '_foliage', leaves)
    lo.parent = root
    bpy.context.scene.collection.objects.link(lo)
    return root, lo


def main():
  out.mkdir(parents=True, exist_ok=True)
  for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
  for sname, sp in SPECIES.items():
      for vi, v in enumerate(VARIANTS):
          rnd = random.Random(hash((sname, v)) & 0xffffffff)
          rnd.seed(f'{sname}-{v}')
          root, leaf = build(f'{sname}_{v}', sp, rnd)
          for o in bpy.data.objects:
              o.select_set(o in (root, leaf))
          bpy.context.view_layer.objects.active = root
          path = out / f'{sname}_{v}.glb'
          bpy.ops.export_scene.gltf(filepath=str(path), use_selection=True, export_format='GLB', export_yup=True)
          print('tree', sname, v, 'verts', len(root.data.vertices) + len(leaf.data.vertices), flush=True)
          for o in (leaf, root):
              bpy.data.objects.remove(o, do_unlink=True)


if __name__ == '__main__' and '--mesh' not in sys.argv:
    main()
