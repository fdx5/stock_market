/* A building's floors laid out for the walk (the register's 표제부 and 층별개요: /api/realestate/
 * building-floors), separately from the flats: the floor plate from the building's surveyed
 * footprint (its rectangle in the entrance's frame), a core in the middle (the register's lifts in a
 * bank, two stairs, the toilets), and the rest of each floor shared out to its registered uses by
 * their areas — an office's desks and meeting rooms, a clinic's reception, waiting room and consulting
 * rooms, a ward's beds, shelves and tills, a restaurant's tables, a classroom's desks, a car park's
 * bays, a hotel's rooms — with the points people use (seats, desks, beds, counters, shelves) and a
 * grid to walk on. Escalators join consecutive shop floors of a large store.
 *
 * The frame: x along the front (0..W), z from the front (z = 0, the street door) to the back (0..D);
 * metres; y up. Each floor's own height. */

export interface RegFloor { level: number; label: string; area: number; uses: { use: string; detail: string; area: number }[] }
export interface RegBuilding {
  name?: string | null; use?: string | null; useDetail?: string | null; floors?: number | null; basements?: number | null;
  rideLifts?: number; emergencyLifts?: number; totalArea?: number | null; buildingArea?: number | null; approved?: string | null;
}
export type ZoneKind = "office" | "lobby" | "clinic" | "ward" | "retail" | "food" | "class" | "gym" | "hotel" | "parking" | "rooms" | "plant";

export type Mat = "floor" | "carpet" | "concrete" | "wall" | "glass" | "desk" | "chair" | "fabric" | "metal" | "shelf" | "bed" | "sheet" | "counter" | "car" | "line" | "plant" | "tile" | "lift" | "dark" | "screen" | "wood" | "white";
/** a box: x0 z0 x1 z1 (plan), y0 y1 (height), its material, solid (blocks walking) */
export interface Box { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; m: Mat; solid: boolean; yaw?: number }
export type SpotKind = "desk" | "seat" | "wait" | "bed" | "stand" | "counter" | "shelf" | "lift" | "toilet" | "table" | "exam" | "class" | "treadmill" | "car" | "clerk";
/** a place a person uses: where they stand or sit, facing yaw (radians, 0 = +z), at seat height y */
export interface Spot { x: number; z: number; yaw: number; kind: SpotKind; y: number; zone: number }
export interface Lift { x: number; z: number; w: number; yaw: number; index: number }
export interface Escalator { x: number; z0: number; z1: number; up: boolean; w: number }
export interface Zone { kind: ZoneKind; label: string; rect: [number, number, number, number] }
/** what a floor shows on its walls and hangs from its ceiling: the floor directory by the lifts, the
 * floor's own number, the counters' signs, the toilets', a waiting room's TV, a clock */
export interface Decor { kind: "directory" | "floor" | "sign" | "tv" | "clock"; x: number; z: number; y: number; yaw: number; w: number; h: number; text?: string }
export interface FloorPlan {
  level: number; label: string; height: number; kinds: ZoneKind[];
  zones: Zone[]; boxes: Box[]; spots: Spot[]; lifts: Lift[]; stairs: { x: number; z: number; w: number; d: number }[];
  escalators: Escalator[];
  decor: Decor[];
  /** the outer walls along the outline */
  segs: Seg[];
  /** walkable grid: 0.5 m cells, 1 = free */
  grid: { nx: number; nz: number; cell: number; free: Uint8Array };
  /** the street door (ground floor) */
  door: { x: number; z: number; w: number } | null;
  /** people on this floor */
  crowd: number;
}
/** a business in the building (the shop register's: its name, kind and floor) */
export interface Tenant { name: string; kind: string; category: string | null; level: number }
export interface BuildingPlan { W: number; D: number; floors: Map<number, FloorPlan | null>; levels: number[]; info: RegBuilding; regFloors: RegFloor[]; lifts: number;
  /** the businesses registered in it, by floor */
  tenants: Tenant[];
  /** the building's surveyed outline in the plan's frame (x along the front, z in from the street door),
   * and the door's place along the front — the shell is this, not a rectangle */
  poly: [number, number][] | null; doorX: number }
/** a wall along any line (the outline's sides): its ends, thickness, heights, material */
export interface Seg { ax: number; az: number; bx: number; bz: number; t: number; y0: number; y1: number; m: Mat; solid: boolean }

const CELL = 0.5;

export function kindOf(use: string, detail: string, level: number, building: RegBuilding): ZoneKind {
  const s = `${use} ${detail}`;
  if (/주차/.test(s)) return "parking";
  if (/기계|전기실|발전|저수|물탱크|설비/.test(s)) return "plant";
  if (/병실|입원|병동|요양/.test(s)) return "ward";
  // (a hospital's upper floors are its wards — the register says only 의료시설 — its lower ones the
  // outpatient clinics: in a block of eight floors or more, the top 60 %)
  if (/의료|병원|의원|치과|한의|약국|검진|클리닉|산후/.test(s)) {
    const top = building.floors ?? 0, hospital = /의료|병원/.test(`${building.use} ${building.useDetail}`);
    return hospital && top >= 8 && level > Math.max(3, Math.round(top * 0.4)) ? "ward" : "clinic";
  }
  if (/음식|카페|휴게|제과|식당|주점/.test(s)) return "food";
  if (/판매|소매|상점|마트|백화|쇼핑|시장|매장/.test(s)) return "retail";
  if (/학원|교육|교습|독서|학교|강의/.test(s)) return "class";
  if (/체력|운동|헬스|체육|골프|요가|당구|볼링/.test(s)) return "gym";
  if (/숙박|호텔|모텔|여관|게스트/.test(s)) return "hotel";
  if (/오피스텔|주택|아파트|다세대|기숙/.test(s)) return "rooms";
  if (/업무|사무|금융|은행|오피스|공공|관공|우체국|방송|연구/.test(s)) return level === 1 ? "lobby" : "office";
  if (/근린/.test(s)) return level === 1 ? "retail" : "office";
  return level === 1 ? "lobby" : "office";
}
const LABEL: Record<ZoneKind, string> = { office: "사무실", lobby: "로비", clinic: "진료·대기", ward: "병동", retail: "매장", food: "식당", class: "강의실", gym: "체육시설", hotel: "객실", parking: "주차장", rooms: "호실", plant: "기계실" };
const DENSITY: Record<ZoneKind, number> = { office: 9, lobby: 22, clinic: 6, ward: 10, retail: 11, food: 5, class: 4, gym: 12, hotel: 30, parking: 120, rooms: 40, plant: 400 };

function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** The plate: the footprint's extent along the door's wall and back from it (capped for the walk). */
export function plateOf(foot: [number, number][] | undefined, heading: number, area?: number | null, door?: [number, number]): { W: number; D: number; poly: [number, number][] | null; doorX: number } {
  if (foot && foot.length >= 3) {
    // the outline in the door's frame: u along the front, v out through the door (its side z = 0)
    const hx = Math.cos(heading), hy = Math.sin(heading);
    const uv = foot.map(([x, y]) => [-x * hy + y * hx, x * hx + y * hy] as [number, number]);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [u, v] of uv) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const du = door ? -door[0] * hy + door[1] * hx : (u0 + u1) / 2;
    // (a very large block: the part within 80 m either side of the door and 100 m in)
    const cu0 = Math.max(u0, du - 80), cu1 = Math.min(u1, du + 80), cv0 = Math.max(v0, v1 - 100);
    let poly = uv.map(([u, v]) => [u - cu0, v1 - v] as [number, number]);
    poly = clipRect(poly, 0, 0, cu1 - cu0, v1 - cv0);
    if (poly.length < 3) poly = [[0, 0], [cu1 - cu0, 0], [cu1 - cu0, v1 - cv0], [0, v1 - cv0]];
    // (anticlockwise in x, z)
    let a = 0; for (let i = 0; i < poly.length; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length]; a += x1 * z2 - x2 * z1; }
    if (a < 0) poly.reverse();
    return { W: Math.max(10, cu1 - cu0), D: Math.max(9, v1 - cv0), poly, doorX: Math.min(cu1 - cu0 - 2, Math.max(2, du - cu0)) };
  }
  const a = Math.max(120, area ?? 400), W = Math.min(120, Math.sqrt(a * 1.6)), D = Math.min(80, Math.max(9, a / W));
  return { W, D, poly: null, doorX: W / 2 };
}
/** a ring clipped to a rectangle (Sutherland–Hodgman) */
function clipRect(p: [number, number][], x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const edge = (pts: [number, number][], inside: (q: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); }
    return out;
  };
  const lerpX = (a: [number, number], b: [number, number], x: number): [number, number] => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1e-9)];
  const lerpZ = (a: [number, number], b: [number, number], z: number): [number, number] => [a[0] + (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || 1e-9), z];
  let q = edge(p, a => a[0] >= x0, (a, b) => lerpX(a, b, x0));
  q = edge(q, a => a[0] <= x1, (a, b) => lerpX(a, b, x1));
  q = edge(q, a => a[1] >= z0, (a, b) => lerpZ(a, b, z0));
  q = edge(q, a => a[1] <= z1, (a, b) => lerpZ(a, b, z1));
  return q;
}
export function inPoly(x: number, z: number, p: [number, number][]) {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) hit = !hit;
  return hit;
}
function edgeDist(x: number, z: number, p: [number, number][]) {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
  return d;
}

