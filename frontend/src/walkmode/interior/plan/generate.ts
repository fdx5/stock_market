import type { FloorPlan, Opening, Room, RoomType, StyleName, Fixture } from "./types";
import type { Envelope } from "./envelope";
import { caseNumber, makeCaseLayout } from "./layoutCases";
import { STYLE_NAMES } from "./types";

/* An estimated floor plan for a unit of a given 전용면적: a Korean 판상형 layout made for the
 * complex's type (makeLayout: its bays, rooms and their sizes from the area, the era and a seed),
 * scaled to the area. (T2–T4 below are the original three drawings, kept for reference.)
 * Register/trade areas do not describe internal walls. This generator is the explicitly
 * estimated fallback; a separately verified image-derived plan takes priority.
 *
 * Templates are drawn on wall centre lines, so the rooms' areas add up to the 전용면적 the way
 * the register measures it. Front (z max) is the balcony side; the front door is on the back. */

export type R = [string, RoomType, string, number, number, number, number, string?];
export type O = Omit<Opening, "center" | "at"> & { center: number; at: number };
export interface Template { name: string; label: string; rooms: R[]; openings: O[]; ref: number }

const door = (a: string, b: string, axis: "x" | "z", at: number, center: number, width = 0.9, hinge: "start" | "end" = "start", swingInto = a): O =>
  ({ type: "door", a, b, axis, at, center, width, height: 2.1, sill: 0, hinge, swingInto });
const open = (a: string, b: string, axis: "x" | "z", at: number, center: number, width: number, height = 2.35): O =>
  ({ type: "open", a, b, axis, at, center, width, height, sill: 0 });
const win = (a: string, axis: "x" | "z", at: number, center: number, width: number, height: number, sill: number, type: Opening["type"] = "window"): O =>
  ({ type, a, b: "out", axis, at, center, width, height, sill });

// [id, type, label, x0, z0, x1, z1, zone]
const T4: Template = {
  name: "4bay", label: "4Bay 판상형", ref: 0,
  rooms: [
    ["bed3", "bedroom", "침실3", 0, 3.4, 2.6, 7.4],
    ["bed2", "bedroom", "침실2", 2.6, 3.4, 5.3, 7.4],
    ["living", "living", "거실", 5.3, 3.4, 9.1, 7.4, "lk"],
    ["master", "master", "안방", 9.1, 3.4, 12.0, 7.4],
    ["bath2", "bathroom", "공용 욕실", 0, 0, 2.9, 2.2],
    ["entry", "entrance", "현관", 2.9, 0, 5.3, 2.2],
    ["hall", "hall", "복도", 0, 2.2, 5.3, 3.4],
    ["kitchen", "kitchen", "주방·식당", 5.3, 0, 9.1, 3.4, "lk"],
    ["dress", "dressroom", "드레스룸", 9.1, 1.9, 12.0, 3.4],
    ["ensuite", "ensuite", "안방 욕실", 9.1, 0, 12.0, 1.9],
    ["util", "utility", "다용도실", 5.3, -1.5, 7.3, 0],
  ],
  openings: [
    { type: "front_door", a: "entry", b: "out", axis: "z", at: 0, center: 4.1, width: 0.95, height: 2.1, sill: 0, hinge: "end", swingInto: "out" },
    { type: "glass_door", a: "entry", b: "hall", axis: "z", at: 2.2, center: 4.1, width: 1.7, height: 2.25, sill: 0 },
    door("bath2", "hall", "z", 2.2, 2.25, 0.75, "end"),
    door("bed3", "hall", "z", 3.4, 2.0, 0.9, "end"),
    door("bed2", "hall", "z", 3.4, 4.6, 0.9, "start"),
    open("hall", "kitchen", "x", 5.3, 2.8, 1.2),
    open("living", "kitchen", "z", 3.4, 7.2, 3.8),
    door("master", "living", "x", 9.1, 3.95, 0.9, "start"),
    open("master", "dress", "z", 3.4, 11.4, 0.9),
    door("ensuite", "dress", "z", 1.9, 10.0, 0.75, "start"),
    { type: "glass_door", a: "util", b: "kitchen", axis: "z", at: 0, center: 6.3, width: 0.85, height: 2.1, sill: 0, hinge: "start", swingInto: "util" },
    win("bed3", "z", 7.4, 1.3, 1.6, 1.5, 0.6),
    win("bed2", "z", 7.4, 3.95, 1.8, 1.5, 0.6),
    win("living", "z", 7.4, 7.2, 3.3, 2.25, 0.02, "balcony_window"),
    win("master", "z", 7.4, 10.55, 2.2, 1.6, 0.5),
    win("kitchen", "z", 0, 8.2, 1.3, 1.0, 1.1),
    win("util", "z", -1.5, 6.3, 1.4, 1.1, 1.0),
    win("bed3", "x", 0, 5.6, 1.0, 1.2, 0.9),
  ],
};

