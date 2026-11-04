import type { FloorPlan, Opening, Room } from "./types";
import { openingsOnWall, resolveWallOpenings } from "./wallOpenings";

/* Can a body walk into every room of an image-read flat? The walls are what build.ts stands up:
 * every room edge, less the doorish openings on it (front door shut), each a wall's half
 * thickness inside its room; the walker a 0.24 m-radius body on a 4 cm grid from the front door.
 * No furniture here — this is the plan's own access, checked (and mended) before furnishing. */

const R = 0.24, C = 0.04, EPS = 0.002;
const HALF_WALL = 0.06;
const doorish = (o: Opening) => o.type === "door" || o.type === "sliding_door" || o.type === "glass_door" || o.type === "open";
/** rooms a person must be able to go into (a balcony too: it is a room you can stand in) */
const MUST = new Set(["living", "kitchen", "bedroom", "master", "bathroom", "ensuite", "dressroom", "alpha", "entrance", "hall", "utility", "balcony"]);
export const kindOf = (r: Room) => (r.type === "hall" ? r.surfaceType ?? r.type : r.type);

type Seg = [number, number, number, number];
export interface AccessReport {
  /** rooms (zones) with room for a body inside that the walker cannot reach */
  blocked: { id: string; label: string; zone: string }[];
  /** zones checked */
  targets: number;
  repairs: number;
}

const half = (p: FloorPlan) => (p.imageAnalysis?.wallThicknessMetres !== undefined ? p.imageAnalysis.wallThicknessMetres / 2 : HALF_WALL);

function segmentsOf(p: FloorPlan): Seg[] {
  const ops = resolveWallOpenings(p.rooms, p.openings, true), e = half(p), out: Seg[] = [];
  for (const r of p.rooms) {
    const [x0, z0, x1, z1] = r.rect;
    const sides = [
      { axis: "z" as const, line: z0, lo: x0, hi: x1, at: (a: number): [number, number] => [a, z0 + e] },
      { axis: "z" as const, line: z1, lo: x0, hi: x1, at: (a: number): [number, number] => [a, z1 - e] },
      { axis: "x" as const, line: x0, lo: z0, hi: z1, at: (a: number): [number, number] => [x0 + e, a] },
      { axis: "x" as const, line: x1, lo: z0, hi: z1, at: (a: number): [number, number] => [x1 - e, a] },
    ];
    for (const s of sides) {
      const pass = openingsOnWall(p.rooms, ops, r, s.axis, s.line, s.lo, s.hi, true).filter(doorish)
        .map(o => [Math.max(s.lo, o.center - o.width / 2), Math.min(s.hi, o.center + o.width / 2)] as [number, number]).sort((a, b) => a[0] - b[0]);
      let a = s.lo;
      for (const [g0, g1] of pass) { if (g0 > a + EPS) out.push([...s.at(a), ...s.at(g0)]); a = Math.max(a, g1); }
      if (s.hi > a + EPS) out.push([...s.at(a), ...s.at(s.hi)]);
    }
  }
  // (each swing door's leaf standing open in the room it swings into, as the walk test has them:
  // from its hinge — the start of the doorway, or its end — a door's width out of the wall)
  const byId = new Map(p.rooms.map(r => [r.id, r]));
  for (const o of p.openings) {
    if (o.type !== "door" || o.b === "out") continue;
    const into = byId.get(o.swingInto ?? o.a); if (!into) continue;
    const j = o.axis === "x" ? 0 : 1, dir = Math.abs(into.rect[j] - o.at) < EPS ? 1 : -1;
    const h = o.hinge === "end" ? o.center + o.width / 2 : o.center - o.width / 2, len = o.width * 0.95;
    out.push(o.axis === "x" ? [o.at, h, o.at + dir * len, h] : [h, o.at, h, o.at + dir * len]);
  }
  return out;
}

interface Grid { nx: number; nz: number; x0: number; z0: number; free: Uint8Array; seen: Uint8Array; from?: Int32Array; }

