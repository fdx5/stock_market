"""Generate KOSPIMAP's trading hall in Blender, then export its static glTF scene."""
import argparse
from collections import defaultdict
import json
from math import cos, pi, radians, sin
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = json.loads((ROOT / "frontend/src/exchange/layout.json").read_text(encoding="utf-8"))
BATCH = defaultdict(list)


def material(name, color, roughness, metal=0, energy=0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1)
    value.use_nodes = True
    pbr = value.node_tree.nodes.get("Principled BSDF")
    pbr.inputs["Base Color"].default_value = (*color, 1)
    pbr.inputs["Roughness"].default_value = roughness
    pbr.inputs["Metallic"].default_value = metal
    if energy:
        pbr.inputs["Emission Color"].default_value = (*color, 1)
        pbr.inputs["Emission Strength"].default_value = energy
    return value


def pbr(root, key, label, roughness, metal, strength):
    value = material(label, (.12, .11, .14), roughness, metal)
    nodes, links = value.node_tree.nodes, value.node_tree.links
    shader = nodes.get("Principled BSDF")
    for channel, socket in (("color", "Base Color"), ("roughness", "Roughness"), ("normal", "Normal")):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(root / f"{key}-{channel}.jpg"), check_existing=True)
        if channel != "color":
            node.image.colorspace_settings.name = "Non-Color"
        if channel == "normal":
            normal = nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = strength
            links.new(node.outputs["Color"], normal.inputs["Color"])
            links.new(normal.outputs["Normal"], shader.inputs[socket])
        else:
            links.new(node.outputs["Color"], shader.inputs[socket])
    return value


def mesh_object(name, vertices, polygons, mat, zone, tile, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], polygons)
    data.update()
    if bevel:
        mesh = bmesh.new()
        mesh.from_mesh(data)
        bmesh.ops.bevel(mesh, geom=list(mesh.edges), offset=bevel, segments=2, affect="EDGES")
        mesh.to_mesh(data)
        mesh.free()
        data.update()
    uv = data.uv_layers.new(name="Surface")
    for face in data.polygons:
        normal = face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        u, v = ((1, 2), (0, 2), (0, 1))[axis]
        for idx in face.loop_indices:
            co = data.vertices[data.loops[idx].vertex_index].co
            uv.data[idx].uv = (co[u] / tile, co[v] / tile)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    BATCH[(zone, mat.name)].append(obj)
    return obj


def box(name, x, y, z, width, height, depth, mat, zone, *, bevel=0, yaw=0, tile=1):
    a, b, c = width / 2, depth / 2, height / 2
    vertices = [(-a, -b, -c), (a, -b, -c), (a, b, -c), (-a, b, -c),
                (-a, -b, c), (a, -b, c), (a, b, c), (-a, b, c)]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    result = mesh_object(name, vertices, faces, mat, zone, tile, bevel)
    result.location = (x, -z, y)
    result.rotation_euler.z = radians(yaw)
    return result


def disc(name, x, y, z, radius, height, mat, zone, sides=12, ratio=1, bevel=0):
    verts = [(cos(i * 2 * pi / sides + pi / sides) * radius, sin(i * 2 * pi / sides + pi / sides) * radius * ratio, lift)
             for lift in (-height / 2, height / 2) for i in range(sides)]
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    faces += [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
    result = mesh_object(name, verts, faces, mat, zone, 1.4, bevel)
    result.location = (x, -z, y)
    return result


def import_prop(source, identifier, placements):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(source / identifier / f"{identifier}.gltf"))
    imported = set(bpy.context.scene.objects) - before
    bpy.context.view_layer.update()
    meshes = [(obj, obj.matrix_world.copy()) for obj in imported if obj.type == "MESH"]
    for idx, (x, z, yaw) in enumerate(placements):
        transform = Matrix.Translation((x, -z, 0)) @ Matrix.Rotation(radians(yaw), 4, "Z")
        for src, world in meshes:
            duplicate = bpy.data.objects.new(f"Lounge {identifier} {idx + 1}", src.data)
            bpy.context.collection.objects.link(duplicate)
            duplicate.matrix_world = transform @ world
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)


