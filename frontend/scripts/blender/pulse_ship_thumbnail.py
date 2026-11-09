"""Render the pulse-board ship for its share thumbnail (transparent PNG).

    blender -b -P frontend/scripts/blender/pulse_ship_thumbnail.py -- <ship.glb> <out.png>

Placards get decorative neon panels instead of company marks: share art never shows
real logos or market numbers. A holdout sea plane cuts the hull at the waterline.
"""
import math
import random
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)

NEON = [(.75, .45, 1.), (.25, .85, 1.), (1., .55, .25), (1., .35, .6), (.4, .6, 1.)]
for obj in scene.objects:
    if obj.type == "MESH" and obj.name.startswith("LogoPlate"):
        mat = bpy.data.materials.new(obj.name + "_art")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        color = random.choice(NEON)
        bsdf.inputs["Base Color"].default_value = (*[c * .35 for c in color], 1)
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.6
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if obj.type == "MESH" and obj.name == "HullName":
        obj.hide_render = True

# the sea surface: a holdout plane at the waterline keeps only what floats above it
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -1.2))
sea = bpy.context.active_object
hold = bpy.data.materials.new("sea_holdout")
hold.use_nodes = True
nodes = hold.node_tree.nodes
nodes.clear()
out = nodes.new("ShaderNodeOutputMaterial")
holdout = nodes.new("ShaderNodeHoldout")
hold.node_tree.links.new(holdout.outputs[0], out.inputs[0])
sea.data.materials.append(hold)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.data.lens = 46
cam.location = (13.5, -29, 7.2)
cam.rotation_euler = (Vector((1.5, 0, .9)) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

for name, energy, rot, color in (("key", 3.2, (52, 0, -40), (1, .95, .9)), ("rim", 2.6, (60, 0, 150), (.75, .5, 1.))):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
    light.data.energy, light.data.color = energy, color
    light.rotation_euler = tuple(math.radians(v) for v in rot)
    scene.collection.objects.link(light)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (.06, .04, .1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
scene.world = world
for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 2400, 1260
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("rendered", OUT)