function flood(p: FloorPlan): Grid | null {
  const [bx0, bz0, bx1, bz1] = p.bounds, nx = Math.ceil((bx1 - bx0) / C), nz = Math.ceil((bz1 - bz0) / C);
  if (nx < 1 || nz < 1 || nx * nz > 400000) return null;
  const segs = segmentsOf(p), free = new Uint8Array(nx * nz), seen = new Uint8Array(nx * nz);
  const inRoom = new Uint8Array(nx * nz);
  for (const r of p.rooms) {
    const i0 = Math.max(0, Math.floor((r.rect[0] - bx0) / C)), i1 = Math.min(nx - 1, Math.ceil((r.rect[2] - bx0) / C));
    const j0 = Math.max(0, Math.floor((r.rect[1] - bz0) / C)), j1 = Math.min(nz - 1, Math.ceil((r.rect[3] - bz0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = bx0 + (i + .5) * C, z = bz0 + (j + .5) * C; if (x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]) inRoom[j * nx + i] = 1; }
  }
  free.set(inRoom);
  // carve each wall's body-radius band out of the free cells
  for (const [a, b, c, d] of segs) {
    const i0 = Math.max(0, Math.floor((Math.min(a, c) - R - bx0) / C)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a, c) + R - bx0) / C));
    const j0 = Math.max(0, Math.floor((Math.min(b, d) - R - bz0) / C)), j1 = Math.min(nz - 1, Math.ceil((Math.max(b, d) + R - bz0) / C));
    const dx = c - a, dz = d - b, L = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i; if (!free[k]) continue;
      const x = bx0 + (i + .5) * C, z = bz0 + (j + .5) * C, t = Math.max(0, Math.min(1, ((x - a) * dx + (z - b) * dz) / L));
      if (Math.hypot(x - a - t * dx, z - b - t * dz) < R) free[k] = 0;
    }
  }
  // start just inside the front door (else the living room's centre)
  const fd = p.openings.find(o => o.type === "front_door");
  let sx: number, sz: number;
  const room = fd && p.rooms.find(r => r.id === fd.a);
  if (fd && room) {
    const j = fd.axis === "x" ? 0 : 1, inward = Math.abs(room.rect[j] - fd.at) < EPS ? 1 : -1, d = 0.45;
    [sx, sz] = fd.axis === "x" ? [fd.at + inward * d, fd.center] : [fd.center, fd.at + inward * d];
  } else { const l = p.rooms.find(r => r.type === "living") ?? p.rooms[0]; sx = (l.rect[0] + l.rect[2]) / 2; sz = (l.rect[1] + l.rect[3]) / 2; }
  let best = -1, bd = Infinity;
  for (let k = 0; k < free.length; k++) if (free[k]) { const x = bx0 + (k % nx + .5) * C, z = bz0 + (Math.floor(k / nx) + .5) * C, dd = Math.hypot(x - sx, z - sz); if (dd < bd) { bd = dd; best = k; } }
  if (best < 0) return { nx, nz, x0: bx0, z0: bz0, free, seen };
  const q = [best], from = new Int32Array(free.length).fill(-1); seen[best] = 1;
  for (let h = 0; h < q.length; h++) { const k = q[h], i = k % nx; for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (n >= 0 && n < free.length && free[n] && !seen[n]) { seen[n] = 1; from[n] = k; q.push(n); } }
  return { nx, nz, x0: bx0, z0: bz0, free, seen, from };
}

/** cells of a room: [free cells, reached cells] */
function cellsIn(g: Grid, r: Room): [number, number] {
  let f = 0, s = 0;
  const i0 = Math.max(0, Math.floor((r.rect[0] - g.x0) / C)), i1 = Math.min(g.nx - 1, Math.ceil((r.rect[2] - g.x0) / C));
  const j0 = Math.max(0, Math.floor((r.rect[1] - g.z0) / C)), j1 = Math.min(g.nz - 1, Math.ceil((r.rect[3] - g.z0) / C));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = g.x0 + (i + .5) * C, z = g.z0 + (j + .5) * C; if (x <= r.rect[0] || x >= r.rect[2] || z <= r.rect[1] || z >= r.rect[3]) continue;
    const k = j * g.nx + i; if (g.free[k]) f++; if (g.seen[k]) s++;
  }
  return [f, s];
}

