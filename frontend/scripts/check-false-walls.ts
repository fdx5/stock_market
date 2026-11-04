/* No wall where the drawing has none: every passage the analysis read between two shared spaces
 * (living, kitchen, hall, entrance — by the zone's own type) must come out of the builder with no
 * wall volume standing in it. Reports the metres of wall built across drawn passages.
 * usage: esbuild-bundled; node check-false-walls.js <analysis JSON folder> [--detail] */
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import * as THREE from "three";
import {floorPlanFromImage, type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
import {buildShell, wallHalfThickness} from "../src/walkmode/interior/build";
import {Batcher} from "../src/walkmode/interior/geom";
import {wallBacksPoint} from "../src/walkmode/interior/solidWalls";
import type {Palette} from "../src/walkmode/interior/materials";

const dir = process.argv[2], detail = process.argv.includes("--detail");
const P = new Proxy({}, {get: () => new THREE.MeshBasicMaterial()}) as unknown as Palette;
const SHARED = new Set(["living", "kitchen", "dining", "hall", "corridor", "entrance"]);
let total = 0, walled = 0, plans = 0, bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as ImageAnalysis;
  const p = floorPlanFromImage({complexId: "t", complexName: "t", dong: "1", unitType: "t", area: a.drawing.exclusiveArea, areaBasis: "t", floor: 3, style: "modern_white"}, a);
  if (!p) continue;
  plans++;
  const sh = buildShell(p, P, new Batcher(), new THREE.Group()), e = wallHalfThickness(p);
  const byId = new Map(a.rooms!.map(r => [r.id, r]));
  const surface = (id: string) => { const r = byId.get(id); return r ? (a.rooms!.find(q => q.zone === r.zone && q.type !== "hall")?.type ?? r.type) : "out"; };
  let len = 0, run = 0; const where: string[] = [];
  for (const o of a.openings!) {
    if (o.type !== "open" || o.b === "out" || !SHARED.has(surface(o.a)) || !SHARED.has(surface(o.b))) continue;
    const n = Math.max(2, Math.round(o.width / 0.05)), step = o.width / n;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const u = o.center - o.width / 2 + (i + 0.5) * step;
      // (a jamb of 6 cm at each end may stand: a passage meeting a perpendicular wall)
      if (u < o.center - o.width / 2 + 0.06 || u > o.center + o.width / 2 - 0.06) continue;
      const [x, z] = o.axis === "x" ? [o.at, u] : [u, o.at];
      // (only where the two rooms — or pieces of their zones — really meet across the line)
      const J = o.axis === "x" ? 0 : 1, K = 1 - J, ra = byId.get(o.a)!, rb = byId.get(o.b)!;
      const edge = (r: typeof ra) => Math.abs(r.rect[J] - o.at) < 0.002 ? J : J + 2;
      const touch = (r: typeof ra) => a.rooms!.some(q => q.zone === r.zone && q.rect[K] <= u && q.rect[K + 2] >= u && Math.abs(q.rect[edge(r)] - o.at) < 0.002);
      if (!touch(ra) || !touch(rb)) continue;
      if (wallBacksPoint(sh.wallVolumes, e - 0.005, x, z, 1.2)) hit++;
    }
    run += o.width; if (hit) { len += hit * step; where.push(`${o.a}|${o.b}@${o.axis}${o.at.toFixed(2)} c${o.center.toFixed(2)} w${o.width.toFixed(2)}: ${(hit * step).toFixed(2)}m`); }
  }
  total += run; walled += len; if (len > 0.05) bad++;
  console.log(f.replace(".json", ""), len > 0.05 ? `WALLED ${len.toFixed(2)}m / ${run.toFixed(2)}m` : "ok");
  if (detail) for (const w of where) console.log("   ", w);
}
console.log(`plans ${plans} passages ${total.toFixed(1)}m walled ${walled.toFixed(2)}m plans-with-false-walls ${bad}`);
