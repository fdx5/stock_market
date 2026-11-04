import type { FloorPlan, Opening, Room } from "./types";
import { Placer, packKitchen } from "../furnish";

/* A kitchen zone read from a drawing is cut into rectangles largest first, and the largest can be
 * the wrong one for a kitchen: a 2 × 3 m piece with passages down both long sides and a door in
 * the third — a corridor — while the counter's wall runs along a 4.7 × 1.7 m band across the
 * pieces. Then the fridge and the counter fit nowhere and the whole flat was refused. Here the
 * zone's floor (unchanged) is cut again round the rectangle where they do fit. */

const EPS = 0.002;

export function recutKitchen(plan: FloorPlan): FloorPlan | null {
  const area = (r: Room) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
  const kitchens = plan.rooms.filter(r => r.type === "kitchen");
  if (!kitchens.length) return null;
  const main = kitchens.reduce((a, b) => area(b) > area(a) ? b : a);
  if (packKitchen(new Placer(main, plan))) return null;
  const pieces = plan.rooms.filter(r => r.zone === main.zone);
  if (pieces.length < 2) return null;
  // the zone's floor on the grid of its pieces' own edges
  const xs = [...new Set(pieces.flatMap(r => [r.rect[0], r.rect[2]]))].sort((a, b) => a - b);
  const zs = [...new Set(pieces.flatMap(r => [r.rect[1], r.rect[3]]))].sort((a, b) => a - b);
  const inside = (x: number, z: number) => pieces.some(r => x > r.rect[0] - EPS && x < r.rect[2] + EPS && z > r.rect[1] - EPS && z < r.rect[3] + EPS);
  const full = (i0: number, j0: number, i1: number, j1: number) => { for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (!inside((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)) return false; return true; };
  const cands: [number, number, number, number][] = [];
  for (let i0 = 0; i0 < xs.length - 1; i0++) for (let i1 = i0 + 1; i1 < xs.length; i1++) for (let j0 = 0; j0 < zs.length - 1; j0++) for (let j1 = j0 + 1; j1 < zs.length; j1++) {
    const w = xs[i1] - xs[i0], d = zs[j1] - zs[j0];
    if (Math.min(w, d) < 1.4 || Math.max(w, d) < 2.0 || !full(i0, j0, i1, j1)) continue;
    cands.push([i0, j0, i1, j1]);
  }
  cands.sort((a, b) => (xs[b[2]] - xs[b[0]]) * (zs[b[3]] - zs[b[1]]) - (xs[a[2]] - xs[a[0]]) * (zs[a[3]] - zs[a[1]]));
  for (const [i0, j0, i1, j1] of cands.slice(0, 40)) {
    const next = cutAround(plan, main, pieces, xs, zs, [i0, j0, i1, j1]);
    if (next && packKitchen(new Placer(next.rooms.find(r => r.id === main.id)!, next))) return next;
  }
  return null;
}

/** the zone's floor as the chosen rectangle (the kitchen) and the rest cut largest first (its
 * pieces); openings re-pointed to the new pieces they lie on, the seams inside the zone open */
function cutAround(plan: FloorPlan, main: Room, pieces: Room[], xs: number[], zs: number[], pick: [number, number, number, number]): FloorPlan | null {
  const nx = xs.length - 1, nz = zs.length - 1, used = new Uint8Array(nx * nz);
  const inside = (i: number, j: number) => pieces.some(r => (xs[i] + xs[i + 1]) / 2 > r.rect[0] && (xs[i] + xs[i + 1]) / 2 < r.rect[2] && (zs[j] + zs[j + 1]) / 2 > r.rect[1] && (zs[j] + zs[j + 1]) / 2 < r.rect[3]);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (!inside(i, j)) used[j * nx + i] = 1;
  const rects: [number, number, number, number][] = [];
  const take = ([i0, j0, i1, j1]: [number, number, number, number]) => { for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) used[j * nx + i] = 1; rects.push([xs[i0], zs[j0], xs[i1], zs[j1]]); };
  take(pick);
  for (;;) {
    let best: [number, number, number, number] | null = null, ba = 0;
    for (let i0 = 0; i0 < nx; i0++) for (let j0 = 0; j0 < nz; j0++) {
      if (used[j0 * nx + i0]) continue;
      for (let i1 = i0 + 1; i1 <= nx && !used[j0 * nx + i1 - 1]; i1++) for (let j1 = j0 + 1; j1 <= nz; j1++) {
        let ok = true; for (let i = i0; i < i1 && ok; i++) if (used[(j1 - 1) * nx + i]) ok = false;
        if (!ok) break;
        const a = (xs[i1] - xs[i0]) * (zs[j1] - zs[j0]); if (a > ba) { ba = a; best = [i0, j0, i1, j1]; }
      }
    }
    if (!best) break;
    take(best);
  }
  if (rects.length > 12) return null;
  const others = plan.rooms.filter(r => r.zone !== main.zone);
  const lead = pieces.find(p => p !== main) ?? main;
  const fresh: Room[] = rects.map((rect, n) => n === 0 ? { ...main, rect: rect as Room["rect"] } : { ...lead, id: `${main.id}-k${n}`, type: "hall", rect: rect as Room["rect"] });
  const zoneIds = new Set(pieces.map(p => p.id));
  const openings: Opening[] = [];
  for (const o of plan.openings) {
    const inA = zoneIds.has(o.a), inB = zoneIds.has(o.b);
    if (inA && inB) continue;                       // (a seam inside the zone: open again below)
    if (!inA && !inB) { openings.push(o); continue; }
    const mine = inA ? "a" : "b", j = o.axis === "x" ? 0 : 1, k = 1 - j, s = o.center - o.width / 2, e = o.center + o.width / 2;
    for (const r of fresh) {
      if (Math.abs(r.rect[j] - o.at) > EPS && Math.abs(r.rect[j + 2] - o.at) > EPS) continue;
      const lo = Math.max(s, r.rect[k]), hi = Math.min(e, r.rect[k + 2]);
      if (hi - lo < 0.05) continue;
      openings.push({ ...o, [mine]: r.id, center: (lo + hi) / 2, width: hi - lo, swingInto: o.swingInto && zoneIds.has(o.swingInto) ? r.id : o.swingInto });
    }
  }
  for (let a = 0; a < fresh.length; a++) for (let b = a + 1; b < fresh.length; b++) {
    const A = fresh[a].rect, B = fresh[b].rect;
    for (const j of [0, 1]) {
      const k = 1 - j, at = Math.abs(A[j + 2] - B[j]) < EPS ? A[j + 2] : Math.abs(B[j + 2] - A[j]) < EPS ? A[j] : null;
      if (at === null) continue;
      const lo = Math.max(A[k], B[k]), hi = Math.min(A[k + 2], B[k + 2]);
      if (hi - lo > 0.05) openings.push({ type: "open", a: fresh[a].id, b: fresh[b].id, axis: j === 0 ? "x" : "z", at, center: (lo + hi) / 2, width: hi - lo, height: 2.4, sill: 0 });
    }
  }
  return { ...plan, rooms: [...others, ...fresh], openings };
}