/** rooms (each piece of floor a body fits in, of a room a person goes into) the walker cannot reach */
export function planAccess(p: FloorPlan): AccessReport {
  const g = flood(p);
  const blocked: AccessReport["blocked"] = [];
  let targets = 0;
  for (const r of p.rooms) {
    if (!MUST.has(kindOf(r))) continue;
    if (!g) { targets++; blocked.push({ id: r.id, label: r.label, zone: r.zone }); continue; }
    const [free, reached] = cellsIn(g, r);
    // (a piece no body fits in is a duct or a sliver, not floor to go onto)
    if (free * C * C < 0.3) continue;
    targets++;
    if (reached * C * C < 0.12) blocked.push({ id: r.id, label: r.label, zone: r.zone });
  }
  return { blocked, targets, repairs: 0 };
}

const PRIVATE = new Set(["bedroom", "master", "bathroom", "ensuite", "dressroom", "alpha"]);
const WET = new Set(["bathroom", "ensuite"]);
const JAMB = 0.08;

/** A gap a drawing shows into a bedroom or a bathroom from another room is its doorway: the wall
 * resolver never lets a private room stand open to another (resolveWallOpenings), so an "open"
 * read there is turned into a door of a door's width, or the room is left with no way in. */
export function privateOpensToDoors(rooms: Room[], openings: Opening[]): { openings: Opening[]; doors: number } {
  const ids = new Map(rooms.map(r => [r.id, r]));
  const kind = (r: Room) => r.surfaceType ?? r.type;
  // (a room whose door was read already keeps that one: a gap read beside it at the same corner is
  // the same doorway read twice, and two leaves there shut each other's way)
  const hasDoor = new Set<string>();
  for (const o of openings) {
    if (!["door", "sliding_door", "glass_door"].includes(o.type) || o.b === "out") continue;
    const a = ids.get(o.a), b = ids.get(o.b);
    if (!a || !b || a.zone === b.zone) continue;
    if (!["balcony", "utility"].includes(kind(b))) hasDoor.add(a.zone);
    if (!["balcony", "utility"].includes(kind(a))) hasDoor.add(b.zone);
  }
  let doors = 0;
  const out = openings.map(o => {
    if (o.type !== "open" || o.b === "out") return o;
    const a = ids.get(o.a), b = ids.get(o.b);
    if (!a || !b || a.zone === b.zone) return o;
    const pa = PRIVATE.has(a.surfaceType ?? a.type), pb = PRIVATE.has(b.surfaceType ?? b.type);
    if (!pa && !pb) return o;
    if ((!pa || hasDoor.has(a.zone)) && (!pb || hasDoor.has(b.zone))) return o;
    const wet = WET.has(a.surfaceType ?? a.type) || WET.has(b.surfaceType ?? b.type);
    const width = Math.min(o.width, wet ? 0.8 : 0.9);
    // (the leaf swings into the private room; into the bedroom from its bathroom or dressing room)
    const into = pa && pb ? (WET.has(a.surfaceType ?? a.type) ? a : b) : pa ? a : b;
    doors++;
    hasDoor.add(a.zone); hasDoor.add(b.zone);
    return { ...o, type: "door" as const, width, height: 2.1, sill: 0, hinge: "start" as const, swingInto: into.id };
  });
  return { openings: out, doors };
}

/** what the walker may come into a room of this kind through, best first */
function rank(kind: string, q: Room): number {
  const k = q.type === "hall" && !PRIVATE.has(q.surfaceType ?? "") ? "hall" : kindOf(q);
  const order: Record<string, string[]> = {
    bathroom: ["hall", "entrance", "living", "kitchen", "dressroom", "master", "bedroom", "alpha", "utility"],
    dressroom: ["master", "bedroom", "hall", "alpha", "living"],
    bedroom: ["hall", "living", "entrance", "kitchen", "dressroom", "alpha", "bedroom", "master"],
    balcony: ["living", "kitchen", "bedroom", "master", "alpha", "hall", "utility", "balcony", "dressroom"],
    utility: ["kitchen", "hall", "living", "balcony", "entrance", "utility"],
    public: ["hall", "living", "kitchen", "entrance", "alpha", "bedroom", "master", "balcony", "utility"],
  };
  const of = WET.has(kind) ? "bathroom" : kind === "dressroom" ? "dressroom" : kind === "bedroom" || kind === "master" || kind === "alpha" ? "bedroom" : kind === "balcony" ? "balcony" : kind === "utility" ? "utility" : "public";
  const i = order[of].indexOf(k);
  return i < 0 ? 99 : i;
}

