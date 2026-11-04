import type { Opening, Room } from "./types";
import { openingsOnWall } from "./wallOpenings";

/* A drawing read from its image is right about where the rooms are, less so about the small things
 * on their edges, and those are what a walker meets first:
 *  - a passage read a little short of the room's corner leaves a 5–25 cm sliver of wall standing in
 *    it — a pillar no flat has;
 *  - a passage between two pieces of one room (the reader cut an L into rects) read over most of the
 *    seam but not all of it leaves a wall stub inside the room;
 *  - a door symbol read narrow (its swing arc clipped by the line work) gives a door leaf 0.6 m wide —
 *    half a door.
 * These are mended on the plan, before the walls are built; room rects are never moved. */

const EPS = 0.002;
/** the room doors' least clear widths: a flat's bathroom door, its other doors, the front door */
export const DOOR_MIN = { bath: 0.72, room: 0.8, front: 0.85 } as const;
/** a wall shorter than this between a passage and a corner is a misread, not a wall */
export const STUB = 0.3;
/** a room's piece narrower than this is a strip of it, not a space of its own */
export const STRIP = 1.2;
/** the jamb kept beside a door: from a corner, or from another opening */
const JAMB = 0.06;

const wet = (r: Room | undefined) => !!r && ["bathroom", "ensuite"].includes(r.surfaceType ?? r.type);

/** the intervals along the edge line (axis, at) that the rooms of `zone` touch from one side (−1:
 * rooms ending at the line, +1: rooms starting at it), joined where they meet */
