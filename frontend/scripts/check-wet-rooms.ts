/* A bathroom is closed: no passage ('open') between a wet room and a dry one, and one door (two only
 * when it really is shared — reported). usage: esbuild-bundled; node check-wet-rooms.js <folder> */
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {floorPlanFromImage, type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
const dir = process.argv[2];
const WET = new Set(["bathroom", "ensuite"]);
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as ImageAnalysis;
  const p = floorPlanFromImage({complexId: "t", complexName: "t", dong: "1", unitType: "t", area: a.drawing.exclusiveArea, areaBasis: "t", floor: 3, style: "modern_white"}, a);
  if (!p) continue;
  const by = new Map(p.rooms.map(r => [r.id, r])), wet = (id: string) => { const r = by.get(id); return !!r && WET.has(r.surfaceType ?? r.type); };
  const out: string[] = [];
  for (const o of p.openings) if (o.type === "open" && o.b !== "out" && wet(o.a) !== wet(o.b)) out.push(`OPEN ${o.a}|${o.b} ${o.axis}${o.at.toFixed(2)} w${o.width.toFixed(2)}`);
  const zones = new Map<string, number>();
  for (const o of p.openings) if (["door", "sliding_door", "glass_door"].includes(o.type) && wet(o.a) !== wet(o.b)) { const z = by.get(wet(o.a) ? o.a : o.b)!.zone; zones.set(z, (zones.get(z) ?? 0) + 1); }
  for (const [z, n] of zones) if (n > 1) out.push(`DOORS ${z}=${n}`);
  for (const r of p.rooms) if (r.type !== "hall" && WET.has(r.type) && !zones.has(r.zone)) out.push(`NODOOR ${r.id}`);
  if (out.length) bad++;
  console.log(f.replace(".json", ""), out.length ? out.join("; ") : "ok");
}
console.log("plans with wet-room faults", bad);
