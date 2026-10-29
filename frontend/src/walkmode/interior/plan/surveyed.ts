import type { FacilityKind, FacilityRole, Fixture, FloorPlan, Opening, Room, RoomType, Side } from "./types";
import { FACILITY_LABEL, facilityStyle, programOf, type FacilityInput } from "./facility";

/* A floor laid out from its drawing (도면 기반): the surveyed outline of the floor (SGIS), its charted
 * partitions where it has them — rooms, open floor and corridors, lifts, stairs, escalators, toilets,
 * shafts — and the cores of the nearest charted floor where it has not. Floors with an outline only get
 * the programme of their register use laid out inside that outline: a corridor spine, the core by the
 * way in, rooms out to the walls. Everything on a 0.5 m raster in the building's own axes (the
 * outline's main direction), then cut into the rectangles the interior engine builds walls from: a
 * room of the drawing may be several rectangles joined by open walls, one light zone. Very large
 * floors (a hospital, an exhibition hall) are walked as the part round the way in — at most 46 × 34 m —
 * the cut sides closed. */

type P2 = [number, number];
export interface SurveyedInput extends FacilityInput {
  /** the floor's outline polygons (outer ring, holes), metres, plan frame (x, z) */
  outline: P2[][][];
  /** charted partitions: "10" business, "20" open/corridor, "31" void, "32" lift, "33" escalator, "34" stair, "35" toilet, "40" shaft */
  partitions: { type: string; poly: P2[][]; name?: string; category?: string }[];
  /** cores from the nearest charted floor (same codes) when this floor has none */
  cores: { type: string; ring: P2[] }[];
  /** where the visitor came in (ground floor), plan frame */
  entry: P2 | null;
  seed: number;
}