/** the clear runs of the wall between two rooms, away from corners and from what is already on it */
function sharedRuns(p: FloorPlan, r: Room, q: Room): { axis: "x" | "z"; at: number; lo: number; hi: number }[] {
  const out: { axis: "x" | "z"; at: number; lo: number; hi: number }[] = [];
  for (const axis of ["x", "z"] as const) {
    const j = axis === "x" ? 0 : 1, k = 1 - j;
    const at = Math.abs(r.rect[j + 2] - q.rect[j]) < EPS ? r.rect[j + 2] : Math.abs(q.rect[j + 2] - r.rect[j]) < EPS ? r.rect[j] : null;
    if (at === null) continue;
    const lo = Math.max(r.rect[k], q.rect[k]), hi = Math.min(r.rect[k + 2], q.rect[k + 2]);
    if (hi - lo < 0.5) continue;
    const cuts = [lo, hi];
    for (const o of p.rooms) if (Math.abs(o.rect[j] - at) < EPS || Math.abs(o.rect[j + 2] - at) < EPS) for (const v of [o.rect[k], o.rect[k + 2]]) if (v > lo && v < hi) cuts.push(v);
    cuts.sort((a, b) => a - b);
    for (let n = 1; n < cuts.length; n++) {
      let iv: [number, number][] = [[cuts[n - 1] + JAMB, cuts[n] - JAMB]];
      for (const o of p.openings) if (o.axis === axis && Math.abs(o.at - at) < EPS) {
        const s = o.center - o.width / 2 - JAMB, e = o.center + o.width / 2 + JAMB;
        iv = iv.flatMap(([x, y]) => e <= x || s >= y ? [[x, y] as [number, number]] : ([[x, Math.min(y, s)], [Math.max(x, e), y]] as [number, number][]).filter(([u, v]) => v - u > 0.01));
      }
      for (const [x, y] of iv) if (y - x > 0.5) out.push({ axis, at, lo: x, hi: y });
    }
  }
  return out;
}

const reachedRooms = (p: FloorPlan, g: Grid | null) => {
  const seen = new Set<string>();
  if (g) for (const r of p.rooms) if (cellsIn(g, r)[1] * C * C >= 0.12) seen.add(r.id);
  return seen;
};

/** Mend a plan whose rooms cannot all be walked into: each room the walker cannot reach gets a way
 * in — a door (a passage between two shared spaces, a glazed door to a balcony) in its wall with a
 * reached room, the kind of room it would open from first (a bathroom from the hall, a dressing
 * room from its bedroom), on the longest clear run of that wall. Each one is kept only when the
 * walk then reaches the room. Returns how many were added. */