const T3: Template = {
  name: "3bay", label: "3Bay 판상형", ref: 0,
  rooms: [
    ["bed2", "bedroom", "침실2", 0, 3.0, 2.7, 6.8],
    ["living", "living", "거실", 2.7, 3.0, 6.2, 6.8, "lk"],
    ["master", "master", "안방", 6.2, 3.0, 9.0, 6.8],
    ["entry", "entrance", "현관", 0, 0, 1.8, 1.9],
    ["bath2", "bathroom", "공용 욕실", 1.8, 0, 3.6, 1.9],
    ["hall", "hall", "복도", 0, 1.9, 3.6, 3.0],
    ["kitchen", "kitchen", "주방·식당", 3.6, 0, 6.2, 3.0, "lk"],
    ["dress", "dressroom", "드레스룸", 6.2, 1.6, 9.0, 3.0],
    ["ensuite", "ensuite", "안방 욕실", 6.2, 0, 9.0, 1.6],
    ["util", "utility", "다용도실", 3.6, -1.3, 5.4, 0],
  ],
  openings: [
    { type: "front_door", a: "entry", b: "out", axis: "z", at: 0, center: 0.9, width: 0.95, height: 2.1, sill: 0, hinge: "start", swingInto: "out" },
    { type: "glass_door", a: "entry", b: "hall", axis: "z", at: 1.9, center: 0.9, width: 1.5, height: 2.25, sill: 0 },
    door("bath2", "hall", "z", 1.9, 2.75, 0.75, "end"),
    door("bed2", "hall", "z", 3.0, 1.6, 0.9, "start"),
    open("hall", "living", "z", 3.0, 3.15, 0.9),
    open("hall", "kitchen", "x", 3.6, 2.45, 1.1),
    open("living", "kitchen", "z", 3.0, 4.9, 2.6),
    door("master", "living", "x", 6.2, 3.55, 0.9, "start"),
    open("master", "dress", "z", 3.0, 8.3, 0.9),
    door("ensuite", "dress", "z", 1.6, 7.0, 0.75, "start"),
    { type: "glass_door", a: "util", b: "kitchen", axis: "z", at: 0, center: 4.5, width: 0.8, height: 2.1, sill: 0, hinge: "start", swingInto: "util" },
    win("bed2", "z", 6.8, 1.35, 1.7, 1.5, 0.6),
    win("living", "z", 6.8, 4.45, 3.1, 2.25, 0.02, "balcony_window"),
    win("master", "z", 6.8, 7.6, 2.1, 1.6, 0.5),
    win("kitchen", "z", 0, 5.8, 0.7, 0.9, 1.15),
    win("util", "z", -1.3, 4.5, 1.2, 1.1, 1.0),
  ],
};

const T2: Template = {
  name: "2bay", label: "2Bay 판상형", ref: 0,
  rooms: [
    ["master", "master", "침실", 0, 2.6, 3.0, 6.4],
    ["living", "living", "거실", 3.0, 2.6, 7.0, 6.4, "lk"],
    ["entry", "entrance", "현관", 0, 0, 1.6, 1.6],
    ["bath2", "bathroom", "욕실", 1.6, 0, 3.4, 1.6],
    ["hall", "hall", "복도", 0, 1.6, 3.4, 2.6],
    ["kitchen", "kitchen", "주방·식당", 3.4, 0, 7.0, 2.6, "lk"],
  ],
  openings: [
    { type: "front_door", a: "entry", b: "out", axis: "z", at: 0, center: 0.8, width: 0.95, height: 2.1, sill: 0, hinge: "start", swingInto: "out" },
    open("entry", "hall", "z", 1.6, 0.8, 1.3),
    door("bath2", "hall", "z", 1.6, 2.5, 0.75, "end"),
    door("master", "hall", "z", 2.6, 1.6, 0.9, "start"),
    open("hall", "living", "z", 2.6, 3.2, 0.4),
    open("hall", "kitchen", "x", 3.4, 2.1, 1.0),
    open("living", "kitchen", "z", 2.6, 5.2, 3.6),
    win("master", "z", 6.4, 1.5, 1.8, 1.5, 0.6),
    win("living", "z", 6.4, 5.0, 3.2, 2.25, 0.02, "balcony_window"),
    win("kitchen", "z", 0, 5.4, 1.2, 1.0, 1.1),
  ],
};

