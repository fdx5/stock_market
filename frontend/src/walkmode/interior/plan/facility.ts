import type { FacilityKind, FacilityRole, Fixture, FloorPlan, Opening, Room, RoomType, StyleName } from "./types";
import type { RegBuilding, ZoneKind } from "../../building/plan";

/* A floor of a building other than flats — an office, a clinic, a ward, shops, a school, a museum —
 * laid out the way such floors are built in Korea: a core at one end (the lifts, the stair, the
 * toilets), a corridor along the plate, the rooms either side of it on the outside walls with their
 * windows. Its size from the building's footprint, its rooms from the register's use for the floor,
 * named from the businesses registered on it (or a hospital's departments). The same plan the flats
 * use: the same walls, doors, lights and materials build it (build.ts), and facilityFurnish.ts
 * furnishes it. */

export interface FacilityInput {
  /** the building's key (seeds the layout) and its name */
  id: string; name: string;
  kind: FacilityKind; level: number; levelLabel: string; use: string;
  /** the footprint's extent along the street front and back from it (m) */
  width: number; depth: number;
  /** the businesses registered on this floor; a hospital's departments */
  tenants: string[]; departments: string[];
  built?: number | null;
}

/** the register's use of a floor (building/plan.ts kindOf) → what is built on it */
export function facilityKindOf(z: ZoneKind): FacilityKind {
  switch (z) {
    case "office": case "lobby": return "office";
    case "clinic": return "clinic";
    case "ward": return "ward";
    case "retail": return "retail";
    case "food": return "food";
    case "class": return "school";
    case "gym": return "gym";
    case "hotel": case "rooms": return "hotel";
    case "parking": return "parking";
    case "plant": return "plant";
    case "museum": return "museum";
    default: return "civic";
  }
}
/** a building's own name for what it is (the HUD's line) */
export const FACILITY_LABEL: Record<FacilityKind, string> = { office: "업무시설", clinic: "의원·진료", ward: "병동", retail: "판매·근린생활", food: "음식점", school: "교육시설", gym: "운동시설", hotel: "숙박·호실", parking: "주차장", plant: "기계·전기실", civic: "공공·민원", museum: "전시시설" };

const STYLE: Record<FacilityKind, StyleName> = { office: "gray_minimal", clinic: "modern_white", ward: "modern_white", retail: "modern_white", food: "wood_natural", school: "nordic_bright", gym: "gray_minimal", hotel: "hotel_dark", parking: "gray_minimal", plant: "gray_minimal", civic: "modern_white", museum: "hotel_dark" };

