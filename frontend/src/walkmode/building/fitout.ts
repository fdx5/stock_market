import { kindOf, type BuildingPlan, type FloorPlan, type Mat, type Seg, type SpotKind, type Tenant, type ZoneKind } from "./plan";

/**
 * Any building's floor, fitted out live from what is known about it, in this order:
 *  1. its surveyed outline and, where charted, its rooms and cores (SGIS 사업체 전개도, this floor);
 *  2. its vertical cores — lifts, stairs, toilets, shafts — from its nearest charted floor (they are
 *     stacked through a building), else a core sized by the register's lift count;
 *  3. the register's use of this floor (건축물대장 층별개요), which picks the floor's programme;
 *  4. the businesses registered on it (상가정보 / SGIS names) and a hospital's departments (HIRA);
 *  5. the programme's planning rules: a structural grid of columns, corridors at the programme's
 *     spacing, rooms of its sizes along them, each room furnished for what it is.
 * Everything is laid out in the building's own axes (its outline's main direction), on a 0.5 m raster,
 * so nothing is left empty: what no rule claims becomes a support room or open floor.
 */

type P2 = [number, number];
export interface FitSource {
  outline: P2[][][];
  /** this floor's charted rooms (plan coords): type "10" business, "20" open, … */
  rooms: { type: string; poly: P2[][]; name?: string; category?: string }[];
  /** the cores (plan coords): "32" lift, "33" escalator, "34" stairs, "35" toilet, "40" shaft */
  cores: { type: string; ring: P2[] }[];
  coresFrom: number | null;
}
export interface FitInput { b: BuildingPlan; level: number; src: FitSource; entry: P2 | null; departments: string[]; tenants: Tenant[]; seed: number; year?: number }

type RT = "unit" | "cinema" | "aquarium" | "exhibit" | "stall" | "consult" | "treat" | "exam" | "xray" | "blood" | "counsel" | "store" | "staff" | "office" | "meeting" | "pantry" | "shop" | "cafe" | "food" | "pharmacy" | "bank" | "mart" | "salon" | "class" | "guest" | "ward6" | "ward2" | "lounge" | "plant" | "vacant";
interface Room { u0: number; v0: number; u1: number; v1: number; front: 0 | 1 | 2 | 3; type: RT; name?: string; zone?: number; walls: boolean; glass?: boolean; ring?: P2[] }
type Profile = "house" | "outpatient" | "ward" | "office" | "retail" | "class" | "hotel" | "civic" | "food" | "parking";

const VENUE = new Set<string>(["aquarium", "exhibit", "food"]);
const FREE = 1, CORE = 2, CORR = 3, HALL = 4, ROOM = 5, COL = 6, OPEN = 7;
const DEPTS = ["내과", "정형외과", "외과", "신경과", "소아청소년과", "산부인과", "이비인후과", "안과", "피부과", "비뇨의학과", "재활의학과", "가정의학과", "신경외과", "흉부외과", "정신건강의학과", "영상의학과", "진단검사의학과"];
const ZK: Record<RT, ZoneKind> = { unit: "rooms", cinema: "museum", aquarium: "museum", exhibit: "museum", stall: "parking", consult: "clinic", treat: "clinic", exam: "clinic", xray: "clinic", blood: "clinic", counsel: "office", store: "office", staff: "office", office: "office", meeting: "office", pantry: "office",
  shop: "retail", cafe: "food", food: "food", pharmacy: "retail", bank: "retail", mart: "retail", salon: "retail", class: "class", guest: "hotel", ward6: "ward", ward2: "ward", lounge: "lobby", plant: "plant", vacant: "retail" };
const NAME: Partial<Record<RT, string>> = { cinema: "상영관", aquarium: "수족관", exhibit: "전시실", treat: "처치실", exam: "검사실", xray: "방사선촬영실", blood: "채혈실", counsel: "상담실", store: "창고", staff: "직원휴게실", meeting: "회의실", pantry: "탕비실", plant: "설비실", lounge: "휴게공간" };