const SERVICE: RoomType[] = ["utility", "balcony"];
const areaOf = (r: [number, number, number, number]) => (r[2] - r[0]) * (r[3] - r[1]);
for (const t of [T2, T3, T4]) t.ref = t.rooms.filter(r => !SERVICE.includes(r[1])).reduce((s, r) => s + (r[5] - r[3]) * (r[6] - r[4]), 0);

export function templateFor(area: number): Template { return area < 50 ? T2 : area < 78 ? T3 : T4; }

/* ---- the layouts: made from the unit's size, its complex's era and a seed — not three fixed
 * drawings, which gave every flat of 78㎡ and up the one same 4Bay plan. A Korean 판상형 flat is a
 * row of bays along the balcony front (the living room, the master bedroom at one end, bedrooms at the
 * other) over a service band at the back (the front door and its 중문, the bathrooms, the kitchen
 * behind the living room, the master's dressing room and en-suite), a corridor between. Varied here,
 * as they vary between complexes and types: the bays (2, 3, 4), every room's width and the two bands'
 * depths; the door and the bathroom's order; a fourth bedroom, an 알파룸 or a pantry beside them; the
 * old blocks' corridor across the whole width (the kitchen and a third bedroom off it, one bathroom),
 * the newer ones' only as far as the living room; the kitchen open to the corridor or not; dressing
 * room and en-suite, en-suite alone with a built-in wardrobe, or neither; the utility room behind the
 * kitchen's either end; the end flats' side windows. The same type in the same complex always comes
 * out the same; the plan is mirrored by the 동's line (see generatePlan). */

/** the wall two rectangles share: its axis, its line and span; null if they do not touch */
function touch(a: number[], b: number[]): { axis: "x" | "z"; at: number; lo: number; hi: number } | null {
  const e = 0.01;
  if (Math.abs(a[2] - b[0]) < e || Math.abs(a[0] - b[2]) < e) {
    const lo = Math.max(a[1], b[1]), hi = Math.min(a[3], b[3]);
    if (hi - lo > 0.7) return { axis: "x", at: Math.abs(a[2] - b[0]) < e ? a[2] : a[0], lo, hi };
  }
  if (Math.abs(a[3] - b[1]) < e || Math.abs(a[1] - b[3]) < e) {
    const lo = Math.max(a[0], b[0]), hi = Math.min(a[2], b[2]);
    if (hi - lo > 0.7) return { axis: "z", at: Math.abs(a[3] - b[1]) < e ? a[3] : a[1], lo, hi };
  }
  return null;
}

