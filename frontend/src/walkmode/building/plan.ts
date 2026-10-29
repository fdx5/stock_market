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
export type SpotKind = "desk" | "seat" | "wait" | "bed" | "stand" | "counter" | "shelf" | "lift" | "toilet" | "table" | "exam" | "class" | "treadmill" | "car";
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
  /** walkable grid: 0.5 m cells, 1 = free */
  grid: { nx: number; nz: number; cell: number; free: Uint8Array };
  /** the street door (ground floor) */
  door: { x: number; z: number; w: number } | null;
  /** people on this floor */
  crowd: number;
}
export interface BuildingPlan { W: number; D: number; floors: Map<number, FloorPlan | null>; levels: number[]; info: RegBuilding; regFloors: RegFloor[]; lifts: number }

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
export function plateOf(foot: [number, number][] | undefined, heading: number, area?: number | null): { W: number; D: number } {
  if (foot && foot.length >= 3) {
    const hx = Math.cos(heading), hy = Math.sin(heading);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of foot) { const u = -x * hy + y * hx, v = x * hx + y * hy; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    return { W: Math.min(72, Math.max(10, u1 - u0)), D: Math.min(40, Math.max(9, v1 - v0)) };
  }
  const a = Math.max(120, area ?? 400), W = Math.min(72, Math.sqrt(a * 1.6));
  return { W, D: Math.min(40, Math.max(9, a / W)) };
}