export function mendAccess(p: FloorPlan): number {
  let added = flipLeaves(p);
  for (let pass = 0; pass < 24; pass++) {
    const before = planAccess(p);
    if (!before.blocked.length) break;
    const reached = reachedRooms(p, flood(p));
    let progress = false;
    for (const b of before.blocked) {
      if (reached.has(b.id)) continue;
      const r = p.rooms.find(x => x.id === b.id)!;
      // (a room's lead piece names what it is: its hall pieces are that room too)
      const lead = p.rooms.find(x => x.zone === r.zone && x.type !== "hall") ?? r;
      const kind = kindOf(lead);
      const cands: { q: Room; run: ReturnType<typeof sharedRuns>[number]; score: number }[] = [];
      for (const q of p.rooms) {
        if (q === r || !reached.has(q.id)) continue;
        const qk = kindOf(q), same = q.zone === r.zone;
        if (!same && WET.has(kind) && (WET.has(qk) || qk === "balcony")) continue;
        if (!same && kind === "balcony" && WET.has(qk)) continue;
        // (another piece of the same room first: the seam between them opened)
        const pr = same ? -1 : rank(kind, q);
        for (const run of sharedRuns(p, r, q)) cands.push({ q, run, score: pr * 100 - Math.min(5, run.hi - run.lo) });
      }
      cands.sort((x, y) => x.score - y.score);
      for (const c of cands) {
        const len = c.run.hi - c.run.lo, qk = kindOf(c.q), same = c.q.zone === r.zone;
        const pub = same || (!PRIVATE.has(kind) && !PRIVATE.has(qk) && kind !== "balcony" && qk !== "balcony" && kind !== "utility" && qk !== "utility");
        const wet = WET.has(kind) || WET.has(qk);
        const want = pub ? len : kind === "balcony" || qk === "balcony" ? Math.min(1.6, len) : Math.min(wet ? 0.8 : 0.9, len);
        if (want < (wet ? 0.68 : 0.72)) continue;
        // (a door by the run's end nearer a corner, as flats have them; a passage the whole run)
        const center = pub ? (c.run.lo + c.run.hi) / 2 : c.run.lo + want / 2;
        const type: Opening["type"] = pub ? "open" : (kind === "balcony" || qk === "balcony") && want >= 1.2 ? "glass_door" : "door";
        const into = PRIVATE.has(kind) ? r : PRIVATE.has(qk) ? c.q : r;
        const o: Opening = { type, a: r.id, b: c.q.id, axis: c.run.axis, at: c.run.at, center, width: want, height: type === "open" ? 2.4 : 2.1, sill: 0, hinge: "start", swingInto: into.id };
        p.openings.push(o);
        if (reachedRooms(p, flood(p)).has(r.id)) { added++; progress = true; break; }
        p.openings.pop();
      }
      if (reachedRooms(p, flood(p)).has(r.id)) continue;
      // (no clear wall left: a balcony's window to a reached room — the 발코니 창 a flat walks
      // through — made a glazed door over its own span)
      const wins = p.openings.filter(o => (o.type === "window" || o.type === "balcony_window") && o.b !== "out" && (o.a === r.id) !== (o.b === r.id))
        .map(o => ({ o, q: p.rooms.find(x => x.id === (o.a === r.id ? o.b : o.a))! })).filter(w => w.q && reached.has(w.q.id) && !WET.has(kindOf(w.q)) && !WET.has(kind) && (kind === "balcony" || kindOf(w.q) === "balcony" || kind === "utility"))
        .sort((x, y) => rank(kind, x.q) - rank(kind, y.q) || y.o.width - x.o.width);
      for (const { o } of wins) {
        if (o.width < 0.72) continue;
        const keep = { ...o };
        Object.assign(o, o.width >= 1.2 ? { type: "glass_door", sill: 0, height: 2.1 } : { type: "door", sill: 0, height: 2.1, width: Math.min(0.9, o.width), hinge: "start", swingInto: o.a });
        if (reachedRooms(p, flood(p)).has(r.id)) { added++; progress = true; break; }
        Object.assign(o, keep);
      }
      if (progress || reachedRooms(p, flood(p)).has(r.id)) continue;
      // (a wall's thickness of nothing between it and a reached room — the reader left the wall
      // line out of both: the room's side brought up to the other's, so a door can stand there)
      if (closeGap(p, r, reached)) progress = true;
    }
    if (!progress) break;
  }
  return added + flipLeaves(p);
}

/** a door whose open leaf stands across the way (to the room next to it, past a corner) hinged at
 * its other jamb, or swung into the other room: whichever leaves fewer rooms shut off */
function flipLeaves(p: FloorPlan): number {
  let n = planAccess(p).blocked.length, flipped = 0;
  if (!n) return 0;
  for (const o of p.openings) {
    if (o.type !== "door" || o.b === "out") continue;
    const was = { hinge: o.hinge, swingInto: o.swingInto };
    const other = o.swingInto === o.a ? o.b : o.a;
    let best = n, pick: typeof was | null = null;
    for (const t of [{ hinge: o.hinge === "end" ? "start" as const : "end" as const, swingInto: was.swingInto }, { hinge: was.hinge, swingInto: other }, { hinge: o.hinge === "end" ? "start" as const : "end" as const, swingInto: other }]) {
      Object.assign(o, t);
      const m = planAccess(p).blocked.length;
      if (m < best) { best = m; pick = t; }
    }
    Object.assign(o, pick ?? was);
    if (pick) { n = best; flipped++; if (!n) break; }
  }
  return flipped;
}