export function makeLayout(area: number, built: number | null | undefined, rnd: () => number, env?: Envelope | null, baysOverride?:2|3|4): Template {
  const year = built ?? 2005, old = year < 1993, recent = year >= 2010;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const vary = (v: number, k = 0.1) => v * (1 - k + rnd() * 2 * k);
  // (the bays: from the flat's measured width when its building is known — a bay ~2.7–4.2 m; else
  // the usual ones for its size and era)
  const fromWidth = env ? (env.width >= 10.4 ? 4 : env.width >= 7.6 ? 3 : 2) : 0;
  const bays = baysOverride ?? (env ? Math.min(fromWidth, area < 52 || (old && area < 62) ? 2 : area < 70 ? 3 : 4, env.kind === "tower" ? 3 : 4) || 2
    : area < 52 ? 2 : area < 70 ? (old ? 2 : pick([2, 3, 3])) : area < 95 ? (old ? 3 : pick([3, 3, 4, 4])) : 4);
  const big = area >= 125;
  const L = vary(area < 52 ? 3.6 : area < 100 ? 4.0 : 4.6), M = vary(area < 66 ? 3.0 : 3.35), B = () => vary(area < 70 ? 2.75 : 2.9);
  // (the old blocks' corridor across the whole width: the rooms behind it a room's depth, ~2.4 m)
  const fullHall = old || env?.kind === "corridor" || rnd() < 0.18, hh = vary(1.25, 0.06);
  // (and behind a partial corridor, a bathroom's ~1.8 m depth at least)
  const Df = vary(area < 66 ? 3.7 : 4.0, 0.08), Db = fullHall ? hh + vary(2.5, 0.06) : Math.max(hh + 1.8, vary(area < 66 ? 2.75 : 3.15, 0.08));
  const rooms: R[] = [], openings: O[] = [];
  // the front, left to right
  const front: [string, RoomType, string, number][] =
    bays === 2 ? [["master", "master", "침실", M], ["living", "living", "거실", L]]
    : bays === 3 ? [["bed2", "bedroom", "침실2", B()], ["living", "living", "거실", L], ["master", "master", "안방", M]]
    : [["bed3", "bedroom", "침실3", B()], ["bed2", "bedroom", "침실2", B()], ["living", "living", "거실", L], ["master", "master", "안방", M]];
  const W = front.reduce((s, f) => s + f[3], 0), D = Db + Df;
  const fx: Record<string, [number, number]> = {};
  { let x = 0; for (const [id, type, label, w] of front) { rooms.push([id, type, label, x, Db, x + w, D, type === "living" ? "lk" : undefined]); fx[id] = [x, x + w]; x += w; } }
  const lv = fx.living, ms = fx.master;
  // the service band (z 0..Db); the corridor along its front edge
  const zb = Db - hh;
  const ensuite = bays > 2 && (!old || area >= 100), dress = ensuite && area >= 72 && rnd() < (recent ? 0.95 : 0.7);
  const kitchenOpen = fullHall || rnd() < (recent ? 0.75 : 0.45);
  // (the door and the bathroom need ~1.5 m and ~1.9 m: under a narrow bedroom they take part of the
  // kitchen's width, which stays under the living room's)
  const span0 = bays === 2 ? ms[1] : lv[0], sSpan = Math.max(span0, Math.min(span0 + (lv[1] - lv[0]) * 0.4, 3.5));
  const hall: [number, number] = fullHall ? [0, W] : [0, sSpan];
  // under the bedrooms (or the 2-bay's master): the door, the bathroom, maybe a room more
  {
    const span = sSpan, bw = Math.max(Math.min(1.9, span * 0.55), Math.min(vary(2.3), span * 0.55)), ew = Math.min(vary(area < 85 ? 1.8 : 2.2), span - bw);
    const parts: [string, RoomType, string, number][] = [];
    const extra = span - bw - ew;
    if (extra > 2.4 && big) parts.push(["bed4", "bedroom", "침실4", extra]);
    // (an 알파룸 only as deep as a room: shallower, a pantry)
    else if (extra > 1.5 && recent) parts.push(rnd() < 0.5 && zb >= 2.3 && extra >= 2.2 ? ["alpha", "bedroom", "알파룸", extra] : ["pantry", "dressroom", "팬트리", extra]);
    const ew2 = span - bw - parts.reduce((s, p) => s + p[3], 0);
    const pair: [string, RoomType, string, number][] = [["entry", "entrance", "현관", ew2], ["bath2", "bathroom", bays === 2 || !ensuite ? "욕실" : "공용 욕실", bw]];
    if (rnd() < 0.5) pair.reverse();
    const all = rnd() < 0.5 ? [...parts, ...pair] : [...pair, ...parts];
    let x = 0; for (const [id, type, label, w] of all) { rooms.push([id, type, label, x, 0, x + w, zb]); x += w; }
  }
  // the kitchen under the living room
  rooms.push(["kitchen", "kitchen", "주방·식당", bays === 2 ? Math.max(lv[0], sSpan) : sSpan, 0, lv[1], fullHall ? zb : Db, "lk"]);
  // under the master
  if (bays > 2) {
    const zt = fullHall ? zb : Db;
    if (!ensuite) rooms.push(["bedB", "bedroom", bays === 3 ? "침실3" : "침실4", ms[0], 0, ms[1], zt]);
    else if (dress && zt >= 2.9) { const ez = Math.max(1.6, zt * vary(0.55, 0.08)); rooms.push(["ensuite", "ensuite", "안방 욕실", ms[0], 0, ms[1], ez], ["dress", "dressroom", "드레스룸", ms[0], ez, ms[1], zt]); }
    else { const ew = Math.min(vary(2.0), ms[1] - ms[0] - 0.9); rooms.push(["ensuite", "ensuite", "안방 욕실", ms[0], 0, ms[0] + ew, zt], ["dress", "dressroom", "붙박이장", ms[0] + ew, 0, ms[1], zt]); }
  }
  rooms.push(["hall", "hall", "복도", hall[0], zb, hall[1], Db]);
  // the utility room behind the kitchen, at one end of it
  const kit = rooms.find(r => r[0] === "kitchen")!, uw = Math.min(vary(1.9), kit[5] - kit[3] - 0.4), ud = vary(1.4, 0.08), ux = rnd() < 0.5 ? kit[3] : kit[5] - uw;
  rooms.push(["util", "utility", "다용도실", ux, -ud, ux + uw, 0]);

  // ---- the openings, from which rooms touch
  const get = (id: string) => rooms.find(r => r[0] === id);
  const rect = (r: R) => [r[3], r[4], r[5], r[6]];
  const meets = (a: string, b: string) => { const ra = get(a), rb = get(b); return ra && rb ? touch(rect(ra), rect(rb)) : null; };
  const link = (a: string, b: string, kind: "door" | "open" | "glass" | "wide", width = 0.9, end?: "lo" | "hi") => {
    const t = meets(a, b); if (!t) return false;
    const span = t.hi - t.lo, w = kind === "wide" ? Math.max(1.2, span - 0.6) : kind === "glass" ? Math.min(1.7, span - 0.3) : Math.min(width, span - 0.3);
    if (w < 0.6) return false;
    const c = kind === "wide" || kind === "glass" ? (t.lo + t.hi) / 2 : (end ?? (rnd() < 0.5 ? "lo" : "hi")) === "lo" ? t.lo + 0.18 + w / 2 : t.hi - 0.18 - w / 2;
    if (kind === "door") openings.push(door(a, b, t.axis, t.at, c, w, rnd() < 0.5 ? "start" : "end"));
    else if (kind === "glass") openings.push({ type: "glass_door", a, b, axis: t.axis, at: t.at, center: c, width: w, height: 2.25, sill: 0 });
    else openings.push(open(a, b, t.axis, t.at, c, w));
    return true;
  };
  const entry = get("entry")!;
  openings.push({ type: "front_door", a: "entry", b: "out", axis: "z", at: 0, center: (entry[3] + entry[5]) / 2, width: 0.95, height: 2.1, sill: 0, hinge: rnd() < 0.5 ? "start" : "end", swingInto: "out" });
  // the 중문: built in as standard only lately; an old flat's often none (or added later by the owner)
  // (a small flat's entry is often only a step and a shoe cabinet: half as likely to have one)
  const middleDoor = rnd() < (old ? 0.25 : recent ? 0.8 : 0.55) * (area < 60 ? 0.5 : 1);
  if (!link("entry", "hall", middleDoor ? "glass" : "open", 1.2)) link("entry", "kitchen", "open", 1.0);
  if (!link("living", "kitchen", "wide")) link("hall", "living", "wide");
  // (the corridor reaches the living side one way or another: into the kitchen, or the living room)
  if (!(kitchenOpen && link("hall", "kitchen", "open", 1.1)) && !link("hall", "living", "open", 1.0)) link("hall", "kitchen", "open", 1.1);
  if (fullHall && !openings.some(o => (o.a === "hall" && o.b === "living") || (o.a === "living" && o.b === "hall"))) link("hall", "living", "open", 1.6);
  for (const r of rooms) {
    const [id, type] = r;
    if (type === "bedroom" || type === "bathroom") { if (!link(id, "hall", "door", type === "bathroom" ? 0.75 : 0.9)) link(id, "living", "door", 0.9, "lo"); }
    else if (id === "pantry") { if (!link(id, "hall", "door", 0.8)) link(id, "kitchen", "door", 0.8); }
  }
  // (the master's door at the back of the living room's side wall, by the kitchen: the wall toward
  // the window is the sofa's or the TV's)
  if (!link("master", "living", "door", 0.9, "lo")) link("master", "hall", "door");
  // (the dressing room off the master; across the old blocks' corridor, off the corridor)
  if (get("dress") && !link("master", "dress", "open")) link("dress", "hall", "door", 0.8);
  if (get("ensuite") && !link("ensuite", "master", "door", 0.75)) link("ensuite", "dress", "door", 0.75);
  link("util", "kitchen", "glass");
  // windows: the front, the back, the end walls (an end flat's)
  const endFlat = env ? env.end !== null || env.kind === "tower" : rnd() < 0.35;
  const sideOK = (x0: number, x1: number) => !env || env.kind === "tower" ? true : env.end === "left" ? x0 < 0.01 : x1 > W - 0.01;
  const corridor = env?.kind === "corridor";
  for (const r of rooms) {
    const [id, type] = r, w = r[5] - r[3], d = r[6] - r[4];
    if (Math.abs(r[6] - D) < 0.01) {
      if (type === "living") openings.push(win(id, "z", D, (r[3] + r[5]) / 2, w * vary(0.82, 0.06), 2.25, 0.02, "balcony_window"));
      else openings.push(win(id, "z", D, (r[3] + r[5]) / 2, Math.min(w - 0.6, type === "master" ? 2.2 : 1.8), type === "master" ? 1.6 : 1.5, type === "master" ? 0.5 : 0.6));
    }
    if (Math.abs(r[4]) < 0.01 && (type === "bedroom" || type === "kitchen") && !(type === "kitchen" && r[3] >= ux - 0.01 && r[5] <= ux + uw + 0.01))
      openings.push(win(id, "z", 0, type === "kitchen" ? (ux - r[3] > r[5] - ux - uw ? (r[3] + ux) / 2 : (ux + uw + r[5]) / 2) : (r[3] + r[5]) / 2, Math.min(type === "kitchen" ? Math.max(0.7, Math.max(ux - r[3], r[5] - ux - uw) - 0.5) : w - 0.6, type === "kitchen" ? 1.2 : 1.4),
        corridor ? 0.7 : type === "kitchen" ? 1.0 : 1.2, corridor ? 1.45 : type === "kitchen" ? 1.1 : 0.9));
    if (id === "util") openings.push(win(id, "z", r[4], (r[3] + r[5]) / 2, Math.min(w - 0.4, 1.3), 1.1, 1.0));
    if (endFlat && (type === "bedroom" || type === "master" || (env?.kind === "tower" && type === "living")) && d > 2.2 && (r[3] < 0.01 || Math.abs(r[5] - W) < 0.01) && sideOK(r[3], r[5]))
      openings.push(type === "living" ? win(id, "x", r[3] < 0.01 ? 0 : W, (r[4] + r[6]) / 2, Math.min(d - 0.8, 2.2), 2.1, 0.15) : win(id, "x", r[3] < 0.01 ? 0 : W, (r[4] + r[6]) / 2, 1.0, 1.2, 0.9));
  }
  const label = `${bays}Bay ${env?.kind === "tower" ? "타워형" : env?.kind === "corridor" ? "복도식" : "판상형"}${env?.end ? " · 측세대" : ""}${old && !corridor ? " · 구축" : fullHall && !corridor ? " · 중앙 복도" : ""}${get("alpha") ? " · 알파룸" : get("pantry") ? " · 팬트리" : get("bed4") ? " · 침실4" : ""}`;
  const t: Template = { name: `bay${bays}`, label, rooms, openings, ref: 0 };
  t.ref = rooms.filter(r => !SERVICE.includes(r[1])).reduce((s, r) => s + (r[5] - r[3]) * (r[6] - r[4]), 0);
  return t;
}

