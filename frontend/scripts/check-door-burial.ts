/* A closed door must be seen in its doorway from both rooms: rays cast at the closed leaf from each
 * side must reach the leaf before any wall, reveal or casing of the shell.
 * usage: esbuild-bundled; node check-door-burial.js <analysis JSON folder> [--detail] */
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import * as THREE from "three";
import {floorPlanFromImage, type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
import {planAccess} from "../src/walkmode/interior/plan/planAccess";
import {buildShell} from "../src/walkmode/interior/build";
import {Batcher} from "../src/walkmode/interior/geom";
import type {Palette} from "../src/walkmode/interior/materials";

const dir = process.argv[2], detail = process.argv.includes("--detail");
const mats = new Map<string, THREE.Material>(), names = new Map<THREE.Material, string>();
const P = new Proxy({} as Palette, {get: (_t, k: string) => { if (!mats.has(k)) { const m = new THREE.MeshBasicMaterial({side: THREE.DoubleSide}); mats.set(k, m); names.set(m, k); } return mats.get(k); }});
let doors = 0, buried = 0, plans = 0;
const ray = new THREE.Raycaster();
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as ImageAnalysis;
  const p = floorPlanFromImage({complexId: "t", complexName: "t", dong: "1", unitType: "t", area: a.drawing.exclusiveArea, areaBasis: "t", floor: 3, style: "modern_white"}, a);
  if (!p) continue;
  planAccess(p);
  plans++;
  const B = new Batcher(), dyn = new THREE.Group();
  const sh = buildShell(p, P, B, dyn);
  const shellMeshes = B.build();
  const bad: string[] = [];
  for (const d of sh.doors) {
    if (d.opening.type === "glass_door") continue;
    doors++;
    if (d.kind === "slide") d.leaf.position.copy(d.slideFrom!); else d.pivot.rotation.y = d.closedYaw;
    dyn.updateMatrixWorld(true);
    const leafMeshes: THREE.Object3D[] = []; d.leaf.traverse(o => { if ((o as THREE.Mesh).isMesh) leafMeshes.push(o); });
    const box = new THREE.Box3(); for (const m of leafMeshes) box.expandByObject(m);
    const alongX = d.opening.axis === "z";
    const c = box.getCenter(new THREE.Vector3());
    let hit = 0, n = 0; const why = new Set<string>();
    for (let i = 1; i < 8; i++) for (const y of [0.25, 1.0, 1.9]) for (const side of [1, -1]) {
      const t = i / 8;
      const pt = alongX ? new THREE.Vector3(box.min.x + (box.max.x - box.min.x) * t, y, c.z) : new THREE.Vector3(c.x, y, box.min.z + (box.max.z - box.min.z) * t);
      const dirv = alongX ? new THREE.Vector3(0, 0, -side) : new THREE.Vector3(-side, 0, 0);
      const from = pt.clone().addScaledVector(dirv, -0.15);
      ray.set(from, dirv); ray.far = 0.3;
      const leafHit = ray.intersectObjects(leafMeshes, false)[0];
      if (!leafHit) continue;
      n++;
      const wall = ray.intersectObjects(shellMeshes, false).find(h => h.distance < leafHit.distance - 0.002);
      if (wall) { hit++; why.add(names.get((wall.object as THREE.Mesh).material as THREE.Material) + (side > 0 ? "+" : "-")); }
    }
    if (d.kind !== "slide") d.pivot.rotation.y = d.t ? d.openYaw : d.closedYaw;
    if (hit) { buried++; const o = d.opening; bad.push(`${d.label}[${o.type} ${o.a}|${o.b} ${o.axis}=${o.at.toFixed(2)} c${o.center.toFixed(2)} w${o.width.toFixed(2)}] ${hit}/${n} ${[...why].join(",")}`); }
  }
  console.log(f.replace(".json", ""), bad.length ? "BURIED " + bad.join("; ") : "ok");
}
console.log(`plans ${plans} doors ${doors} buried ${buried}`);