type Front = "door" | "glass" | "open";
interface Want { type: RoomType; label: string; w: number; front: Front; grow?: boolean; people?: FacilityRole[] }

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** the rooms a floor of this kind has, in the order they line the corridor */
function program(f: FacilityInput, rnd: () => number): Want[] {
  const t = f.tenants.filter(Boolean), at = (i: number, d: string) => t[i] ?? d;
  const L = f.level, no = (i: number) => `${Math.abs(L)}${String(i + 1).padStart(2, "0")}`;
  switch (f.kind) {
    case "office": {
      const firm = t[0] ? `${t[0]}` : "";
      return [
        { type: "openOffice", label: firm ? `${firm} 사무실` : "사무실", w: 13, front: "glass", grow: true, people: ["desk", "desk", "desk", "desk", "desk", "visitor"] },
        { type: "meeting", label: "대회의실", w: 6.4, front: "glass", people: ["desk", "desk"] },
        { type: "office", label: firm ? "대표이사실" : "임원실", w: 4.8, front: "door", people: ["desk"] },
        { type: "pantry", label: "탕비실", w: 3.6, front: "door", people: [] },
        { type: "meeting", label: "소회의실", w: 4.2, front: "glass", people: [] },
        ...(t[1] ? [{ type: "openOffice" as RoomType, label: `${t[1]} 사무실`, w: 9, front: "glass" as Front, grow: true, people: ["desk", "desk", "desk"] as Want["people"] }] : []),
        { type: "storage", label: "문서고", w: 3, front: "door", people: [] },
      ];
    }
    case "clinic": {
      const deps = f.departments.length ? f.departments : (t.length ? t.map(n => n.replace(/의원$|병원$/, "")) : ["내과", "가정의학과", "이비인후과", "정형외과"]);
      const n = clamp(Math.round(f.width / 7), 2, 4);
      return [
        { type: "waiting", label: t[0] ? `${t[0]} 접수·대기실` : "접수·대기실", w: 8.5, front: "open", grow: true, people: ["clerk", "clerk", "patient", "patient", "patient", "patient"] },
        ...Array.from({ length: n }, (_, i): Want => ({ type: "consult", label: `${deps[i % deps.length]} 제${i + 1}진료실`, w: 3.8, front: "door", people: ["doctor", "patient"] })),
        { type: "treatment", label: "주사·처치실", w: 4.6, front: "door", people: ["nurse"] },
        { type: "treatment", label: rnd() < 0.5 ? "물리치료실" : "검사실", w: 5.2, front: "door", people: ["nurse", "patient"] },
        { type: "staffroom", label: "직원 휴게실", w: 3.4, front: "door", people: [] },
      ];
    }
    case "ward": return [
      { type: "service", label: "간호사 스테이션", w: 6, front: "open", people: ["nurse", "nurse", "doctor"] },
      ...Array.from({ length: clamp(Math.round(f.width / 7.5), 2, 4) }, (_, i): Want => ({ type: "ward", label: `${no(i)}호 병실`, w: 6.2, front: "door", people: ["patient", "patient", "visitor"] })),
      { type: "treatment", label: "처치실", w: 4, front: "door", people: [] },
      { type: "waiting", label: "환자 휴게실", w: 5.2, front: "open", people: ["patient"] },
      { type: "storage", label: "린넨실", w: 3, front: "door", people: [] },
    ];
    case "retail": {
      const names = ["편의점", "약국", "베이커리", "안경원", "꽃집", "휴대폰 매장", "부동산", "세탁소"];
      const shops = Math.max(3, Math.min(6, t.length || Math.round(f.width / 6.5)));
      // (the stock names, shuffled: each once)
      for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
      return Array.from({ length: shops }, (_, i): Want => {
        const name = at(i, names[i % names.length]);
        const cafe = /카페|커피|베이커리|제과|빵|분식|식당|김밥|치킨|음식/.test(name);
        const pharm = /약국/.test(name);
        return { type: cafe ? "cafe" : pharm ? "pharmacy" : "shop", label: name, w: cafe ? 8 : 6, front: "glass", grow: i === 0, people: cafe ? ["clerk", "shopper", "shopper"] : ["clerk", "shopper"] };
      });
    }
    case "food": return [
      { type: "cafe", label: at(0, "카페"), w: 10, front: "open", grow: true, people: ["clerk", "shopper", "shopper", "shopper"] },
      { type: "cafe", label: at(1, "한식당"), w: 9, front: "glass", people: ["cook", "shopper", "shopper"] },
      { type: "cafe", label: at(2, "분식"), w: 6.5, front: "glass", people: ["cook", "shopper"] },
      { type: "storage", label: "식자재 창고", w: 3, front: "door", people: [] },
    ];
    case "school": {
      const acad = t[0] ?? "";
      return [
        { type: "service", label: acad ? `${acad} 안내데스크` : "행정실", w: 5, front: "glass", people: ["clerk"] },
        ...Array.from({ length: clamp(Math.round(f.width / 8), 2, 4) }, (_, i): Want => ({ type: "classroom", label: `강의실 ${i + 1}`, w: 7.2, front: "door", people: ["teacher", "student", "student", "student", "student"] })),
        { type: "staffroom", label: "교무실", w: 5.2, front: "door", people: ["teacher"] },
        { type: "classroom", label: "자습실", w: 6, front: "door", grow: true, people: ["student", "student"] },
        { type: "meeting", label: "상담실", w: 3.6, front: "door", people: [] },
      ];
    }
    case "gym": return [
      { type: "service", label: at(0, "피트니스") + " 안내", w: 4.6, front: "glass", people: ["clerk"] },
      { type: "gym", label: at(0, "피트니스") + " 운동실", w: 16, front: "glass", grow: true, people: ["visitor", "visitor", "visitor", "visitor", "teacher"] },
      { type: "staffroom", label: "탈의실", w: 4.4, front: "door", people: [] },
      { type: "gym", label: "GX룸", w: 8, front: "glass", people: ["teacher", "visitor"] },
    ];
    case "hotel": return [
      { type: "service", label: "프런트", w: 5.4, front: "open", people: ["clerk"] },
      ...Array.from({ length: clamp(Math.round(f.width / 4.4), 3, 7) }, (_, i): Want => ({ type: "guest", label: `${no(i)}호`, w: 4.2, front: "door", people: i % 3 === 0 ? ["guest"] : [] })),
      { type: "storage", label: "린넨실", w: 2.8, front: "door", people: [] },
    ];
    case "museum": return [
      { type: "gallery", label: "제1전시실", w: 12, front: "open", grow: true, people: ["visitor", "visitor", "visitor", "guard"] },
      { type: "gallery", label: "제2전시실", w: 9, front: "open", people: ["visitor", "visitor"] },
      { type: "shop", label: "아트숍", w: 6, front: "glass", people: ["clerk", "shopper"] },
      { type: "cafe", label: "카페", w: 7, front: "open", people: ["clerk", "shopper"] },
      { type: "storage", label: "수장고", w: 3.4, front: "door", people: [] },
    ];
    case "plant": return [
      { type: "plant", label: "기계실", w: 10, front: "door", grow: true, people: ["guard"] },
      { type: "plant", label: "전기실", w: 7, front: "door", people: [] },
      { type: "plant", label: "저수조실", w: 7, front: "door", people: [] },
      { type: "storage", label: "방재실", w: 4.5, front: "door", people: ["guard"] },
    ];
    case "parking": return [];
    default: return [
      { type: "service", label: t[0] ? `${t[0]} 민원실` : "민원실", w: 13, front: "open", grow: true, people: ["clerk", "clerk", "clerk", "visitor", "visitor", "visitor"] },
      { type: "openOffice", label: "사무실", w: 9, front: "glass", people: ["desk", "desk", "desk"] },
      { type: "meeting", label: "상담실", w: 4, front: "door", people: ["clerk"] },
      { type: "office", label: "과장실", w: 4.2, front: "door", people: ["desk"] },
      { type: "pantry", label: "탕비실", w: 3.2, front: "door", people: [] },
      { type: "storage", label: "기록물 보관실", w: 3.2, front: "door", people: [] },
    ];
  }
}