/** the plan mirrored left to right (the other line of a 계단식 pair) */
function mirrorPlan(plan: FloorPlan) {
  const W = plan.bounds[0] + plan.bounds[2];
  for (const r of plan.rooms) r.rect = [W - r.rect[2], r.rect[1], W - r.rect[0], r.rect[3]];
  for (const o of plan.openings) {
    if (o.axis === "z") o.center = W - o.center; else o.at = W - o.at;
    // (a door's hinge end flips with the wall it is in running across the mirror)
    if (o.hinge && o.axis === "z") o.hinge = o.hinge === "start" ? "end" : "start";
  }
  for (const f of plan.fixtures) { f.pos = [W - f.pos[0], f.pos[1]]; f.rot = f.rot === 180 || f.rot === 0 ? f.rot : -f.rot; }
}

/** A small deterministic random from a string (the same unit always comes out the same). */
export function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let x = (h >>> 0) || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1_000_000) / 1_000_000; };
}

export interface PlanInput {
  complexId: string; complexName: string; dong: string; unitType: string; area: number;
  areaBasis: string; roomsBasis?: string; households?: number | null; built?: number | null;
  style?: StyleName; floor?: number;
  /** the flat's measured frame (its building's footprint and the register's lines): plan/envelope.ts */
  envelope?: Envelope | null;
  layoutCase?: number;
  furnishingCase?: number;
  bays?:2|3|4;
}

