/* Every room of an image-read flat must be walkable into from the front door: walls are every room
 * edge except the doorish openings (as build.ts erects them), the walker a 0.24 m-radius body.
 * usage: esbuild-bundled; node check-image-plan-access.js <analysis JSON folder> [--detail] */
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {floorPlanFromImage, type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
import {planAccess} from "../src/walkmode/interior/plan/planAccess";

const dir = process.argv[2], detail = process.argv.includes("--detail");
let bad = 0, total = 0, plans = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as ImageAnalysis;
  const p = floorPlanFromImage({complexId: "t", complexName: "t", dong: "1", unitType: "t", area: a.drawing.exclusiveArea, areaBasis: "t", floor: 3, style: "modern_white"}, a);
  if (!p) { console.log(f, a.status, "(no plan)"); continue; }
  plans++;
  const r = planAccess(p);
  total += r.targets; bad += r.blocked.length;
  console.log(f.replace(".json", ""), r.blocked.length ? "BLOCKED " + r.blocked.map(b => `${b.label}(${b.id})`).join(", ") : "ok", r.repairs ? `repairs=${r.repairs}` : "");
  if (detail) { for (const x of p.rooms) console.log("  ", x.id, x.type, x.surfaceType, x.zone, x.label, x.rect.map(v => v.toFixed(2)).join(",")); for (const o of p.openings) console.log("  ", o.type, o.a, o.b, o.axis, o.at.toFixed(2), o.center.toFixed(2), o.width.toFixed(2)); }
}
console.log(`plans ${plans} rooms ${total} blocked ${bad}`);