function zoneSpans(rooms: Room[], zone: string, axis: "x" | "z", at: number, side: -1 | 1): [number, number][] {
  const j = axis === "x" ? 0 : 1, k = 1 - j;
  const iv = rooms.filter(r => r.zone === zone && Math.abs(r.rect[side < 0 ? j + 2 : j] - at) < EPS)
    .map(r => [r.rect[k], r.rect[k + 2]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) { const p = out[out.length - 1]; if (p && a <= p[1] + EPS) p[1] = Math.max(p[1], b); else out.push([a, b]); }
  return out;
}

const sideOf = (r: Room, o: Opening): -1 | 1 => Math.abs(r.rect[o.axis === "x" ? 2 : 3] - o.at) < EPS ? -1 : 1;

/** the stretch of the edge line both sides of an opening share, around its centre */
function sharedRun(rooms: Room[], o: Opening, ids: Map<string, Room>): [number, number] | null {
  const a = ids.get(o.a), b = o.b === "out" ? undefined : ids.get(o.b);
  if (!a || !b) return null;
  const sa = zoneSpans(rooms, a.zone, o.axis, o.at, sideOf(a, o)).find(([p, q]) => p - EPS <= o.center && o.center <= q + EPS);
  const sb = zoneSpans(rooms, b.zone, o.axis, o.at, sideOf(b, o)).find(([p, q]) => p - EPS <= o.center && o.center <= q + EPS);
  if (!sa || !sb) return null;
  const lo = Math.max(sa[0], sb[0]), hi = Math.min(sa[1], sb[1]);
  return hi - lo > 0.05 ? [lo, hi] : null;
}

export interface TidyReport { stubsOpened: number; seamsOpened: number; doorsWidened: number; publicStubs?: number; piecesMerged?: number; kitchenRecut?: boolean }

export function tidyImageOpenings(rooms: Room[], input: Opening[]): { openings: Opening[]; report: TidyReport } {
  const ids = new Map(rooms.map(r => [r.id, r]));
  const openings = input.map(o => ({ ...o }));
  const report: TidyReport = { stubsOpened: 0, seamsOpened: 0, doorsWidened: 0 };
  const onLine = (o: Opening, q: Opening) => q !== o && q.axis === o.axis && Math.abs(q.at - o.at) < EPS;
  const concrete = (q: Opening) => q.type !== "open";
  const ends = (q: Opening): [number, number] => [q.center - q.width / 2, q.center + q.width / 2];

  // 0. a strip of a room (a reader's piece under 1.2 m across — a balcony's or a hall's sliver) is
  //    floor of that room: the seam to the rest of it with no door or window in it is no wall
  const short = (r: Room) => Math.min(r.rect[2] - r.rect[0], r.rect[3] - r.rect[1]);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    if (a.zone !== b.zone || Math.min(short(a), short(b)) >= STRIP) continue;
    for (const axis of ["x", "z"] as const) {
      const J = axis === "x" ? 0 : 1, K = 1 - J;
      const at = Math.abs(a.rect[J + 2] - b.rect[J]) < EPS ? a.rect[J + 2] : Math.abs(b.rect[J + 2] - a.rect[J]) < EPS ? a.rect[J] : null;
      if (at === null) continue;
      const lo = Math.max(a.rect[K], b.rect[K]), hi = Math.min(a.rect[K + 2], b.rect[K + 2]);
      if (hi - lo < 0.1) continue;
      const on = openings.filter(q => q.axis === axis && Math.abs(q.at - at) < EPS && ends(q)[1] > lo + EPS && ends(q)[0] < hi - EPS);
      if (on.some(concrete)) continue;
      for (const q of on) q.width = 0;
      openings.push({ type: "open", a: a.id, b: b.id, axis, at, center: (lo + hi) / 2, width: hi - lo, height: 2.4, sill: 0 });
      report.seamsOpened++;
    }
  }
  // 1. passages: to the corner when what is left there is a stub; a seam inside one room open over
  //    all of it when the drawing opened most of it
  for (const o of openings) {
    if (!o.width) continue;
    if (o.type !== "open" || o.b === "out") continue;
    const run = sharedRun(rooms, o, ids); if (!run) continue;
    const a = ids.get(o.a)!, b = ids.get(o.b)!, same = a.zone === b.zone;
    let [s, e] = ends(o);
    const others = openings.filter(q => onLine(o, q));
    // (the nearest other opening on each side bounds the stretch a passage may take)
    const left = Math.max(run[0], ...others.map(q => ends(q)[1]).filter(v => v <= s + EPS));
    const right = Math.min(run[1], ...others.map(q => ends(q)[0]).filter(v => v >= e - EPS));
    const nearConcrete = (v: number) => others.some(q => concrete(q) && Math.abs((v < s ? ends(q)[1] : ends(q)[0]) - v) < EPS);
    const covered = (e - s) / Math.max(EPS, run[1] - run[0]);
    const reach = same && covered >= 0.5 ? Infinity : STUB;
    let changed = false;
    // (a door's jamb is a wall it needs: a passage stops short of it)
    if (s - left > EPS && s - left < reach && !(nearConcrete(left) && left > run[0] + EPS)) { s = left; changed = true; }
    if (right - e > EPS && right - e < reach && !(nearConcrete(right) && right < run[1] - EPS)) { e = right; changed = true; }
    if (changed) { o.center = (s + e) / 2; o.width = e - s; if (same && reach === Infinity) report.seamsOpened++; else report.stubsOpened++; }
  }
  // two passages on one line with a stub between them: one passage
  for (const o of openings) {
    if (o.type !== "open" || !o.width) continue;
    for (const q of openings) {
      if (q === o || q.type !== "open" || !q.width || !onLine(o, q) || q.a !== o.a && q.a !== o.b) continue;
      const [s, e] = ends(o), [t, u] = ends(q), gap = t >= e ? t - e : s >= u ? s - u : -1;
      if (gap < 0 || gap >= STUB) continue;
      if (openings.some(c => concrete(c) && onLine(o, c) && ends(c)[1] > Math.min(e, u) && ends(c)[0] < Math.max(s, t))) continue;
      const lo = Math.min(s, t), hi = Math.max(e, u);
      o.center = (lo + hi) / 2; o.width = hi - lo; q.width = 0; report.stubsOpened++;
    }
  }
  // 2. doors read narrow: widened about their centre, within the wall they stand in
  for (const o of openings) {
    if (!["door", "sliding_door", "front_door"].includes(o.type)) continue;
    const a = ids.get(o.a), b = o.b === "out" ? undefined : ids.get(o.b);
    const want = o.type === "front_door" ? DOOR_MIN.front : wet(a) || wet(b) ? DOOR_MIN.bath : DOOR_MIN.room;
    if (o.width >= want - EPS) continue;
    let run: [number, number] | null;
    if (o.b === "out") { const sp = a ? zoneSpans(rooms, a.zone, o.axis, o.at, sideOf(a, o)).find(([p, q]) => p - EPS <= o.center && o.center <= q + EPS) : undefined; run = sp ?? null; }
    else run = sharedRun(rooms, o, ids);
    if (!run) continue;
    const [s, e] = ends(o);
    // (other doors and windows keep a jamb's width; a passage gives way — it is clipped by the door)
    const others = openings.filter(q => onLine(o, q) && concrete(q) && q.width > 0);
    const lo = Math.max(run[0] + JAMB, ...others.map(q => ends(q)[1] + JAMB).filter(v => v <= s + JAMB + EPS));
    const hi = Math.min(run[1] - JAMB, ...others.map(q => ends(q)[0] - JAMB).filter(v => v >= e - JAMB - EPS));
    const w = Math.min(want, hi - lo);
    if (w <= o.width + 0.02) continue;
    const c = Math.min(hi - w / 2, Math.max(lo + w / 2, o.center));
    o.center = c; o.width = w; report.doorsWidened++;
  }
  return { openings: openings.filter(o => o.width > 0.01), report };
}