export function generatePlan(p: PlanInput): FloorPlan {
  // (the layout the complex's type has: its size, its era, its own seed)
  const env = p.envelope ?? null;
  const index = caseNumber(p.layoutCase ?? Math.floor(seeded(`${p.complexId}|${p.dong}|${p.unitType}|structure`)()*512));
  const layoutRandom = seeded(`${p.complexId}|${p.unitType}|case:${index}`);
  const t = makeCaseLayout(p.area, index, layoutRandom) ?? makeLayout(p.area, p.built, layoutRandom, env, p.bays);
  if (index % 8 === 0) t.label += ` · CASE ${String(index+1).padStart(3,"0")}`;
  // scaled to the area; with a measured frame, to its proportions too (width over depth, kept within
  // reason: the rooms' own shapes stretched at most ~12% each way) — the doors and windows keep their sizes
  let sx = Math.sqrt(p.area / t.ref), sz = sx;
  if (env) {
    let W0 = 0, D0 = 0;
    for (const r of t.rooms) if (r[1] !== "utility") { W0 = Math.max(W0, r[5]); D0 = Math.max(D0, r[6]); }
    const want = env.width / env.depth, now = W0 / D0, k = Math.min(1.25, Math.max(1 / 1.25, want / now));
    sx = Math.sqrt(p.area / t.ref) * Math.sqrt(k); sz = Math.sqrt(p.area / t.ref) / Math.sqrt(k);
  }
  const rooms: Room[] = t.rooms.map(([id, type, label, x0, z0, x1, z1, zone]) => ({
    id, type, label, rect: [x0 * sx, z0 * sz, x1 * sx, z1 * sz], zone: zone ?? id,
    floorDrop: type === "entrance" ? 0.12 : type === "bathroom" || type === "ensuite" || type === "utility" ? 0.03 : 0,
  }));
  const byId = new Map(rooms.map(r => [r.id, r]));
  let kitchenWindowSeen=false;
  const openings: Opening[] = t.openings.filter(o=>{
    if(!["window","balcony_window"].includes(o.type)||byId.get(o.a)?.type!=="kitchen")return true;
    if(kitchenWindowSeen)return false;kitchenWindowSeen=true;return true;
  }).map(o => {
    const cen = o.center * (o.axis === "z" ? sx : sz), at = o.at * (o.axis === "z" ? sz : sx);
    // (an opening as wide as the shared wall stays as wide as it, scaled)
    const shared = sharedSpan(byId.get(o.a)!, o.b === "out" ? null : byId.get(o.b)!, o.axis, at);
    // (and never wider than its wall, less a little either side: a frame narrowed to the building's
    // own width has narrower walls)
    const width = Math.min(o.type === "open" && o.width > 2 ? o.width * (o.axis === "z" ? sx : sz) : o.width, Math.max(0.6, shared[1] - shared[0] - 0.24),o.type==="window"&&byId.get(o.a)?.type==="kitchen"?.95:Infinity);
    const half = width / 2, lo = shared[0] + 0.12 + half, hi = shared[1] - 0.12 - half;
    const kitchenWindow=["window","balcony_window"].includes(o.type)&&(byId.get(o.a)?.type==="kitchen"||byId.get(o.b)?.type==="kitchen");
    return { ...o, at, width, center: lo <= hi ? Math.min(hi, Math.max(lo, cen)) : (shared[0] + shared[1]) / 2,...(kitchenWindow&&o.sill<.95?{sill:.95,height:Math.max(.8,o.sill+o.height-.95)}:{}) };
  });
  const xs = rooms.flatMap(r => [r.rect[0], r.rect[2]]), zs = rooms.flatMap(r => [r.rect[1], r.rect[3]]);
  const counted = rooms.filter(r => !SERVICE.includes(r.type)).reduce((a, r) => a + areaOf(r.rect), 0);
  const rnd = seeded(`${p.complexId}|${p.dong}|${p.unitType}`);
  const plan: FloorPlan = {
    complexId: p.complexId, complexName: p.complexName, dong: p.dong, unitType: p.unitType,
    areaExclusiveM2: p.area, ceilingHeightM: p.built && p.built >= 2015 ? 2.4 : 2.32,
    source: "estimated_template", template: t.label,
    basis: { area: p.areaBasis, rooms: env ? `${env.basis} · 방 배치는 추정` : p.roomsBasis ?? "template", households: p.households ?? null, built: p.built ?? null },
    bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    rooms, openings, fixtures: [],
    check: { areaM2: Math.round(counted * 100) / 100, error: Math.round((counted / p.area - 1) * 10000) / 10000 },
    style: p.style ?? STYLE_NAMES[Math.floor(rnd() * STYLE_NAMES.length)],
    floor: p.floor ?? 3 + Math.floor(rnd() * 12), layoutCase: index, furnishingCase: p.furnishingCase ?? 0,
  };
  plan.fixtures = fixturesFor(plan);
  // (the two lines of a stair hall are mirror images: which one, by the 동)
  // (an end line's side windows are already on its outside wall: not mirrored away from it)
  if (!env?.end && seeded(`${p.complexId}|${p.dong}|${env?.line ?? "line"}`)() < 0.5) mirrorPlan(plan);
  return plan;
}