export function planBuilding(info: RegBuilding, regFloors: RegFloor[], W: number, D: number, poly: [number, number][] | null = null, doorX = W / 2, tenants: Tenant[] = []): BuildingPlan {
  const above = Math.max(1, info.floors ?? Math.max(1, ...regFloors.map(f => f.level))), below = Math.max(0, info.basements ?? 0, ...regFloors.map(f => -f.level));
  const levels: number[] = [];
  for (let l = -Math.min(below, 6); l <= Math.min(above, 60); l++) if (l !== 0) levels.push(l);
  const lifts = Math.max(levels.length > 3 || W * D > 600 ? 1 : 0, Math.min(8, (info.rideLifts ?? 0) + (info.emergencyLifts ? 1 : 0)));
  return { W, D, floors: new Map(levels.map(l => [l, null])), levels, info, regFloors, lifts, poly, doorX, tenants };
}

/** Lay out one floor (made when it is first visited). */
export function planFloor(b: BuildingPlan, level: number, seed: number): FloorPlan {
  const { W, D } = b, R = rng(seed * 131 + level * 977 + 7);
  const reg = b.regFloors.find(f => f.level === level);
  // its uses (merged by kind), the register's or, for a floor it does not list, the building's main one
  const uses = new Map<ZoneKind, number>();
  for (const u of reg?.uses ?? []) { const k = kindOf(u.use, u.detail, level, b.info); uses.set(k, (uses.get(k) ?? 0) + Math.max(1, u.area)); }
  if (!uses.size) uses.set(level < 0 ? "parking" : kindOf(b.info.use ?? "", b.info.useDetail ?? "", level, b.info), 1);
  // (the ground floor of an office or hospital block keeps a lobby by the door)
  if (level === 1 && !uses.has("lobby") && W * D > 300 && [...uses.keys()].some(k => k === "office" || k === "clinic" || k === "ward")) uses.set("lobby", [...uses.values()].reduce((a, b) => a + b, 0) * 0.3);
  const kinds = [...uses.entries()].sort((a, b) => (a[0] === "lobby" ? -1 : b[0] === "lobby" ? 1 : b[1] - a[1])).map(e => e[0]);
  const height = level < 0 ? 3.3 : level === 1 ? 4.5 : kinds[0] === "retail" || kinds[0] === "food" ? 4.2 : kinds[0] === "ward" || kinds[0] === "clinic" ? 3.9 : 3.6;
  const boxes: Box[] = [], spots: Spot[] = [], zones: Zone[] = [], lifts: Lift[] = [], stairs: FloorPlan["stairs"] = [], decor: Decor[] = [], segs: Seg[] = [];
  const poly = b.poly;
  /** inside the outline, `inset` m clear of its walls */
  const insideAt = (x: number, z: number, inset = 0) => !poly || (inPoly(x, z, poly) && edgeDist(x, z, poly) >= inset);
  const add = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat, solid = true) => boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, m, solid });
  const T = 0.2, H = height;

  // ---- the core: a lift bank facing the front, the toilets behind it, stairs at both ends of the plate
  const nl = b.lifts, small = W * D < 260;
  const coreW = small ? 3.2 : Math.max(5, nl * 2.3 + 1.6), coreD = small ? 3.2 : 6.2;
  let ccx = small ? W - coreW / 2 - T : W / 2, ccz = small ? D - coreD / 2 - T : Math.max(4.5 + coreD / 2, D / 2);
  if (poly && !small) {
    // (the core where the outline has the most room round it, toward its middle)
    let best = -Infinity;
    for (let x = 4; x < W - 4; x += 2) for (let z = 6; z < D - 4; z += 2) {
      if (!inPoly(x, z, poly)) continue;
      const sc = Math.min(edgeDist(x, z, poly), 18) - Math.hypot(x - W / 2, z - D / 2) * 0.08;
      if (sc > best) { best = sc; ccx = x; ccz = z; }
    }
  }
  const cx0 = ccx - coreW / 2, cz0 = Math.max(4.5, ccz - coreD / 2), cx1 = cx0 + coreW, cz1 = cz0 + coreD;
  add(cx0, cz0, cx1, cz0 + 0.25, 0, H, "wall"); add(cx0, cz1 - 0.25, cx1, cz1, 0, H, "wall");
  add(cx0, cz0, cx0 + 0.25, cz1, 0, H, "wall"); add(cx1 - 0.25, cz0, cx1, cz1, 0, H, "wall");
  // the lifts: doors on the core's front (z = cz0), cars inside
  const liftW = 2.1;
  for (let i = 0; i < nl; i++) {
    const lx = cx0 + 0.8 + i * 2.3 + liftW / 2;
    if (lx + liftW / 2 > cx1 - 0.3) break;
    lifts.push({ x: lx, z: cz0 - 0.02, w: liftW, yaw: Math.PI, index: i });
    add(lx - liftW / 2 - 0.12, cz0 - 0.06, lx - liftW / 2, cz0 + 0.25, 0, 2.6, "metal"); add(lx + liftW / 2, cz0 - 0.06, lx + liftW / 2 + 0.12, cz0 + 0.25, 0, 2.6, "metal");
    add(lx - 1.0, cz0 - 0.04, lx + 1.0, cz0 + 0.02, 0, 2.3, "lift", false);
    add(lx - liftW / 2 - 0.12, cz0 - 0.06, lx + liftW / 2 + 0.12, cz0 + 0.25, 2.3, 2.6, "metal");
    spots.push({ x: lx + (R() - 0.5) * 1.2, z: cz0 - 1.2 - R() * 0.8, yaw: Math.PI, kind: "lift", y: 0, zone: -1 });
  }
  // the toilets at the core's back (a door each side)
  if (!small) {
    add(cx0, cz1 - 2.6, cx1, cz1 - 2.4, 0, H, "wall");
    spots.push({ x: cx0 + coreW * 0.3, z: cz1 + 0.8, yaw: 0, kind: "toilet", y: 0, zone: -1 }, { x: cx1 - coreW * 0.3, z: cz1 + 0.8, yaw: 0, kind: "toilet", y: 0, zone: -1 });
    for (const sx of [cx0 + 0.25, cx1 - 2.2]) add(sx, cz1 - 0.02, sx + 1.95, cz1 + 0.02, 0, 2.1, "wood", false);
  }
  // stairs: two, at the plate's ends (one for a small plate)
  const stairW = 2.8, stairD = 5.4;
  const sz0 = Math.max(T + 0.1, Math.min(D - stairD - T, (cz0 + cz1) / 2 - stairD / 2));
  const fit = (sx: number) => insideAt(sx, sz0, 0.3) && insideAt(sx + stairW, sz0, 0.3) && insideAt(sx, sz0 + stairD, 0.3) && insideAt(sx + stairW, sz0 + stairD, 0.3);
  let left = T + 0.1, right = W - stairW - T - 0.1;
  while (left < cx0 - stairW - 2 && !fit(left)) left += 1;
  while (right > cx1 + 2 && !fit(right)) right -= 1;
  const stairAt = small ? [[T + 0.1, D - stairD - T]] : [[left, sz0], [right, sz0]];
  for (const [sx, sz] of stairAt) {
    add(sx, sz, sx + stairW, sz + 0.2, 0, H, "wall"); add(sx, sz + stairD - 0.2, sx + stairW, sz + stairD, 0, H, "wall");
    const doorSide = sx < W / 2 ? sx + stairW : sx;
    add(doorSide - 0.1, sz, doorSide + 0.1, sz + 1.6, 0, H, "wall"); add(doorSide - 0.1, sz + 2.6, doorSide + 0.1, sz + stairD, 0, H, "wall");
    add(doorSide - 0.06, sz + 1.6, doorSide + 0.06, sz + 2.6, 0, 2.1, "metal", false);
    // the flights inside (a few treads, solid)
    for (let k = 0; k < 8; k++) add(sx + 0.2, sz + 0.4 + k * 0.28, sx + stairW / 2 - 0.05, sz + 0.68 + k * 0.28, 0, 0.17 * (k + 1), "concrete");
    stairs.push({ x: sx, z: sz, w: stairW, d: stairD });
  }
  // the outer wall: glazed above a sill (a car park's solid, with openings near the top)
  const parking = kinds[0] === "parking", door = level === 1 ? { x: b.doorX, z: 0, w: 3.0 } : null;
  if (door && poly) {
    // (the door on the outline where it crosses the door's line, nearest the street)
    let zMin = Infinity;
    for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; if ((ax - door.x) * (bx - door.x) <= 0 && ax !== bx) zMin = Math.min(zMin, az + (bz - az) * (door.x - ax) / (bx - ax)); }
    if (Number.isFinite(zMin)) door.z = zMin;
  }
  const seg = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, m: Mat, t = T, solid = true) => { if (Math.hypot(bx - ax, bz - az) > 0.05) segs.push({ ax, az, bx, bz, t, y0, y1, m, solid }); };
  const segRun = (ax: number, az: number, bx: number, bz: number) => {
    if (parking || level < 0) { seg(ax, az, bx, bz, 0, H, "concrete"); return; }
    const sill = level === 1 ? 0.15 : 0.85;
    seg(ax, az, bx, bz, 0, sill, "wall"); seg(ax, az, bx, bz, H - 0.5, H, "wall"); seg(ax, az, bx, bz, sill, H - 0.5, "glass", 0.06);
    const len = Math.hypot(bx - ax, bz - az);
    for (let t = 1.5; t < len; t += 1.5) { const k = t / len, mx = ax + (bx - ax) * k, mz = az + (bz - az) * k, ux = (bx - ax) / len * 0.03, uz = (bz - az) / len * 0.03; seg(mx - ux, mz - uz, mx + ux, mz + uz, 0, H, "metal", 0.12, false); }
  };
  const wallRun = (x0: number, z0: number, x1: number, z1: number) => {
    if (parking || level < 0) { add(x0, z0, x1, z1, 0, H, "concrete"); return; }
    add(x0, z0, x1, z1, 0, level === 1 ? 0.15 : 0.85, "wall"); add(x0, z0, x1, z1, H - 0.5, H, "wall");
    add(x0, z0, x1, z1, level === 1 ? 0.15 : 0.85, H - 0.5, "glass");
    // mullions every 1.5 m
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = along ? x1 - x0 : z1 - z0;
    for (let t = 1.5; t < len; t += 1.5) along ? add(x0 + t - 0.03, z0, x0 + t + 0.03, z1, 0, H, "metal") : add(x0, z0 + t - 0.03, x1, z0 + t + 0.03, 0, H, "metal");
  };
  if (poly) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      // (the door's side: the wall in two runs either side of it, glass over it)
      const len = Math.hypot(bx - ax, bz - az), t = len ? ((door?.x ?? 0) - ax) * (bx - ax) / (len * len) + ((door?.z ?? 0) - az) * (bz - az) / (len * len) : -1;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      if (door && t > 0 && t < 1 && Math.hypot(px - door.x, pz - door.z) < 0.6) {
        const h = door.w / 2 / len, k0 = Math.max(0, t - h), k1 = Math.min(1, t + h);
        segRun(ax, az, ax + (bx - ax) * k0, az + (bz - az) * k0); segRun(ax + (bx - ax) * k1, az + (bz - az) * k1, bx, bz);
        seg(ax + (bx - ax) * k0, az + (bz - az) * k0, ax + (bx - ax) * k1, az + (bz - az) * k1, 2.8, H, "glass", 0.06);
      } else segRun(ax, az, bx, bz);
    }
  }
  if (door) {
    if (!poly) { wallRun(0, 0, door.x - door.w / 2, T); wallRun(door.x + door.w / 2, 0, W, T); add(door.x - door.w / 2, 0, door.x + door.w / 2, T, 2.8, H, "glass"); }
    const dz = door.z;
    // (the vestibule: 3 m deep, glass to either side, the inner doors' opening as wide as the outer)
    const vx0 = door.x - door.w / 2 - 1.2, vx1 = door.x + door.w / 2 + 1.2, vz = dz + 3.2;
    add(vx0, dz + T, vx0 + 0.06, vz, 0, 2.8, "glass"); add(vx1 - 0.06, dz + T, vx1, vz, 0, 2.8, "glass");
    add(vx0, vz - 0.03, door.x - door.w / 2, vz + 0.03, 0, 2.8, "glass"); add(door.x + door.w / 2, vz - 0.03, vx1, vz + 0.03, 0, 2.8, "glass");
    add(vx0, vz - 0.05, vx1, vz + 0.05, 2.8, 3.1, "metal");
    add(door.x - door.w / 2, dz + T + 0.02, door.x + door.w / 2, vz - 0.05, 0, 0.012, "dark", false);
  }
  else if (!poly) wallRun(0, 0, W, T);
  if (!poly) { wallRun(0, D - T, W, D); wallRun(0, 0, T, D); wallRun(W - T, 0, W, D); }

  // a hospital's ground floor: its 원무과 (admissions and payments) across the hall (below)
  const hospital = /의료|병원/.test(`${b.info.use ?? ""} ${b.info.useDetail ?? ""}`), bigHall = level === 1 && hospital && !!door && W * D > 1500;
  // ---- the businesses on this floor, as registered (the shop register's names, kinds, floors): a unit
  // each — glass front and door on the walkway, its name over it, inside what its trade has — laid
  // before the floor's own layout (which keeps off them); and on a large hospital's clinic floors,
  // with no units registered, its outpatient departments' suites
  const reserved: [number, number, number, number][] = [];
  const mine = b.tenants.filter(t => t.level === level);
  const deptNames = ["내과", "외과", "정형외과", "소아청소년과", "산부인과", "신경과", "피부과", "안과", "이비인후과", "비뇨의학과", "재활의학과", "영상의학과"];
  const units: { name: string; kind: ZoneKind; trade: string }[] = mine.slice(0, 40).map(t => ({ name: t.name, trade: t.kind, kind: tradeZone(t.kind) }));
  if (!units.length && hospital && level >= 1 && level <= 3 && W * D > 1500 && (kinds.includes("clinic") || kinds.includes("lobby")))
    for (let i = 0; i < Math.min(8, Math.floor(W * D / 900)); i++) units.push({ name: `${deptNames[(i + level * 4) % deptNames.length]} 외래`, trade: "clinic", kind: "clinic" });
  if (units.length) placeUnits(units);
  function tradeZone(k: string): ZoneKind { return k === "clinic" ? "clinic" : k === "academy" ? "class" : k === "food" || k === "cafe" ? "food" : k === "agent" || k === "bank" ? "office" : k === "culture" ? "gym" : k === "lodging" ? "hotel" : "retail"; }
  function placeUnits(list: { name: string; kind: ZoneKind; trade: string }[]) {
    // (a unit's width by its trade; 7–9 m deep; along the outline's inside, the walkway side toward the core)
    const widthOf = (t: string) => t === "clinic" ? 11 : t === "academy" ? 10 : t === "food" ? 9 : t === "cafe" ? 7 : t === "pharmacy" ? 6 : t === "bank" ? 8 : 6.5;
    const depth = 7.5;
    // candidate places: on a 1 m grid, nearer the outline first, never the entrance hall, the main way, the core
    const cands: [number, number, number][] = [];
    for (let x = 1; x < W - 1; x += 1) for (let z = 1; z < D - 1; z += 1) {
      const d = poly ? edgeDist(x, z, poly) : Math.min(x, z, W - x, D - z);
      if (insideAt(x, z, 0.3)) cands.push([x, z, d]);
    }
    cands.sort((a, c) => a[2] - c[2]);
    for (const u of list) {
      const w = widthOf(u.trade);
      let done = false;
      for (const [x, z] of cands) {
        if (done) break;
        // (its back to the outline's nearest side: the front faces in)
        for (const [rx0, rz0, rx1, rz1, face] of [[x, z, x + w, z + depth, "s"], [x, z - depth, x + w, z, "n"], [x, z, x + depth, z + w, "e"], [x - depth, z, x, z + w, "w"]] as [number, number, number, number, string][]) {
          if (blocked(rx0, rz0, rx1, rz1, 0.2) || !insideAt(rx0, rz0, 0.25) || !insideAt(rx1, rz0, 0.25) || !insideAt(rx0, rz1, 0.25) || !insideAt(rx1, rz1, 0.25)) continue;
          if (cx1 + 3 > rx0 && cx0 - 3 < rx1 && cz1 + 2 > rz0 && cz0 - 4 < rz1) continue;
          reserved.push([rx0, rz0, rx1, rz1]); unit(u, rx0, rz0, rx1, rz1, face); done = true; break;
        }
      }
    }
  }
  /** one unit: three walls, a glass front with its door on `face` (n = toward z0, s = z1, e = x1, w = x0
   * — the side away from the outline), its sign over the door, its fittings */
  function unit(u: { name: string; kind: ZoneKind; trade: string }, x0: number, z0: number, x1: number, z1: number, face: string) {
    const zi = zones.length; zones.push({ kind: u.kind, label: u.name, rect: [x0, z0, x1, z1] });
    const wall = (a: number, b2: number, c: number, d2: number) => add(a, b2, c, d2, 0, H, "wall");
    const t = 0.12;
    // the front: glass, the door 1.6 m at its middle; the other three sides walls
    const front = (horiz: boolean, at: number, lo: number, hi: number) => {
      const mid = (lo + hi) / 2;
      if (horiz) { add(lo, at - 0.04, mid - 0.8, at + 0.04, 0, 2.7, "glass"); add(mid + 0.8, at - 0.04, hi, at + 0.04, 0, 2.7, "glass"); add(lo, at - 0.06, hi, at + 0.06, 2.7, H, "wall"); }
      else { add(at - 0.04, lo, at + 0.04, mid - 0.8, 0, 2.7, "glass"); add(at - 0.04, mid + 0.8, at + 0.04, hi, 0, 2.7, "glass"); add(at - 0.06, lo, at + 0.06, hi, 2.7, H, "wall"); }
      return mid;
    };
    let sx: number, sz: number, yaw: number, inX: number, inZ: number;
    if (face === "n") { wall(x0, z1 - t, x1, z1); wall(x0, z0, x0 + t, z1); wall(x1 - t, z0, x1, z1); const m = front(true, z0, x0, x1); sx = m; sz = z0 - 0.08; yaw = Math.PI; inX = 0; inZ = 1; }
    else if (face === "s") { wall(x0, z0, x1, z0 + t); wall(x0, z0, x0 + t, z1); wall(x1 - t, z0, x1, z1); const m = front(true, z1, x0, x1); sx = m; sz = z1 + 0.08; yaw = 0; inX = 0; inZ = -1; }
    else if (face === "e") { wall(x0, z0, x0 + t, z1); wall(x0, z0, x1, z0 + t); wall(x0, z1 - t, x1, z1); const m = front(false, x1, z0, z1); sx = x1 + 0.08; sz = m; yaw = Math.PI / 2; inX = -1; inZ = 0; }
    else { wall(x1 - t, z0, x1, z1); wall(x0, z0, x1, z0 + t); wall(x0, z1 - t, x1, z1); const m = front(false, x0, z0, z1); sx = x0 - 0.08; sz = m; yaw = -Math.PI / 2; inX = 1; inZ = 0; }
    decor.push({ kind: "sign", x: sx, z: sz, y: 3.0, yaw, w: Math.min((face === "n" || face === "s" ? x1 - x0 : z1 - z0) - 0.6, 0.55 * u.name.length + 1.2), h: 0.62, text: u.name });
    // inside: by its trade, in its own frame (u across the front, v in from it)
    const ux = face === "n" || face === "s" ? 1 : 0, uz = 1 - ux, fw = ux ? x1 - x0 : z1 - z0, dep = ux ? z1 - z0 : x1 - x0;
    const o0x = face === "w" ? x0 : face === "e" ? x1 : x0, o0z = face === "n" ? z0 : face === "s" ? z1 : z0;
    const P = (u2: number, v: number): [number, number] => [o0x + ux * u2 + inX * v, o0z + uz * u2 + inZ * v];
    const box = (u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, m: Mat, solid = true) => { const [ax, az] = P(u0, v0), [bx, bz] = P(u1, v1); add(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y0, y1, m, solid); };
    const spot = (u2: number, v: number, faceIn: boolean, kind: SpotKind, y = 0) => { const [px, pz] = P(u2, v); spots.push({ x: px, z: pz, yaw: faceIn ? yaw + Math.PI : yaw, kind, y, zone: zi }); };
    const tr = u.trade;
    if (tr === "clinic") {
      // reception at the back facing the door, waiting chairs before it, two consulting rooms to the side
      box(fw * 0.3, dep - 1.6, fw * 0.7, dep - 1.0, 0, 1.05, "counter"); spot(fw * 0.5, dep - 0.6, false, "counter");
      for (let i = 0; i < Math.floor(fw * 0.5 / 0.6); i++) { box(0.6 + i * 0.6, 1.4, 1.1 + i * 0.6, 1.9, 0, 0.45, "fabric"); spot(0.85 + i * 0.6, 1.7, true, "seat", 0.45); }
      box(fw * 0.72, 0.2, fw * 0.74, dep - 0.2, 0, H, "wall"); box(fw * 0.74, dep * 0.5, fw - 0.2, dep * 0.52, 0, H, "wall");
      box(fw * 0.8, dep - 1.4, fw - 0.4, dep - 0.8, 0, 0.74, "desk"); spot(fw * 0.87, dep - 0.4, false, "desk", 0.46); box(fw * 0.8, 1.0, fw - 0.4, 1.8, 0, 0.6, "sheet");
    } else if (tr === "academy") {
      box(0.6, dep - 0.3, fw - 0.6, dep - 0.22, 1.0, 2.2, "dark", false); spot(fw / 2, dep - 0.9, true, "stand");
      for (let r = 0; r < Math.floor((dep - 2.4) / 1.2); r++) for (let c = 0; c < Math.floor((fw - 1) / 1.5); c++) { box(0.8 + c * 1.5, 1.4 + r * 1.2, 1.9 + c * 1.5, 1.9 + r * 1.2, 0, 0.72, "desk"); spot(1.35 + c * 1.5, 1.1 + r * 1.2, false, "class", 0.45); }
    } else if (tr === "food" || tr === "cafe") {
      box(0.6, dep - 1.4, fw - 0.6, dep - 0.8, 0, 1.05, "counter"); spot(fw / 2, dep - 0.4, false, "counter");
      for (let gx = 1.0; gx + 1.4 < fw; gx += 2.2) for (let gv = 1.2; gv + 1.4 < dep - 1.8; gv += 2.2) { box(gx, gv, gx + 0.8, gv + 0.8, 0, 0.74, "wood"); spot(gx + 0.4, gv - 0.35, false, "table", 0.46); spot(gx + 0.4, gv + 1.15, true, "table", 0.46); }
    } else if (tr === "agent" || tr === "bank") {
      for (let i = 0; i < Math.floor((fw - 1) / 2.2); i++) { box(0.8 + i * 2.2, dep - 2.6, 2.4 + i * 2.2, dep - 1.9, 0, 0.74, "desk"); spot(1.6 + i * 2.2, dep - 1.4, false, "desk", 0.46); spot(1.6 + i * 2.2, dep - 3.2, true, "seat", 0.46); }
    } else if (tr === "culture") {
      for (let r = 0; r < Math.floor((dep - 1.5) / 1.6); r++) { box(0.5, 1.2 + r * 1.6, fw - 0.5, 1.8 + r * 1.6, 0, 0.74, "desk"); for (let c = 0; c < Math.floor((fw - 1) / 0.9); c++) { box(0.7 + c * 0.9, 1.6 + r * 1.6, 1.2 + c * 0.9, 1.65 + r * 1.6, 0.74, 1.15, "screen", false); spot(0.95 + c * 0.9, 1.0 + r * 1.6, false, "desk", 0.46); } }
    } else if (tr === "lodging") {
      for (let i = 0; i < Math.floor(fw / 3.5); i++) { box(0.6 + i * 3.5, dep - 2.4, 2.2 + i * 3.5, dep - 0.3, 0, 0.6, "bed"); spot(1.4 + i * 3.5, dep - 1.3, false, "bed", 0.62); }
    } else {
      // a shop: a till by the door, shelves in rows behind
      box(0.4, 0.6, 1.6, 1.2, 0, 0.95, "counter"); spot(1.0, 1.6, false, "counter");
      for (let gx = 2.2; gx + 0.8 < fw - 0.4; gx += 2.2) { box(gx, 1.6, gx + 0.8, dep - 0.6, 0, 1.6, "shelf"); spot(gx - 0.4, dep / 2, false, "shelf"); }
    }
  }

  // ---- the zones: strips across the plate by their areas (the lobby first, by the door)
  const total = kinds.reduce((s, k) => s + uses.get(k)!, 0);
  let x = T;
  kinds.forEach((k, zi) => {
    const share = uses.get(k)! / total, x1 = zi === kinds.length - 1 ? W - T : x + (W - 2 * T) * share;
    if (x1 - x < 3) return;
    const z = { kind: k, label: LABEL[k], rect: [x, T, x1, D - T] as [number, number, number, number] };
    zones.push(z);
    // (between zones: a partition with a door gap)
    if (zi > 0 && !parking && !bigHall) { add(x - 0.05, T, x + 0.05, D * 0.4, 0, H, "wall"); add(x - 0.05, D * 0.4 + 1.6, x + 0.05, D - T, 0, H, "wall"); }
    layZone(z, zi);
    x = x1;
  });

  function blocked(x0: number, z0: number, x1: number, z1: number, pad = 0.6) {
    for (const r of reserved) if (x1 > r[0] - 0.3 && x0 < r[2] + 0.3 && z1 > r[1] - 0.3 && z0 < r[3] + 0.3) return true;
    // (the core with its lift lobby, the stairs and their doors, and the street door's way in kept clear)
    if (x1 > cx0 - pad && x0 < cx1 + pad && z1 > cz0 - 2.4 && z0 < cz1 + 1.2) return true;
    for (const s of stairs) if (x1 > s.x - pad - 1 && x0 < s.x + s.w + pad + 1 && z1 > s.z - pad && z0 < s.z + s.d + pad) return true;
    if (door && x1 > door.x - 7 && x0 < door.x + 7 && z0 < door.z + 11) return true;
    // (the main way in: from the door straight to the lift lobby, 3.2 m wide, and along the lobby)
    if (door && x1 > door.x - 1.6 && x0 < door.x + 1.6 && z0 < cz0) return true;
    if (z1 > cz0 - 3.4 && z0 < cz0 && x1 > Math.min(cx0, door?.x ?? cx0) - 2 && x0 < Math.max(cx1, door?.x ?? cx1) + 2) return true;
    if (poly && !(insideAt(x0, z0, 0.35) && insideAt(x1, z0, 0.35) && insideAt(x0, z1, 0.35) && insideAt(x1, z1, 0.35) && insideAt((x0 + x1) / 2, (z0 + z1) / 2, 0.35))) return true;
    return false;
  }
  function layZone(z: Zone, zi: number) {
    const [x0, z0, x1, z1] = z.rect, k = z.kind;
    const grid = (sx: number, sz: number, fn: (x: number, y: number) => void, mx = 1.2, mz = 1.2) => {
      for (let gz = z0 + mz; gz + sz <= z1 - mz; gz += sz) for (let gx = x0 + mx; gx + sx <= x1 - mx; gx += sx) if (!blocked(gx, gz, gx + sx, gz + sz)) fn(gx, gz);
    };
    if (k === "office") {
      // desk pods of four (two facing pairs), aisles between; a meeting room in a corner; a pantry
      grid(3.4, 3.6, (gx, gz) => {
        add(gx, gz, gx + 2.8, gz + 1.5, 0, 0.74, "desk");
        add(gx + 1.38, gz, gx + 1.42, gz + 1.5, 0.74, 1.15, "white", false);
        for (const [dx, dz, yaw] of [[0.7, -0.45, 0], [2.1, -0.45, 0], [0.7, 1.95, Math.PI], [2.1, 1.95, Math.PI]] as [number, number, number][]) {
          spots.push({ x: gx + dx, z: gz + dz, yaw, kind: "desk", y: 0.46, zone: zi });
          add(gx + dx - 0.25, gz + (dz < 0 ? 0.1 : 1.0), gx + dx + 0.25, gz + (dz < 0 ? 0.5 : 1.4), 0.74, 1.12, "screen", false);
        }
      });
      if (x1 - x0 > 12) {
        const mx0 = x1 - 6.2, mz0 = z1 - 5.0;
        if (!blocked(mx0, mz0, x1, z1, 0.2)) {
          add(mx0, mz0, mx0 + 0.08, z1, 0, H, "glass"); add(mx0, mz0, x1 - 2.2, mz0 + 0.08, 0, H, "glass"); add(x1 - 1.2, mz0, x1, mz0 + 0.08, 0, H, "glass");
          add(mx0 + 1.2, mz0 + 1.4, x1 - 1.2, z1 - 1.4, 0, 0.74, "wood");
          for (let t = mx0 + 1.6; t < x1 - 1.4; t += 0.9) { spots.push({ x: t, z: mz0 + 1.0, yaw: 0, kind: "seat", y: 0.46, zone: zi }, { x: t, z: z1 - 1.0, yaw: Math.PI, kind: "seat", y: 0.46, zone: zi }); }
        }
      }
      // the pantry by the core: a counter, a water cooler; people stand there
      add(cx0 - 0.2, cz1 + 1.0, cx0 + 2.6, cz1 + 1.6, 0, 0.92, "counter");
      spots.push({ x: cx0 + 0.6, z: cz1 + 2.1, yaw: Math.PI, kind: "stand", y: 0, zone: zi }, { x: cx0 + 1.8, z: cz1 + 2.2, yaw: Math.PI, kind: "stand", y: 0, zone: zi });
    } else if (k === "lobby") {
      // reception desk facing the door, security gates, a waiting area with sofas, planters
      // (the information desk to one side of the way in, past the entrance hall, facing the door)
      const dz0 = (door?.z ?? 0) + 11.5, rx = door ? Math.min(x1 - 3, Math.max(x0 + 3, door.x + 5.5)) : (x0 + x1) / 2;
      add(rx - 2.2, dz0, rx + 2.2, dz0 + 0.8, 0, 1.05, "counter");
      spots.push({ x: rx - 1, z: dz0 + 1.3, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: rx + 1, z: dz0 + 1.3, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
      spots.push({ x: rx - 0.8, z: dz0 - 0.7, yaw: 0, kind: "wait", y: 0, zone: zi }, { x: rx + 0.6, z: dz0 - 0.8, yaw: 0, kind: "wait", y: 0, zone: zi });
      for (let g = -2; g <= 2; g++) if (!blocked(rx + g * 1.1 - 0.1, cz0 - 3.4, rx + g * 1.1 + 0.1, cz0 - 2.6, 0)) add(rx + g * 1.1 - 0.12, cz0 - 3.2, rx + g * 1.1 + 0.12, cz0 - 2.6, 0, 1.0, "metal");
      for (const sx of [x0 + 2.5, x1 - 5.5]) if (sx > x0 + 1 && sx + 3 < x1 - 1 && !blocked(sx, 9, sx + 3, 11, 0.2)) {
        // (the back to the front wall's side, the seats facing in, toward the lifts)
        add(sx, 9.0, sx + 3.0, 9.9, 0, 0.42, "fabric"); add(sx, 9.0, sx + 3.0, 9.3, 0.42, 0.85, "fabric");
        for (let t = 0.6; t < 3; t += 0.9) spots.push({ x: sx + t, z: 9.6, yaw: 0, kind: "seat", y: 0.42, zone: zi });
        add(sx + 0.6, 10.6, sx + 2.4, 11.4, 0, 0.4, "wood");
      }
      for (const px of [x0 + 1.2, x1 - 1.8]) add(px, 1.0, px + 0.6, 1.6, 0, 1.6, "plant", true);
    } else if (k === "clinic" && bigHall) {
      // (the hall's 원무과 takes the reception and the waiting; the consulting rooms along the back)
      rooms(z, zi, z1 - Math.min(5.5, (z1 - cz1) - 1.6), z1, "exam");
    } else if (k === "clinic") {
      // reception by the lifts, rows of waiting chairs, consulting rooms along the back wall
      const rx = (x0 + x1) / 2;
      add(rx - 1.8, cz0 - 4.6, rx + 1.8, cz0 - 3.9, 0, 1.05, "counter");
      spots.push({ x: rx - 0.8, z: cz0 - 3.4, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: rx + 0.8, z: cz0 - 3.4, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
      for (let q = 0; q < 4; q++) spots.push({ x: rx + (q - 1.5) * 0.7, z: cz0 - 5.4 - q * 0.05, yaw: 0, kind: "wait", y: 0, zone: zi });
      // waiting rows (front half)
      // (rows across, an aisle every eight seats; the backs toward the door, the seats toward the counter)
      const counterZ = cz0 - 4.6;
      for (let rz = Math.max(3.5, counterZ - 12); rz < counterZ - 5.5; rz += 1.9) {
        for (let cxp = x0 + 1.2, n = 0; cxp + 0.55 < x1 - 1.2; cxp += 0.6, n++) {
          if (n % 9 === 8) continue;
          if (blocked(cxp, rz, cxp + 0.55, rz + 0.6, 0.3)) continue;
          add(cxp, rz, cxp + 0.52, rz + 0.5, 0, 0.45, "fabric"); add(cxp, rz, cxp + 0.52, rz + 0.08, 0.45, 0.9, "fabric");
          spots.push({ x: cxp + 0.26, z: rz + 0.32, yaw: 0, kind: "seat", y: 0.45, zone: zi });
        }
      }
      rooms(z, zi, z1 - Math.min(5.5, (z1 - cz1) - 1.6), z1, "exam");
    } else if (k === "ward") {
      rooms(z, zi, z1 - Math.min(6.5, (z1 - cz1) - 1.6), z1, "bed");
      rooms(z, zi, z0, z0 + Math.min(6.5, cz0 - z0 - 3.0), "bed");
      // the nurses' station by the lifts
      const rx = (x0 + x1) / 2;
      add(rx - 2, cz0 - 3.6, rx + 2, cz0 - 3.0, 0, 1.05, "counter");
      spots.push({ x: rx - 0.8, z: cz0 - 2.6, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: rx + 0.8, z: cz0 - 2.6, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
    } else if (k === "retail") {
      // gondola shelves in rows, tills by the door, people at the shelves
      grid(2.6, 4.6, (gx, gz) => {
        add(gx, gz, gx + 0.9, gz + 3.6, 0, 1.6, "shelf");
        for (let t = 0.6; t < 3.4; t += 1.2) { spots.push({ x: gx - 0.45, z: gz + t, yaw: Math.PI / 2, kind: "shelf", y: 0, zone: zi }, { x: gx + 1.35, z: gz + t, yaw: -Math.PI / 2, kind: "shelf", y: 0, zone: zi }); }
      }, 1.6, 2.4);
      for (let t = 0; t < 2; t++) {
        const tx = x0 + 2 + t * 2.4; if (tx + 1.6 > x1 - 1 || blocked(tx, 1.6, tx + 1.6, 2.4, 0)) continue;
        add(tx, 1.6, tx + 1.6, 2.3, 0, 0.95, "counter");
        spots.push({ x: tx + 0.8, z: 2.8, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: tx + 0.8, z: 1.1, yaw: 0, kind: "wait", y: 0, zone: zi });
      }
    } else if (k === "food") {
      // a counter and kitchen along the back, tables of two and four
      add(x0 + 0.4, z1 - 3.0, x1 - 0.4, z1 - 2.4, 0, 1.05, "counter");
      add(x0 + 0.4, z1 - 1.2, x1 - 0.4, z1 - 0.4, 0, 0.9, "metal");
      for (let t = x0 + 1; t < x1 - 1; t += 2.4) spots.push({ x: t, z: z1 - 1.8, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
      grid(2.2, 2.2, (gx, gz) => {
        if (gz + 2.2 > z1 - 3.4) return;
        add(gx + 0.7, gz + 0.7, gx + 1.5, gz + 1.5, 0, 0.74, "wood");
        for (const [dx, dz, yaw] of [[1.1, 0.35, 0], [1.1, 1.85, Math.PI], [0.35, 1.1, Math.PI / 2], [1.85, 1.1, -Math.PI / 2]] as [number, number, number][]) {
          spots.push({ x: gx + dx, z: gz + dz, yaw, kind: "table", y: 0.46, zone: zi });
          add(gx + dx - 0.2, gz + dz - 0.2, gx + dx + 0.2, gz + dz + 0.2, 0, 0.45, "chair", false);
        }
      });
    } else if (k === "class") {
      rooms(z, zi, z0, z0 + Math.min(8, cz0 - z0 - 2.5), "class");
      rooms(z, zi, z1 - Math.min(8, z1 - cz1 - 2), z1, "class");
    } else if (k === "gym") {
      grid(1.4, 2.6, (gx, gz) => { add(gx, gz, gx + 0.8, gz + 2.0, 0, 0.25, "dark"); add(gx, gz + 1.7, gx + 0.8, gz + 1.8, 0.25, 1.4, "metal"); spots.push({ x: gx + 0.4, z: gz + 0.9, yaw: 0, kind: "treadmill", y: 0.22, zone: zi }); }, 1.5, 2);
    } else if (k === "hotel" || k === "rooms") {
      rooms(z, zi, z0, z0 + Math.min(7, cz0 - z0 - 2.4), "bed");
      rooms(z, zi, z1 - Math.min(7, z1 - cz1 - 2), z1, "bed");
    } else if (k === "parking") {
      // columns on an 8.1 m grid, bays along both sides of the drive aisles, cars in most
      for (let gx = x0 + 4; gx < x1 - 2; gx += 8.1) for (let gz = z0 + 5.2; gz < z1 - 2; gz += 11.2) if (!blocked(gx, gz, gx + 0.6, gz + 0.6, 0)) add(gx, gz, gx + 0.6, gz + 0.6, 0, H, "concrete");
      for (const bz of [z0 + 0.3, z1 - 5.3]) for (let bx = x0 + 0.6; bx + 2.5 < x1 - 0.6; bx += 2.6) {
        if (blocked(bx, bz, bx + 2.5, bz + 5, 0.1)) continue;
        add(bx, bz, bx + 0.08, bz + 5, 0, 0.005, "line", false);
        if (R() < 0.72) { add(bx + 0.35, bz + 0.4, bx + 2.2, bz + 4.6, 0.15, 1.45, "car"); spots.push({ x: bx + 1.25, z: bz < D / 2 ? bz + 5.4 : bz - 0.4, yaw: 0, kind: "car", y: 0, zone: zi }); }
      }
    } else {
      // plant rooms: equipment
      grid(3, 3, (gx, gz) => add(gx, gz, gx + 1.8, gz + 1.2, 0, 1.8, "metal"));
    }
  }
  /** a row of rooms between z0 and z1 across the zone, doors to the side facing the core */
  function rooms(z: Zone, zi: number, rz0: number, rz1: number, content: "exam" | "bed" | "class") {
    const [x0, , x1] = z.rect;
    if (rz1 - rz0 < 3) return;
    const towardCore = rz0 < cz0 ? rz1 : rz0, w = content === "class" ? 7 : content === "bed" ? 4.2 : 3.4;
    // the corridor wall, in runs between the rooms' doors (a door 1 m wide near each room's start)
    const doors: number[] = [];
    for (let rx = x0; rx + w <= x1 + 0.01; rx += w) if (!blocked(rx + 0.2, rz0, rx + w - 0.2, rz1, 0)) doors.push(rx + 0.4);
    let wx = x0;
    for (const d of doors) { if (d - wx > 0.05) add(wx, towardCore - 0.06, d, towardCore + 0.06, 0, H, "wall"); add(d, towardCore - 0.06, d + 1.0, towardCore + 0.06, 2.1, H, "wall"); wx = d + 1.0; }
    if (x1 - wx > 0.05) add(wx, towardCore - 0.06, x1, towardCore + 0.06, 0, H, "wall");
    for (let rx = x0; rx + w <= x1 + 0.01; rx += w) {
      if (blocked(rx + 0.2, rz0, rx + w - 0.2, rz1, 0)) continue;
      add(rx + w - 0.06, rz0, rx + w + 0.06, rz1, 0, H, "wall");
      // the door leaf, standing open against the wall
      boxes.push({ x0: rx + 1.4, z0: towardCore + (rz0 < cz0 ? -1.0 : 0.06), x1: rx + 1.44, z1: towardCore + (rz0 < cz0 ? -0.06 : 1.0), y0: 0, y1: 2.05, m: "wood", solid: false });
      const inner = rz0 < cz0 ? rz0 + 0.4 : rz1 - 0.4, inward = rz0 < cz0 ? -1 : 1;
      if (content === "exam") {
        add(rx + 0.5, inner + inward * -0.2, rx + 1.9, inner + inward * -0.9, 0, 0.74, "desk");
        spots.push({ x: rx + 1.2, z: inner - inward * 1.3, yaw: inward > 0 ? 0 : Math.PI, kind: "desk", y: 0.46, zone: zi });
        add(rx + 2.3, rz0 + 0.6, rx + 3.0, rz1 - 0.6, 0, 0.7, "sheet");
        spots.push({ x: rx + 1.2, z: inner - inward * 2.2, yaw: inward > 0 ? Math.PI : 0, kind: "exam", y: 0.46, zone: zi });
      } else if (content === "bed") {
        const nb = Math.max(1, Math.floor((rz1 - rz0 - 1.4) / 1.25));
        for (let i = 0; i < Math.min(nb, 4); i++) {
          const bz = Math.min(rz0, rz1) + 0.5 + i * 1.25;
          add(rx + 1.6, bz, rx + w - 0.3, bz + 1.0, 0, 0.62, "bed"); add(rx + w - 0.6, bz, rx + w - 0.3, bz + 1.0, 0.62, 1.0, "metal");
          spots.push({ x: rx + (1.6 + w - 0.3) / 2, z: bz + 0.5, yaw: Math.PI / 2, kind: "bed", y: 0.65, zone: zi });
          spots.push({ x: rx + 1.1, z: bz + 0.5, yaw: -Math.PI / 2, kind: "seat", y: 0.45, zone: zi });
        }
      } else {
        // a classroom: a board, rows of desks facing it
        add(rx + 0.4, rz0 + 0.3, rx + w - 0.4, rz0 + 0.38, 1.0, 2.2, "dark", false);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
          const dx = rx + 0.9 + c * 1.45, dz = rz0 + 1.6 + r * 1.2; if (dz + 0.9 > rz1 - 0.3) continue;
          add(dx, dz, dx + 1.1, dz + 0.5, 0, 0.72, "desk"); spots.push({ x: dx + 0.55, z: dz + 0.85, yaw: Math.PI, kind: "class", y: 0.45, zone: zi });
        }
        spots.push({ x: rx + w / 2, z: rz0 + 0.9, yaw: 0, kind: "stand", y: 0, zone: zi });
      }
    }
  }

  // ---- the 원무과 of a large hospital: a long counter across the hall facing the door — numbered
  // windows 1.8 m apart, each with its glass partition, a monitor and a clerk; a wall behind with the
  // department's name large over it; ticket machines at its ends; rows of seats facing it, the main
  // way through its middle to the lifts left open
  if (bigHall && door) {
    const cz = Math.max(door.z + 21, Math.min(cz0 - 5.5, door.z + 30)), gap0 = door.x - 2.2, gap1 = door.x + 2.2;
    const xa = Math.max(T + 1.5, door.x - 26), xb = Math.min(W - T - 1.5, door.x + 26);
    let n = 0;
    const runs: [number, number][] = [];
    for (const [ra, rb] of [[xa, gap0], [gap1, xb]] as [number, number][]) {
      let s0 = -1;
      for (let xw = ra + 0.9; xw + 0.9 <= rb; xw += 1.8) {
        const clash = xw + 0.9 > cx0 - 2 && xw - 0.9 < cx1 + 2 && cz + 2.4 > cz0 - 3.4 && cz < cz1 + 1;
        if (clash || !insideAt(xw, cz, 0.6) || !insideAt(xw, cz + 2.4, 0.6)) { if (s0 >= 0) { runs.push([s0, xw - 0.9]); s0 = -1; } continue; }
        if (s0 < 0) s0 = xw - 0.9;
        n++;
        add(xw - 0.9, cz, xw + 0.9, cz + 0.35, 0, 1.08, "counter");
        add(xw - 0.9, cz + 0.35, xw + 0.9, cz + 1.0, 0, 0.74, "desk");
        add(xw + 0.87, cz - 0.05, xw + 0.93, cz + 1.0, 1.08, 1.7, "glass", false);
        add(xw - 0.25, cz + 0.5, xw + 0.25, cz + 0.55, 0.74, 1.12, "screen", false);
        spots.push({ x: xw, z: cz + 1.4, yaw: Math.PI, kind: "clerk", y: 0.46, zone: -1 });
        spots.push({ x: xw, z: cz - 0.5, yaw: 0, kind: "wait", y: 0, zone: -1 });
        decor.push({ kind: "sign", x: xw, z: cz - 0.06, y: 2.0, yaw: Math.PI, w: 0.7, h: 0.38, text: `${n}번` });
      }
      if (s0 >= 0) runs.push([s0, rb - (rb - ra - 0.9) % 1.8]);
    }
    // the wall behind the clerks, the name over it, the ticket machines at the ends
    for (const [a, b2] of runs) {
      add(a, cz + 2.2, b2, cz + 2.4, 0, H, "wall");
      if (b2 - a > 6) decor.push({ kind: "sign", x: (a + b2) / 2, z: cz + 2.17, y: 3.05, yaw: Math.PI, w: Math.min(13, (b2 - a) * 0.6), h: 1.0, text: "원무과  접수 · 수납" });
      for (const kx of [a - 0.9, b2 + 0.4]) if (insideAt(kx + 0.25, cz - 1, 0.4)) { add(kx, cz - 1.3, kx + 0.5, cz - 0.9, 0, 1.45, "white"); add(kx + 0.05, cz - 1.32, kx + 0.45, cz - 1.3, 0.9, 1.35, "screen", false); }
    }
    // the waiting seats: rows across the hall facing the counter, an aisle every nine and the main way open
    for (let rz = door.z + 13.5; rz < cz - 2.6; rz += 1.9) {
      for (let cxp = xa, k = 0; cxp + 0.55 < xb; cxp += 0.6, k++) {
        if (k % 10 === 9) continue;
        if (cxp + 0.55 > gap0 - 0.8 && cxp < gap1 + 0.8) continue;
        if (blocked(cxp, rz, cxp + 0.55, rz + 0.6, 0.3) && !(rz > door.z + 11 && insideAt(cxp, rz, 0.6) && !(cxp + 0.55 > door.x - 1.6 && cxp < door.x + 1.6))) continue;
        add(cxp, rz, cxp + 0.52, rz + 0.5, 0, 0.45, "fabric"); add(cxp, rz, cxp + 0.52, rz + 0.08, 0.45, 0.9, "fabric");
        spots.push({ x: cxp + 0.26, z: rz + 0.32, yaw: 0, kind: "seat", y: 0.45, zone: -1 });
      }
    }
    // the queue's number boards over the counter's middle, each side
    for (const [a, b2] of runs) if (b2 - a > 10) decor.push({ kind: "tv", x: (a + b2) / 2 + (b2 - a) * 0.3, z: cz + 2.17, y: 3.05, yaw: Math.PI, w: 1.8, h: 1.0 });
  }

  // ---- what the floor shows: by the lifts its directory and its number (the core's front wall, facing
  // the lobby), the toilets' sign, a sign over each counter, a clock; in a waiting room a TV; plants by
  // the windows, a water cooler and bins by the core
  {
    const faceLobby = Math.PI;
    if (!small) {
      decor.push({ kind: "directory", x: cx0 + 0.55, z: cz0 - 0.03, y: 1.55, yaw: faceLobby, w: 0.9, h: 1.5 });
      decor.push({ kind: "floor", x: cx1 - 0.75, z: cz0 - 0.03, y: 2.05, yaw: faceLobby, w: 1.1, h: 0.75, text: reg?.label ?? (level < 0 ? `B${-level}` : `${level}F`) });
      decor.push({ kind: "sign", x: (cx0 + cx1) / 2, z: cz1 + 0.03, y: 2.35, yaw: 0, w: 1.2, h: 0.32, text: "화장실 ▲" });
      decor.push({ kind: "clock", x: (cx0 + cx1) / 2, z: cz0 - 0.03, y: 2.9, yaw: faceLobby, w: 0.4, h: 0.4 });
      add(cx1 + 0.4, cz0 - 1.0, cx1 + 0.75, cz0 - 0.6, 0, 1.15, "white"); add(cx1 + 0.42, cz0 - 0.98, cx1 + 0.73, cz0 - 0.62, 1.15, 1.45, "glass", false);
      add(cx0 - 0.75, cz0 - 1.0, cx0 - 0.4, cz0 - 0.6, 0, 0.75, "metal");
    }
    for (const sp of spots) if (sp.kind === "counter") {
      const z = zones[sp.zone]?.kind;
      const text = z === "clinic" ? "원무과 · 접수 · 수납" : z === "ward" ? "간호사실" : z === "lobby" ? "안내" : z === "retail" ? "계산대" : z === "food" ? "주문 · 픽업" : null;
      if (text && !decor.some(d => d.kind === "sign" && d.text === text && Math.hypot(d.x - sp.x, d.z - sp.z) < 6)) decor.push({ kind: "sign", x: sp.x, z: sp.z + 0.6, y: 2.55, yaw: Math.PI, w: 1.6, h: 0.4, text });
    }
    for (const z of zones) {
      const [x0, z0, x1, z1] = z.rect;
      if (z.kind === "clinic" && x1 - x0 > 6) decor.push({ kind: "tv", x: (x0 + x1) / 2, z: T + 0.04, y: 2.2, yaw: 0, w: 1.6, h: 0.9 });
      if (!parking && level >= 0) for (const [px, pz] of [[x0 + 0.6, z0 + 0.6], [x1 - 1.2, z0 + 0.6], [x0 + 0.6, z1 - 1.2], [x1 - 1.2, z1 - 1.2]]) if (!blocked(px, pz, px + 0.6, pz + 0.6, 0)) add(px, pz, px + 0.6, pz + 0.6, 0, 1.3 + R() * 0.5, "plant");
    }
  }

  // ---- escalators: in a store of two or more shop floors, beside the core
  const escalators: Escalator[] = [];
  const shopFloors = b.levels.filter(l => { const r = b.regFloors.find(f => f.level === l); return !!r && r.uses.some(u => kindOf(u.use, u.detail, l, b.info) === "retail") && r.area > 900; });
  if (shopFloors.includes(level) && (shopFloors.includes(level + 1) || shopFloors.includes(level - 1)) && cx0 > 9) {
    const ex = cx0 - 4.0, ez0 = Math.max(3, cz0 - 2), len = Math.min(9, D - ez0 - 2);
    if (shopFloors.includes(level + 1)) escalators.push({ x: ex, z0: ez0, z1: ez0 + len, up: true, w: 1.1 });
    if (shopFloors.includes(level - 1)) escalators.push({ x: ex - 1.6, z0: ez0 + len, z1: ez0, up: false, w: 1.1 });
    // (the shelves cleared from where they stand)
    for (let i = boxes.length - 1; i >= 0; i--) { const q = boxes[i]; if (q.m === "shelf" && q.x1 > ex - 2.8 && q.x0 < ex + 1.8 && q.z1 > ez0 - 1 && q.z0 < ez0 + len + 1) boxes.splice(i, 1); }
    for (let i = spots.length - 1; i >= 0; i--) { const s = spots[i]; if (s.kind === "shelf" && s.x > ex - 3.2 && s.x < ex + 2.2 && s.z > ez0 - 1.4 && s.z < ez0 + len + 1.4) spots.splice(i, 1); }
  }

  // ---- the walking grid
  const nx = Math.ceil(W / CELL), nz = Math.ceil(D / CELL), free = new Uint8Array(nx * nz).fill(1);
  for (const q of boxes) {
    if (!q.solid || q.y0 > 1.6 || q.y1 < 0.3) continue;
    const i0 = Math.max(0, Math.floor((q.x0 - 0.15) / CELL)), i1 = Math.min(nx - 1, Math.floor((q.x1 + 0.15) / CELL));
    const j0 = Math.max(0, Math.floor((q.z0 - 0.15) / CELL)), j1 = Math.min(nz - 1, Math.floor((q.z1 + 0.15) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) free[j * nx + i] = 0;
  }
  if (poly) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!inPoly((i + 0.5) * CELL, (j + 0.5) * CELL, poly) || edgeDist((i + 0.5) * CELL, (j + 0.5) * CELL, poly) < 0.3) free[j * nx + i] = 0;
  for (const e of escalators) { const i0 = Math.floor((e.x - 0.8) / CELL), i1 = Math.floor((e.x + e.w + 0.8) / CELL), j0 = Math.floor(Math.min(e.z0, e.z1) / CELL), j1 = Math.floor(Math.max(e.z0, e.z1) / CELL); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && i < nx && j >= 0 && j < nz) free[j * nx + i] = 0; }
  // people: by each zone's use and size
  let crowd = 0;
  const share = poly ? Math.abs(poly.reduce((t, [x1, z1], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return t + x1 * z2 - x2 * z1; }, 0)) / 2 / (W * D) : 1;
  for (const z of zones) crowd += ((z.rect[2] - z.rect[0]) * (z.rect[3] - z.rect[1])) * share / DENSITY[z.kind];
  crowd = Math.round(Math.min(380, Math.max(level < 0 ? 2 : 6, crowd)) * (0.75 + R() * 0.4));
  return { level, label: reg?.label ?? (level < 0 ? `지하${-level}층` : `${level}층`), height, kinds, zones, boxes, spots, lifts, stairs, escalators, decor, segs, grid: { nx, nz, cell: CELL, free }, door, crowd };
}

/** A path on the grid between two points (A*, 8 neighbours), as points; null if none. */
export function findPath(g: FloorPlan["grid"], ax: number, az: number, bx: number, bz: number, maxNodes = 6000): [number, number][] | null {
  const { nx, nz, cell, free } = g;
  const ci = (x: number) => Math.max(0, Math.min(nx - 1, Math.floor(x / cell))), cj = (z: number) => Math.max(0, Math.min(nz - 1, Math.floor(z / cell)));
  const near = (i: number, j: number) => { if (free[j * nx + i]) return j * nx + i; for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && free[b * nx + a]) return b * nx + a; } return -1; };
  const s = near(ci(ax), cj(az)), t = near(ci(bx), cj(bz));
  if (s < 0 || t < 0) return null;
  const tx = t % nx, tz = (t - tx) / nx;
  const gS = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
  const open: number[] = [s], f = new Float32Array(nx * nz).fill(Infinity);
  gS[s] = 0; f[s] = 0;
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const c = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (c === t) break;
    if (closed[c]) continue; closed[c] = 1;
    const i = c % nx, j = (c - i) / nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const d = b * nx + a; if (!free[d] || closed[d]) continue;
      if (di && dj && (!free[j * nx + a] || !free[b * nx + i])) continue;
      const gg = gS[c] + (di && dj ? 1.414 : 1);
      if (gg < gS[d]) { gS[d] = gg; from[d] = c; f[d] = gg + Math.hypot(a - tx, b - tz); open.push(d); }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const out: [number, number][] = [];
  for (let c = t; c >= 0 && c !== s; c = from[c]) { const i = c % nx; out.push([(i + 0.5) * cell, ((c - i) / nx + 0.5) * cell]); }
  out.reverse();
  // (thinned: every few cells)
  const thin = out.filter((_, k) => k % 3 === 2 || k === out.length - 1);
  thin.push([bx, bz]);
  return thin;
}