function rand(seed: number) { let s = (seed >>> 0) || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const inRing = (x: number, z: number, p: P2[]) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inPolyH = (x: number, z: number, p: P2[][]) => inRing(x, z, p[0]) && !p.slice(1).some(h => inRing(x, z, h));
const ringArea = (p: P2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

const CIRC = /복도|화장실|계단|창고|기계|전기|설비|공용|주차|승강|발전|방재/;
function useRT(t: string): RT | null {
  return /영화/.test(t) ? "cinema" : /수족/.test(t) ? "aquarium" : /휴게음식|카페|제과/.test(t) ? "cafe" : /음식|식당/.test(t) ? "food" : /판매|상점|소매|근린|마트/.test(t) ? "shop"
    : /업무|사무/.test(t) ? "office" : /숙박|호텔/.test(t) ? "guest" : /교육|학원|학교/.test(t) ? "class" : /의료|의원|병원/.test(t) ? "consult" : /전시|집회|문화|관람/.test(t) ? "exhibit" : null;
}
/** the floor's mix of uses (the register's 층별개요), by area: two or more make a mixed floor */
export function mixOf(b: BuildingPlan, level: number): { rt: RT; area: number }[] {
  const m = new Map<RT, number>();
  for (const u of b.regFloors.find(f => f.level === level)?.uses ?? []) { const t = `${u.use} ${u.detail}`; if (CIRC.test(u.detail || u.use)) continue; const rt = useRT(t); if (rt) m.set(rt, (m.get(rt) ?? 0) + u.area); }
  return [...m].map(([rt, area]) => ({ rt, area })).sort((a, c) => c.area - a.area);
}
/** what this floor is for: the register's largest use on it, a hospital's floors by height */
export function profileOf(b: BuildingPlan, level: number, shops = 0): Profile | null {
  const reg = b.regFloors.find(f => f.level === level), uses = [...(reg?.uses ?? [])].filter(u => !CIRC.test(u.detail || u.use) || /주차/.test(u.detail || u.use)).sort((a, c) => c.area - a.area);
  const all = `${b.info.use ?? ""} ${b.info.useDetail ?? ""} ${b.info.name ?? ""}`;
  const mix = mixOf(b, level);
  if (mix.length >= 2 && !/의료|병원|의원/.test(all)) return shops >= 3 || mix.some(m => m.rt === "shop" || m.rt === "food" || m.rt === "cafe") ? "retail" : "civic";
  let k = kindOf(uses[0]?.use ?? b.info.use ?? "", uses[0]?.detail ?? b.info.useDetail ?? "", level, b.info);
  if (k === "parking") {
    // (a car park's floor with trade on it — registered shops, or a quarter of its area — is a mall)
    const total = uses.reduce((t, u) => t + u.area, 0) || 1;
    const trade = uses.filter(u => !/주차/.test(`${u.use} ${u.detail}`)).sort((a, c) => c.area - a.area)[0];
    if (shops >= 3 || (trade && trade.area / total >= 0.25)) k = trade ? kindOf(trade.use, trade.detail, level, b.info) : "retail";
    if (k === "parking") return "parking";
    if (k === "rooms" || k === "plant" || k === "office" && shops >= 3) k = "retail";
  }
  if (k === "plant") return null;
  if (k === "rooms") return "house";
  if (/의료|병원|의원/.test(all) || k === "clinic" || k === "ward") {
    const top = b.info.floors ?? 1, wardFrom = top >= 8 ? Math.max(3, Math.ceil(top * 0.4)) : 99;
    if (level >= wardFrom || k === "ward") return "ward";
    return level < 0 && k !== "clinic" ? "retail" : "outpatient";
  }
  return k === "retail" ? "retail" : k === "food" ? "food" : k === "class" ? "class" : k === "hotel" ? "hotel" : k === "civic" || k === "museum" ? "civic" : "office";
}

const LATTICE: Record<Profile, { corr: number; spine: number; depth: number; width: number; open: boolean }> = {
  outpatient: { corr: 6.0, spine: 9, depth: 5.4, width: 2.8, open: false },
  ward: { corr: 2.8, spine: 3.2, depth: 7.0, width: 4.2, open: false },
  office: { corr: 2.0, spine: 2.4, depth: 5.6, width: 4.2, open: true },
  retail: { corr: 4.0, spine: 5.0, depth: 8.0, width: 5.6, open: false },
  food: { corr: 3.6, spine: 4.5, depth: 9.0, width: 7.0, open: false },
  class: { corr: 3.0, spine: 3.6, depth: 8.0, width: 9.0, open: false },
  hotel: { corr: 1.9, spine: 2.4, depth: 8.0, width: 4.0, open: false },
  civic: { corr: 3.0, spine: 4.0, depth: 6.0, width: 6.0, open: true },
  parking: { corr: 6.0, spine: 6.5, depth: 5.0, width: 2.5, open: false },
  house: { corr: 1.4, spine: 1.6, depth: 6.5, width: 5.6, open: false },
};

export function fitOut(inp: FitInput): FloorPlan | null {
  const { b, level, src } = inp;
  const profile = profileOf(b, level, inp.tenants.length);
  const measured = src.rooms.some(r => r.type === "10");
  if (!profile && !measured) return null;
  const prof: Profile = profile ?? "retail", rnd = rand(inp.seed * 7919 + level * 131);
  const polys = src.outline.filter(p => p[0]?.length >= 3);
  if (!polys.length) return null;
  // (a large mall's walks are wide: past 15,000 m² its corridors and spine half as wide again)
  const plateArea = polys.reduce((t, p) => t + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  const L = (prof === "retail" || prof === "food") && plateArea > 15000 ? { ...LATTICE[prof], corr: LATTICE[prof].corr * 1.5, spine: LATTICE[prof].spine * 1.8 } : LATTICE[prof];
  const hospitalB = /의료|병원|의원/.test(`${b.info.use ?? ""} ${b.info.useDetail ?? ""} ${b.info.name ?? ""}`);
  const H = level === 1 ? 4.6 : prof === "ward" || prof === "hotel" ? 3.4 : prof === "parking" ? 3.0 : 3.9;

  // ---- the building's axes: the direction its outline's edges run most (mod 90°), by length
  const hist = new Float64Array(90);
  for (const p of polys) for (const r of p) for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]); let d = Math.atan2(c[1] - a[1], c[0] - a[0]) * 180 / Math.PI; d = ((d % 90) + 90) % 90; hist[Math.floor(d) % 90] += len; }
  let bestA = 0; for (let d = 0, top = -1; d < 90; d++) { const s = hist[d] + 0.5 * (hist[(d + 1) % 90] + hist[(d + 89) % 90]); if (s > top) { top = s; bestA = d; } }
  // (refined: the length-weighted mean of the edges near it)
  let sw = 0, sa = 0; for (const p of polys) for (const r of p) for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]); let d = Math.atan2(c[1] - a[1], c[0] - a[0]) * 180 / Math.PI; d = ((d % 90) + 90) % 90; let off = d - bestA; if (off > 45) off -= 90; if (off < -45) off += 90; if (Math.abs(off) < 2) { sw += len; sa += off * len; } }
  const th = (bestA + (sw ? sa / sw : 0)) * Math.PI / 180, ca = Math.cos(th), sn = Math.sin(th);
  const toL = (p: P2): P2 => [p[0] * ca + p[1] * sn, -p[0] * sn + p[1] * ca];
  const toP = (u: number, v: number): P2 => [u * ca - v * sn, u * sn + v * ca];
  const lp = polys.map(p => p.map(r => r.map(toL)));
  const all = lp.flatMap(p => p[0]);
  const U0 = Math.min(...all.map(q => q[0])) - 0.5, V0 = Math.min(...all.map(q => q[1])) - 0.5;
  const c = 0.5, nu = Math.ceil((Math.max(...all.map(q => q[0])) + 0.5 - U0) / c), nv = Math.ceil((Math.max(...all.map(q => q[1])) + 0.5 - V0) / c);
  if (nu * nv > 1_600_000) return null;
  const lab = new Uint8Array(nu * nv), owner = new Int32Array(nu * nv).fill(-1);
  const cu = (i: number) => U0 + (i + 0.5) * c, cv = (j: number) => V0 + (j + 0.5) * c;
  const iu = (u: number) => Math.floor((u - U0) / c), jv = (v: number) => Math.floor((v - V0) / c);
  const at = (u: number, v: number) => { const i = iu(u), j = jv(v); return i < 0 || j < 0 || i >= nu || j >= nv ? 0 : lab[j * nu + i]; };
  // (inside: scanline over each ring, even-odd)
  for (let j = 0; j < nv; j++) {
    const v = cv(j);
    for (const p of lp) {
      const xs: number[] = [];
      for (const r of p) for (let i = 0; i < r.length; i++) { const a = r[i], q = r[(i + 1) % r.length]; if ((a[1] > v) !== (q[1] > v)) xs.push(a[0] + (v - a[1]) * (q[0] - a[0]) / (q[1] - a[1])); }
      xs.sort((a, q) => a - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, iu(xs[k]) ); i <= Math.min(nu - 1, iu(xs[k + 1])); i++) if (cu(i) >= xs[k] && cu(i) <= xs[k + 1]) lab[j * nu + i] = FREE;
    }
  }
  const lo = (a: number, o: number) => Math.ceil((a - o) / c - 0.5), hi = (a: number, o: number) => Math.floor((a - o) / c - 0.5);
  const fillRect = (u0: number, v0: number, u1: number, v1: number, to: number, only: number[] = [FREE], who = -1) => {
    // (a cell is the rectangle's when its centre is in it — the same rule as rectIs)
    for (let j = Math.max(0, lo(v0, V0)); j <= Math.min(nv - 1, hi(v1, V0)); j++) for (let i = Math.max(0, lo(u0, U0)); i <= Math.min(nu - 1, hi(u1, U0)); i++) {
      const k = j * nu + i; if (only.includes(lab[k])) { lab[k] = to; if (who >= 0) owner[k] = who; }
    }
  };
  const rectIs = (u0: number, v0: number, u1: number, v1: number, ok: number[]) => {
    for (let j = lo(v0, V0); j <= hi(v1, V0); j++) for (let i = lo(u0, U0); i <= hi(u1, U0); i++) { if (i < 0 || j < 0 || i >= nu || j >= nv || !ok.includes(lab[j * nu + i])) return false; }
    return true;
  };

  // ---- output
  const segs: Seg[] = [], spots: FloorPlan["spots"] = [], decor: FloorPlan["decor"] = [], zones: FloorPlan["zones"] = [];
  const lifts: FloorPlan["lifts"] = [], stairs: FloorPlan["stairs"] = [], points: NonNullable<FloorPlan["points"]> = [];
  const seg = (a: P2, q: P2, t: number, y0: number, y1: number, m: Mat, solid = true) => { const A = toP(...a), B = toP(...q); segs.push({ ax: A[0], az: A[1], bx: B[0], bz: B[1], t, y0, y1, m, solid }); };
  const segP = (A: P2, B: P2, t: number, y0: number, y1: number, m: Mat, solid = true) => segs.push({ ax: A[0], az: A[1], bx: B[0], bz: B[1], t, y0, y1, m, solid });
  /** a box in the building's axes (drawn as a seg: a box turned to them) */
  const blk = (u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, m: Mat, solid = true) => {
    const du = Math.abs(u1 - u0), dv = Math.abs(v1 - v0), mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    if (du >= dv) seg([Math.min(u0, u1), mv], [Math.max(u0, u1), mv], Math.max(0.02, dv), y0, y1, m, solid);
    else seg([mu, Math.min(v0, v1)], [mu, Math.max(v0, v1)], Math.max(0.02, du), y0, y1, m, solid);
  };
  const yawOf = (du: number, dv: number) => { const [x, z] = toP(du, dv); return Math.atan2(x, z); };
  const spot = (u: number, v: number, du: number, dv: number, kind: SpotKind, y: number, zone: number) => { const [x, z] = toP(u, v); spots.push({ x, z, yaw: yawOf(du, dv), kind, y, zone }); };
  const sign = (u: number, v: number, y: number, du: number, dv: number, w: number, h: number, text: string, kind: FloorPlan["decor"][number]["kind"] = "sign") => { const [x, z] = toP(u, v); decor.push({ kind, x, z, y, yaw: yawOf(du, dv), w, h, text }); };

  // ---- 1. the cores: charted (this floor or the nearest charted one), else made to the register
  const coreRings = src.cores.map(cr => ({ type: cr.type, ring: cr.ring.map(toL) })).filter(cr => cr.ring.length >= 3);
  for (const cr of coreRings) {
    const us = cr.ring.map(q => q[0]), vs = cr.ring.map(q => q[1]);
    for (let j = Math.max(0, jv(Math.min(...vs))); j <= Math.min(nv - 1, jv(Math.max(...vs))); j++) for (let i = Math.max(0, iu(Math.min(...us))); i <= Math.min(nu - 1, iu(Math.max(...us))); i++)
      if (lab[j * nu + i] && inRing(cu(i), cv(j), cr.ring)) lab[j * nu + i] = CORE;
  }
  // (none charted: a core at the floor's deepest point, its lifts the register's, stairs at its ends)
  let synth: { u0: number; v0: number; u1: number; v1: number; alongU: boolean; n: number } | null = null;
  if (!coreRings.length) {
    const dist = new Int32Array(nu * nv).fill(-1), q: number[] = [];
    for (let k = 0; k < lab.length; k++) if (!lab[k]) { dist[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) { const k = q[h], i = k % nu, j = (k / nu) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, z = j + dj; if (a < 0 || z < 0 || a >= nu || z >= nv) continue; const n = z * nu + a; if (dist[n] < 0) { dist[n] = dist[k] + 1; q.push(n); } } }
    let deep = 0; for (let k = 1; k < dist.length; k++) if (dist[k] > dist[deep]) deep = k;
    const n = Math.max(prof === "house" ? 1 : 2, Math.min(12, (b.info.rideLifts ?? 0) + (b.info.emergencyLifts ?? 0) || Math.ceil((b.info.totalArea ?? 3000) / 6000)));
    const alongU = (nu > nv), len = Math.ceil(n / 2) * 2.6 + 2 * 3.4 + 6, wid = 8.6;
    const mu = cu(deep % nu), mv = cv((deep / nu) | 0);
    synth = alongU ? { u0: mu - len / 2, v0: mv - wid / 2, u1: mu + len / 2, v1: mv + wid / 2, alongU, n } : { u0: mu - wid / 2, v0: mv - len / 2, u1: mu + wid / 2, v1: mv + len / 2, alongU, n };
    fillRect(synth.u0, synth.v0, synth.u1, synth.v1, CORE, [FREE]);
  }

  // ---- 2. the structural grid: columns every 8.4 m in the building's axes (clad, with a skirting)
  const S = 8.4, colAt: P2[] = [];
  for (let u = U0 + 0.95; u < U0 + nu * c; u += S) for (let v = V0 + 0.95; v < V0 + nv * c; v += S) {
    let ok = true; for (const [du, dv] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) { const l = at(u + du, v + dv); if (l !== FREE) { ok = false; break; } }
    if (ok) colAt.push([u, v]);
  }

  // ---- 3. the entrance, the spine through the floor from it, the hall inside it
  let eL: P2 | null = inp.entry ? toL(inp.entry) : null, axis = 1, sg = 1;
  const cRing = lp.slice().sort((a, q) => ringArea(q[0]) - ringArea(a[0]))[0][0];
  if (eL) {
    // (onto the outline's nearest edge; inward is the axis most opposed to that edge's outward normal)
    let best = Infinity, nrm: P2 = [0, 1], on: P2 = eL;
    for (let i = 0; i < cRing.length; i++) {
      const a = cRing[i], q = cRing[(i + 1) % cRing.length], dx = q[0] - a[0], dz = q[1] - a[1], l2 = dx * dx + dz * dz; if (l2 < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((eL[0] - a[0]) * dx + (eL[1] - a[1]) * dz) / l2)), px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - eL[0], pz - eL[1]);
      if (d < best) { best = d; on = [px, pz]; const ln = Math.sqrt(l2); nrm = [dz / ln, -dx / ln]; if (inRing(px + nrm[0] * 0.3, pz + nrm[1] * 0.3, cRing)) nrm = [-nrm[0], -nrm[1]]; }
    }
    eL = on; if (Math.abs(nrm[0]) > Math.abs(nrm[1])) { axis = 0; sg = nrm[0] > 0 ? -1 : 1; } else { axis = 1; sg = nrm[1] > 0 ? -1 : 1; }
  } else { axis = nu > nv ? 0 : 1; sg = 1; }
  // (along: the spine's coordinate, across: the other)
  const A = (u: number, v: number) => axis === 0 ? u : v, X = (u: number, v: number) => axis === 0 ? v : u;
  const UV = (a: number, x: number): P2 => axis === 0 ? [a, x] : [x, a];
  const rectAX = (a0: number, x0: number, a1: number, x1: number) => { const p = UV(Math.min(a0, a1), Math.min(x0, x1)), q = UV(Math.max(a0, a1), Math.max(x0, x1)); return [p[0], p[1], q[0], q[1]] as [number, number, number, number]; };
  const aMin = axis === 0 ? U0 : V0, aMax = aMin + (axis === 0 ? nu : nv) * c, xMin = axis === 0 ? V0 : U0, xMax = xMin + (axis === 0 ? nv : nu) * c;
  const ea = eL ? A(...eL) : sg > 0 ? aMin : aMax, ex = eL ? X(...eL) : (xMin + xMax) / 2;
  const ground = level === 1 && !!eL;
  const hallD = ground ? (prof === "outpatient" ? 20 : prof === "office" || prof === "hotel" || prof === "civic" ? 13 : 8) : 0;
  const hallW = ground ? (prof === "outpatient" ? 44 : prof === "retail" || prof === "food" ? 10 : 20) : 0;
  const zoneOf = (kind: ZoneKind, label: string, u0: number, v0: number, u1: number, v1: number, ring?: P2[]) => {
    const pts = ring ?? [toP(u0, v0), toP(u1, v0), toP(u1, v1), toP(u0, v1)];
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    zones.push({ kind, label, rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], polygon: [pts] }); return zones.length - 1;
  };
  let hallZone = -1;
  if (ground && !measured) {
    const [u0, v0, u1, v1] = rectAX(ea, ex - hallW / 2, ea + sg * hallD, ex + hallW / 2);
    fillRect(u0, v0, u1, v1, HALL); hallZone = zoneOf("lobby", "로비", u0, v0, u1, v1);
  }
  const rooms: Room[] = [];
  if (!measured) {
    // the spine: from the door through the floor (or, above the street, along the floor's middle)
    const [su0, sv0, su1, sv1] = rectAX(aMin, ex - L.spine / 2, aMax, ex + L.spine / 2);
    fillRect(su0, sv0, su1, sv1, CORR);
    // lobbies before the cores: 3 m round each, kept open
    for (const cr of coreRings) { const us = cr.ring.map(q => q[0]), vs = cr.ring.map(q => q[1]); if (cr.type !== "40") fillRect(Math.min(...us) - 3, Math.min(...vs) - 3, Math.max(...us) + 3, Math.max(...vs) + 3, CORR); }
    if (synth) fillRect(synth.u0 - 3, synth.v0 - 3, synth.u1 + 3, synth.v1 + 3, CORR);
    // cross corridors at the programme's spacing, measured from the hall's back (or the spine's start)
    const pitch = 2 * L.depth + L.corr, a0 = ea + sg * (hallD + L.corr / 2);
    const lines: number[] = [];
    for (let k = -Math.ceil((aMax - aMin) / pitch) - 1; k <= Math.ceil((aMax - aMin) / pitch) + 1; k++) { const a = a0 + sg * k * pitch; if (a > aMin - L.corr && a < aMax + L.corr) lines.push(a); }
    if (!L.open) for (const a of lines) { const [u0, v0, u1, v1] = rectAX(a - L.corr / 2, xMin, a + L.corr / 2, xMax); fillRect(u0, v0, u1, v1, CORR); }
    // ---- 4. rooms along both sides of every corridor, out from the spine both ways
    const sides: { a: number; dir: number; x0: number; xd: number; seg: string }[] = [];
    if (!L.open) {
      lines.forEach((a, li) => { for (const dir of [1, -1]) for (const xd of [1, -1]) sides.push({ a: a + dir * L.corr / 2, dir, x0: ex + xd * L.spine / 2, xd, seg: `${li}:${xd}` }); });
    } else {
      // (open plans: the cores' rings of rooms only — meeting rooms, pantries — the rest open floor)
      for (const cr of coreRings.length ? coreRings : synth ? [{ type: "x", ring: [[synth.u0, synth.v0], [synth.u1, synth.v0], [synth.u1, synth.v1], [synth.u0, synth.v1]] as P2[] }] : []) {
        if (cr.type === "40") continue;
        const as = cr.ring.map(q => A(...q)), xs = cr.ring.map(q => X(...q));
        for (const dir of [1, -1]) sides.push({ a: (dir > 0 ? Math.max(...as) : Math.min(...as)) + dir * 3, dir, x0: Math.min(...xs) - 3, xd: 1, seg: "core" });
      }
    }
    const depth = L.depth, wantW = (sd: { seg: string }, k: number) => prof === "ward" ? (k % 3 === 2 ? 6.6 : 4.2) : prof === "outpatient" && sd.seg !== "core" && k === 0 ? 5.6 : L.width;
    for (const sd of sides) {
      let x = sd.x0, k = 0;
      for (let guard = 0; guard < 400; guard++) {
        const w = wantW(sd, k), xa = sd.xd > 0 ? x : x - w, xb = sd.xd > 0 ? x + w : x;
        if ((sd.xd > 0 && xa > xMax) || (sd.xd < 0 && xb < xMin)) break;
        const [u0, v0, u1, v1] = rectAX(sd.a, xa, sd.a + sd.dir * depth, xb);
        // (front: the corridor side; one of four in the building's axes)
        const front: Room["front"] = axis === 0 ? (sd.dir > 0 ? 0 : 1) : (sd.dir > 0 ? 2 : 3);
        // a slot clipped by the outline gets the depth it has (at least 3.4 m), else it is skipped
        let ok = rectIs(u0, v0, u1, v1, [FREE, COL]);
        let rr: [number, number, number, number] = [u0, v0, u1, v1];
        if (!ok) for (const dd of [depth * 0.8, depth * 0.65, 3.4]) { const q = rectAX(sd.a, xa, sd.a + sd.dir * dd, xb); if (rectIs(...q, [FREE, COL])) { ok = true; rr = q; break; } }
        if (ok && rectIs(...(rectAX(sd.a - sd.dir * 0.6, xa + 0.5, sd.a - sd.dir * 0.1, xb - 0.5)), [CORR, HALL])) {
          rooms.push({ u0: rr[0], v0: rr[1], u1: rr[2], v1: rr[3], front, type: prof === "parking" ? "stall" : "office", walls: prof !== "parking", name: prof === "parking" ? undefined : sd.seg });
          fillRect(...rr, ROOM, [FREE, COL], rooms.length - 1); k++;
        }
        x += sd.xd * (ok ? w : 1);
      }
    }
  } else {
    // ---- a charted floor: its businesses as given, the rest open
    for (let k = 0; k < lab.length; k++) if (lab[k] === FREE) lab[k] = CORR;
    for (const r of src.rooms) {
      if (r.type !== "10" && !(r.type === "20" && ringArea(r.poly[0]) < 400 && ringArea(r.poly[0]) > 6)) continue;
      const ring = r.poly[0].map(toL), us = ring.map(q => q[0]), vs = ring.map(q => q[1]);
      // (furnished within its largest inner rectangle, its front the side toward the open floor)
      const box = innerRect(ring, c);
      if (!box) continue;
      const [u0, v0, u1, v1] = box, mid: P2 = [(u0 + u1) / 2, (v0 + v1) / 2];
      const fr = ([[0, [u0 - 1.2, mid[1]]], [1, [u1 + 1.2, mid[1]]], [2, [mid[0], v0 - 1.2]], [3, [mid[0], v1 + 1.2]]] as [Room["front"], P2][])
        .map(([f, p]) => ({ f, score: (inRing(p[0], p[1], ring) ? 0 : 1) + (at(...p) === CORR ? 2 : 0) })).sort((a, q) => q.score - a.score)[0].f;
      // (an uncharted unit: in a hospital, its own rooms — no business is registered in them; elsewhere vacant)
      const t: RT = r.type === "20" ? (hospitalB ? (["exam", "treat", "counsel", "store", "staff"] as RT[])[Math.floor(rnd() * 5)] : "vacant") : typeOfCategory(r.category ?? "", r.name ?? "");
      rooms.push({ u0, v0, u1, v1, front: fr, type: t, name: r.type === "20" ? (hospitalB ? undefined : "공실") : r.name, walls: false, glass: r.type !== "20" || !hospitalB, ring });
      for (let j = Math.max(0, jv(Math.min(...vs))); j <= Math.min(nv - 1, jv(Math.max(...vs))); j++) for (let i = Math.max(0, iu(Math.min(...us))); i <= Math.min(nu - 1, iu(Math.max(...us))); i++)
        if (lab[j * nu + i] === CORR && inRing(cu(i), cv(j), ring)) { lab[j * nu + i] = ROOM; owner[j * nu + i] = rooms.length - 1; }
    }
  }

  // ---- 5. what is left: support rooms (or open floor) in its largest rectangles, down to 2 × 2.4 m
  const leftover = () => {
    const h = new Int32Array(nu);
    let best = { area: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) h[i] = lab[j * nu + i] === FREE ? h[i] + 1 : 0;
      const st: number[] = [];
      for (let i = 0; i <= nu; i++) {
        const hi = i < nu ? h[i] : 0;
        while (st.length && h[st[st.length - 1]] >= hi) { const top = st.pop()!, height = h[top], left = st.length ? st[st.length - 1] + 1 : 0, w = i - left; const area = w * height; if (w >= 4 && height >= 4 && area > best.area) best = { area, i0: left, i1: i - 1, j0: j - height + 1, j1: j }; }
        st.push(i);
      }
    }
    return best.area ? best : null;
  };
  const openRects: [number, number, number, number][] = [];
  for (let guard = 0; guard < 160; guard++) {
    const r = leftover(); if (!r || r.area * c * c < 6) break;
    let u0 = U0 + r.i0 * c, u1 = U0 + (r.i1 + 1) * c, v0 = V0 + r.j0 * c, v1 = V0 + (r.j1 + 1) * c;
    // (a side touching a walkway is its front)
    const touch = (f: Room["front"]) => { let n = 0; for (let t = 0; t < 1; t += 0.1) { const p: P2 = f === 0 ? [u0 - 0.3, v0 + (v1 - v0) * t] : f === 1 ? [u1 + 0.3, v0 + (v1 - v0) * t] : f === 2 ? [u0 + (u1 - u0) * t, v0 - 0.3] : [u0 + (u1 - u0) * t, v1 + 0.3]; const l = at(...p); if (l === CORR || l === HALL || l === OPEN) n++; } return n; };
    const fronts = ([0, 1, 2, 3] as Room["front"][]).map(f => ({ f, n: touch(f) })).sort((a, q) => q.n - a.n);
    const big = (u1 - u0) * (v1 - v0) > 60;
    if (L.open && big) { fillRect(u0, v0, u1, v1, OPEN); openRects.push([u0, v0, u1, v1]); continue; }
    if (big && Math.min(u1 - u0, v1 - v0) > 9) {
      // (a large block: a corridor through its middle, rooms either side — the next passes take them)
      if (u1 - u0 > v1 - v0) { const m = (v0 + v1) / 2; fillRect(u0, m - 1.2, u1, m + 1.2, CORR); } else { const m = (u0 + u1) / 2; fillRect(m - 1.2, v0, m + 1.2, v1, CORR); }
      continue;
    }
    // (long thin blocks: a row of rooms of 3–6 m along their length, each opening onto a long side; a
    // block reached only at its end gets a 1.8 m passage down one long side first)
    const along = u1 - u0 >= v1 - v0 ? "u" : "v";
    const longSides: Room["front"][] = along === "u" ? [2, 3] : [0, 1];
    let lf = longSides.map(f => ({ f, n: touch(f) })).sort((a, q) => q.n - a.n)[0];
    if (!lf.n && fronts[0].n && Math.min(u1 - u0, v1 - v0) >= 4.6) {
      const f = longSides[0];
      if (f === 2) { fillRect(u0, v0, u1, v0 + 1.8, CORR); v0 += 1.8; } else { fillRect(u0, v0, u0 + 1.8, v1, CORR); u0 += 1.8; }
      lf = { f, n: 1 };
    }
    const span = along === "u" ? u1 - u0 : v1 - v0, n = Math.max(1, Math.round(span / (Math.min(u1 - u0, v1 - v0) < 3.5 ? 3.2 : 4.6)));
    for (let k = 0; k < n; k++) {
      const a = (along === "u" ? u0 : v0) + span * k / n, z = (along === "u" ? u0 : v0) + span * (k + 1) / n;
      const rr: [number, number, number, number] = along === "u" ? [a, v0, z, v1] : [u0, a, u1, z];
      const t = !lf.n && !fronts[0].n ? "plant" : pickSupport(prof, rnd), cm: P2 = [(rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2];
      rooms.push({ u0: rr[0], v0: rr[1], u1: rr[2], v1: rr[3], front: lf.n ? lf.f : fronts[0].f, type: t, walls: t !== "stall", name: t === "office" ? `b${Math.round(A(...cm) / 30)}:${Math.sign(X(...cm) - ex)}` : undefined });
      fillRect(...rr, ROOM, [FREE], rooms.length - 1);
    }
  }

  // ---- 6. what each room is: the businesses registered here first (on the spine, the hall), then
  // the programme's rooms; a hospital's corridors by department
  const tenants = [...inp.tenants];
  const depts = (inp.departments.length ? inp.departments : DEPTS).filter(d => !/치과|한방|응급/.test(d));
  const near = (r: Room) => { const p: P2 = [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2]; return Math.abs(A(...p) - ea) + Math.abs(X(...p) - ex); };
  const order = rooms.map((_, i) => i).filter(i => rooms[i].type === "office" && !measured).sort((a, q) => near(rooms[a]) - near(rooms[q]));
  const mix = mixOf(b, level), mixed = mix.length >= 2 && prof !== "outpatient" && prof !== "ward";
  const mixAt = new Map<number, RT>();
  if (mixed) {
    const total = mix.reduce((t, m) => t + m.area, 0), spatial = order.slice().sort((a, q) => { const pa: P2 = [(rooms[a].u0 + rooms[a].u1) / 2, (rooms[a].v0 + rooms[a].v1) / 2], pq: P2 = [(rooms[q].u0 + rooms[q].u1) / 2, (rooms[q].v0 + rooms[q].v1) / 2]; return Math.floor(A(...pa) / 40) - Math.floor(A(...pq) / 40) || X(...pa) - X(...pq); });
    let k = 0; for (const m of mix) { const n = Math.round(spatial.length * m.area / total); for (let i = 0; i < n && k < spatial.length; i++) mixAt.set(spatial[k++], m.rt); }
  }
  const mixNo = new Map<RT, number>();
  const deptOf = new Map<string, string>(); let dn = (Math.max(0, level - 1) * 5) % depts.length;
  let consultNo = new Map<string, number>(), wardNo = 0;
  for (const i of order) {
    const r = rooms[i], segKey = r.name ?? "";
    r.name = undefined;
    const frontage = rectIs(...frontStrip(r, 0.6), [CORR]) && near(r) < 60 && (ground || level === -1);
    if (tenants.length && (frontage || prof === "retail" || prof === "food")) { const t = tenants.shift()!; r.type = typeOfCategory(`${t.kind} ${t.category ?? ""}`, t.name); r.name = t.name; r.glass = true; continue; }
    if (prof === "outpatient") {
      if (ground && frontage && !deptOf.has("_cafe")) { deptOf.set("_cafe", "1"); r.type = "cafe"; r.name = "카페"; r.glass = true; continue; }
      if (ground && frontage && !deptOf.has("_mart")) { deptOf.set("_mart", "1"); r.type = "mart"; r.name = "편의점"; r.glass = true; continue; }
      if (ground && frontage && !deptOf.has("_ph")) { deptOf.set("_ph", "1"); r.type = "pharmacy"; r.name = "외래약 수납"; r.glass = true; continue; }
      if (!deptOf.has(segKey)) deptOf.set(segKey, depts[dn++ % depts.length]);
      const d = deptOf.get(segKey)!, n = (consultNo.get(d) ?? 0) + 1; consultNo.set(d, n);
      r.type = d === "영상의학과" ? "xray" : d === "진단검사의학과" ? "blood" : n % 7 === 0 ? "treat" : n % 9 === 4 ? "exam" : "consult";
      r.name = r.type === "consult" ? `${d} ${n}진료실` : `${d} ${NAME[r.type]}`;
    } else if (prof === "ward") { r.type = i % 3 === 2 ? "ward6" : "ward2"; wardNo++; r.name = `${level}${String(wardNo).padStart(2, "0")}호 ${r.type === "ward6" ? "다인실" : "2인실"}`; }
    else if (prof === "office") r.type = rnd() < 0.7 ? "meeting" : "pantry";
    else if (prof === "civic") r.type = rnd() < 0.6 ? "office" : "meeting";
    else if (prof === "class") r.type = "class";
    else if (prof === "hotel") r.type = "guest";
    else if (prof === "house") { r.type = "unit"; wardNo++; r.name = `${level < 0 ? "B" : ""}${Math.abs(level)}${String(wardNo).padStart(2, "0")}호`; }
    else if (prof === "food") r.type = "food";
    else r.type = rnd() < 0.08 ? "vacant" : "shop";
    const mt = mixAt.get(i);
    if (mt && !r.name) { r.type = mt; const n = (mixNo.get(mt) ?? 0) + 1; mixNo.set(mt, n); r.name = mt === "cinema" ? `상영관 ${n}관` : NAME[mt] ? (n === 1 ? NAME[mt] : "") : undefined; if (mt === "shop" || mt === "food" || mt === "cafe") r.glass = true; }
  }
  void consultNo;
  function frontStrip(r: Room, d: number): [number, number, number, number] {
    return r.front === 0 ? [r.u0 - d, r.v0 + 0.4, r.u0 - 0.1, r.v1 - 0.4] : r.front === 1 ? [r.u1 + 0.1, r.v0 + 0.4, r.u1 + d, r.v1 - 0.4] : r.front === 2 ? [r.u0 + 0.4, r.v0 - d, r.u1 - 0.4, r.v0 - 0.1] : [r.u0 + 0.4, r.v1 + 0.1, r.u1 - 0.4, r.v1 + d];
  }

  // ---- 7. build: outer walls, cores, columns, rooms (walls, doors, fittings, signs), hall, corridors
  const T = 0.14;
  for (const p of polys) for (const ring of p) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len < 0.05) continue;
    const mid: P2 = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2], entryNear = ground && inp.entry && distSeg(inp.entry, a, q) < 0.8;
    const part = (t0: number, t1: number) => {
      const A0: P2 = [a[0] + (q[0] - a[0]) * t0, a[1] + (q[1] - a[1]) * t0], B0: P2 = [a[0] + (q[0] - a[0]) * t1, a[1] + (q[1] - a[1]) * t1];
      const glassy = ground && inp.entry && Math.hypot(mid[0] - inp.entry[0], mid[1] - inp.entry[1]) < 22;
      if (glassy) { segP(A0, B0, 0.08, 0, H - 0.4, "glass"); segP(A0, B0, T, H - 0.4, H, "metal"); }
      else if (level < 1 || prof === "parking") segP(A0, B0, T, 0, H, prof === "parking" ? "concrete" : "wall");
      else { segP(A0, B0, T, 0, 0.9, "wall"); segP(A0, B0, 0.06, 0.9, 2.75, "glass"); segP(A0, B0, T, 2.75, H, "wall"); }
    };
    if (entryNear && inp.entry) {
      const t = Math.max(0, Math.min(1, ((inp.entry[0] - a[0]) * (q[0] - a[0]) + (inp.entry[1] - a[1]) * (q[1] - a[1])) / (len * len))), g = 2.0 / len;
      if (t - g > 0) part(0, t - g); if (t + g < 1) part(t + g, 1);
      segP([a[0] + (q[0] - a[0]) * (t - g), a[1] + (q[1] - a[1]) * (t - g)], [a[0] + (q[0] - a[0]) * (t + g), a[1] + (q[1] - a[1]) * (t + g)], T, 2.6, H, "metal");
    } else part(0, 1);
  }
  // (the street door's vestibule: glass to either side, inner automatic doors)
  if (ground && eL) {
    const pin = (d: number, x: number) => UV(ea + sg * d, ex + x);
    for (const x of [-3.2, 3.2]) seg(pin(0.2, x), pin(3.4, x), 0.06, 0, 2.7, "glass");
    seg(pin(3.4, -3.2), pin(3.4, -1.9), 0.06, 0, 2.7, "glass"); seg(pin(3.4, 1.9), pin(3.4, 3.2), 0.06, 0, 2.7, "glass"); seg(pin(3.4, -3.2), pin(3.4, 3.2), 0.12, 2.7, 3.0, "metal");
    seg(pin(0.3, -2), pin(3.3, 2), 0.01, 0, 0.012, "dark", false);
    sign(...pin(3.45, 0), 2.85, ...dirTo(-sg), 3.2, 0.42, `${b.info.name ?? ""}`.slice(0, 16) || "출입구");
  }
  function dirTo(s: number): P2 { return axis === 0 ? [s, 0] : [0, s]; }
  // cores: walls to the ceiling, a door on the side toward the floor
  const openSide = (ring: P2[]) => {
    let best = { score: -1, i: 0, n: [0, 0] as P2, m: [0, 0] as P2, len: 0 };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len < 1.1) continue;
      let n: P2 = [(q[1] - a[1]) / len, -(q[0] - a[0]) / len]; const m: P2 = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
      if (inRing(m[0] + n[0] * 0.2, m[1] + n[1] * 0.2, ring)) n = [-n[0], -n[1]];
      const l = at(m[0] + n[0] * 1.2, m[1] + n[1] * 1.2), score = (l === CORR || l === HALL || l === OPEN ? 100 : l === FREE ? 50 : l === ROOM ? 5 : 0) + Math.min(len, 6);
      if (score > best.score) best = { score, i, n, m, len };
    }
    return best;
  };
  const ringWalls = (ring: P2[], m: Mat, gapAt: number, gap: number, t = 0.2) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len < 0.05) continue;
      const P = (t0: number): P2 => [a[0] + (q[0] - a[0]) * t0, a[1] + (q[1] - a[1]) * t0];
      if (i === gapAt && len > gap + 0.2) { const g = gap / 2 / len; seg(P(0), P(0.5 - g), t, 0, H, m); seg(P(0.5 + g), P(1), t, 0, H, m); seg(P(0.5 - g), P(0.5 + g), t, 2.4, H, m); }
      else seg(P(0), P(1), t, 0, H, m);
    }
  };
  let liftN = 0;
  const coreList: { type: string; ring: P2[] }[] = coreRings.length ? coreRings : synth ? synthCores(synth) : [];
  for (const cr of coreList) {
    if (cr.type === "40") { ringWalls(cr.ring, "concrete", -1, 0); continue; }
    const o = openSide(cr.ring);
    if (cr.type === "32") {
      // (a car per 2.4 m of its open side)
      ringWalls(cr.ring, "wall", -1, 0);
      const cars = Math.max(1, Math.min(4, Math.floor(o.len / 2.4))), a = cr.ring[o.i], q = cr.ring[(o.i + 1) % cr.ring.length];
      for (let k = 0; k < cars; k++) {
        const t = (k + 0.5) / cars, mu = a[0] + (q[0] - a[0]) * t + o.n[0] * 0.12, mv = a[1] + (q[1] - a[1]) * t + o.n[1] * 0.12, [x, z] = toP(mu, mv), [nx, nz] = toP(o.n[0], o.n[1]);
        lifts.push({ x, z, w: Math.min(1.6, o.len / cars - 0.5), yaw: Math.atan2(nx, nz), nx, nz, index: liftN++ });
      }
      sign(o.m[0] + o.n[0] * 0.14, o.m[1] + o.n[1] * 0.14, 2.75, o.n[0], o.n[1], Math.min(2.4, o.len * 0.6), 0.36, "엘리베이터");
      continue;
    }
    ringWalls(cr.ring, "wall", o.i, cr.type === "35" ? 1.1 : 1.6);
    const [ex2, ez2] = toP(o.m[0] + o.n[0] * 1.3, o.m[1] + o.n[1] * 1.3);
    const us = cr.ring.map(q => q[0]), vs = cr.ring.map(q => q[1]), [x0, z0] = toP(Math.min(...us), Math.min(...vs));
    if (cr.type === "34" || cr.type === "33") {
      stairs.push({ x: x0, z: z0, w: Math.max(...us) - Math.min(...us), d: Math.max(...vs) - Math.min(...vs), entry: [ex2, ez2] });
      // (the flight inside: steps rising away from its door)
      for (let i = 0; i < 12; i++) { const d = 0.5 + i * 0.28, mu = o.m[0] - o.n[0] * d, mv = o.m[1] - o.n[1] * d; if (!inRing(mu, mv, cr.ring)) break; seg([mu - o.n[1] * 0.6, mv + o.n[0] * 0.6], [mu + o.n[1] * 0.6, mv - o.n[0] * 0.6], 0.28, 0, (i + 1) * 0.16, "concrete", false); }
      sign(o.m[0] + o.n[0] * 0.14, o.m[1] + o.n[1] * 0.14, 2.75, o.n[0], o.n[1], 1.6, 0.36, cr.type === "33" ? "에스컬레이터" : "계단 · 비상구");
    } else if (cr.type === "35") {
      // (stalls along the far side, basins by the door)
      const ib = innerRect(cr.ring, 0.25);
      if (ib) { const [a0, b0, a1, b1] = ib, wide = a1 - a0 > b1 - b0; for (let s = 0; s < (wide ? a1 - a0 : b1 - b0) - 1; s += 1.3) { if (wide) blk(a0 + s, b1 - 1.5, a0 + s + 0.05, b1, 0.15, 2.0, "white"); else blk(a1 - 1.5, b0 + s, a1, b0 + s + 0.05, 0.15, 2.0, "white"); } }
      sign(o.m[0] + o.n[0] * 0.14, o.m[1] + o.n[1] * 0.14, 2.4, o.n[0], o.n[1], 1.2, 0.36, "화장실");
    }
  }
  for (const [u, v] of colAt) if (at(u, v) !== CORE) { blk(u - 0.45, v - 0.45, u + 0.45, v + 0.45, 0, H, "white"); blk(u - 0.48, v - 0.48, u + 0.48, v + 0.48, 0, 0.12, "dark", false); }
  let benches = 0;
  for (const [u, v] of colAt) {
    if (benches > 60) break;
    let open = true; for (let du = -3.5; du <= 3.5 && open; du += 0.5) for (let dv = -3.5; dv <= 3.5; dv += 0.5) { if (Math.abs(du) < 0.6 && Math.abs(dv) < 0.6) continue; const l = at(u + du, v + dv); if (l !== CORR && l !== HALL && l !== OPEN) { open = false; break; } }
    if (!open) continue;
    benches++;
    // (a bench each side of it, a planter at its foot)
    for (const s of [-1, 1]) { blk(u - 0.9, v + s * 0.6, u + 0.9, v + s * 1.05, 0.38, 0.45, "wood"); blk(u - 0.8, v + s * 0.65, u - 0.7, v + s * 1.0, 0, 0.38, "metal", false); blk(u + 0.7, v + s * 0.65, u + 0.8, v + s * 1.0, 0, 0.38, "metal", false); spot(u - 0.4, v + s * 0.85, 0, s, "stand", 0, -1); }
    blk(u + 0.5, v - 0.3, u + 1.1, v + 0.3, 0, 0.5, "white"); blk(u + 0.55, v - 0.25, u + 1.05, v + 0.25, 0.5, 1.05, "plant", false);
  }

  // the rooms
  let plates = 0;
  for (let ri = 0; ri < rooms.length; ri++) {
    const r = rooms[ri], zk = ZK[r.type];
    const w = r.front < 2 ? r.v1 - r.v0 : r.u1 - r.u0, d = r.front < 2 ? r.u1 - r.u0 : r.v1 - r.v0;
    const P = (s: number, t: number): P2 => r.front === 0 ? [r.u0 + t, r.v0 + s] : r.front === 1 ? [r.u1 - t, r.v1 - s] : r.front === 2 ? [r.u1 - s, r.v0 + t] : [r.u0 + s, r.v1 - t];
    const inward: P2 = r.front === 0 ? [1, 0] : r.front === 1 ? [-1, 0] : r.front === 2 ? [0, 1] : [0, -1];
    const B = (s0: number, t0: number, s1: number, t1: number, y0: number, y1: number, m: Mat, solid = true) => { const a = P(s0, t0), q = P(s1, t1); blk(a[0], a[1], q[0], q[1], y0, y1, m, solid); };
    const SP = (s: number, t: number, fs: number, ft: number, kind: SpotKind, y: number) => { const a = P(s, t), q = P(s + fs, t + ft); spot(a[0], a[1], q[0] - a[0], q[1] - a[1], kind, y, r.zone ?? -1); };
    const label = r.name ?? NAME[r.type] ?? "";
    r.zone = zoneOf(zk, label, r.u0, r.v0, r.u1, r.v1, r.ring?.map(q => toP(...q)));
    const shopLike = r.glass || ["shop", "cafe", "food", "pharmacy", "bank", "mart", "salon", "vacant"].includes(r.type);
    const doorW = shopLike ? Math.min(2.4, w * 0.4) : r.type === "xray" || r.type.startsWith("ward") ? 1.4 : 1.0;
    const ds = shopLike ? (w - doorW) / 2 : 0.35;
    // walls: front (glass for shops), sides, back; the door's opening and its leaf
    if (r.walls) {
      const wl = (a: P2, q: P2, m: Mat, y0 = 0, y1 = H, t = 0.12) => seg(a, q, t, y0, y1, m);
      if (shopLike) { wl(P(0, 0), P(ds, 0), "glass", 0, 2.7, 0.06); wl(P(ds + doorW, 0), P(w, 0), "glass", 0, 2.7, 0.06); wl(P(0, 0), P(w, 0), "wall", 2.7, H); }
      else {
        wl(P(0, 0), P(ds, 0), "wall"); wl(P(ds + doorW, 0), P(w, 0), "wall"); wl(P(ds, 0), P(ds + doorW, 0), "wall", 2.3, H);
        // (the sliding leaf, half open; its frame; outside, the wood dado and the accent band)
        seg(P(ds + doorW * 0.55, 0.1), P(Math.min(w - 0.05, ds + doorW * 1.55), 0.1), 0.04, 0, 2.28, "wood", false);
        for (const s of [ds, ds + doorW]) seg(P(s - 0.04, 0), P(s + 0.04, 0), 0.2, 0, 2.34, "metal", false);
        seg(P(ds - 0.04, 0), P(ds + doorW + 0.04, 0), 0.2, 2.3, 2.38, "metal", false);
        if (prof === "outpatient" || prof === "ward" || prof === "office" || prof === "civic") for (const [a, q] of [[0, ds - 0.05], [ds + doorW + 0.05, w]] as P2[]) if (q - a > 0.2) { seg(P(a, -0.075), P(q, -0.075), 0.03, 0, 1.0, "wainscot", false); seg(P(a, -0.08), P(q, -0.08), 0.03, 1.0, 1.1, "accent", false); }
      }
      // (a venue spread over neighbouring units — an aquarium, a hall, a food court — is one room:
      // no wall between units of it)
      const same = (p: P2) => { const k = (jv(p[1]) * nu + iu(p[0])), o = owner[k]; return o >= 0 && o !== ri && rooms[o].type === r.type && VENUE.has(r.type); };
      // (a shop's side on a walk is a shop window too)
      const walkAt = (p: P2) => { const l = at(...p); return l === CORR || l === HALL; };
      const side = (a: P2, q: P2, out: P2) => { if (same(out)) return; if (shopLike && walkAt(out)) { wl(a, q, "glass", 0, 2.7, 0.06); wl(a, q, "wall", 2.7, H); } else wl(a, q, "wall"); };
      side(P(0, 0), P(0, d), P(-0.35, d / 2)); side(P(w, 0), P(w, d), P(w + 0.35, d / 2)); if (!same(P(w / 2, d + 0.35))) wl(P(0, d), P(w, d), "wall");
    } else if (r.ring) {
      // (a charted unit: its own outline, glass on the side toward the floor)
      const ring = r.ring;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - a[0], q[1] - a[1]); if (len < 0.05) continue;
        const m: P2 = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2], n: P2 = [(q[1] - a[1]) / len, -(q[0] - a[0]) / len];
        const outside = [at(m[0] + n[0] * 0.6, m[1] + n[1] * 0.6), at(m[0] - n[0] * 0.6, m[1] - n[1] * 0.6)];
        const open = outside.includes(CORR) || outside.includes(HALL);
        const fm: Mat = r.glass ? "glass" : "wall", ft = r.glass ? 0.06 : 0.12;
        if (open && len > 3) { const g = (r.glass ? 1.0 : 0.55) / len; seg(a, [a[0] + (q[0] - a[0]) * (0.5 - g), a[1] + (q[1] - a[1]) * (0.5 - g)], ft, 0, 2.7, fm); seg([a[0] + (q[0] - a[0]) * (0.5 + g), a[1] + (q[1] - a[1]) * (0.5 + g)], q, ft, 0, 2.7, fm); seg(a, q, 0.12, 2.7, H, "wall"); }
        else seg(a, q, ft, 0, H, open ? fm : "wall");
      }
    }
    // its name over the door (a business's sign; a clinic's plate) and a lit panel by the door
    const [su, sv] = P(shopLike ? w / 2 : Math.min(w - 0.3, ds + doorW + 0.45), -0.08);
    if (shopLike && label) sign(su, sv, 2.95, -inward[0], -inward[1], Math.min(w - 0.4, Math.max(1.6, label.length * 0.32 + 0.6)), 0.5, label);
    else if (label && plates < 140 && (r.type !== "store" && r.type !== "plant" && r.type !== "stall")) { plates++; sign(su, sv, 1.95, -inward[0], -inward[1], 0.62, 0.22, label.replace(/^\S+ (\d+진료실)$/, "$1")); B(ds + doorW + 0.2, -0.06, ds + doorW + 0.6, -0.02, 1.35, 1.65, "screen", false); }
    furnish(r.type, w, d, B, SP, rnd);
    if (r.walls && label && !shopLike && r.type !== "store" && r.type !== "plant") { const dp = toP(...P(ds + doorW / 2, -0.9)); points.push({ x: dp[0], z: dp[1], kind: "room", label }); }
  }

  // the hall: the 원무과 (a hospital), a reception (others), seats, the information desk, plants
  if (ground && eL && hallZone >= 0) {
    const pin = (dd: number, x: number) => UV(ea + sg * dd, ex + x);
    const fwd = dirTo(sg), back = dirTo(-sg);
    const box = (d0: number, x0: number, d1: number, x1: number, y0: number, y1: number, m: Mat, solid = true) => { const a = pin(d0, x0), q = pin(d1, x1); blk(a[0], a[1], q[0], q[1], y0, y1, m, solid); };
    if (prof === "outpatient") {
      const cz = hallD - 3.2, gap = L.spine / 2 + 0.6, windows: [number, number, number][] = [];
      let n = 0;
      for (const side of [-1, 1]) for (let x = gap + 0.9; x + 0.9 < hallW / 2 - 1; x += 1.8) {
        const xw = side * x;
        if (at(...pin(cz + 1, xw)) !== HALL) continue;
        n++;
        box(cz, xw - 0.9, cz + 0.35, xw + 0.9, 0, 1.08, "counter"); box(cz + 0.35, xw - 0.9, cz + 1.0, xw + 0.9, 0, 0.74, "desk");
        box(cz - 0.05, xw + 0.86, cz + 1.0, xw + 0.92, 1.08, 1.7, "glass", false); box(cz + 0.5, xw - 0.25, cz + 0.55, xw + 0.25, 0.74, 1.12, "screen", false);
        const c1 = pin(cz + 1.4, xw), c2 = pin(cz - 0.5, xw); spot(c1[0], c1[1], back[0], back[1], "clerk", 0.46, hallZone); spot(c2[0], c2[1], fwd[0], fwd[1], "wait", 0, hallZone);
        const s = pin(cz - 0.06, xw); sign(s[0], s[1], 2.0, back[0], back[1], 0.7, 0.38, `${n}번`);
        const wp = toP(...pin(cz - 0.9, xw)); windows.push([wp[0], wp[1], n]);
      }
      for (const side of [-1, 1]) { box(cz + 2.2, side * gap, cz + 2.4, side * (hallW / 2 - 1), 0, H, "wall"); const s = pin(cz + 2.15, side * (gap + hallW / 4)); sign(s[0], s[1], 3.25, back[0], back[1], Math.min(12, hallW / 4), 0.95, "원무과  접수 · 수납"); const t = pin(cz + 2.15, side * (gap + hallW / 8)); decor.push({ kind: "tv", x: toP(...t)[0], z: toP(...t)[1], y: 3.25, yaw: yawOf(back[0], back[1]), w: 1.8, h: 1.0 }); }
      // seats: rows across the hall facing the counter, the spine kept open, an aisle every ten
      for (let dd = 7.5; dd < cz - 2.4; dd += 1.9) for (const side of [-1, 1]) for (let x = gap + 0.6, k = 0; x + 0.6 < hallW / 2 - 1.2; x += 0.62, k++) {
        if (k % 10 === 9) continue; const p = pin(dd, side * x); if (at(...p) !== HALL) continue;
        box(dd - 0.12, side * x - 0.31, dd + 0.12, side * x + 0.31, 0.3, 0.36, "metal", false); spot(p[0], p[1], fwd[0], fwd[1], "seat", 0.45, hallZone);
      }
      // (the information desk and the ticket machines by the door; wheelchairs by the wall)
      box(5.0, gap + 0.5, 6.0, gap + 3.5, 0, 1.05, "counter"); { const p = pin(6.6, gap + 2); spot(p[0], p[1], back[0], back[1], "clerk", 0.46, hallZone); const s = pin(4.9, gap + 2); sign(s[0], s[1], 2.4, back[0], back[1], 1.4, 0.4, "안내"); }
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
        box(cz - 1.4, side * (gap + 1 + k * 1.1), cz - 1.0, side * (gap + 1.5 + k * 1.1), 0, 1.45, "white"); box(cz - 1.42, side * (gap + 1.05 + k * 1.1), cz - 1.4, side * (gap + 1.45 + k * 1.1), 0.95, 1.4, "screen", false);
        const kp = toP(...pin(cz - 2.0, side * (gap + 1.25 + k * 1.1))); points.push({ x: kp[0], z: kp[1], kind: "ticket", label: "번호표", windows });
      }
      { const s = pin(cz - 1.45, gap + 2.3); sign(s[0], s[1], 1.75, back[0], back[1], 1.6, 0.3, "번호표 발급"); const s2 = pin(cz - 1.45, -(gap + 2.3)); sign(s2[0], s2[1], 1.75, back[0], back[1], 1.6, 0.3, "번호표 발급"); }
      for (let k = 0; k < 6; k++) box(4.2, -(gap + 1 + k * 0.75), 5.0, -(gap + 1.6 + k * 0.75), 0, 0.9, "metal", false);
    } else {
      // (a reception counter facing the door; a lounge to its side; speed gates on the spine)
      box(hallD * 0.45, -4, hallD * 0.45 + 0.8, 4, 0, 1.05, "counter"); for (const x of [-2, 2]) { const p = pin(hallD * 0.45 + 1.4, x); spot(p[0], p[1], back[0], back[1], "clerk", 0.46, hallZone); }
      { const s = pin(hallD * 0.45 - 0.05, 0); sign(s[0], s[1], 1.25, back[0], back[1], 2.2, 0.3, prof === "hotel" ? "FRONT DESK" : "안내"); }
      if (prof === "office") for (let x = -L.spine / 2 + 0.3; x < L.spine / 2; x += 0.9) box(hallD - 1, x, hallD - 0.2, x + 0.18, 0, 1.0, "metal");
      for (const side of [-1, 1]) for (let k = 0; k < 2; k++) { const x = side * (hallW / 2 - 3), dd = 4 + k * 3; box(dd, x - 1.2, dd + 0.9, x + 1.2, 0, 0.42, "fabric"); const p = pin(dd + 0.45, x); spot(p[0], p[1], fwd[0], fwd[1], "seat", 0.42, hallZone); }
    }
    for (const side of [-1, 1]) { box(1.0, side * (hallW / 2 - 1.6), 1.8, side * (hallW / 2 - 0.8), 0, 0.5, "dark"); box(1.1, side * (hallW / 2 - 1.5), 1.7, side * (hallW / 2 - 0.9), 0.5, 1.6, "plant", false); }
    const dir = pin(hallD - 0.6, 0); decor.push({ kind: "directory", x: toP(...dir)[0], z: toP(...dir)[1], y: 1.7, yaw: yawOf(back[0], back[1]), w: 1.4, h: 2.0 });
  }
  // the corridors: a hospital department's reception and its waiting rows down the middle; a sign
  // over each corridor's mouth; the spine's coloured guide lines; benches by the open windows
  if (!measured) {
    const segFirst = new Map<string, Room>();
    for (const r of rooms) if (r.name && /진료실|처치실|검사실|촬영실|채혈실/.test(r.name)) { const d = r.name.split(" ")[0]; if (!segFirst.has(d) || near(r) < near(segFirst.get(d)!)) segFirst.set(d, r); }
    if (prof === "outpatient") for (const [d, r] of segFirst) {
      // (the corridor this room fronts: its axis along the front; the reception at the spine end)
      const fs = frontStrip(r, L.corr - 0.2), cuu = (fs[0] + fs[2]) / 2, cvv = (fs[1] + fs[3]) / 2;
      const alongCorr = r.front < 2 ? 1 : 0;
      const towardSpine = Math.sign(ex - X(cuu, cvv)) || 1;
      const xs = X(cuu, cvv), aa = A(cuu, cvv);
      const pAt = (dx: number, da: number) => UV(aa + da, xs + dx);
      void alongCorr;
      // reception desk: across the corridor's mouth, a nurse behind
      const r0 = pAt(towardSpine * 0.8, -1.1), r1 = pAt(towardSpine * 1.6, 1.1); blk(Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.max(r0[0], r1[0]), Math.max(r0[1], r1[1]), 0, 1.05, "counter");
      const nz = pAt(-towardSpine * 0.2, 0); const fdir = dirAX(towardSpine); spot(nz[0], nz[1], fdir[0], fdir[1], "counter", 0, -1);
      const sg2 = pAt(towardSpine * 1.2, 0); sign(sg2[0], sg2[1], 2.9, fdir[0], fdir[1], 2.6, 0.55, d);
      // the waiting rows: two lines back to back down the corridor's middle, facing the doors
      for (let k = 0, x = 3.5; x < 60; x += 0.62, k++) {
        if (k % 9 === 8) { const p = pAt(-towardSpine * x, 0); if (at(...p) === CORR) blk(p[0] - 0.28, p[1] - 0.22, p[0] + 0.28, p[1] + 0.22, 0, 0.5, "wood"); continue; }
        for (const side of [-1, 1]) {
          const p = pAt(-towardSpine * x, side * 0.35); if (at(...p) !== CORR) { x = 99; break; }
          const toward = dirAX2(side); spot(p[0], p[1], toward[0], toward[1], "seat", 0.45, -1);
          const b0 = pAt(-towardSpine * (x - 0.31), side * 0.35), b1 = pAt(-towardSpine * (x + 0.31), side * 0.35); seg(b0, b1, 0.24, 0.3, 0.36, "metal", false);
        }
      }
    }
    function dirAX(s: number): P2 { return axis === 0 ? [0, s] : [s, 0]; }
    function dirAX2(s: number): P2 { return axis === 0 ? [s, 0] : [0, s]; }
    // the spine's guide lines (green, orange, blue)
    if (prof === "outpatient") [-0.5, 0, 0.5].forEach((x, i) => { const a = UV(ea + sg * (hallD + 1), ex + x), q = UV(sg > 0 ? aMax : aMin, ex + x); void i; seg(a, q, 0.12, 0, 0.008, "line", false); });
  }
  // open floors: desk pods (offices), counters (civic), set out in rows with aisles
  for (const [u0, v0, u1, v1] of openRects) {
    const zi = zoneOf(prof === "civic" ? "civic" : "office", prof === "civic" ? "민원실" : "사무실", u0, v0, u1, v1);
    for (let u = u0 + 1.4; u + 3.2 < u1 - 0.8; u += 3.6) for (let v = v0 + 1.4; v + 1.6 < v1 - 0.8; v += 3.2) {
      if (!rectIs(u, v - 0.6, u + 3.2, v + 2.2, [OPEN])) continue;
      blk(u, v, u + 3.2, v + 1.6, 0, 0.74, "desk"); blk(u, v + 0.78, u + 3.2, v + 0.82, 0.74, 1.15, "white", false);
      for (const [du, dv, fv] of [[0.8, -0.45, 1], [2.4, -0.45, 1], [0.8, 2.05, -1], [2.4, 2.05, -1]] as [number, number, number][]) { spot(u + du, v + dv, 0, fv, "desk", 0.46, zi); blk(u + du - 0.25, v + dv + fv * 0.85 - 0.02, u + du + 0.25, v + dv + fv * 0.85 + 0.02, 0.76, 1.08, "screen", false); }
    }
  }

  // ---- 8. walking: a grid in the plan's frame — walkable cells off the walls and the furniture
  const W = Math.max(b.W, ...polys.flatMap(p => p[0].map(q => q[0] + 1))), D = Math.max(b.D, ...polys.flatMap(p => p[0].map(q => q[1] + 1)));
  b.W = W; b.D = D;
  const cell = Math.max(0.5, Math.sqrt(W * D / 180000)), gx = Math.ceil(W / cell), gz = Math.ceil(D / cell), free = new Uint8Array(gx * gz);
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) { const l = at(...toL([(i + 0.5) * cell, (j + 0.5) * cell])); if (l === FREE || l === CORR || l === HALL || l === ROOM || l === OPEN) free[j * gx + i] = 1; }
  const mark = (x: number, z: number, r: number) => { for (let j = Math.max(0, Math.floor((z - r) / cell)); j <= Math.min(gz - 1, Math.floor((z + r) / cell)); j++) for (let i = Math.max(0, Math.floor((x - r) / cell)); i <= Math.min(gx - 1, Math.floor((x + r) / cell)); i++) free[j * gx + i] = 0; };
  for (const s of segs) { if (!s.solid || s.y0 > 1.4 || s.y1 < 0.3) continue; const n = Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / 0.25); for (let i = 0; i <= n; i++) mark(s.ax + (s.bx - s.ax) * i / n, s.az + (s.bz - s.az) * i / n, s.t / 2 + 0.22); }
  for (const l of lifts) mark(l.x, l.z, 0.3);
  // (doorways: the cells across each opening are kept open, so the crowd can come and go)
  const spawnL: P2 | null = eL ? UV(ea + sg * 5, ex + 0) : null;
  const spawn = spawnL ? toP(...spawnL) : null;
  let crowdArea = 0; for (let k = 0; k < free.length; k++) crowdArea += free[k];
  crowdArea *= cell * cell;
  const kinds: ZoneKind[] = [...new Set(zones.map(z => z.kind))];
  if (!kinds.length) kinds.push("office");
  const label = b.regFloors.find(f => f.level === level)?.label ?? (level < 0 ? `지하 ${-level}층` : `${level}층`);
  const doorP = ground && eL ? toP(...UV(ea + sg * 1.2, ex)) : null;
  return {
    level, label, height: H, kinds: prof === "outpatient" || prof === "ward" ? ["clinic", ...kinds.filter(k => k !== "clinic")] : kinds, zones, boxes: [], spots, lifts, stairs, escalators: [], decor, segs,
    grid: { nx: gx, nz: gz, cell, free }, points, door: doorP ? { x: doorP[0], z: doorP[1], w: 3.6 } : null,
    crowd: Math.round(Math.min(prof === "ward" ? 160 : prof === "parking" ? 40 : 340, Math.max(12, crowdArea / (prof === "outpatient" ? 26 : prof === "parking" ? 150 : 40)))),
    polygons: polys, spawn: spawn ?? undefined,
    survey: { year: inp.year ?? 2019, partitions: measured, facilities: coreRings.length > 0 },
    basis: [measured ? "이 층 SGIS 구획·업체 실측" : "외곽선 실측", coreRings.length ? (src.coresFrom === level ? "코어 실측" : `코어: ${src.coresFrom != null ? (src.coresFrom < 0 ? `B${-src.coresFrom}` : `${src.coresFrom}F`) : ""} 실측 위치`) : "코어 추정", measured ? "가구 재구성" : `실 배치 추정(${profileName(prof)})`].join(" · "),
  };

  function synthCores(s: NonNullable<typeof synth>): { type: string; ring: P2[] }[] {
    const out: { type: string; ring: P2[] }[] = [], r = (u0: number, v0: number, u1: number, v1: number): P2[] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const half = Math.ceil(s.n / 2);
    if (s.alongU) {
      let u = s.u0; out.push({ type: "34", ring: r(u, s.v0, u + 3.4, s.v1) }); u += 3.4;
      for (let k = 0; k < half; k++, u += 2.6) { out.push({ type: "32", ring: r(u, s.v0, u + 2.6, s.v0 + 2.6) }); out.push({ type: "32", ring: r(u, s.v1 - 2.6, u + 2.6, s.v1) }); }
      out.push({ type: "40", ring: r(s.u0 + 3.4, s.v0 + 2.6, u, s.v1 - 2.6) });
      out.push({ type: "35", ring: r(u, s.v0, u + 6, (s.v0 + s.v1) / 2) }); out.push({ type: "35", ring: r(u, (s.v0 + s.v1) / 2, u + 6, s.v1) }); u += 6;
      out.push({ type: "34", ring: r(u, s.v0, s.u1, s.v1) });
    } else {
      let v = s.v0; out.push({ type: "34", ring: r(s.u0, v, s.u1, v + 3.4) }); v += 3.4;
      for (let k = 0; k < half; k++, v += 2.6) { out.push({ type: "32", ring: r(s.u0, v, s.u0 + 2.6, v + 2.6) }); out.push({ type: "32", ring: r(s.u1 - 2.6, v, s.u1, v + 2.6) }); }
      out.push({ type: "40", ring: r(s.u0 + 2.6, s.v0 + 3.4, s.u1 - 2.6, v) });
      out.push({ type: "35", ring: r(s.u0, v, (s.u0 + s.u1) / 2, v + 6) }); out.push({ type: "35", ring: r((s.u0 + s.u1) / 2, v, s.u1, v + 6) }); v += 6;
      out.push({ type: "34", ring: r(s.u0, v, s.u1, s.v1) });
    }
    return out;
  }
}