/** The span of the wall two rooms share (or a room's outer wall) on the line axis = at. */
export function sharedSpan(a: Room, b: Room | null, axis: "x" | "z", at: number): [number, number] {
  const span = (r: Room): [number, number] => axis === "x" ? [r.rect[1], r.rect[3]] : [r.rect[0], r.rect[2]];
  const sa = span(a);
  if (!b) return sa;
  const sb = span(b);
  void at;
  return [Math.max(sa[0], sb[0]), Math.min(sa[1], sb[1])];
}

/** The plumbing and the light switches, placed by rules from the rooms (scaled plans move them). */
export function fixturesFor(plan: FloorPlan): Fixture[] {
  const out: Fixture[] = [];
  const room = (id: string) => plan.rooms.find(r => r.id === id);
  const bath = room("bath2"), ens = room("ensuite"), kit = room("kitchen"), util = room("util");
  if (bath) {
    const [x0, z0, x1] = bath.rect;
    const big = x1 - x0 > 2.3;
    if (big) out.push({ type: "bathtub", pos: [x0 + 0.42, z0 + 0.82], rot: 0, room: bath.id });
    else out.push({ type: "shower", pos: [x1 - 0.5, z0 + 0.5], rot: 0, room: bath.id });
    out.push({ type: "toilet", pos: [big ? x0 + 1.25 : x0 + 0.45, z0 + 0.36], rot: 0, room: bath.id });
    out.push({ type: "washbasin", pos: [big ? x1 - 0.55 : x0 + 1.05, z0 + 0.27], rot: 0, room: bath.id });
  }
  if (ens) {
    const [x0, z0, x1] = ens.rect;
    out.push({ type: "shower", pos: [x1 - 0.55, z0 + 0.55], rot: 0, room: ens.id });
    out.push({ type: "toilet", pos: [x0 + 0.5, z0 + 0.36], rot: 0, room: ens.id });
    out.push({ type: "washbasin", pos: [x0 + 1.35, z0 + 0.27], rot: 0, room: ens.id });
  }
  if (kit) {
    const [, z0, x1] = kit.rect;
    const w = plan.openings.find(o => o.a === "kitchen" && o.b === "out");
    out.push({ type: "sink", pos: [w ? w.center : x1 - 1.4, z0 + 0.32], rot: 0, room: kit.id });
    out.push({ type: "cooktop", pos: [x1 - 0.32, z0 + 1.55], rot: -90, room: kit.id });
  }
  if (util) {
    const [x0, z0] = util.rect;
    out.push({ type: "washer", pos: [x0 + 0.4, z0 + 0.38], rot: 0, room: util.id });
    out.push({ type: "boiler", pos: [x0 + 1.25, z0 + 0.15], rot: 0, room: util.id });
  }
  // a switch by each room's door, on the latch side, inside the room
  for (const r of plan.rooms) {
    const d = plan.openings.find(o => (o.a === r.id || o.b === r.id) && o.type !== "window" && o.type !== "balcony_window" && o.b !== "out" && o.type !== "open")
      ?? plan.openings.find(o => (o.a === r.id || o.b === r.id) && o.type === "open")
      ?? plan.openings.find(o => o.a === r.id && o.type === "front_door");
    if (!d) continue;
    const latchSign = d.hinge === "end" ? -1 : 1;
    const along = d.center + latchSign * (d.width / 2 + 0.22);
    // into the room from the wall line
    const [x0, z0, x1, z1] = r.rect;
    const inward = d.axis === "z" ? (Math.abs(d.at - z0) < Math.abs(d.at - z1) ? 1 : -1) : (Math.abs(d.at - x0) < Math.abs(d.at - x1) ? 1 : -1);
    const lo = d.axis === "z" ? x0 : z0, hi = d.axis === "z" ? x1 : z1;
    const a = Math.min(hi - 0.15, Math.max(lo + 0.15, along));
    const pos: [number, number] = d.axis === "z" ? [a, d.at + inward * 0.001] : [d.at + inward * 0.001, a];
    const rot = d.axis === "z" ? (inward > 0 ? 0 : 180) : (inward > 0 ? 90 : -90);
    out.push({ type: "switch", pos, rot, room: r.id });
  }
  return out;
}
