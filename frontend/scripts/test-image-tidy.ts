import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {floorPlanFromImage, type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
import {openingsOnWall} from "../src/walkmode/interior/plan/wallOpenings";
import {DOOR_MIN, STUB, tidyImageOpenings} from "../src/walkmode/interior/plan/imageTidy";
import type {FloorPlan, Opening, Room} from "../src/walkmode/interior/plan/types";

// unit: a passage read 12 cm short of the corner, a seam opened over 80 %, a 0.62 m door
const rooms: Room[] = [
  {id: "bed", type: "bedroom", label: "침실", zone: "b", rect: [0, 0, 3, 4]},
  {id: "strip", type: "hall", label: "침실", zone: "b", rect: [3, 0, 3.6, 5]},
  {id: "hall", type: "hall", label: "복도", zone: "h", rect: [0, 4, 3, 5.2]},
  {id: "liv", type: "living", label: "거실", zone: "l", rect: [3.6, 0, 8, 5]},
];
const ops: Opening[] = [
  {type: "open", a: "bed", b: "strip", axis: "x", at: 3, center: 2.1, width: 3.3, height: 2.4, sill: 0},
  {type: "door", a: "hall", b: "bed", axis: "z", at: 4, center: 1.5, width: .62, height: 2.1, sill: 0},
  {type: "open", a: "strip", b: "liv", axis: "x", at: 3.6, center: 2.5, width: 4.76, height: 2.4, sill: 0},
];
const t = tidyImageOpenings(rooms, ops);
const seam = t.openings.find(o => o.a === "bed" && o.b === "strip")!;
assert.ok(Math.abs(seam.center - seam.width / 2 - 0) < 1e-6 && Math.abs(seam.center + seam.width / 2 - 4) < 1e-6, "seam inside one room opened whole");
const door = t.openings.find(o => o.type === "door")!;
assert.ok(Math.abs(door.width - DOOR_MIN.room) < 1e-6, "narrow door widened");
const pass = t.openings.find(o => o.a === "strip" && o.b === "liv")!;
assert.ok(Math.abs(pass.center - pass.width / 2) < 1e-6 && Math.abs(pass.center + pass.width / 2 - 5) < 1e-6, "12 cm stub at a corner opened");
// a private room's real wall is kept: a passage covering a third of a seam between two zones is not stretched
const keep = tidyImageOpenings(rooms, [{type: "open", a: "strip", b: "liv", axis: "x", at: 3.6, center: 1, width: 1, height: 2.4, sill: 0}]);
assert.equal(keep.openings[0].width, 1);

// the sample drawings: wall stubs beside passages and narrow doors, before and after
const dir = process.argv[2];
const input = {complexId: "t", complexName: "t", dong: "101", unitType: "t", area: 0, areaBasis: "t", floor: 4, style: "modern_white" as const};
const stubs = (p: FloorPlan) => {
  let n = 0;
  for (const r of p.rooms) for (const [axis, at, lo, hi] of [["x", r.rect[0], r.rect[1], r.rect[3]], ["x", r.rect[2], r.rect[1], r.rect[3]], ["z", r.rect[1], r.rect[0], r.rect[2]], ["z", r.rect[3], r.rect[0], r.rect[2]]] as const) {
    const j = axis === "x" ? 0 : 1, k = 1 - j;
    if (!p.rooms.some(q => q !== r && (Math.abs(q.rect[j] - at) < .002 || Math.abs(q.rect[j + 2] - at) < .002) && q.rect[k] < hi - .01 && q.rect[k + 2] > lo + .01)) continue;
    // (a stub beside a passage: a door's jamb by a corner is a wall a door needs)
    const holes = openingsOnWall(p.rooms, p.openings, r, axis, at, lo, hi, true).map(o => [o.center - o.width / 2, o.center + o.width / 2, o.type === "open" ? 1 : 0]).sort((a, b) => a[0] - b[0]);
    let a = lo, prev = 0;
    for (const [h0, h1, open] of holes) { if (h0 - a > .01 && h0 - a < STUB && (open || prev)) n++; if (h1 > a) { a = h1; prev = open; } }
    if (prev && hi - a > .01 && hi - a < STUB) n++;
  }
  return n;
};
/** metres of wall standing inside one room: same-zone seams not covered by an opening */
const innerWall = (p: FloorPlan) => {
  let m = 0;
  for (let i = 0; i < p.rooms.length; i++) for (let j = i + 1; j < p.rooms.length; j++) {
    const a = p.rooms[i], b = p.rooms[j]; if (a.zone !== b.zone) continue;
    for (const axis of ["x", "z"] as const) {
      const J = axis === "x" ? 0 : 1, K = 1 - J;
      const at = Math.abs(a.rect[J + 2] - b.rect[J]) < .002 ? a.rect[J + 2] : Math.abs(b.rect[J + 2] - a.rect[J]) < .002 ? a.rect[J] : null;
      if (at === null) continue;
      const lo = Math.max(a.rect[K], b.rect[K]), hi = Math.min(a.rect[K + 2], b.rect[K + 2]); if (hi - lo < .01) continue;
      let iv: [number, number][] = [[lo, hi]];
      for (const o of p.openings) if (o.axis === axis && Math.abs(o.at - at) < .002) { const s = o.center - o.width / 2, e = o.center + o.width / 2; iv = iv.flatMap(([x, y]) => e <= x || s >= y ? [[x, y] as [number, number]] : [[x, Math.max(x, s)], [Math.min(y, e), y]].filter(([u, v]) => v - u > .01) as [number, number][]); }
      m += iv.reduce((t, [x, y]) => t + y - x, 0);
    }
  }
  return m;
};
const narrow = (p: FloorPlan) => p.openings.filter(o => o.type === "door" && o.width < .7).length;
let before = 0, after = 0, nb = 0, na = 0, files = 0, w0 = 0, w1 = 0;
if (dir) for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
  const a = JSON.parse(readFileSync(join(dir, f), "utf8")) as ImageAnalysis; if (a.status !== "ready") continue;
  const inp = {...input, area: a.drawing.exclusiveArea};
  const p0 = floorPlanFromImage(inp, a, {tidy: false}), p1 = floorPlanFromImage(inp, a);
  if (!p0 || !p1) { console.log(f, "no plan"); continue; }
  files++; const s0 = stubs(p0), s1 = stubs(p1), d0 = narrow(p0), d1 = narrow(p1);
  before += s0; after += s1; nb += d0; na += d1; w0 += innerWall(p0); w1 += innerWall(p1);
  assert.deepEqual(p1.rooms.map(r => r.rect), p0.rooms.map(r => r.rect), "rooms never moved");
  console.log(f.padEnd(22), `stubs ${s0}→${s1}`, `doors<0.7m ${d0}→${d1}`, JSON.stringify(p1.imageAnalysis!.tidy));
}
if (files) { console.log(`total (${files} drawings): wall stubs ${before}→${after}, narrow doors ${nb}→${na}, walls inside one room ${w0.toFixed(1)}→${w1.toFixed(1)} m`); assert.ok(after < before && na <= nb && w1 < w0); }
console.log("image-tidy: checks passed");