export function generateFacility(f: FacilityInput): FloorPlan {
  const rnd = rng(`${f.id}|${f.level}|${f.kind}`);
  // the plate: the footprint, kept within what a walk round takes (and the lights the scene has)
  const W = r1(clamp(f.width || 24, 18, 40)), D = r1(clamp(f.depth || 16, 13.5, 21));
  const cw = f.kind === "ward" || f.kind === "clinic" ? 2.6 : f.kind === "retail" || f.kind === "museum" || f.kind === "food" ? 3.2 : 2.3;
  const a = r1((D - cw) / 2), b = r1(a + cw);
  const C = 6.4, half = 3.2, stairW = 2.8;
  const rooms: Room[] = [], openings: Opening[] = [], fixtures: Fixture[] = [];
  const people: NonNullable<FloorPlan["facility"]>["people"] = [];
  const add = (id: string, type: RoomType, label: string, rect: [number, number, number, number], zone = id) => { const r: Room = { id, type, label, rect: rect.map(r1) as Room["rect"], zone }; rooms.push(r); return r; };
  const door = (a: string, b: string, axis: "x" | "z", at: number, center: number, width = 0.95, hinge: "start" | "end" = "start", swingInto = a): Opening =>
    ({ type: "door", a, b, axis, at, center: r1(center), width, height: 2.1, sill: 0, hinge, swingInto });
  const glass = (a: string, b: string, axis: "x" | "z", at: number, center: number, width = 1.8): Opening => ({ type: "glass_door", a, b, axis, at, center: r1(center), width, height: 2.3, sill: 0 });
  const open = (a: string, b: string, axis: "x" | "z", at: number, center: number, width: number): Opening => ({ type: "open", a, b, axis, at, center: r1(center), width: r1(width), height: 2.45, sill: 0 });
  const win = (a: string, axis: "x" | "z", at: number, center: number, width: number, sill = 0.75, height = 1.75): Opening => ({ type: "window", a, b: "out", axis, at, center: r1(center), width: r1(width), height, sill });
  const ground = f.level === 1, parking = f.kind === "parking";

  // ------------------------------------------------ the core: lifts, stair, toilets; the corridor
  add("corridor", "corridor", "복도", [0, a, W, b]);
  add("stair", "stair", "계단실", [0, b, stairW, D]);
  add("lifthall", "liftHall", "엘리베이터 홀", [stairW, b, C, D]);
  openings.push(open("lifthall", "corridor", "z", b, (stairW + C) / 2, C - stairW - 0.4));
  openings.push(door("stair", "lifthall", "x", stairW, b + 1.4, 0.95, "start", "stair"));
  const lifts: NonNullable<FloorPlan["facility"]>["lifts"] = [];
  // (two cars side by side on the hall's back wall, facing the corridor)
  const lw = C - stairW;
  for (const k of lw > 3.2 ? [0.27, 0.73] : [0.5]) lifts.push({ x: r1(stairW + lw * k), z: D, yaw: Math.PI });
  if (parking) {
    add("wc_m", "storage", "전기실", [0, 0, C, a]);
    openings.push(door("wc_m", "corridor", "z", a, half, 0.95, "end", "wc_m"));
  } else {
    add("wc_m", "restroom", "남자 화장실", [0, 0, half, a]);
    add("wc_f", "restroom", "여자 화장실", [half, 0, C, a]);
    openings.push(door("wc_m", "corridor", "z", a, half - 0.8, 0.9, "end", "wc_m"), door("wc_f", "corridor", "z", a, half + 0.8, 0.9, "start", "wc_f"));
  }

  // ------------------------------------------------ the ground floor's lobby and front door
  let northFrom = C, startAt: [number, number, number] = [(stairW + C) / 2, D - 1.6, 0];
  const lobbyKinds = new Set<FacilityKind>(["office", "clinic", "ward", "school", "civic", "hotel", "museum", "gym"]);
  if (ground && lobbyKinds.has(f.kind)) {
    const Lw = r1(clamp(W * 0.32, 7.5, 11));
    add("lobby", "lobby", `${f.name} 로비`, [C, 0, C + Lw, a]);
    openings.push(open("lobby", "corridor", "z", a, C + Lw / 2, Lw - 1.2));
    openings.push({ type: "front_door", a: "lobby", b: "out", axis: "z", at: 0, center: r1(C + Lw / 2), width: 1.8, height: 2.4, sill: 0, hinge: "start", swingInto: "out" });
    for (const s of [-1, 1]) openings.push(win("lobby", "z", 0, C + Lw / 2 + s * (Lw / 4 + 0.5), Lw / 2 - 2.2, 0.15, 2.45));
    people.push({ room: "lobby", role: "guard" }, { room: "lobby", role: "visitor" });
    northFrom = C + Lw;
    startAt = [C + Lw / 2, 1.1, Math.PI];
  } else if (ground && parking) {
    // (the deck's way out: the ramp's door on the street end)
    openings.push({ type: "front_door", a: "park", b: "out", axis: "x", at: W, center: r1(D / 2), width: 1.8, height: 2.4, sill: 0, hinge: "start", swingInto: "out" });
    startAt = [W - 1.4, D / 2, Math.PI / 2];
  } else if (ground) {
    // (shops and restaurants at street level: the way in by the corridor's street end)
    openings.push({ type: "front_door", a: "corridor", b: "out", axis: "x", at: W, center: r1((a + b) / 2), width: Math.min(1.8, cw - 0.4), height: 2.4, sill: 0, hinge: "start", swingInto: "out" });
    startAt = [W - 1.2, (a + b) / 2, Math.PI / 2];
  }

  // ------------------------------------------------ the rooms either side of the corridor
  if (parking) {
    add("park", "parking", `${f.levelLabel} 주차장`, [C, 0, W, D]);
    // (the corridor ends at the core: the deck opens from it)
    rooms[0].rect = [0, a, C, b];
    openings.push(open("park", "corridor", "x", C, (a + b) / 2, cw - 0.3));
    people.push({ room: "park", role: "visitor" }, { room: "park", role: "guard" });
  } else {
    const want = program(f, rnd);
    // north band from northFrom to W, south band from C to W: the program dealt out in turn, the
    // biggest rooms first on the longer band
    const bands = [{ side: "n" as const, x0: northFrom, x1: W, list: [] as Want[] }, { side: "s" as const, x0: C, x1: W, list: [] as Want[] }];
    const room = (bd: (typeof bands)[number]) => bd.list.reduce((t, w) => t + w.w, 0);
    for (const w of want) {
      const bd = bands.slice().sort((p, q) => (p.x1 - p.x0 - room(p)) - (q.x1 - q.x0 - room(q))).pop()!;
      if (room(bd) + Math.min(w.w, 3) > bd.x1 - bd.x0 + 0.01) continue;
      bd.list.push(w);
    }
    for (const bd of bands) {
      const len = bd.x1 - bd.x0, sum = room(bd);
      if (!bd.list.length || len < 2.5) continue;
      // (the widths scaled to fill the band; what is left over to the rooms that grow)
      const growers = bd.list.filter(w => w.grow), spare = len - sum;
      const widths = bd.list.map(w => spare >= 0 ? w.w + (growers.length ? (w.grow ? spare / growers.length : 0) : spare / bd.list.length) : w.w * len / sum);
      let x = bd.x0;
      bd.list.forEach((w, i) => {
        const x1 = i === bd.list.length - 1 ? bd.x1 : r1(x + widths[i]);
        if (x1 - x < 2.4) { x = x1; return; }
        const id = `${bd.side}${i}`, z0 = bd.side === "n" ? 0 : b, z1 = bd.side === "n" ? a : D, edge = bd.side === "n" ? a : b;
        add(id, w.type, w.label, [x, z0, x1, z1]);
        const mid = (x + x1) / 2, rw = x1 - x;
        // its way in from the corridor: a door near one end (the room's own wall left whole), a glass
        // front's double door in the middle, an open front most of its width
        if (w.front === "open") openings.push(open(id, "corridor", "z", edge, mid, Math.min(rw - 1.2, Math.max(2.4, rw * 0.6))));
        else if (w.front === "glass") openings.push(glass(id, "corridor", "z", edge, mid, rw > 5 ? 1.8 : 1.5));
        else openings.push(door(id, "corridor", "z", edge, x + Math.min(1.0, rw / 2), 0.95, "start", id));
        // windows on the outside wall: one long band (two on a wide room) — the scene's lights are few
        const ext = bd.side === "n" ? 0 : D;
        if (w.type !== "storage" && w.type !== "plant" && w.type !== "stair" && f.level > 0) {
          if (rw > 9.5) { for (const s of [-1, 1]) openings.push(win(id, "z", ext, mid + s * rw / 4, rw / 2 - 1.1)) }
          else { openings.push(win(id, "z", ext, mid, Math.max(1.2, rw - 1.4))) }
        }
        for (const role of w.people ?? []) people.push({ room: id, role });
        x = x1;
      });
    }
    // the corridor's far end: a window on the street side if it is a dead end
    if (f.level > 0 && !openings.some(o => o.b === "out" && o.a === "corridor")) openings.push(win("corridor", "x", W, (a + b) / 2, cw - 0.8, 0.9, 1.5));
  }
  people.push({ room: "corridor", role: "visitor" }, { room: "corridor", role: parking ? "guard" : "visitor" });

  // (each room and each window is an area light in the scene, which has 28: the narrowest windows go
  // first — a wide room's pair becomes its one band — until they fit)
  const LIGHTS = 27;
  for (;;) {
    const wins = openings.filter(o => o.type === "window");
    if (rooms.length + wins.length <= LIGHTS || !wins.length) break;
    const pair = wins.find(o => wins.some(p => p !== o && p.a === o.a && p.at === o.at));
    if (pair) {
      const twin = wins.find(p => p !== pair && p.a === pair.a && p.at === pair.at)!;
      const lo = Math.min(pair.center - pair.width / 2, twin.center - twin.width / 2), hi = Math.max(pair.center + pair.width / 2, twin.center + twin.width / 2);
      openings.splice(openings.indexOf(twin), 1); pair.center = r1((lo + hi) / 2); pair.width = r1(hi - lo); continue;
    }
    openings.splice(openings.indexOf(wins.sort((p, q) => p.width - q.width)[0]), 1);
  }

  // ------------------------------------------------ switches by the doors (work rooms and toilets)
  for (const r of rooms) {
    if (r.type === "corridor" || r.type === "liftHall" || r.type === "lobby" || r.type === "parking") continue;
    const d = openings.find(o => (o.a === r.id || o.b === r.id) && o.b !== "out" && o.type !== "window");
    if (!d || d.axis !== "z") continue;
    const [x0, z0, x1, z1] = r.rect;
    const inward = Math.abs(d.at - z0) < Math.abs(d.at - z1) ? 1 : -1;
    const along = clamp(d.center + (d.hinge === "end" ? -1 : 1) * (d.width / 2 + 0.22), x0 + 0.15, x1 - 0.15);
    fixtures.push({ type: "switch", pos: [along, d.at + inward * 0.001], rot: inward > 0 ? 0 : 180, room: r.id });
  }

  const area = rooms.reduce((t, r) => t + (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]), 0);
  return {
    complexId: f.id, complexName: f.name, dong: "", unitType: FACILITY_LABEL[f.kind], areaExclusiveM2: Math.round(area), ceilingHeightM: f.kind === "parking" || f.kind === "plant" ? 3.0 : 2.75,
    source: "estimated_template", template: `${FACILITY_LABEL[f.kind]} 표준 평면 (코어·중복도)`,
    basis: { area: "건물 외곽 실측", rooms: f.use ? `건축물대장 층별 용도: ${f.use}` : "건축물대장 용도", built: f.built ?? null },
    bounds: [0, 0, W, D], rooms, openings, fixtures,
    check: { areaM2: Math.round(area), error: 0 },
    style: STYLE[f.kind], floor: Math.max(1, f.level),
    facility: { kind: f.kind, name: f.name, level: f.level, levelLabel: f.levelLabel, use: f.use, start: startAt, lifts, people },
  };
}

/** the building's register → what its lift panel lists: each floor, what it is */
export function facilityLevels(levels: number[], regFloors: { level: number; label: string; uses: { use: string; detail: string }[] }[]): { level: number; label: string; uses: string }[] {
  return levels.map(l => {
    const r = regFloors.find(f => f.level === l);
    return { level: l, label: r?.label ?? (l < 0 ? `지하 ${-l}층` : `${l}층`), uses: r ? [...new Set(r.uses.map(u => u.detail || u.use).filter(Boolean))].slice(0, 3).join(", ") : "" };
  });
}
export type { RegBuilding };
