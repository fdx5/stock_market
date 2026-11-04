import assert from "node:assert/strict";
import { generateSurveyed } from "../src/walkmode/interior/plan/surveyed";
import { generateFacility } from "../src/walkmode/interior/plan/facility";
import { stairLayout } from "../src/walkmode/interior/facilityFurnish";
import type { FloorPlan } from "../src/walkmode/interior/plan/types";

// every stair room's door opens onto its landing (never onto the flights), and the landing is where
// one arriving by the stair stands; a basement car park is laid out (it threw before)
const rings: [number, number][][] = [[[0, 0], [42, 0], [42, 26], [0, 26]], [[0, 0], [18, 0], [18, 30], [0, 30]], [[0, 0], [60, 0], [60, 14], [30, 14], [30, 34], [0, 34]]];
let stairs = 0, plans = 0;
const check = (p: FloorPlan | null, what: string) => {
  assert.ok(p, what + ": a plan"); plans++;
  for (const r of p.rooms.filter(q => q.type === "stair")) {
    stairs++;
    const L = stairLayout(p, r), [X0, Z0, X1, Z1] = r.rect;
    // the landing's rectangle
    const land: [number, number, number, number] = L.alongZ ? (L.end ? [X0, Z1 - L.land, X1, Z1] : [X0, Z0, X1, Z0 + L.land]) : (L.end ? [X1 - L.land, Z0, X1, Z1] : [X0, Z0, X0 + L.land, Z1]);
    const fl = L.d > 2.2 ? L.flights : null;
    for (const o of p.openings.filter(o => (o.a === r.id || o.b === r.id) && o.type !== "window")) {
      // (the door's span on its wall must not meet the flights' span along that wall)
      const s = o.center - o.width / 2, e = o.center + o.width / 2;
      if (!fl) continue;
      const along = o.axis === "x" ? [fl[1], fl[3]] : [fl[0], fl[2]];
      const onWall = o.axis === "x" ? Math.abs(o.at - fl[0]) < .01 || Math.abs(o.at - fl[2]) < .01 : Math.abs(o.at - fl[1]) < .01 || Math.abs(o.at - fl[3]) < .01;
      assert.ok(!onWall || e <= along[0] + .01 || s >= along[1] - .01, `${what}: ${r.id} door ${o.axis}@${o.at} [${s.toFixed(2)},${e.toFixed(2)}] onto the flights ${fl.map(v => v.toFixed(2))}`);
    }
    const [ax, az] = L.at;
    assert.ok(ax >= land[0] && ax <= land[2] && az >= land[1] && az <= land[3], `${what}: arrival on the landing`);
  }
};
for (const [n, ring] of rings.entries()) for (const [kind, level] of [["parking", -1], ["office", 1], ["office", 4], ["clinic", 2], ["retail", 1]] as const) {
  const base = { id: "t", name: "테스트빌딩", kind, level, levelLabel: level < 0 ? `지하 ${-level}층` : `${level}층`, use: "", width: 40, depth: 24, tenants: [], departments: [], built: 2010 } as Parameters<typeof generateFacility>[0];
  const s = generateSurveyed({ ...base, outline: [[ring]], entry: level === 1 ? [ring[1][0] / 2, 0] : null, seed: 11 + n, partitions: [], cores: [] });
  check(s, `surveyed ${n} ${kind} ${level}`);
  if (kind === "parking") assert.ok(s!.rooms.some(r => r.type === "parking"), "a car park deck");
  check(generateFacility(base), `facility ${kind} ${level}`);
}
console.log(`facility stairs: ${stairs} stair rooms on ${plans} plans — doors on landings, arrivals on landings; basements as car parks PASS`);