/** a blocked room's side moved across a gap under 0.35 m (no room in it) to a reached room's side */
function closeGap(p: FloorPlan, r: Room, reached: Set<string>): boolean {
  for (const q of p.rooms) {
    if (q === r || !reached.has(q.id)) continue;
    for (const j of [0, 1]) {
      const k = 1 - j;
      const lo = Math.max(r.rect[k], q.rect[k]), hi = Math.min(r.rect[k + 2], q.rect[k + 2]);
      if (hi - lo < 0.85) continue;
      // q beyond r's far side, or before its near side
      for (const [edge, to] of [[j + 2, q.rect[j]], [j, q.rect[j + 2]]] as const) {
        const gap = edge === j + 2 ? to - r.rect[j + 2] : r.rect[j] - to;
        if (gap <= EPS || gap > 0.35) continue;
        const next = [...r.rect] as Room["rect"]; next[edge] = to;
        const strip: Room["rect"] = j === 0 ? (edge === 2 ? [r.rect[2], r.rect[1], to, r.rect[3]] : [to, r.rect[1], r.rect[0], r.rect[3]]) : (edge === 3 ? [r.rect[0], r.rect[3], r.rect[2], to] : [r.rect[0], to, r.rect[2], r.rect[1]]);
        if (p.rooms.some(o => o !== r && Math.min(o.rect[2], strip[2]) - Math.max(o.rect[0], strip[0]) > EPS && Math.min(o.rect[3], strip[3]) - Math.max(o.rect[1], strip[1]) > EPS)) continue;
        const was = r.rect; r.rect = next;
        // (the openings on the side that moved go with it)
        const moved = p.openings.filter(o => (o.a === r.id || o.b === r.id) && o.axis === (j === 0 ? "x" : "z") && Math.abs(o.at - was[edge]) < EPS);
        for (const o of moved) o.at = to;
        return true;
      }
    }
  }
  return false;
}

/** The ways on foot from the front door into every room piece a person goes into, as 0.5 m-wide
 * strips (the walker's body): furniture keeps off them (furnish.ts Placer.walkway), so no wardrobe or
 * desk stands across the way to a room beyond it. Each way ends 0.4 m inside its room. */
export function walkways(p: FloorPlan): Rect4[] {
  const g = flood(p);
  if (!g?.from) return [];
  const { nx, x0, z0 } = g, dist = new Int32Array(g.free.length).fill(-1);
  // (BFS order distance from the start, from the parents)
  const order: number[] = [];
  for (let k = 0; k < g.free.length; k++) if (g.seen[k] && g.from[k] < 0) { dist[k] = 0; order.push(k); }
  for (let h = 0; h < order.length; h++) { const k = order[h], i = k % nx; for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) if (n >= 0 && n < g.free.length && g.from[n] === k && dist[n] < 0) { dist[n] = dist[k] + 1; order.push(n); } }
  const keep = new Set<number>();
  for (const r of p.rooms) {
    if (!MUST.has(kindOf(r))) continue;
    let entry = -1;
    const i0 = Math.max(0, Math.floor((r.rect[0] - x0) / C)), i1 = Math.min(nx - 1, Math.ceil((r.rect[2] - x0) / C));
    const j0 = Math.max(0, Math.floor((r.rect[1] - z0) / C)), j1 = Math.min(g.nz - 1, Math.ceil((r.rect[3] - z0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i, x = x0 + (i + .5) * C, z = z0 + (j + .5) * C;
      if (x <= r.rect[0] || x >= r.rect[2] || z <= r.rect[1] || z >= r.rect[3] || dist[k] < 0) continue;
      if (entry < 0 || dist[k] < dist[entry]) entry = k;
    }
    if (entry < 0) continue;
    // (on into the room 0.4 m, then back along the way to the door)
    let end = entry;
    for (let h = 0; h < order.length; h++) { const k = order[h]; if (dist[k] === dist[entry] + 10) { let a = k; while (a >= 0 && dist[a] > dist[entry]) a = g.from[a]; if (a === entry) { end = k; break; } } }
    for (let k = end; k >= 0; k = g.from[k]) keep.add(k);
  }
  const out: Rect4[] = [];
  for (const k of keep) { const x = x0 + (k % nx + .5) * C, z = z0 + (Math.floor(k / nx) + .5) * C; out.push([x - .25, z - .25, x + .25, z + .25]); }
  return out;
}
type Rect4 = [number, number, number, number];

export const accessGrid = flood;
export const accessCells = cellsIn;