def build(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = source / "materials"
    marble = pbr(materials, "marble", "Smoke marble", .25, .05, .16)
    wood = pbr(materials, "walnut", "Oiled smoked walnut", .44, 0, .24)
    steel = pbr(materials, "steel", "Brushed graphite steel", .29, .72, .12)
    leather = pbr(materials, "leather", "Anthracite leather", .62, 0, .34)
    carpet = pbr(materials, "carpet", "Quiet charcoal carpet", .9, 0, .29)
    plaster = pbr(materials, "plaster", "Mineral plaster", .61, 0, .22)
    brass = material("Pale brushed brass", (.46, .25, .105), .33, .76)
    black = material("Black ceramic", (.016, .019, .028), .41, .24)
    glass = material("Smoky black glass", (.025, .035, .055), .18, .54)
    window = material("Indigo clerestory glazing", (.061, .108, .224), .29, .18, .73)
    amber = material("Warm recessed light", (1, .71, .34), .42, 0, 2.2)
    white = material("Ceiling softbox diffuser", (.94, .86, .74), .38, 0, 2.6)
    cyan = material("Exchange cyan inlay", (.065, .68, .93), .35, .07, 1.7)
    blue = material("Deep violet side light", (.29, .18, .65), .39, 0, 1.35)
    seam = material("Stone joints", (.045, .042, .049), .74)
    room = LAYOUT["room"]
    width, depth, ceiling = room["width"], room["depth"], room["height"]

    box("Structural floor", 0, -.14, 0, width, .25, depth, seam, "floor")
    for i in range(8):
        for j in range(7):
            dx, dz = width / 8, depth / 7
            box("Honed stone slab", (i - 3.5) * dx, -.028, (j - 3) * dz,
                dx - .018, .055, dz - .018, marble, "floor", tile=dx * 1.2)
    for x in (-1.48, 1.48):
        box("Flush brass aisle inlay", x, .002, 0, .022, .004, depth - 1.5, brass, "floor")
    for z in (-8.8, 8.65):
        box("Threshold inlay", 0, .003, z, 24.3, .005, .027, brass, "floor")
    box("Raised presentation platform", 0, .14, -11.02, 23.5, .28, 1.55, marble, "north", bevel=.035)
    box("Stage footlight", 0, .078, -10.235, 22.7, .026, .026, cyan, "north")
    box("Main exchange wall", 0, 6.4, -11.94, 28.4, 12.8, .55, plaster, "north", tile=2.2)
    box("Lobby wall", 0, 6.4, 12, 28.4, 12.8, .45, plaster, "south", tile=2.2)
    for x, width in ((0, 11.65), (-8.7, 5.15), (8.7, 5.15)):
        box("Walnut market-wall panel", x, 4.15, -11.61, width, 6.9, .14, wood, "north", bevel=.045, tile=2.8)
        box("Market wall brass baseline", x, .76, -11.53, width, .027, .038, brass, "north")
        box("Market wall upper brass trim", x, 7.62, -11.52, width, .028, .04, brass, "north")
    box("Raised ticker fascia", 0, 8.32, -11.58, 24.92, .79, .2, steel, "north", bevel=.043)
    for x in (-10.1, -8.9, -7.7, 7.7, 8.9, 10.1):
        box("Marquee wall vertical rib", x, 10.04, -11.62, .063, 1.95, .08, brass, "north", bevel=.018)
    for side in (-1, 1):
        wing = "west" if side < 0 else "east"
        wall_x = 14 * side
        box("Clerestory side wall", wall_x, 6.4, 0, .38, 12.8, 24, plaster, wing, tile=2.4)
        box("Timber plinth", wall_x - side * .21, 1.05, 0, .15, 2.05, 23.7, wood, wing, tile=1.8)
        box("Low brass reveal", wall_x - side * .295, 2.11, 0, .025, .034, 23.65, brass, wing)
        box("Clerestory ledge", wall_x - side * .32, 7.11, 0, .57, .32, 23.7, steel, wing, bevel=.035)
        for i, z in enumerate((-9.55, -5.7, -1.9, 1.9, 5.7, 9.55)):
            x = wall_x - side * .25
            box("Tall stone pilaster", x, 5.9, z, .7, 11.8, .47, plaster, wing, bevel=.065, tile=1.55)
            box("Pilaster gold stile", x - side * .36, 5.7, z, .045, 10.3, .087, brass, wing)
            box("Pilaster accent light", x - side * .37, 3.4, z + .18, .022, 4.9, .03, blue, wing)
            box("Column foot", x - side * .06, .22, z, 1, .42, .71, marble, wing, bevel=.04)
            if i < 5:
                bay = z + 1.9
                box("Deep window recess", wall_x - side * .23, 9.8, bay, .19, 4.48, 3.36, black, wing, bevel=.03)
                box("Clerestory pane", wall_x - side * .35, 9.8, bay, .15, 4.17, 3.07, window, wing)
                for rail_z in (-1.05, 0, 1.05):
                    box("Window mullion", wall_x - side * .45, 9.8, bay + rail_z, .12, 4.25, .052, steel, wing)
                for height in (8.56, 9.8, 11.15):
                    box("Window horizontal bar", wall_x - side * .45, height, bay, .11, .055, 3.16, steel, wing)
        for i in range(20):
            box("Slatted gallery apron", wall_x - side * .46, 6.7, 9.7 - i * 1.03, .27, .49, .08, wood, wing)

    for x in (-11.75, -5.9, 5.9, 11.75):
        for z, zone in ((-11.43, "north"), (11.49, "south")):
            box("Engaged bronze column", x, 6.15, z, .48, 12.3, .46, steel, zone, bevel=.045)
            box("Tall illuminated brass spine", x, 6.2, z + (.25 if z < 0 else -.25),
                .064, 11.25, .047, amber, zone)
    for x in (-9.8, -5, 0, 5, 9.8):
        box("Lobby portal dark glazing", x, 2.45, 11.66, 4.15, 4.9, .14, glass, "south", bevel=.085)
        box("Lobby transom", x, 5, 11.52, 4.19, .072, .13, brass, "south")
    box("Upper ceiling shell", 0, ceiling + .08, 0, 28.6, .15, 24, black, "ceiling")
    for z in (-10.2, -6.8, -3.4, 0, 3.4, 6.8, 10.2):
        box("Structural ceiling coffer", 0, 12.1, z, 27.8, .44, .32, steel, "ceiling", bevel=.035, tile=2.3)
        box("Recessed gold rib", 0, 11.86, z, 25.8, .027, .051, amber, "ceiling")
    for x in (-10.7, -6.65, 0, 6.65, 10.7):
        for z in (-8.1, -4.05, 0, 4.05, 8.1):
            length = 2.18 if x else 2.88
            box("Suspended black luminaire", x, 11.56, z, 2.7, .16, length, steel, "ceiling", bevel=.055)
            box("Luminous acoustic panel", x, 11.465, z, 2.4, .032, length - .23, white if abs(x) < 7 else amber,
                "ceiling", bevel=.012)
    for x in (-7.9, 7.9):
        box("Ceiling cable bridge", x, 10.95, 0, .16, .46, 20.7, steel, "ceiling", bevel=.04)
        box("Cable bridge cyan edge", x, 10.71, 0, .04, .025, 20.5, cyan, "ceiling")

    for idx, post in enumerate(LAYOUT["posts"]):
        x, z, zone = post["x"], post["z"], f"post-{idx + 1}"
        disc("Acoustic trading post carpet", x, .011, z, 2.5, .02, carpet, zone, 12, .88)
        disc("Graphite island kick plate", x, .115, z, 2.1, .23, black, zone, 12, .63, .04)
        disc("Smoked walnut console", x, .5, z, 2.14, .69, wood, zone, 12, .63, .035)
        disc("Brass desk reveal", x, .827, z, 2.18, .055, brass, zone, 12, .64)
        disc("Honed black desktop", x, .913, z, 2.24, .13, marble, zone, 12, .66, .05)
        disc("Post core", x, 1.23, z, .59, .61, steel, zone, 12, 1, .04)
        disc("Cyan post lettering strip", x, .765, z, 2.146, .027, cyan, zone, 12, .632)
        for s in (-1, 1):
            for dx in (-1.25, 0, 1.25):
                box("Low-profile keyboard", x + dx, .991, z + s * 1.12, .35, .026, .12, black, zone, bevel=.012)
                box("Keyboard key field", x + dx, 1.007, z + s * 1.12, .305, .008, .081, steel, zone)
                box("Mouse", x + dx + .25, 1.005, z + s * 1.11, .063, .047, .108, black, zone, bevel=.021)
            for dx in (-1.25, 1.25):
                px, pz = x + dx, z + s * 1.87
                disc("Chair steel base", px, .091, pz, .30, .045, steel, zone, 10)
                disc("Hydraulic chair column", px, .34, pz, .069, .48, steel, zone, 10)
                box("Padded executive chair seat", px, .57, pz, .57, .14, .56, leather, zone, bevel=.06)
                box("Padded executive chair back", px, .91, pz + s * .25, .54, .57, .15, leather, zone, bevel=.06)
                for arm in (-1, 1):
                    box("Chair brass support", px + arm * .27, .71, pz, .058, .24, .125, brass, zone, bevel=.021)
                    box("Chair upholstered arm", px + arm * .28, .84, pz, .088, .075, .38, leather, zone, bevel=.024)

    for i, screen in enumerate(LAYOUT["screens"]):
        x, y, z, w, h, yaw = (screen[key] for key in ("x", "y", "z", "w", "h", "yaw"))
        wall = screen["housing"] == "wall"
        theta = radians(yaw)
        front_x, front_z = sin(theta), cos(theta)
        zone = "screen-walls" if wall else f"screen-post-{i // 4}"
        bezel = .10 if wall else .035
        box("Screen milled aluminium housing", x - front_x * .11, y, z - front_z * .11, w + bezel, h + bezel, .16,
            steel, zone, bevel=.028 if wall else .019, yaw=yaw)
        box("Screen recessed black face", x - front_x * .028, y, z - front_z * .028, w + bezel * .48, h + bezel * .48,
            .018, black, zone, yaw=yaw)
        if not wall:
            box("Monitor arm", x - front_x * .15, (y + .92) / 2, z - front_z * .15, .055, y - .92, .105, steel, zone, yaw=yaw)
        box("Indicator light", x - front_x * .028, y - h / 2 - bezel * .14, z - front_z * .017,
            min(.25, w * .14), .022 if wall else .009, .014, cyan, zone, yaw=yaw)

    for side in (-1, 1):
        x, z = 10.15 * side, 7.6
        box("Lounge inset carpet", x, .008, z, 3.9, .016, 3.9, carpet, "floor", bevel=.025)
    import_prop(source, "modern_arm_chair_01", [(-11.1, 8.1, -34), (-9.2, 8.1, 34), (9.2, 8.1, -34), (11.1, 8.1, 34)])
    import_prop(source, "industrial_coffee_table", [(-10.15, 7.26, 0), (10.15, 7.26, 0)])
    import_prop(source, "potted_plant_04", [(x, z, 0) for x in (-12.9, 12.9) for z in (-8.9, 8.9)])

    combined = defaultdict(list)
    for (zone, name), objects in BATCH.items():
        section = "architecture" if not zone.startswith(("post-", "screen-post")) else "trading posts"
        combined[(section, name)].extend(objects)
    for (zone, name), objects in combined.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        objects[0].name = f"{zone} / {name}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--blend", type=Path)
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    options.output.parent.mkdir(parents=True, exist_ok=True)
    build(options.sources.resolve())
    if options.blend:
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(options.blend.resolve()))
    bpy.ops.export_scene.gltf(filepath=str(options.output.resolve()), export_format="GLB",
                             export_yup=True, export_image_format="JPEG", export_jpeg_quality=86, export_cameras=False, export_lights=False,
                             export_materials="EXPORT", export_extras=False, export_meshopt_compression_enable=True,
                             export_gpu_instances=True)