/** the shared spaces of a flat: a wall between two of them is a partition only where it is drawn */
const PUBLIC = new Set(["living", "kitchen", "dining", "hall", "corridor", "entrance"]);
const isPublic = (r: Room) => PUBLIC.has(r.surfaceType ?? r.type) && PUBLIC.has(r.type);

/** After the openings are resolved: a short piece of wall (under STUB) beside a passage, between two
 * shared spaces (living, kitchen, hall, entrance), is a pillar the drawing never had — opened as
 * part of the passage. Private rooms' and wet rooms' walls are left as they are. */
export function openPublicStubs(rooms: Room[], openings: Opening[]): { openings: Opening[]; opened: number } {
  const out = openings.slice(); let opened = 0;
  for (const r of rooms) {
    if (!isPublic(r)) continue;
    for (const [axis, at, lo, hi] of [["x", r.rect[0], r.rect[1], r.rect[3]], ["x", r.rect[2], r.rect[1], r.rect[3]], ["z", r.rect[1], r.rect[0], r.rect[2]], ["z", r.rect[3], r.rect[0], r.rect[2]]] as const) {
      const j = axis === "x" ? 0 : 1, k = 1 - j, low = Math.abs(r.rect[j + 2] - at) < EPS;
      const holes = openingsOnWall(rooms, out, r, axis, at, lo, hi, true).map(o => ({ s: o.center - o.width / 2, e: o.center + o.width / 2, open: o.type === "open" })).sort((a, b) => a.s - b.s);
      if (!holes.some(h => h.open)) continue;
      // the wall pieces between the holes, each with whether a passage is beside it
      const pieces: { s: number; e: number; byPassage: boolean }[] = [];
      let a = lo, prevOpen = false;
      for (const h of holes) { if (h.s - a > EPS) pieces.push({ s: a, e: h.s, byPassage: prevOpen || h.open }); if (h.e > a) { a = h.e; prevOpen = h.open; } }
      if (hi - a > EPS) pieces.push({ s: a, e: hi, byPassage: prevOpen });
      for (const p of pieces) {
        if (!p.byPassage || p.e - p.s >= STUB) continue;
        // (only one shared space across the whole piece: a stub between two neighbours stays)
        const across = rooms.filter(q => q !== r && Math.abs(q.rect[low ? j : j + 2] - at) < EPS && q.rect[k] <= p.s + EPS && q.rect[k + 2] >= p.e - EPS);
        const q = across[0];
        if (across.length !== 1 || !isPublic(q)) continue;
        // (already open from the other side)
        if (out.some(o => o.type === "open" && o.axis === axis && Math.abs(o.at - at) < EPS && o.center - o.width / 2 <= p.s + EPS && o.center + o.width / 2 >= p.e - EPS)) continue;
        out.push({ type: "open", a: r.id, b: q.id, axis, at, center: (p.s + p.e) / 2, width: p.e - p.s, height: 2.4, sill: 0 });
        opened++;
      }
    }
  }
  return { openings: out, opened };
}

