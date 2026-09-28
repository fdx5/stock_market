"""Bake tree impostor cells for the 3D complex view's plant atlas (public/3d/plants.*).

Run inside Blender (tested with 5.2):
  blender -b --factory-startup -P frontend/scripts/bake-plants.py -- <out_dir> <model.gltf>...
Each root object of a glTF (a Poly Haven CC0 model; some hold several variants) is
rendered from the side and from above with an orthographic camera on a transparent
background, 2x the cell size. Writes <out_dir>/<object>_side.png, _top.png and
cells.json with the metrics scenePlants.ts reads (span, topSpan, groundV, height, width).
The PNGs are then packed into the atlas by bake-plants-pack.py.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out = Path(args[0])
out.mkdir(parents=True, exist_ok=True)
RES = 640  # the atlas cell is 320 px
MARGIN = 3 / 320  # same ground margin as the existing cells (groundV 0.0098)

scene = bpy.context.scene
# (the factory scene's cube, camera and light)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE_NEXT'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
# Soft daylight like the existing cells: sky fill plus a sun from the upper left.
world = bpy.data.worlds.new('bake') if not scene.world else scene.world
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.85, 0.9, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.75
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 2.2
scene.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
scene.collection.objects.link(cam)
scene.camera = cam

cells = json.loads((out / 'cells.json').read_text()) if (out / 'cells.json').exists() else {}


def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


for path in args[1:]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None and o.type in ('MESH', 'EMPTY')]
    for root in roots:
        tree = [root] + list(root.children_recursive)
        for o in new:
            o.hide_render = o not in tree
        lo, hi = bounds(tree)
        size = hi - lo
        # Blender is Z up: height = z, the crown's footprint = x / y.
        height, width = size.z, max(size.x, size.y)
        cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
        # Side: looking along +y, the square frame spans the larger of height and width.
        span = max(height / (1 - 2 * MARGIN), width) * 1.02
        cam.data.ortho_scale = span
        ground_v = MARGIN
        cam.location = (cx, lo.y - 50, lo.z - ground_v * span + span / 2)
        cam.rotation_euler = (math.pi / 2, 0, 0)
        sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
        name = root.name.replace('_LOD0', '')
        scene.render.filepath = str(out / f'{name}_side.png')
        bpy.ops.render.render(write_still=True)
        # Top: straight down.
        top_span = max(size.x, size.y) * 1.04
        cam.data.ortho_scale = top_span
        cam.location = (cx, cy, hi.z + 50)
        cam.rotation_euler = (0, 0, 0)
        sun.rotation_euler = (math.radians(35), 0, math.radians(-35))
        scene.render.filepath = str(out / f'{name}_top.png')
        bpy.ops.render.render(write_still=True)
        cells[name] = dict(span=round(span, 4), topSpan=round(top_span, 4), groundV=round(ground_v, 4), height=round(height, 4), width=round(width, 4))
        print('baked', name, cells[name], flush=True)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for b in list(block):
            if not b.users:
                block.remove(b)
    (out / 'cells.json').write_text(json.dumps(cells, indent=1))
