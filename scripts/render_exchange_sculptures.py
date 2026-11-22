"""Studio renders of the atrium's sculptures for the browser's art viewer.

    blender -b --factory-startup --python scripts/render_exchange_sculptures.py -- <sources>

Writes frontend/public/3d/exchange-floor/art/sculpture-<id>.webp (1,400 px) for each Poly Haven
sculpture in frontend/src/exchange/art.json: soft three-point light on a seamless grey sweep.
"""
import json
from math import radians
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ART = json.loads((ROOT / "frontend/src/exchange/art.json").read_text(encoding="utf-8"))
OUT = ROOT / "frontend/public/3d/exchange-floor/art"


def studio():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception:
        pass
    scene.cycles.samples = 160
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x = scene.render.resolution_y = 1400
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.02, .02, .025, 1)
    scene.world = world
    # Seamless sweep.
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    floor = bpy.context.active_object
    m = bpy.data.materials.new("Sweep")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.09, .09, .1, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = .6
    floor.data.materials.append(m)
    for name, loc, energy, size in (("Key", (2.5, -2.5, 3.2), 900, 2.5), ("Fill", (-3, -1.5, 2), 260, 3.5), ("Rim", (0, 3, 3.5), 700, 2)):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size = energy, size
        obj = bpy.data.objects.new(name, light)
        obj.location = loc
        bpy.context.collection.objects.link(obj)
        direction = Vector((0, 0, .6)) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render(source, key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    studio()
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / key / f"{key}.gltf"))
    meshes = [o for o in set(bpy.context.scene.objects) - before if o.type == "MESH"]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = max(hi - lo)
    scale = 1.2 / size
    for o in set(bpy.context.scene.objects) - before:
        if o.parent is None:
            o.location = (o.location - Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))) * scale
            o.scale = o.scale * scale
    h = (hi.z - lo.z) * scale
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.6, -3.4, h * .6 + .35)
    target = Vector((0, 0, h * .48))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    png = OUT / f"sculpture-{key}.png"
    bpy.context.scene.render.filepath = str(png)
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return png


if __name__ == "__main__":
    src = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    for key in ART["sculptures"]:
        if (src / key).exists():
            print("rendered", render(src, key), flush=True)