function profileName(p: Profile) { return ({ house: "주거", parking: "주차장", outpatient: "외래 진료층", ward: "병동", office: "업무시설", retail: "판매·근린", food: "음식점", class: "교육시설", hotel: "숙박시설", civic: "공공시설" } as Record<Profile, string>)[p]; }
function distSeg(p: P2, a: P2, q: P2) { const dx = q[0] - a[0], dz = q[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)); return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]); }
function pickSupport(p: Profile, rnd: () => number): RT {
  if (p === "parking") return "stall";
  if (p === "house") return "store";
  const list: RT[] = p === "outpatient" ? ["office", "office", "office", "office", "counsel", "treat", "store", "staff"] : p === "ward" ? ["treat", "store", "staff", "lounge"] : p === "office" ? ["meeting", "store", "pantry"] : p === "class" ? ["class", "staff", "store"] : p === "hotel" ? ["guest", "store"] : ["shop", "store", "vacant"];
  return list[Math.floor(rnd() * list.length)];
}
function typeOfCategory(t: string, name: string): RT {
  const s = `${t} ${name}`;
  if (/카페|커피|제과|베이커리|cafe/i.test(s)) return "cafe";
  if (/음식|식당|푸드|주점|food/i.test(s)) return "food";
  if (/편의점|마트|슈퍼|mart/i.test(s)) return "mart";
  if (/약국|의약|pharmacy/i.test(s)) return "pharmacy";
  if (/은행|금융|bank/i.test(s)) return "bank";
  if (/미용|헤어|네일|salon/i.test(s)) return "salon";
  if (/의원|병원|의료|clinic/i.test(s) && !/의료기/.test(s)) return "consult";
  if (/학원|교육|academy/i.test(s)) return "class";
  if (/기업|연구|사무|부동산|agent/i.test(s)) return "office";
  return "shop";
}
/** the largest axis-aligned rectangle inside a ring (on a raster of `step`) */
function innerRect(ring: P2[], step: number): [number, number, number, number] | null {
  const us = ring.map(q => q[0]), vs = ring.map(q => q[1]), u0 = Math.min(...us), v0 = Math.min(...vs);
  const nu = Math.ceil((Math.max(...us) - u0) / step), nv = Math.ceil((Math.max(...vs) - v0) / step);
  if (nu < 2 || nv < 2 || nu * nv > 250000) return null;
  const h = new Int32Array(nu); let best = { a: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) h[i] = inRing(u0 + (i + 0.5) * step, v0 + (j + 0.5) * step, ring) ? h[i] + 1 : 0;
    const st: number[] = [];
    for (let i = 0; i <= nu; i++) { const hi = i < nu ? h[i] : 0; while (st.length && h[st[st.length - 1]] >= hi) { const top = st.pop()!, left = st.length ? st[st.length - 1] + 1 : 0, a = (i - left) * h[top]; if (a > best.a) best = { a, i0: left, i1: i - 1, j0: j - h[top] + 1, j1: j }; } st.push(i); }
  }
  return best.a ? [u0 + best.i0 * step + 0.1, v0 + best.j0 * step + 0.1, u0 + (best.i1 + 1) * step - 0.1, v0 + (best.j1 + 1) * step - 0.1] : null;
}
export { inPolyH };