/** Pieces of one room (one zone) whose union is a rectangle and whose seam is open over its whole
 * length — after tidyImageOpenings, the strips and the mostly-open seams — become one rectangle:
 * the room is furnished and walked as the size it is (its furniture went in the largest piece
 * only: a living room kept 76 % of its floor, a kitchen 69 %). Never across a door or a window,
 * never two zones; openings re-pointed to the merged room. */
export function mergeOpenPieces(input: Room[], source: Opening[]): { rooms: Room[]; openings: Opening[]; merged: number } {
  let rooms = input.map(r => ({ ...r, rect: [...r.rect] as Room["rect"] })), openings = source.map(o => ({ ...o })), merged = 0;
  const area = (r: Room) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
  for (let changed = true; changed;) {
    changed = false;
    pairs: for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      // (pieces of one room: a living room and its kitchen share a zone and stay two rooms)
      if (a.zone !== b.zone || (a.type !== b.type && a.type !== "hall" && b.type !== "hall")) continue;
      let axis: "x" | "z", at: number, lo: number, hi: number;
      if (Math.abs(a.rect[0] - b.rect[0]) < EPS && Math.abs(a.rect[2] - b.rect[2]) < EPS && (Math.abs(a.rect[3] - b.rect[1]) < EPS || Math.abs(b.rect[3] - a.rect[1]) < EPS)) {
        axis = "z"; at = Math.abs(a.rect[3] - b.rect[1]) < EPS ? a.rect[3] : b.rect[3]; lo = a.rect[0]; hi = a.rect[2];
      } else if (Math.abs(a.rect[1] - b.rect[1]) < EPS && Math.abs(a.rect[3] - b.rect[3]) < EPS && (Math.abs(a.rect[2] - b.rect[0]) < EPS || Math.abs(b.rect[2] - a.rect[0]) < EPS)) {
        axis = "x"; at = Math.abs(a.rect[2] - b.rect[0]) < EPS ? a.rect[2] : b.rect[2]; lo = a.rect[1]; hi = a.rect[3];
      } else continue;
      const seam = openings.filter(o => o.axis === axis && Math.abs(o.at - at) < EPS && o.width > 0.01 && o.center + o.width / 2 > lo + EPS && o.center - o.width / 2 < hi - EPS);
      if (seam.some(o => o.type !== "open")) continue;
      // (open over the whole seam: the passages' union covers it, a hair's gap at each end allowed)
      const iv = seam.map(o => [o.center - o.width / 2, o.center + o.width / 2]).sort((p, q) => p[0] - q[0]);
      let reach = lo;
      for (const [s, e] of iv) { if (s > reach + 0.02) break; reach = Math.max(reach, e); }
      if (reach < hi - 0.02) continue;
      const keep = (a.type !== "hall") !== (b.type !== "hall") ? (a.type !== "hall" ? a : b) : area(a) >= area(b) ? a : b, gone = keep === a ? b : a;
      keep.rect = [Math.min(a.rect[0], b.rect[0]), Math.min(a.rect[1], b.rect[1]), Math.max(a.rect[2], b.rect[2]), Math.max(a.rect[3], b.rect[3])];
      rooms = rooms.filter(r => r !== gone);
      openings = openings.filter(o => !seam.includes(o)).map(o => ({ ...o, a: o.a === gone.id ? keep.id : o.a, b: o.b === gone.id ? keep.id : o.b, swingInto: o.swingInto === gone.id ? keep.id : o.swingInto })).filter(o => o.a !== o.b);
      merged++; changed = true; break pairs;
    }
  }
  return { rooms, openings, merged };
}