const CELL = 0.5, MAXW = 46, MAXD = 34;
const VOID = -1, FREE = 0;
const inRing = (x: number, z: number, p: P2[]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inPoly = (x: number, z: number, p: P2[][]) => !!p[0] && inRing(x, z, p[0]) && !p.slice(1).some(h => inRing(x, z, h));
const r1 = (v: number) => Math.round(v * 10) / 10;
const ringArea = (p: P2[]) => Math.abs(p.reduce((t, a, i) => { const b = p[(i + 1) % p.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
/** a long thin shape (a corridor's): its bounding box much longer than wide, or mostly empty */
const elongated = (p: P2[]) => { const xs = p.map(q => q[0]), zs = p.map(q => q[1]), w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs); return Math.max(w, d) / Math.max(0.1, Math.min(w, d)) > 4 || ringArea(p) < w * d * 0.45; };

interface Region { id: number; type: RoomType; label: string; core?: "lift" | "stair" | "escalator" | "toilet"; people: FacilityRole[]; front: "door" | "glass" | "open"; name?: string }

/** the outline's main direction: the angle (mod 90°) its edges' lengths favour */
function mainAngle(rings: P2[][]): number {
  const bins = new Float64Array(90);
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; d = ((d % 90) + 90) % 90;
    bins[Math.round(d) % 90] += l;
  }
  let best = 0; for (let i = 1; i < 90; i++) if (bins[i] > bins[best]) best = i;
  return (best > 45 ? best - 90 : best) * Math.PI / 180;
}

export function generateSurveyed(f: SurveyedInput): FloorPlan | null {
  const outer = f.outline.filter(p => p[0]?.length >= 3);
  if (!outer.length) return null;
  let s = (f.seed >>> 0) || 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  // ------------------------------------------------ into the building's axes
  const th = mainAngle(outer.map(p => p[0])), c = Math.cos(-th), sn = Math.sin(-th);
  const rot = (p: P2): P2 => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c];
  const O = outer.map(p => p.map(r => r.map(rot)));
  const parts = f.partitions.map(q => ({ ...q, poly: q.poly.map(r => r.map(rot)) }));
  const cores = f.cores.map(q => ({ ...q, ring: q.ring.map(rot) }));
  // (the way in onto the drawn outline: the door the walker used is on the map's footprint, which
  // need not match the survey's walls — the nearest point of them, a little inside)
  let entry = f.entry ? rot(f.entry) : null;
  if (entry) {
    let best: P2 = entry, bd = Infinity;
    for (const r of O.map(p => p[0])) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((entry[0] - a[0]) * dx + (entry[1] - a[1]) * dz) / l2)), q: P2 = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(q[0] - entry[0], q[1] - entry[1]);
      if (d < bd) { bd = d; const l = Math.sqrt(l2), nx_ = -dz / l, nz_ = dx / l; const inn = O.some(p => inPoly(q[0] + nx_ * 0.8, q[1] + nz_ * 0.8, p)) ? 1 : -1; best = [q[0] + nx_ * 0.8 * inn, q[1] + nz_ * 0.8 * inn]; }
    }
    entry = best;
  }
  const all = O.flatMap(p => p[0]);
  const bx0 = Math.min(...all.map(p => p[0])), bz0 = Math.min(...all.map(p => p[1])), bx1 = Math.max(...all.map(p => p[0])), bz1 = Math.max(...all.map(p => p[1]));
  if (bx1 - bx0 < 6 || bz1 - bz0 < 6) return null;
  // ------------------------------------------------ the part walked: round the way in, else the lifts
  const liftCs = [...parts.filter(p => p.type === "32").map(p => p.poly[0]), ...cores.filter(q => q.type === "32").map(q => q.ring)].map(r => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length] as P2);
  const insideAny = (x: number, z: number) => O.some(p => inPoly(x, z, p));
  let focus: P2 = entry && f.level === 1 ? entry : liftCs[0] ?? [(bx0 + bx1) / 2, (bz0 + bz1) / 2];
  const W = Math.min(MAXW, bx1 - bx0), D = Math.min(MAXD, bz1 - bz0);
  const wx0 = Math.min(bx1 - W, Math.max(bx0, focus[0] - W / 2)), wz0 = Math.min(bz1 - D, Math.max(bz0, focus[1] - D / 2));
  const nx = Math.round(W / CELL), nz = Math.round(D / CELL);
  const cx = (i: number) => wx0 + (i + 0.5) * CELL, cz = (j: number) => wz0 + (j + 0.5) * CELL;
  // ------------------------------------------------ the raster: what each cell is
  const g = new Int32Array(nx * nz).fill(VOID), out = new Uint8Array(nx * nz);   // out: outside the building (not a cut)
  const regions: Region[] = [];
  const region = (r: Omit<Region, "id">) => { const id = regions.length + 1; regions.push({ ...r, id }); return id; };
  const kind = f.kind, prog = programOf(f, rnd);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (insideAny(cx(i), cz(j))) g[k] = FREE; else out[k] = 1; }
  const charted = parts.filter(p => p.type !== "31" && p.type !== "40");
  let chartedCells = 0;
  const regionOfPart = new Map<number, number>();
  let shopNo = 0, hall: number | undefined;
  const partRegion = (pi: number) => {
    let r = regionOfPart.get(pi); if (r) return r;
    const p = charted[pi], t = p.type;
    if (t === "32") r = region({ type: "storage", label: "엘리베이터", core: "lift", people: [], front: "door" });
    else if (t === "34") r = region({ type: "stair", label: "계단실", core: "stair", people: [], front: "door" });
    else if (t === "33") r = region({ type: "corridor", label: "에스컬레이터", core: "escalator", people: ["visitor"], front: "open" });
    else if (t === "35") r = region({ type: "restroom", label: rnd() < 0.5 ? "남자 화장실" : "여자 화장실", core: "toilet", people: [], front: "door" });
    else if (t === "20" && (ringArea(p.poly[0]) > 400 || !!p.name === false && ringArea(p.poly[0]) > 250 && elongated(p.poly[0]))) {
      // (a big open partition: the mall's or the building's halls and corridors — one region)
      r = hall ??= region({ type: "corridor", label: "복도", people: ["visitor", "visitor"], front: "open" });
    }
    else {
      // a business: its name and kind from the survey's company there, else the floor's programme
      const w = prog[shopNo++ % Math.max(1, prog.length)] ?? { type: "office" as RoomType, label: "사무실", front: "door" as const, people: ["desk"] as FacilityRole[] };
      const nm = p.name, cat = p.category ?? "";
      const type: RoomType = /음식|카페|커피|제과|식당/.test(cat + (nm ?? "")) ? "cafe" : /의원|병원|의료|치과|한의/.test(cat + (nm ?? "")) ? "waiting" : /약국/.test(cat + (nm ?? "")) ? "pharmacy"
        : /소매|판매|상점|마트|편의/.test(cat) ? "shop" : /학원|교육/.test(cat) ? "classroom" : nm ? (kind === "retail" || kind === "food" ? "shop" : "openOffice") : w.type;
      r = region({ type, label: nm ?? w.label, people: w.people ?? [], front: type === "shop" || type === "cafe" || type === "pharmacy" ? "glass" : type === "waiting" ? "open" : w.front, name: nm });
    }
    regionOfPart.set(pi, r); return r;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (g[k] !== FREE) continue;
    const x = cx(i), z = cz(j);
    if (parts.some(p => (p.type === "40" || p.type === "31") && inPoly(x, z, p.poly))) { g[k] = VOID; continue; }
    const pi = charted.findIndex(p => inPoly(x, z, p.poly));
    if (pi >= 0) { g[k] = partRegion(pi); chartedCells++; }
  }
  const insideCells = g.reduce((t, v) => t + (v !== VOID ? 1 : 0), 0);
  if (insideCells < 40) return null;
  const drawn = chartedCells / insideCells > 0.25;
  // (the cores of another charted floor, where this one has none)
  if (!drawn) for (const q of cores) {
    if (q.type !== "32" && q.type !== "34" && q.type !== "35") continue;
    const id = region(q.type === "32" ? { type: "storage", label: "엘리베이터", core: "lift", people: [], front: "door" } : q.type === "34" ? { type: "stair", label: "계단실", core: "stair", people: [], front: "door" } : { type: "restroom", label: "화장실", core: "toilet", people: [], front: "door" });
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (g[k] === FREE && inRing(cx(i), cz(j), q.ring)) g[k] = id; }
  }
  // ------------------------------------------------ an outline only: the programme laid out in it
  if (!drawn) synthesize();
  else {
    // (what the drawing leaves uncharted inside the walls is open floor)
    const open = region({ type: "corridor", label: "복도", people: ["visitor", "visitor"], front: "open" });
    for (let k = 0; k < g.length; k++) if (g[k] === FREE) g[k] = open;
  }

  function synthesize() {
    // double-loaded corridors along the window's long axis, one every ~2 room depths + a corridor
    // (the first through the focus), cross corridors every ~26 m; the core by the focus; rooms off
    // each corridor out to half way to the next (or the wall), cut along it by the programme
    const cw = kind === "ward" || kind === "clinic" ? 2.6 : kind === "retail" || kind === "museum" || kind === "food" ? 3.2 : 2.4;
    const roomD = kind === "retail" || kind === "food" ? 9 : kind === "school" ? 8 : kind === "museum" ? 10 : 7;
    const along = W >= D;
    const L = along ? nx : nz, A = along ? nz : nx;
    const at = (u: number, v: number) => along ? v * nx + u : u * nx + v;
    const half = Math.round(cw / CELL / 2), period = Math.round((2 * roomD + cw) / CELL);
    const fu = Math.round(((along ? focus[0] - wx0 : focus[1] - wz0)) / CELL), fv = Math.round(((along ? focus[1] - wz0 : focus[0] - wx0)) / CELL);
    // the ground floor's lobby first, where the way in is
    if (f.level === 1 && entry) {
      const lob = region({ type: "lobby", label: `${f.name} 로비`, people: ["guard", "visitor"], front: "open" });
      const ei = Math.round((entry[0] - wx0) / CELL), ej = Math.round((entry[1] - wz0) / CELL);
      for (let j = ej - 14; j < ej + 14; j++) for (let i = ei - 16; i < ei + 16; i++) { if (i < 0 || j < 0 || i >= nx || j >= nz) continue; const k = j * nx + i; if (g[k] === FREE) g[k] = lob; }
    }
    const corr = region({ type: "corridor", label: "복도", people: ["visitor", "visitor"], front: "open" });
    // (the first corridor a room depth in from the focus — the way in's side — then every period)
    const v0 = Math.max(half + 2, Math.min(A - half - 2, fv + (fv < A / 2 ? 1 : -1) * Math.round(roomD / CELL)));
    const spines: number[] = [];
    for (let v = v0; v < A - 4; v += period) spines.push(v);
    for (let v = v0 - period; v > 4; v -= period) spines.push(v);
    spines.sort((a, b) => a - b);
    for (const sv of spines) for (let u = 0; u < L; u++) for (let v = sv - half; v < sv + half; v++) { if (v < 0 || v >= A) continue; const k = at(u, v); if (g[k] === FREE) g[k] = corr; }
    const cross = Math.round(26 / CELL);
    for (let u0 = ((fu % cross) + cross) % cross; u0 < L; u0 += cross) for (let u = u0; u < Math.min(L, u0 + half * 2); u++) for (let v = 0; v < A; v++) { const k = at(u, v); if (g[k] === FREE) g[k] = corr; }
    // the core on the first corridor by the focus: lifts, stair, toilets (unless charted cores came)
    if (!regions.some(r => r.core === "lift")) {
      // (clear of the lobby round the way in: beside it, toward the plate's middle)
      const cu = Math.max(2, Math.min(L - 22, fu > L / 2 ? fu - 40 : fu + 18)), side = v0 - half - 1 >= 8 ? -1 : 1;
      const block = (u0: number, u1: number, dv0: number, dv1: number, id: number) => {
        for (let u = u0; u < u1; u++) for (let dv = dv0; dv < dv1; dv++) {
          const v = side < 0 ? v0 - half - 1 - dv : v0 + half + dv, k = at(u, v);
          if (u >= 0 && u < L && v >= 0 && v < A && g[k] === FREE) g[k] = id;
        }
      };
      const lift = region({ type: "storage", label: "엘리베이터", core: "lift", people: [], front: "door" });
      block(cu, cu + 10, 0, 4, lift);
      const stair = region({ type: "stair", label: "계단실", core: "stair", people: [], front: "door" });
      block(cu + 10, cu + 16, 0, 12, stair);
      const men = region({ type: "restroom", label: "남자 화장실", core: "toilet", people: [], front: "door" }), women = region({ type: "restroom", label: "여자 화장실", core: "toilet", people: [], front: "door" });
      block(cu, cu + 5, 4, 12, men); block(cu + 5, cu + 10, 4, 12, women);
    }
    // rooms: each free cell belongs to the corridor nearest it (across), on that side; along the
    // corridor cut by the programme's widths
    let p = 0;
    const ids = new Map<string, number>(), named = new Map<string, number>();
    let consultNo = 0;
    const chunkOf = new Map<string, number[]>();
    for (const sv of spines) for (const side of [-1, 1]) {
      // (the stretch this side of this corridor owns: to half way to the next, or the wall)
      const next = side < 0 ? spines.filter(x => x < sv).pop() : spines.find(x => x > sv);
      const lim = next === undefined ? (side < 0 ? 0 : A - 1) : Math.round((sv + next) / 2);
      const edges: number[] = [];
      let u = 0;
      while (u < L) {
        const w = prog[p++ % prog.length]; const wl = Math.max(6, Math.round(w.w / CELL));
        edges.push(u); u += wl;
        chunkOf.set(`${sv}|${side}|${edges.length - 1}`, [w.type === "openOffice" || w.type === "shop" || w.type === "cafe" || w.type === "classroom" || w.type === "gym" || w.type === "gallery" ? 1 : 0]);
        // (a room's name used again: numbered — 진료실 5, 회의실 2)
        const n = (named.get(w.label) ?? 0) + 1; named.set(w.label, n);
        const label = /제\d+진료실$/.test(w.label) ? w.label.replace(/제\d+진료실$/, `제${++consultNo}진료실`) : n === 1 ? w.label : `${w.label} ${n}`;
        ids.set(`${sv}|${side}|${edges.length - 1}`, region({ type: w.type, label, people: w.people ?? [], front: w.front }));
      }
      edges.push(L);
      for (let v = side < 0 ? sv - half - 1 : sv + half; side < 0 ? v >= lim : v <= lim; v += side) {
        if (v < 0 || v >= A) break;
        for (let n = 0; n < edges.length - 1; n++) for (let uu = edges[n]; uu < edges[n + 1]; uu++) { const k = at(uu, v); if (g[k] === FREE) g[k] = ids.get(`${sv}|${side}|${n}`)!; }
      }
    }
    for (let k = 0; k < g.length; k++) if (g[k] === FREE) g[k] = corr;
  }

  // ------------------------------------------------ thin bits to their neighbours (rooms ≥ 1.4 m across)
  for (let pass = 0; pass < 3; pass++) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, v = g[k]; if (v <= 0) continue;
    const same = (di: number, dj: number) => { const a = i + di, b = j + dj; return a >= 0 && b >= 0 && a < nx && b < nz && g[b * nx + a] === v; };
    let runX = 1; for (let d = 1; d < 3 && same(-d, 0); d++) runX++; for (let d = 1; d < 3 && same(d, 0); d++) runX++;
    let runZ = 1; for (let d = 1; d < 3 && same(0, -d); d++) runZ++; for (let d = 1; d < 3 && same(0, d); d++) runZ++;
    if (runX >= 3 && runZ >= 3) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => { const ii = i + a, jj = j + b; return ii >= 0 && jj >= 0 && ii < nx && jj < nz ? g[jj * nx + ii] : VOID; }).filter(x => x > 0 && x !== v);
    if (nb.length) g[k] = nb[0];
  }

  // ------------------------------------------------ cells to rectangles (largest first)
  interface R { region: number; i0: number; j0: number; i1: number; j1: number }
  const rects: R[] = [];
  const used = new Uint8Array(nx * nz);
  for (const rg of regions) {
    const maxRects = rg.type === "corridor" || rg.type === "lobby" ? 60 : 6;
    for (let n = 0; n < maxRects; n++) {
      // the largest all-free rectangle of this region's unused cells (histogram method)
      const h = new Int32Array(nx); let best = { a: 0, i0: 0, j0: 0, i1: 0, j1: 0 };
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) { const k = j * nx + i; h[i] = g[k] === rg.id && !used[k] ? h[i] + 1 : 0; }
        const st: number[] = [];
        for (let i = 0; i <= nx; i++) {
          const hi = i < nx ? h[i] : 0;
          while (st.length && h[st[st.length - 1]] >= hi) {
            const top = st.pop()!, height = h[top], left = st.length ? st[st.length - 1] + 1 : 0, wdt = i - left;
            if (height >= 3 && wdt >= 3 && height * wdt > best.a) best = { a: height * wdt, i0: left, j0: j - height + 1, i1: i, j1: j + 1 };
          }
          st.push(i);
        }
      }
      if (best.a < 9 || (n > 0 && best.a < 24)) break;
      rects.push({ region: rg.id, ...best });
      for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) used[j * nx + i] = 1;
    }
  }
  // (cells no rectangle took: nothing — they stay walls' insides)
  // ------------------------------------------------ rooms
  const rooms: Room[] = [], rr = new Map<string, R>(), regionOfRoom = new Map<string, Region>();
  const byRegion = new Map<number, string[]>();
  rects.forEach((q, n) => {
    const rg = regions[q.region - 1];
    const id = `r${q.region}_${n}`;
    rooms.push({ id, type: rg.type, label: rg.label, rect: [r1(q.i0 * CELL), r1(q.j0 * CELL), r1(q.i1 * CELL), r1(q.j1 * CELL)], zone: `z${q.region}` });
    rr.set(id, q); regionOfRoom.set(id, rg);
    const l = byRegion.get(q.region) ?? []; l.push(id); byRegion.set(q.region, l);
  });
  if (rooms.length < 3) return null;
  const openings: Opening[] = [];
  /** the shared edge of two rooms: its axis, line and span */
  const shared = (a: Room, b: Room): { axis: "x" | "z"; at: number; lo: number; hi: number } | null => {
    const [ax0, az0, ax1, az1] = a.rect, [bx0_, bz0_, bx1_, bz1_] = b.rect, e = 1e-6;
    if (Math.abs(ax1 - bx0_) < e || Math.abs(bx1_ - ax0) < e) { const lo = Math.max(az0, bz0_), hi = Math.min(az1, bz1_); if (hi - lo > 0.9) return { axis: "x", at: Math.abs(ax1 - bx0_) < e ? ax1 : ax0, lo, hi }; }
    if (Math.abs(az1 - bz0_) < e || Math.abs(bz1_ - az0) < e) { const lo = Math.max(ax0, bx0_), hi = Math.min(ax1, bx1_); if (hi - lo > 0.9) return { axis: "z", at: Math.abs(az1 - bz0_) < e ? az1 : az0, lo, hi }; }
    return null;
  };
  const isPublic = (r: Room) => r.type === "corridor" || r.type === "lobby" || r.type === "liftHall";
  const lifts: NonNullable<FloorPlan["facility"]>["lifts"] = [];
  const linked = new Set<string>();
  const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const H = 2.75;
  // same region: open walls between its rectangles (one room); public spaces open into each other
  for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
    const A = rooms[a], B = rooms[b], sh = shared(A, B); if (!sh) continue;
    const ra = regionOfRoom.get(A.id)!, rb = regionOfRoom.get(B.id)!;
    if (ra === rb || (isPublic(A) && isPublic(B))) {
      openings.push({ type: "open", a: A.id, b: B.id, axis: sh.axis, at: sh.at, center: r1((sh.lo + sh.hi) / 2), width: r1(sh.hi - sh.lo - (ra === rb ? 0.02 : 0.6)), height: ra === rb ? H + 0.5 : 2.6, sill: 0 });
      linked.add(pairKey(A.id, B.id));
    }
  }
  // each room region: a way in from the public space it shares the longest wall with
  for (const [rid, ids] of byRegion) {
    const rg = regions[rid - 1];
    if (rg.type === "corridor" || rg.type === "lobby") continue;
    let best: { A: Room; B: Room; sh: NonNullable<ReturnType<typeof shared>> } | null = null;
    for (const id of ids) for (const B of rooms) {
      if (!isPublic(B)) continue;
      const A = rooms.find(r => r.id === id)!, sh = shared(A, B);
      if (sh && (!best || sh.hi - sh.lo > best.sh.hi - best.sh.lo)) best = { A, B, sh };
    }
    if (rg.core === "lift") {
      // (the lift cars: doors on the hall's side of the shaft's wall)
      if (best) {
        const n = Math.max(1, Math.min(3, Math.floor((best.sh.hi - best.sh.lo) / 2.2)));
        const B = best.B, side = sideOf(B, best.sh.axis, best.sh.at);
        for (let q = 0; q < n; q++) lifts.push({ room: B.id, side, u: r1(best.sh.lo + (best.sh.hi - best.sh.lo) * (q + 0.5) / n) });
      }
      continue;
    }
    if (!best) continue;
    const { A, B, sh } = best, len = sh.hi - sh.lo;
    if (rg.front === "open" && len > 3) openings.push({ type: "open", a: A.id, b: B.id, axis: sh.axis, at: sh.at, center: r1((sh.lo + sh.hi) / 2), width: r1(Math.min(len - 1.2, Math.max(2.4, len * 0.6))), height: 2.5, sill: 0 });
    else if (rg.front === "glass" && len > 2.4) openings.push({ type: "glass_door", a: A.id, b: B.id, axis: sh.axis, at: sh.at, center: r1((sh.lo + sh.hi) / 2), width: len > 5 ? 1.8 : 1.5, height: 2.3, sill: 0 });
    else openings.push({ type: "door", a: A.id, b: B.id, axis: sh.axis, at: sh.at, center: r1(sh.lo + Math.min(1.0, len / 2)), width: 0.95, height: 2.1, sill: 0, hinge: "start", swingInto: A.id });
    linked.add(pairKey(A.id, B.id));
  }
  // ------------------------------------------------ the way in: from outside (ground floor) or from the lifts
  const exterior = (r: Room, s: Side) => {
    // how much of a side looks out (the cells beyond it outside the building, not a cut)
    const q = rr.get(r.id)!; let run = 0, best = { lo: 0, hi: 0 }, start = 0;
    const cells: number[] = [];
    if (s === "n" || s === "s") { const j = s === "n" ? q.j0 - 1 : q.j1; for (let i = q.i0; i < q.i1; i++) cells.push(j < 0 || j >= nz ? -1 : out[j * nx + i]); }
    else { const i = s === "w" ? q.i0 - 1 : q.i1; for (let j = q.j0; j < q.j1; j++) cells.push(i < 0 || i >= nx ? -1 : out[j * nx + i]); }
    cells.forEach((v, n) => { if (v === 1) { if (!run) start = n; run++; if (run > best.hi - best.lo) best = { lo: start, hi: n + 1 }; } else run = 0; });
    const base = s === "n" || s === "s" ? q.i0 : q.j0;
    return { lo: (base + best.lo) * CELL, hi: (base + best.hi) * CELL };
  };
  const lineOf = (r: Room, s: Side) => s === "n" ? r.rect[1] : s === "s" ? r.rect[3] : s === "w" ? r.rect[0] : r.rect[2];
  const axisOf = (s: Side): "x" | "z" => s === "n" || s === "s" ? "z" : "x";
  let start: [number, number, number] | null = null;
  if (f.level === 1) {
    const ex = entry ? [entry[0] - wx0, entry[1] - wz0] : [W / 2, 0];
    let best: { r: Room; s: Side; lo: number; hi: number; d: number } | null = null;
    for (const r of rooms) {
      const rg = regionOfRoom.get(r.id);
      if (rg?.core) continue;
      for (const s of ["n", "s", "w", "e"] as Side[]) {
        const e = exterior(r, s); if (e.hi - e.lo < 2.4) continue;
        const mid = (e.lo + e.hi) / 2, p = axisOf(s) === "z" ? [mid, lineOf(r, s)] : [lineOf(r, s), mid];
        const d = Math.hypot(p[0] - ex[0], p[1] - ex[1]) - (isPublic(r) ? 6 : r.type === "shop" || r.type === "cafe" || r.type === "waiting" ? 3 : 0);
        if (!best || d < best.d) best = { r, s, lo: e.lo, hi: e.hi, d };
      }
    }
    if (best) {
      const mid = r1(Math.max(best.lo + 1.2, Math.min(best.hi - 1.2, axisOf(best.s) === "z" ? ex[0] : ex[1])));
      openings.push({ type: "front_door", a: best.r.id, b: "out", axis: axisOf(best.s), at: lineOf(best.r, best.s), center: mid, width: 1.8, height: 2.4, sill: 0, hinge: "start", swingInto: "out" });
      const inward = best.s === "n" ? [0, 1] : best.s === "s" ? [0, -1] : best.s === "w" ? [1, 0] : [-1, 0];
      const px = axisOf(best.s) === "z" ? mid : lineOf(best.r, best.s) + inward[0] * 1.2, pz = axisOf(best.s) === "z" ? lineOf(best.r, best.s) + inward[1] * 1.2 : mid;
      start = [px, pz, Math.atan2(-inward[0], -inward[1])];
    }
  }
  if (!start && lifts.length) {
    const L = lifts[0], r = rooms.find(q => q.id === L.room)!, inward = L.side === "n" ? [0, 1] : L.side === "s" ? [0, -1] : L.side === "w" ? [1, 0] : [-1, 0];
    const across = Math.min(1.3, (axisOf(L.side) === "z" ? r.rect[3] - r.rect[1] : r.rect[2] - r.rect[0]) / 2);
    const px = axisOf(L.side) === "z" ? L.u : lineOf(r, L.side) + inward[0] * across, pz = axisOf(L.side) === "z" ? lineOf(r, L.side) + inward[1] * across : L.u;
    // (out of the lift: facing along the hall toward its farther end, or across a wide one)
    const w = r.rect[2] - r.rect[0], d = r.rect[3] - r.rect[1];
    let dir = inward;
    if (axisOf(L.side) === "z" && w > d * 1.5) dir = [px - r.rect[0] > r.rect[2] - px ? -1 : 1, 0];
    if (axisOf(L.side) === "x" && d > w * 1.5) dir = [0, pz - r.rect[1] > r.rect[3] - pz ? -1 : 1];
    start = [px, pz, Math.atan2(-dir[0], -dir[1])];
  }
  const startRoom = start ? rooms.find(r => start![0] >= r.rect[0] && start![0] <= r.rect[2] && start![1] >= r.rect[1] && start![1] <= r.rect[3]) : rooms.find(isPublic);
  if (!start) { const r = startRoom ?? rooms[0]; start = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2, 0]; }
  // ------------------------------------------------ every room reachable: a door to a reachable neighbour where none
  const reach = () => {
    const seen = new Set<string>([startRoom?.id ?? rooms[0].id]); let grew = true;
    while (grew) { grew = false; for (const o of openings) { if (o.b === "out" || o.type === "window") continue; if (seen.has(o.a) !== seen.has(o.b)) { seen.add(o.a); seen.add(o.b); grew = true; } } }
    return seen;
  };
  for (let pass = 0; pass < 6; pass++) {
    const seen = reach(); let added = false;
    for (const A of rooms) {
      if (seen.has(A.id) || regionOfRoom.get(A.id)?.core === "lift") continue;
      let best: { B: Room; sh: NonNullable<ReturnType<typeof shared>> } | null = null;
      for (const B of rooms) { if (!seen.has(B.id) || regionOfRoom.get(B.id)?.core === "lift") continue; const sh = shared(A, B); if (sh && (!best || sh.hi - sh.lo > best.sh.hi - best.sh.lo)) best = { B, sh }; }
      if (!best) continue;
      openings.push({ type: "door", a: A.id, b: best.B.id, axis: best.sh.axis, at: best.sh.at, center: r1((best.sh.lo + best.sh.hi) / 2), width: 0.95, height: 2.1, sill: 0, hinge: "start", swingInto: A.id });
      added = true; seen.add(A.id);
    }
    if (!added) break;
  }
  // (rooms still shut off — and the lift shafts — are not walked: dropped; their walls stay)
  const seen = reach();
  const keep = rooms.filter(r => seen.has(r.id));
  const kept = new Set(keep.map(r => r.id));
  const ops = openings.filter(o => kept.has(o.a) && (o.b === "out" || kept.has(o.b)));
  const lf = lifts.filter(l => kept.has(l.room));
  // ------------------------------------------------ light zones: the scene has 28 area lights — at most 22 zones
  const zoneArea = new Map<string, number>();
  for (const r of keep) zoneArea.set(r.zone, (zoneArea.get(r.zone) ?? 0) + (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]));
  const merged = new Map<string, string>();
  const zoneOf = (z: string) => { while (merged.has(z)) z = merged.get(z)!; return z; };
  for (;;) {
    const zs = [...new Set(keep.map(r => zoneOf(r.zone)))];
    if (zs.length <= 22) break;
    // the smallest zone into the neighbour it opens to (else any neighbour)
    const small = zs.sort((a, b) => (zoneArea.get(a) ?? 0) - (zoneArea.get(b) ?? 0))[0];
    const mine = keep.filter(r => zoneOf(r.zone) === small);
    let into: string | null = null;
    for (const o of ops) { const a = keep.find(r => r.id === o.a), b = keep.find(r => r.id === o.b); if (!a || !b) continue; if (zoneOf(a.zone) === small && zoneOf(b.zone) !== small) into = zoneOf(b.zone); else if (zoneOf(b.zone) === small && zoneOf(a.zone) !== small) into = zoneOf(a.zone); if (into) break; }
    if (!into) for (const A of mine) { const B = keep.find(r => zoneOf(r.zone) !== small && shared(A, r)); if (B) { into = zoneOf(B.zone); break; } }
    if (!into) into = zs.find(z => z !== small)!;
    merged.set(small, into); zoneArea.set(into, (zoneArea.get(into) ?? 0) + (zoneArea.get(small) ?? 0));
  }
  for (const r of keep) r.zone = zoneOf(r.zone);
  // ------------------------------------------------ windows where a room looks out, the budget allowing
  const zones = new Set(keep.map(r => r.zone)).size;
  const wins: Opening[] = [];
  for (const r of keep) {
    if (r.type === "storage" || r.type === "stair" || r.type === "restroom" || r.type === "plant" || f.level < 0) continue;
    for (const s of ["n", "s", "w", "e"] as Side[]) {
      const e = exterior(r, s); if (e.hi - e.lo < 2) continue;
      const lobby = r.type === "lobby" && f.level === 1;
      // (not over the front door)
      const fd = ops.find(o => o.type === "front_door" && o.a === r.id && o.axis === axisOf(s) && o.at === lineOf(r, s));
      let lo = e.lo + 0.5, hi = e.hi - 0.5;
      if (fd) { if (fd.center - lo > hi - fd.center) hi = Math.min(hi, fd.center - fd.width / 2 - 0.4); else lo = Math.max(lo, fd.center + fd.width / 2 + 0.4); }
      if (hi - lo < 1.2) continue;
      wins.push({ type: "window", a: r.id, b: "out", axis: axisOf(s), at: lineOf(r, s), center: r1((lo + hi) / 2), width: r1(hi - lo), height: lobby ? 2.4 : 1.7, sill: lobby ? 0.12 : 0.8 });
    }
  }
  wins.sort((a, b) => b.width - a.width);
  ops.push(...wins.slice(0, Math.max(0, 27 - zones)));
  // ------------------------------------------------ switches by the doors
  const fixtures: Fixture[] = [];
  for (const r of keep) {
    if (isPublic(r) || r.type === "parking") continue;
    const d = ops.find(o => (o.a === r.id || o.b === r.id) && o.b !== "out" && o.type !== "window" && o.type !== "open");
    if (!d) continue;
    const [x0, z0, x1, z1] = r.rect;
    const inward = d.axis === "z" ? (Math.abs(d.at - z0) < Math.abs(d.at - z1) ? 1 : -1) : (Math.abs(d.at - x0) < Math.abs(d.at - x1) ? 1 : -1);
    const lo = d.axis === "z" ? x0 : z0, hi = d.axis === "z" ? x1 : z1, a = Math.min(hi - 0.15, Math.max(lo + 0.15, d.center + d.width / 2 + 0.22));
    fixtures.push({ type: "switch", pos: d.axis === "z" ? [a, d.at + inward * 0.001] : [d.at + inward * 0.001, a], rot: d.axis === "z" ? (inward > 0 ? 0 : 180) : (inward > 0 ? 90 : -90), room: r.id });
  }
  // ------------------------------------------------ who is here
  const people: NonNullable<FloorPlan["facility"]>["people"] = [];
  for (const [rid, ids] of byRegion) { const rg = regions[rid - 1], id = ids.find(i => kept.has(i)); if (id) for (const role of rg.people) people.push({ room: id, role }); }
  const area = keep.reduce((t, r) => t + (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]), 0);
  const cropped = bx1 - bx0 > W + 0.5 || bz1 - bz0 > D + 0.5;
  return {
    complexId: f.id, complexName: f.name, dong: "", unitType: FACILITY_LABEL[kind], areaExclusiveM2: Math.round(area), ceilingHeightM: kind === "parking" ? 3.0 : H,
    source: "estimated_template",
    template: drawn ? `SGIS 실내 구획도 기반${cropped ? ` (출입구 주변 ${Math.round(W)}×${Math.round(D)}m)` : ""}` : `실측 외곽 기반 ${FACILITY_LABEL[kind]} 배치${cropped ? ` (출입구 주변 ${Math.round(W)}×${Math.round(D)}m)` : ""}`,
    basis: { area: "SGIS 건물 외곽", rooms: drawn ? "SGIS 사업체 전개도 구획 (방·복도·승강기·계단·화장실)" : f.use ? `건축물대장 층별 용도: ${f.use}` : "건축물대장 용도", built: f.built ?? null },
    bounds: [0, 0, r1(nx * CELL), r1(nz * CELL)], rooms: keep, openings: ops, fixtures,
    check: { areaM2: Math.round(area), error: 0 },
    style: facilityStyle(kind, f.seed), floor: Math.max(1, f.level),
    facility: { kind, name: f.name, level: f.level, levelLabel: f.levelLabel, use: f.use, start, lifts: lf, people, drawn },
  };
}

function sideOf(r: Room, axis: "x" | "z", at: number): Side {
  if (axis === "z") return Math.abs(at - r.rect[1]) < 1e-6 ? "n" : "s";
  return Math.abs(at - r.rect[0]) < 1e-6 ? "w" : "e";
}
export type { FacilityKind };