type BFn = (s0: number, t0: number, s1: number, t1: number, y0: number, y1: number, m: Mat, solid?: boolean) => void;
type SFn = (s: number, t: number, fs: number, ft: number, kind: SpotKind, y: number) => void;
/** a room's fittings, in its own frame: s across its front (0…w), t in from its front (0…d) */
function furnish(type: RT, w: number, d: number, B: BFn, SP: SFn, rnd: () => number) {
  const bed = (s: number, t: number, along: boolean) => { if (along) { B(s, t, s + 0.95, t + 2.0, 0, 0.5, "metal"); B(s + 0.05, t + 0.05, s + 0.9, t + 1.95, 0.5, 0.62, "sheet", false); B(s, t + 1.92, s + 0.95, t + 2.0, 0.5, 1.0, "metal", false); SP(s + 0.47, t + 1.0, 0, -1, "bed", 0.62); } };
  switch (type) {
    case "unit": {
      // (a one-room home: the bed at the back, a wardrobe; a sofa facing the TV; the kitchen by the door)
      B(0.15, d - 2.15, Math.min(1.75, w - 0.4), d - 0.1, 0, 0.5, "bed"); B(0.2, d - 2.1, Math.min(1.7, w - 0.45), d - 0.15, 0.5, 0.6, "sheet", false); SP(0.9, d - 1.1, 0, -1, "bed", 0.62);
      B(w - 0.65, d - 1.8, w - 0.05, d - 0.1, 0, 2.1, "wood");
      if (d > 4.5) { B(w - 1.9, d / 2 - 0.45, w - 0.2, d / 2 + 0.45, 0, 0.42, "fabric"); SP(w - 1.05, d / 2, -1, 0, "seat", 0.42); B(0.15, d / 2 - 0.7, 0.3, d / 2 + 0.7, 0.6, 1.4, "screen", false); B(0.1, d / 2 - 0.8, 0.45, d / 2 + 0.8, 0, 0.5, "wood"); }
      B(0.1, 0.3, 0.7, Math.min(2.6, d * 0.4), 0, 0.9, "counter"); B(0.1, 0.3, 0.45, Math.min(2.6, d * 0.4), 1.5, 2.2, "white");
      if (w > 3.4) { B(w / 2 - 0.4, 0.9, w / 2 + 0.4, 1.6, 0, 0.74, "wood"); SP(w / 2, 0.55, 0, 1, "table", 0.46); }
      break;
    }
    case "cinema": {
      // (raked rows facing the screen on the far wall; the aisle down one side)
      B(0.3, d - 0.12, w - 0.3, d - 0.06, 0.9, 3.0, "screen", false);
      for (let t = 1.0, row = 0; t + 0.9 < d - 2.2; t += 1.05, row++) {
        const y = 0.16 * row; if (row) B(0, t - 0.35, w, t + 0.7, 0, y, "carpet");
        for (let s = 1.3; s + 0.55 < w - 0.2; s += 0.62) SP(s, t, 0, 1, "seat", 0.45 + y);
      }
      break;
    }
    case "aquarium": {
      // (a tank along the far wall, lit; a low rail before it)
      B(0.2, Math.max(1.6, d * 0.45), w - 0.2, d - 0.15, 0, 2.6, "water"); B(0.2, Math.max(1.6, d * 0.45) - 0.08, w - 0.2, Math.max(1.6, d * 0.45), 0, 2.6, "glass", false);
      B(0.4, Math.max(1.6, d * 0.45) - 0.9, w - 0.4, Math.max(1.6, d * 0.45) - 0.84, 0.9, 1.0, "metal", false);
      for (let s = 0.8; s < w - 0.5; s += 1.6) SP(s, Math.max(1.6, d * 0.45) - 1.4, 0, 1, "stand", 0);
      break;
    }
    case "exhibit": {
      for (let s = 0.9; s + 1 < w; s += 2.2) for (let t = 1.4; t + 1 < d; t += 2.6) { B(s, t, s + 0.9, t + 0.9, 0, 0.9, "white"); B(s + 0.05, t + 0.05, s + 0.85, t + 0.85, 0.9, 1.6, "glass", false); SP(s + 0.45, t - 0.6, 0, 1, "stand", 0); }
      B(0.2, d - 0.1, w - 0.2, d - 0.05, 1.0, 2.4, "screen", false);
      break;
    }
    case "stall": {
      B(-0.04, 0.2, 0.04, d, 0, 0.008, "line", false); B(w - 0.04, 0.2, w + 0.04, d, 0, 0.008, "line", false);
      if (rnd() < 0.72) { B(0.35, 0.45, w - 0.35, d - 0.3, 0.12, 0.95, "car"); B(0.45, 1.6, w - 0.45, d - 1.3, 0.95, 1.45, "glass"); B(0.45, 1.6, w - 0.45, d - 1.3, 1.42, 1.48, "car", false); }
      break;
    }
    case "consult": {
      // the doctor's desk along the side wall, two screens, the doctor and the patient's stool;
      // the examination couch along the back, its curtain; a basin by the door
      const t0 = Math.min(d - 2.4, 1.6);
      B(w - 0.75, t0, w - 0.05, t0 + 1.5, 0, 0.74, "desk"); B(w - 0.35, t0 + 0.2, w - 0.31, t0 + 0.7, 0.76, 1.12, "screen", false); B(w - 0.35, t0 + 0.8, w - 0.31, t0 + 1.3, 0.76, 1.12, "screen", false);
      SP(w - 1.2, t0 + 0.75, 1, 0, "desk", 0.46); SP(w - 1.5, t0 + 1.8, 0.5, -1, "seat", 0.45);
      if (d > 4) { B(0.15, d - 0.8, Math.min(2.1, w - 0.8), d - 0.1, 0, 0.62, "sheet"); SP(0.9, d - 0.45, 1, 0, "exam", 0.62); B(0.1, d - 1.05, Math.min(2.3, w - 0.6), d - 1.02, 0.3, 2.1, "sheet", false); }
      B(0.1, 0.4, 0.6, 1.1, 0, 0.9, "white"); B(0.12, 1.2, 0.45, 2.4, 0, 1.9, "shelf");
      break;
    }
    case "treat": case "ward2": case "ward6": {
      const n = type === "ward6" ? 3 : type === "ward2" ? 1 : Math.max(1, Math.floor((w - 0.4) / 1.6));
      for (let k = 0; k < n; k++) bed(0.3 + k * (w - 0.6) / n + ((w - 0.6) / n - 0.95) / 2, d - 2.15, true);
      if (type === "ward6" && d > 5.5) for (let k = 0; k < 3; k++) bed(0.3 + k * (w - 0.6) / 3 + ((w - 0.6) / 3 - 0.95) / 2, 0.9, true);
      if (type.startsWith("ward")) { B(w - 0.6, d - 0.7, w - 0.1, d - 0.1, 0, 0.8, "wood"); SP(w - 0.9, d - 1.4, -1, 0, "seat", 0.45); B(w - 1.6, 0.15, w - 0.15, 0.75, 0, 2.1, "wood"); }
      else SP(w / 2, 1.0, 0, 1, "counter", 0);
      break;
    }
    case "exam": case "xray": {
      if (type === "xray") { B(w * 0.25, d * 0.45, w * 0.25 + 0.8, d * 0.45 + 2.2, 0, 0.8, "white"); B(w * 0.25 + 1.2, d * 0.45 + 0.8, w * 0.25 + 1.5, d * 0.45 + 1.1, 0, 2.4, "metal"); B(0.2, d - 0.5, 1.1, d - 0.2, 0.4, 2.0, "white"); B(w - 2.2, 0.2, w - 0.1, 0.25, 0, 2.2, "glass", false); B(w - 2.0, 0.4, w - 0.4, 1.0, 0, 0.74, "desk"); SP(w - 1.2, 1.4, 0, -1, "desk", 0.46); SP(w * 0.25 + 0.4, d * 0.45 + 1.1, 1, 0, "bed", 0.82); }
      else { B(0.2, d - 1.0, 1.4, d - 0.2, 0, 1.4, "white"); B(w - 2.1, d - 0.8, w - 0.2, d - 0.1, 0, 0.62, "sheet"); B(w - 0.8, 0.4, w - 0.1, 1.9, 0, 0.74, "desk"); SP(w - 1.2, 1.1, 1, 0, "desk", 0.46); SP(w - 1.1, d - 0.45, -1, 0, "exam", 0.62); }
      break;
    }
    case "blood": {
      for (let s = 0.5; s + 1.2 < w; s += 1.6) { B(s, 1.4, s + 1.2, 1.9, 0, 0.8, "counter"); SP(s + 0.6, 2.4, 0, -1, "clerk", 0.46); SP(s + 0.6, 0.9, 0, 1, "seat", 0.45); B(s + 1.18, 1.4, s + 1.22, 2.8, 0.8, 1.8, "glass", false); }
      B(0.2, d - 0.7, w - 0.2, d - 0.1, 0, 1.9, "shelf");
      break;
    }
    case "counsel": case "meeting": {
      const tw = Math.min(w - 1.6, 2.4), tl = Math.min(d - 1.8, type === "meeting" ? 4 : 1.6);
      if (tw > 0.6 && tl > 0.6) { const s0 = (w - tw) / 2, t0 = (d - tl) / 2; B(s0, t0, s0 + tw, t0 + tl, 0, 0.74, "wood"); for (let t = t0 + 0.4; t < t0 + tl; t += 0.9) { SP(s0 - 0.4, t, 1, 0, "table", 0.46); SP(s0 + tw + 0.4, t, -1, 0, "table", 0.46); } }
      if (type === "meeting") B(0.5, d - 0.08, w - 0.5, d - 0.04, 1.0, 2.1, "screen", false);
      break;
    }
    case "pantry": case "staff": case "lounge": {
      B(0.1, d - 0.65, w - 0.1, d - 0.05, 0, 0.9, "counter"); B(0.1, d - 0.4, 0.8, d - 0.05, 0, 1.9, "white");
      if (d > 3) { B(w / 2 - 1.2, d / 2 - 0.45, w / 2 + 1.2, d / 2 + 0.45, 0, 0.42, "fabric"); SP(w / 2, d / 2 - 0.9, 0, 1, "seat", 0.42); }
      break;
    }
    case "store": case "plant": {
      for (let t = 0.6; t + 0.5 < d - 0.3; t += 1.5) B(0.3, t, w - 0.3, t + 0.5, 0, type === "plant" ? 1.6 : 2.1, type === "plant" ? "metal" : "shelf");
      break;
    }
    case "office": {
      for (let t = 1.2; t + 1.6 < d - 0.4; t += 3.0) for (let s = 0.5; s + 1.4 < w - 0.3; s += 1.6) { B(s, t, s + 1.4, t + 0.7, 0, 0.74, "desk"); B(s + 0.45, t + 0.15, s + 0.95, t + 0.18, 0.76, 1.08, "screen", false); SP(s + 0.7, t + 1.15, 0, -1, "desk", 0.46); }
      break;
    }
    case "class": {
      B(0.6, d - 0.12, w - 0.6, d - 0.08, 0.9, 2.2, "dark", false); SP(w / 2, d - 1.0, 0, -1, "stand", 0);
      for (let t = 1.2; t + 0.6 < d - 2.0; t += 1.2) for (let s = 0.8; s + 1.1 < w - 0.6; s += 1.5) { B(s, t + 0.4, s + 1.1, t + 0.9, 0, 0.72, "desk"); SP(s + 0.55, t, 0, 1, "class", 0.45); }
      break;
    }
    case "guest": {
      B(0.2, d - 2.2, Math.min(1.8, w - 0.6), d - 0.1, 0, 0.55, "bed"); B(0.25, d - 2.1, Math.min(1.75, w - 0.65), d - 0.15, 0.55, 0.65, "sheet", false); SP(0.9, d - 1.1, 0, -1, "bed", 0.66);
      B(w - 0.55, 1.6, w - 0.05, 3.0, 0, 0.75, "wood"); B(0.1, 0.2, 1.6, 1.9, 0, 2.4, "tile");
      break;
    }
    case "cafe": case "food": {
      B(0.4, d - 1.4, w - 0.4, d - 0.8, 0, 1.05, "counter"); SP(w / 2, d - 0.4, 0, -1, "counter", 0); B(0.4, d - 0.35, w - 0.4, d - 0.05, 0, 2.0, "shelf");
      for (let s = 0.9; s + 0.9 < w - 0.4; s += 2.1) for (let t = 1.0; t + 0.8 < d - 2.0; t += 2.0) { B(s, t, s + 0.8, t + 0.8, 0, 0.74, "wood"); SP(s + 0.4, t - 0.35, 0, 1, "table", 0.46); SP(s + 0.4, t + 1.15, 0, -1, "table", 0.46); }
      break;
    }
    case "mart": case "shop": case "pharmacy": case "salon": case "bank": case "vacant": {
      if (type === "vacant") { B(0.3, 0.05, w - 0.3, 0.07, 1.0, 1.6, "white", false); break; }
      if (type === "pharmacy" || type === "bank") {
        B(0.3, d * 0.5, w - 0.3, d * 0.5 + 0.6, 0, 1.08, "counter"); for (let s = 0.9; s < w - 0.6; s += 1.8) { SP(s, d * 0.5 + 1.0, 0, -1, "clerk", 0.46); SP(s, d * 0.5 - 0.6, 0, 1, "wait", 0); }
        B(0.2, d - 0.5, w - 0.2, d - 0.1, 0, 2.1, "shelf"); if (type === "bank") B(0.2, 0.4, 0.9, 1.0, 0, 1.6, "metal");
        break;
      }
      if (type === "salon") { for (let s = 0.6; s + 0.8 < w; s += 1.4) { B(s, d - 0.3, s + 0.9, d - 0.25, 0.8, 1.9, "glass", false); SP(s + 0.45, d - 1.0, 0, 1, "seat", 0.5); } break; }
      B(0.3, 0.6, 1.6, 1.2, 0, 0.95, "counter"); SP(1.0, 1.6, 0, -1, "counter", 0);
      if (type === "mart") B(w - 0.8, 0.4, w - 0.1, d - 0.4, 0, 2.0, "glass");
      for (let s = 2.2; s + 0.7 < w - 1.0; s += 1.9) { B(s, 1.6, s + 0.7, d - 0.7, 0, 1.6, "shelf"); if (rnd() < 0.7) SP(s - 0.45, (d + 1) / 2, 1, 0, "shelf", 0); }
      break;
    }
  }
}