export function planBuilding(info: RegBuilding, regFloors: RegFloor[], W: number, D: number): BuildingPlan {
  const above = Math.max(1, info.floors ?? Math.max(1, ...regFloors.map(f => f.level))), below = Math.max(0, info.basements ?? 0, ...regFloors.map(f => -f.level));
  const levels: number[] = [];
  for (let l = -Math.min(below, 6); l <= Math.min(above, 60); l++) if (l !== 0) levels.push(l);
  const lifts = Math.max(levels.length > 3 || W * D > 600 ? 1 : 0, Math.min(8, (info.rideLifts ?? 0) + (info.emergencyLifts ? 1 : 0)));
  return { W, D, floors: new Map(levels.map(l => [l, null])), levels, info, regFloors, lifts };
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
  const boxes: Box[] = [], spots: Spot[] = [], zones: Zone[] = [], lifts: Lift[] = [], stairs: FloorPlan["stairs"] = [], decor: Decor[] = [];
  const add = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat, solid = true) => boxes.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, m, solid });
  const T = 0.2, H = height;

  // ---- the core: a lift bank facing the front, the toilets behind it, stairs at both ends of the plate
  const nl = b.lifts, small = W * D < 260;
  const coreW = small ? 3.2 : Math.max(5, nl * 2.3 + 1.6), coreD = small ? 3.2 : 6.2;
  const cx0 = small ? W - coreW - T : (W - coreW) / 2, cz0 = small ? D - coreD - T : Math.max(4.5, (D - coreD) / 2), cx1 = cx0 + coreW, cz1 = cz0 + coreD;
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
  const stairAt = small ? [[T + 0.1, D - stairD - T]] : [[T + 0.1, (D - stairD) / 2], [W - stairW - T - 0.1, (D - stairD) / 2]];
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
  const parking = kinds[0] === "parking", door = level === 1 ? { x: W / 2, z: 0, w: 3.0 } : null;
  const wallRun = (x0: number, z0: number, x1: number, z1: number) => {
    if (parking || level < 0) { add(x0, z0, x1, z1, 0, H, "concrete"); return; }
    add(x0, z0, x1, z1, 0, level === 1 ? 0.15 : 0.85, "wall"); add(x0, z0, x1, z1, H - 0.5, H, "wall");
    add(x0, z0, x1, z1, level === 1 ? 0.15 : 0.85, H - 0.5, "glass");
    // mullions every 1.5 m
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = along ? x1 - x0 : z1 - z0;
    for (let t = 1.5; t < len; t += 1.5) along ? add(x0 + t - 0.03, z0, x0 + t + 0.03, z1, 0, H, "metal") : add(x0, z0 + t - 0.03, x1, z0 + t + 0.03, 0, H, "metal");
  };
  if (door) { wallRun(0, 0, door.x - door.w / 2, T); wallRun(door.x + door.w / 2, 0, W, T); add(door.x - door.w / 2, 0, door.x + door.w / 2, T, 2.8, H, "glass"); }
  else wallRun(0, 0, W, T);
  wallRun(0, D - T, W, D); wallRun(0, 0, T, D); wallRun(W - T, 0, W, D);

  // ---- the zones: strips across the plate by their areas (the lobby first, by the door)
  const total = kinds.reduce((s, k) => s + uses.get(k)!, 0);
  let x = T;
  kinds.forEach((k, zi) => {
    const share = uses.get(k)! / total, x1 = zi === kinds.length - 1 ? W - T : x + (W - 2 * T) * share;
    if (x1 - x < 3) return;
    const z = { kind: k, label: LABEL[k], rect: [x, T, x1, D - T] as [number, number, number, number] };
    zones.push(z);
    // (between zones: a partition with a door gap)
    if (zi > 0 && !parking) { add(x - 0.05, T, x + 0.05, D * 0.4, 0, H, "wall"); add(x - 0.05, D * 0.4 + 1.6, x + 0.05, D - T, 0, H, "wall"); }
    layZone(z, zi);
    x = x1;
  });

  function blocked(x0: number, z0: number, x1: number, z1: number, pad = 0.6) {
    // (the core with its lift lobby, the stairs and their doors, and the street door's way in kept clear)
    if (x1 > cx0 - pad && x0 < cx1 + pad && z1 > cz0 - 2.4 && z0 < cz1 + 1.2) return true;
    for (const s of stairs) if (x1 > s.x - pad - 1 && x0 < s.x + s.w + pad + 1 && z1 > s.z - pad && z0 < s.z + s.d + pad) return true;
    if (door && x1 > door.x - door.w && x0 < door.x + door.w && z0 < 6) return true;
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
      const rx = (x0 + x1) / 2;
      add(rx - 2.2, 8.0, rx + 2.2, 8.8, 0, 1.05, "counter");
      spots.push({ x: rx - 1, z: 9.3, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: rx + 1, z: 9.3, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
      spots.push({ x: rx - 0.8, z: 7.3, yaw: 0, kind: "wait", y: 0, zone: zi }, { x: rx + 0.6, z: 7.2, yaw: 0, kind: "wait", y: 0, zone: zi });
      for (let g = -2; g <= 2; g++) if (!blocked(rx + g * 1.1 - 0.1, cz0 - 3.4, rx + g * 1.1 + 0.1, cz0 - 2.6, 0)) add(rx + g * 1.1 - 0.12, cz0 - 3.2, rx + g * 1.1 + 0.12, cz0 - 2.6, 0, 1.0, "metal");
      for (const sx of [x0 + 2.5, x1 - 5.5]) if (sx > x0 + 1 && sx + 3 < x1 - 1 && !blocked(sx, 3, sx + 3, 4, 0.2)) {
        add(sx, 3.0, sx + 3.0, 3.9, 0, 0.42, "fabric"); add(sx, 3.6, sx + 3.0, 3.9, 0.42, 0.85, "fabric");
        for (let t = 0.6; t < 3; t += 0.9) spots.push({ x: sx + t, z: 2.7, yaw: 0, kind: "seat", y: 0.42, zone: zi });
        add(sx + 0.6, 4.6, sx + 2.4, 5.4, 0, 0.4, "wood");
      }
      for (const px of [x0 + 1.2, x1 - 1.8]) add(px, 1.0, px + 0.6, 1.6, 0, 1.6, "plant", true);
    } else if (k === "clinic") {
      // reception by the lifts, rows of waiting chairs, consulting rooms along the back wall
      const rx = (x0 + x1) / 2;
      add(rx - 1.8, cz0 - 4.6, rx + 1.8, cz0 - 3.9, 0, 1.05, "counter");
      spots.push({ x: rx - 0.8, z: cz0 - 3.4, yaw: Math.PI, kind: "counter", y: 0, zone: zi }, { x: rx + 0.8, z: cz0 - 3.4, yaw: Math.PI, kind: "counter", y: 0, zone: zi });
      for (let q = 0; q < 4; q++) spots.push({ x: rx + (q - 1.5) * 0.7, z: cz0 - 5.4 - q * 0.05, yaw: 0, kind: "wait", y: 0, zone: zi });
      // waiting rows (front half)
      for (let rz = 2.0; rz < Math.min(cz0 - 6.5, 10); rz += 1.9) {
        for (let cxp = x0 + 1.2; cxp + 0.55 < x1 - 1.2; cxp += 0.6) {
          if (blocked(cxp, rz, cxp + 0.55, rz + 0.6, 0.3)) continue;
          add(cxp, rz, cxp + 0.52, rz + 0.5, 0, 0.45, "fabric"); add(cxp, rz + 0.42, cxp + 0.52, rz + 0.5, 0.45, 0.9, "fabric");
          spots.push({ x: cxp + 0.26, z: rz + 0.18, yaw: Math.PI, kind: "seat", y: 0.45, zone: zi });
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
      const text = z === "clinic" ? "접수 · 수납" : z === "ward" ? "간호사실" : z === "lobby" ? "안내" : z === "retail" ? "계산대" : z === "food" ? "주문 · 픽업" : null;
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
  for (const e of escalators) { const i0 = Math.floor((e.x - 0.8) / CELL), i1 = Math.floor((e.x + e.w + 0.8) / CELL), j0 = Math.floor(Math.min(e.z0, e.z1) / CELL), j1 = Math.floor(Math.max(e.z0, e.z1) / CELL); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && i < nx && j >= 0 && j < nz) free[j * nx + i] = 0; }
  // people: by each zone's use and size
  let crowd = 0;
  for (const z of zones) crowd += ((z.rect[2] - z.rect[0]) * (z.rect[3] - z.rect[1])) / DENSITY[z.kind];
  crowd = Math.round(Math.min(320, Math.max(level < 0 ? 2 : 6, crowd)) * (0.75 + R() * 0.4));
  return { level, label: reg?.label ?? (level < 0 ? `지하${-level}층` : `${level}층`), height, kinds, zones, boxes, spots, lifts, stairs, escalators, decor, grid: { nx, nz, cell: CELL, free }, door, crowd };
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
