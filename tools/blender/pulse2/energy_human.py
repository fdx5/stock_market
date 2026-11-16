"""The 증시 전광판2 energy humanoid: an anatomically correct, unclothed, hairless MPFB
(MakeHuman, CC0) human on the game-engine rig — the same rig the heroes' retargeted
captures are made for — exported as a skinned glb without materials (the page gives it
an emissive energy shader).
Runs with the heroes Blender tools (MPFB in their isolated user dirs):
  <heroes worktree>/tools/blender/heroes/run.sh ../../../../sm-pulse2-20261116/tools/blender/pulse2/energy_human.py -- --out <glb>
"""
import os, sys, argparse
sys.path.insert(0, os.environ.get("HEROES_TOOLS", "I:/ai_root/sm-heroes-20261115/tools/blender/heroes"))
import bpy
import lib
import mhbase as M

argv = sys.argv[sys.argv.index("--") + 1:]
p = argparse.ArgumentParser(); p.add_argument("--out", required=True); p.add_argument("--render")
a = p.parse_args(argv)
macro = {"gender": 1.0, "age": 0.5, "muscle": 0.95, "weight": 0.55, "proportions": 0.8, "height": 0.7, "cupsize": 0.5, "firmness": 0.5,
         "race": {"asian": 0.33, "caucasian": 0.34, "african": 0.33}}
parts, rig = M.human(macro, "young_caucasian_male", None, None, None)
body = parts["body"]
for k, o in list(parts.items()):
    if o is not body: bpy.data.objects.remove(o)
body.data.materials.clear()
body.data.materials.append(lib.mat_flat("energy", (0.4, 0.7, 1.0)))
lib.bind([body], rig)
zs = [v.co.z for v in body.data.vertices]
print("height", round(max(zs) - min(zs), 3), "verts", len(body.data.vertices), "bones", len(rig.data.bones))
if a.render:
    lib.studio(1.8); lib.look_camera((1.4, -3.6, 1.2), (0, 0, 0.95), 50); lib.render(a.render, (500, 700), 32)
os.makedirs(os.path.dirname(a.out), exist_ok=True)
lib.export_glb([rig, body], a.out, materials=False)
print("exported", a.out)
