"""Check screen sightlines in Blender geometry using the production layout."""
import argparse
from itertools import product
from math import cos, radians, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_exchange_floor import LAYOUT, build


def blender_point(x, y, z):
    return Vector((x, -z, y))


def walkable(x, z):
    room = LAYOUT["room"]
    if abs(x) > room["width"] / 2 - room["sideInset"] or abs(z) > room["depth"] / 2 - .53:
        return False
    posts = [dict(post, w=4.44, d=4.6) for post in LAYOUT["posts"]]
    return not any(abs(x - item["x"]) < item["w"] / 2 + .29 and abs(z - item["z"]) < item["d"] / 2 + .29
                   for item in [*LAYOUT["obstacles"], *posts])


def trace(scene, graph, origin, target):
    delta = target - origin
    hit, _, _, _, obj, _ = scene.ray_cast(graph, origin, delta.normalized(), distance=delta.length - .008)
    return obj.name if hit else None


def verify():
    bpy.context.view_layer.update()
    scene, graph = bpy.context.scene, bpy.context.evaluated_depsgraph_get()
    issues = []
    for i, screen in enumerate(LAYOUT["screens"]):
        x, y, z, yaw, width, height = (screen[k] for k in ("x", "y", "z", "yaw", "w", "h"))
        angle = radians(yaw)
        normal_x, normal_z = sin(angle), cos(angle)
        right_x, right_z = cos(angle), -sin(angle)
        points = [blender_point(x + width * u * right_x, y + height * v, z + width * u * right_z)
                  for u, v in product((-.49, -.25, 0, .25, .49), (-.49, 0, .49))]
        normal = blender_point(normal_x, 0, normal_z)
        obstruction = {obj for point in points if (obj := trace(scene, graph, point + normal * .36, point))}
        walls = screen["housing"] == "wall"
        distances = (2.1, 3.4, 5.0, 6.4) if walls else (1.7, 2.2, 2.7, 3.3)
        visible = {}
        for side, offsets in (("left", (-1.6, -.8)), ("center", (0,)), ("right", (.8, 1.6))):
            visible[side] = 0
            for distance, lateral in product(distances, offsets):
                view_x = x + normal_x * distance + right_x * lateral
                view_z = z + normal_z * distance + right_z * lateral
                if walkable(view_x, view_z):
                    eye = blender_point(view_x, 1.66, view_z)
                    visible[side] = max(visible[side], sum(trace(scene, graph, eye, point) is None for point in points))
        if obstruction or min(visible.values()) < len(points):
            issues.append(f"{i + 1:02d} {screen['id']}: face {sorted(obstruction)}, sightline {visible}")
    if issues:
        raise RuntimeError("\n".join(issues))
    print(f"{len(LAYOUT['screens'])} screens: all 15 face samples clear from left, center and right viewing positions.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    build(options.sources.resolve())
    verify()
