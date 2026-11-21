"""Check screen sightlines in Blender geometry using the production layout.

    blender -b --factory-startup --python-exit-code 1 --python scripts/verify_exchange_panels.py -- <sources>

For every wall, board and ticker display: 15 points on its face must be clear of brackets, pilasters
and housings just in front of the glass, and the whole face must be visible from a walkable spot on
the left, in front and on the right.
"""
import argparse
from itertools import product
from math import cos, hypot, radians, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_exchange_floor import LAYOUT, build  # noqa: E402


def blender_point(x, y, z):
    return Vector((x, -z, y))


def walkable(x, z):
    walk = LAYOUT["walk"]
    if abs(x) > walk["x"] or not walk["zMin"] <= z <= walk["zMax"]:
        return False
    if any(abs(x - o["x"]) < o["w"] / 2 + .32 and abs(z - o["z"]) < o["d"] / 2 + .32 for o in LAYOUT["obstacles"]):
        return False
    return not any(hypot(x - c["x"], z - c["z"]) < c["r"] + .32 for c in LAYOUT["circles"])


def trace(scene, graph, origin, target):
    delta = target - origin
    hit, _, _, _, obj, _ = scene.ray_cast(graph, origin, delta.normalized(), distance=delta.length - .01)
    return obj.name if hit else None


def verify():
    bpy.context.view_layer.update()
    scene, graph = bpy.context.scene, bpy.context.evaluated_depsgraph_get()
    issues, checked = [], 0
    for i, screen in enumerate(LAYOUT["screens"]):
        if screen["kind"] not in ("wall", "board", "ticker"):
            continue
        checked += 1
        x, y, z, yaw, width, height = (screen[k] for k in ("x", "y", "z", "yaw", "w", "h"))
        angle = radians(yaw)
        normal_x, normal_z = sin(angle), cos(angle)
        right_x, right_z = cos(angle), -sin(angle)
        points = [blender_point(x + width * u * right_x, y + height * v, z + width * u * right_z)
                  for u, v in product((-.48, -.25, 0, .25, .48), (-.45, 0, .45))]
        normal = blender_point(normal_x, 0, normal_z)
        obstruction = {obj for point in points if (obj := trace(scene, graph, point + normal * .3, point + normal * .02))}
        distances = (4, 6, 8, 9.5, 11, 12.5, 14, 16) if screen["kind"] != "ticker" else (6, 9, 12, 16)
        visible = {}
        for side, offsets in (("left", (-4.5, -3.0, -1.5)), ("center", (0,)), ("right", (1.5, 3.0, 4.5))):
            visible[side] = 0
            for distance, lateral in product(distances, offsets):
                vx = x + normal_x * distance + right_x * lateral
                vz = z + normal_z * distance + right_z * lateral
                under_gallery = vz > LAYOUT["walk"]["zMax"] - 1.8 and y > 7   # the gallery deck hides high panels
                if walkable(vx, vz) and not under_gallery:
                    eye = blender_point(vx, 1.68, vz)
                    visible[side] = max(visible[side], sum(trace(scene, graph, eye, p + normal * .02) is None for p in points))
        need = len(points) if screen["kind"] != "ticker" else len(points) - 6   # long bands: most of the face
        if obstruction or min(visible.values()) < need:
            issues.append(f"{i + 1:03d} {screen['id']}: face {sorted(obstruction)}, sightline {visible}")
    if issues:
        raise RuntimeError("\n".join(issues))
    print(f"{checked} wall/board/ticker screens: face clear, visible from left, front and right.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    build(options.sources.resolve())
    verify()
