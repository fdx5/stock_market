import * as THREE from "three";
import { HALF_WALL, type Seg } from "./build";
import type { Batcher } from "./geom";
import { boxUV } from "./geom";
import type { Palette } from "./materials";
import * as M from "./models";
import * as F from "./facilityModels";
import type { Extra } from "./facilityModels";
import type { Frame, Furnished, Interactable, Placer, Rect, SideName } from "./furnish";
import type { FloorPlan, Opening, Room } from "./plan/types";
import type { SignAtlas, SignStyle } from "./facilitySigns";

/* Furnishing a building's rooms by their use (plan/facility.ts): a desk pod for a team, a doctor's
 * desk and couch, cubicles and basins in the toilets, shelving in a shop, a counter and waiting seats
 * in a 민원실, the lift doors in the hall — each against the walls that suit it, the ways through
 * kept clear. Where people would be (a chair at a desk, behind a counter, on a bench) is noted for
 * the people who are put there (facilityPeople.ts). */

export interface Spot { room: Room; x: number; z: number; /** the way the person faces (radians, as Object3D.rotation.y) */ face: number; pose: "sit" | "stand" | "lie"; y?: number; kind: "desk" | "counter" | "seat" | "bed" | "stand" | "doctor" }
export interface FacilityHooks {
  /** the lift called: the floor panel opened */
  lift?(): void;
  /** the floors for the directory: label and what is on it */
  levels?: { level: number; label: string; uses: string }[];
  /** (the directory is put once a floor) */
  directoryPut?: boolean;
}
export interface FacCtx {
  plan: FloorPlan; P: Palette; X: Extra; signs: SignAtlas; B: Batcher; dynamic: THREE.Group; H: number;
  put(kit: M.Kit, f: Frame | THREE.Matrix4, zone: number, solid?: boolean): void;
  hitIn(f: Frame | THREE.Matrix4, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh;
  local(f: Frame, x: number, y: number, z: number): THREE.Vector3;
  interactables: Interactable[]; seats: Furnished["seats"]; colliders: Seg[]; mirrors: Furnished["mirrors"];
  faucet(room: Room, zone: number, spout: THREE.Vector3, bottom: number, label: string, kind: "basin" | "sink" | "tub" | "shower", poolR?: number, poolMax?: number): void;
  spots: Spot[]; hooks: FacilityHooks; zoneOf(r: Room): number;
  /** things made here to free with the interior */
  own<T extends { dispose(): void }>(x: T): T;
}

const opposite: Record<SideName, SideName> = { n: "s", s: "n", w: "e", e: "w" };
/** a side's facing into the room, as a rotation */
const FACE: Record<SideName, number> = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };
const dirOf = (a: number) => [Math.sin(a), Math.cos(a)] as const;

export function furnishFacilityRoom(c: FacCtx, room: Room, pl: Placer) {
  const { P, X, H } = c, zone = c.zoneOf(room);
  const sides: SideName[] = ["n", "s", "w", "e"];
  // (its way in from a public space — a corridor, a hall, the lobby — not the open walls joining a
  // room's own parts)
  const pub = (id: string) => { const r = c.plan.rooms.find(q => q.id === id); return !!r && (r.type === "corridor" || r.type === "lobby" || r.type === "liftHall") && !(r.type === room.type && r.label === room.label); };
  const ways = c.plan.openings.filter(o => o.type !== "window" && o.b !== "out" && ((o.a === room.id && pub(o.b)) || (o.b === room.id && pub(o.a))));
  const corridorOp = ways.find(o => o.type !== "open") ?? ways[0];
  const doorSide: SideName = (corridorOp && pl.sideOf(corridorOp.axis, corridorOp.at)) || "s";
  const winSide = sides.find(s => pl.windowsOn(s).length) ?? opposite[doorSide];
  const solidSides = sides.filter(s => pl.openingsOn(s).length === 0);
  const [X0, Z0, X1, Z1] = [pl.X0, pl.Z0, pl.X1, pl.Z1], W = X1 - X0, D = Z1 - Z0, cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  const sideW = (["w", "e"] as SideName[]).filter(s => solidSides.includes(s));
  /** a free-standing piece centred at (x, z) turned by `yaw` (quarter turns), w × d before turning */
  const freeAt = (x: number, z: number, w: number, d: number, yaw = 0, take = true): Frame | null => {
    const q = Math.round(yaw / (Math.PI / 2)) & 1, hw = (q ? d : w) / 2, hd = (q ? w : d) / 2;
    const rect: Rect = [x - hw, z - hd, x + hw, z + hd];
    if (!pl.free(rect)) return null;
    if (take) pl.take(rect);
    return { m: new THREE.Matrix4().makeRotationY(yaw).setPosition(x, pl.fy, z), rect };
  };
  const wallPut = (s: SideName, kit: M.Kit, w: number, d: number, prefer: number | null = null, height = 0.8, solid = true, clear = 0) => {
    const f = pl.against(s, w, d, prefer, height, clear);
    if (!f) { for (const p of kit) p.g.dispose(); return null; }
    c.put(kit, f, zone, solid); pl.take(f.rect);
    return f;
  };
  /** a wall piece's middle along its wall */
  const uOf = (f: Frame, s: SideName) => s === "w" || s === "e" ? (f.rect[1] + f.rect[3]) / 2 : (f.rect[0] + f.rect[2]) / 2;
  const at = (f: Frame | THREE.Matrix4, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(f instanceof THREE.Matrix4 ? f : f.m);
  const yawOf = (f: Frame | THREE.Matrix4, local = 0) => { const m = f instanceof THREE.Matrix4 ? f : f.m; const d = new THREE.Vector3(Math.sin(local), 0, Math.cos(local)).transformDirection(m); return Math.atan2(d.x, d.z); };
  /** a seat the visitor can take (its look: the facing) */
  const seat = (label: string, p: THREE.Vector3, face: number, w = 0.5) => {
    const [dx, dz] = dirOf(face);
    c.seats.push({ label, eye: new THREE.Vector3(p.x, pl.fy + 1.15, p.z), yaw: Math.atan2(-dx, -dz), pose: "sit", hit: hitBoxAt(c, w, 0.5, w, new THREE.Vector3(p.x, pl.fy + 0.45, p.z)), zone, room });
  };
  const spot = (p: THREE.Vector3, face: number, pose: Spot["pose"], kind: Spot["kind"], y?: number) => {
    // (someone seated behind a counter has a chair)
    if (pose === "sit" && kind === "counter") c.put(F.taskChair(P, X), new THREE.Matrix4().makeRotationY(face).setPosition(p.x, pl.fy, p.z), zone, false);
    c.spots.push({ room, x: p.x, z: p.z, face, pose, kind, y });
  };
  const plant = (s: SideName | null, h = 1.4) => {
    const corners: [number, number][] = [[X0 + 0.35, Z0 + 0.35], [X1 - 0.35, Z0 + 0.35], [X0 + 0.35, Z1 - 0.35], [X1 - 0.35, Z1 - 0.35]];
    for (const [x, z] of corners) { const f = freeAt(x, z, 0.5, 0.5); if (f) { c.put(M.plant(P, h, Math.round(x * 7 + z * 3)), f, zone, true); return; } }
    void s;
  };
  const tvOn = (s: SideName, w = 1.2) => {
    const f = pl.frameAt(s, s === "n" || s === "s" ? cx : cz, w, 0.05);
    c.put(M.tvFrame(P, w, w * 0.5625), new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 1.85, 0.01)), zone, false);
    c.put([F.moved([M.bx(X.monitor, w - 0.04, w * 0.5625 - 0.04, 0.002, 0, 0, 0)], 0, 0.036, 0, 1.85)].flat(), f.m, zone, false);
  };
  const signOn = (s: SideName, style: SignStyle, lines: string[], w: number, h: number, u: number, y: number) => {
    const f = pl.frameAt(s, u, w, 0.02);
    const g = c.signs.sign(style, lines, w, h);
    c.B.add(c.signs.material, zone, g, new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, y, 0.012)), false); g.dispose();
  };
  /** desk + chair against a wall, the sitter's spot (facing the wall) */
  const deskOn = (s: SideName, w = 1.4, monitors = 1, sitLabel?: string) => {
    const f = pl.against(s, w, 1.45, null, 0.8);
    if (!f) return null;
    c.put(F.officeDesk(P, X, w, 0.7, monitors), f, zone, false);
    c.colliders.push(...rectSegs(rectOf(f, w, 0.72)));
    pl.take(f.rect);
    const chair = new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, 1.05));
    c.put(F.taskChair(P, X), chair, zone, false);
    const p = at(f, 0, 0, 1.05);
    if (sitLabel) seat(sitLabel, p, yawOf(f, Math.PI));
    else spot(p, yawOf(f, Math.PI), "sit", "desk");
    return f;
  };

  // -------------------------------------------- lift doors on this room's walls, their call buttons; the floor directory by them
  const myLifts = (c.plan.facility?.lifts ?? []).filter(L => L.room === room.id);
  for (const L of myLifts) {
    const f = pl.frameAt(L.side, L.u, 1.5, 0.15);
    c.put(F.liftDoor(P), f, zone, false);
    const hit = c.hitIn(f, 1.2, 2.2, 0.4, 0, 1.1, 0.2);
    c.interactables.push({ id: `lift-${room.id}-${L.u}`, zone, room, hit, label: () => "엘리베이터 타기 · 층 선택", act: () => { c.hooks.lift?.(); return "beep"; } });
    signOn(L.side, "lift", [`${c.plan.facility?.levelLabel ?? ""}`], 0.46, 0.12, L.u, 2.45);
    pl.take(f.rect);
  }
  if (myLifts.length && !c.hooks.directoryPut) {
    const lv = c.hooks.levels ?? [], s = (["e", "w", "n", "s"] as SideName[]).find(q => q !== myLifts[0].side && pl.openingsOn(q).length === 0 && pl.len(q) > 1.4);
    if (lv.length && s) {
      const rows = [...lv].reverse().slice(0, 14);
      signOn(s, "directory", [`${c.plan.facility?.name ?? ""} 층별 안내`, ...rows.map(l => `${l.label}\t${l.uses || "—"}`)], 1.0, 0.25 + rows.length * 0.09, s === "w" || s === "e" ? cz : cx, 1.55);
      c.hooks.directoryPut = true;
    }
  }

  switch (room.type) {
    case "liftHall": {
      plant(null, 1.2);
      break;
    }
    // -------------------------------------------- the stair: two flights in the well, the exit sign over its door
    case "stair": {
      const z0 = Z0 + 1.9, d = Z1 - z0;
      if (d > 2.2) { c.put(F.stairs(P, X, W, d, H), new THREE.Matrix4().makeTranslation(cx, pl.fy, z0), zone, false); c.colliders.push(...rectSegs([X0, z0, X1, Z1])); }
      break;
    }
    // -------------------------------------------- toilets
    case "restroom": {
      const men = /남/.test(room.label), back = opposite[doorSide];
      const n = Math.max(1, Math.min(4, Math.floor((pl.len(back) - 0.1) / 0.95)));
      const cub = pl.against(back, n * 0.95, 1.6, null, 3);
      if (cub) {
        for (let i = 0; i < n; i++) {
          const m = new THREE.Matrix4().multiplyMatrices(cub.m, new THREE.Matrix4().makeTranslation(-n * 0.95 / 2 + 0.475 + i * 0.95, 0, 0));
          c.put(F.cubicle(X), m, zone, false);
          c.put(M.toilet(P), new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0, 0.02)), zone, false);
        }
        pl.take(cub.rect);
        // (the cubicles' walls block; their open doors let in)
        const r = cub.rect; c.colliders.push(...rectSegs(r).filter((_, k) => k !== ({ n: 2, s: 0, w: 1, e: 3 } as Record<SideName, number>)[back]));
      }
      const [sa, sb] = (["w", "e"] as SideName[]);
      const basinSide = men ? sa : sb, other = men ? sb : sa;
      const bw = Math.min(2.2, pl.len(basinSide) - 2.4);
      if (bw > 0.9) {
        const nb = bw > 1.6 ? 2 : 1;
        const f = pl.against(basinSide, bw, 0.6, null, 3);
        if (f) {
          c.put(F.basinCounter(P, X, bw, nb), f, zone, true); pl.take(f.rect);
          for (let i = 0; i < nb; i++) { const x = -bw / 2 + (bw / nb) * (i + 0.5); c.faucet(room, zone, at(f, x, 1.04, 0.2), pl.fy + 0.88, "세면대 수전", "basin", 0.1, 0.012); }
          const mc = at(f, 0, 1.55, 0.012), mn = at(f, 0, 1.55, 1.012).sub(mc).normalize();
          c.mirrors.push({ pos: mc, normal: mn, w: bw - 0.02, h: 0.93, zone });
        }
      }
      if (men) { for (let i = 0; i < 2; i++) wallPut(other, F.urinal(P, X), 0.8, 0.45, null, 3); }
      break;
    }
    // -------------------------------------------- the lobby: the desk, a lounge, the directory, the building's name
    case "lobby": {
      const s: SideName = "w";
      const f = pl.against(s, Math.min(3.2, pl.len(s) - 1.2), 2.25, null, 3);
      if (f) {
        const w = Math.min(3.2, pl.len(s) - 1.2);
        c.put(F.reception(P, X, w), f, zone, false); pl.take(f.rect); c.colliders.push(...rectSegs(f.rect));
        spot(at(f, -w / 4, 0, 0.95), yawOf(f), "stand", "counter");
        signOn(s, "brand", [c.plan.facility?.name ?? ""], Math.min(2.8, w), 0.42, uOf(f, s), 1.95);
      }
      const so = pl.against("e", 2.3, 0.98, null, 3);
      if (so) {
        c.put(M.sofa(P, 2.3), so, zone, true); pl.take(so.rect);
        seat("소파에 앉기", at(so, 0, 0, 0.55), yawOf(so));
        const t = freeAt(at(so, 0, 0, 1.55).x, at(so, 0, 0, 1.55).z, 1.1, 0.6, yawOf(so));
        if (t) c.put(M.coffeeTable(P), t, zone, true);
      }
      plant(null, 1.6); plant(null, 1.3);
      break;
    }
    // -------------------------------------------- corridors: the exit signs, a hydrant cabinet, a water purifier
    case "corridor": {
      // (a hall's open floor: islands every ~7 m — benches round planters, an information kiosk, a
      // column, a seating group — kept off the ways along it)
      if (W * D > 60 && Math.min(W, D) > 5.5) {
        let n = room.id.length + Math.round(cx * 3 + cz * 7);
        for (let x = X0 + 3.2; x < X1 - 3; x += 7) for (let z = Z0 + 3.2; z < Z1 - 3; z += 7) {
          const kind = (n++) % 4;
          if (kind === 0) { const f = freeAt(x, z, 2.4, 2.4); if (f) { c.put([M.rb(P.woodLight, 2.4, 0.45, 2.4, 0.04, 0, 0.225, 0), M.rb(P.counter, 1.4, 0.5, 1.4, 0.03, 0, 0.25, 0), ...M.plant(P, 1.7, n)], f.m, zone, true); c.colliders.push(...rectSegs(f.rect)); seat("벤치에 앉기", new THREE.Vector3(x, 0, z + 1.0), 0, 0.8); spot(new THREE.Vector3(x - 0.9, 0, z - 1.0), Math.PI, "sit", "seat"); } }
          else if (kind === 1) { const f = freeAt(x, z, 0.8, 0.5); if (f) { c.put([M.rb(X.accentDark, 0.7, 1.9, 0.4, 0.05, 0, 0.95, 0), M.bx(X.monitor, 0.56, 0.9, 0.01, 0, 1.25, 0.205)], f.m, zone, true); const g = c.signs.sign("plate", ["층별 안내", c.plan.facility?.levelLabel ?? ""], 0.56, 0.2); c.B.add(c.signs.material, zone, g, new THREE.Matrix4().makeTranslation(x, pl.fy + 1.82, z + 0.206), false); g.dispose(); } }
          else if (kind === 2) { const f = freeAt(x, z, 0.8, 0.8); if (f) c.put([M.cy(P.trim, 0.38, 0.38, H, 0, H / 2, 0, 32), M.cy(P.steel, 0.4, 0.4, 0.12, 0, 0.06, 0, 32)], f.m, zone, true); }
          else { const f = freeAt(x, z, 3.0, 2.2); if (f) { c.put([...F.moved(M.sofa(P, 2.0), 0, -1.0), ...F.moved(M.coffeeTable(P), 0, 0.2)], f.m, zone, true); c.colliders.push(...rectSegs(f.rect)); spot(new THREE.Vector3(x + 0.5, 0, z - 0.5), 0, "sit", "seat"); } }
        }
      }
      // (a short piece of a hall: nothing on its walls)
      if (Math.max(W, D) < 7) break;
      const along: SideName[] = W > D ? ["n", "s"] : ["w", "e"];
      // (ceiling-hung exit signs at the ends)
      // (they face down the corridor, both ways)
      const lng = W > D;
      for (const u of lng ? [X0 + 1.2, X1 - 1.2] : [Z0 + 1.2, Z1 - 1.2]) {
        const g = c.signs.sign("exit", [], 0.5, 0.17), px = lng ? u : cx, pz = lng ? cz : u;
        for (const k of [0, 1]) { const yaw = (lng ? Math.PI / 2 : 0) + k * Math.PI, [fx, fz] = dirOf(yaw); c.B.add(c.signs.material, zone, g.clone(), new THREE.Matrix4().makeRotationY(yaw).setPosition(px + fx * 0.012, H - 0.2, pz + fz * 0.012), false); }
        c.put([M.bx(P.steel, 0.02, 0.1, 0.02, 0, H - 0.05, 0), M.bx(P.steel, lng ? 0.05 : 0.52, 0.02, lng ? 0.52 : 0.05, 0, H - 0.1, 0)], new THREE.Matrix4().makeTranslation(px, 0, pz), zone, false);
        g.dispose();
      }
      // the hydrant cabinet (red, 소화전) on a blank stretch, a purifier further along
      const hyd = pl.against(along[0], 0.75, 0.2, X0 + W * 0.45, 3);
      if (hyd) { c.put([M.rb(X.tail, 0.75, 1.2, 0.18, 0.01, 0, 1.0, 0.09), M.bx(P.steel, 0.6, 0.02, 0.02, 0, 1.45, 0.19)], hyd, zone, true); pl.take(hyd.rect); }
      const pur = pl.against(along[1], 0.36, 0.42, X0 + W * 0.6, 3);
      if (pur) { c.put([M.rb(P.appliance, 0.32, 1.2, 0.38, 0.03, 0, 0.6, 0.19), M.bx(P.applianceDark, 0.26, 0.2, 0.02, 0, 1.0, 0.385), M.cy(P.chrome, 0.012, 0.012, 0.05, 0, 0.92, 0.36, 8)], pur, zone, true); pl.take(pur.rect); }
      // a clinic's or a ward's corridor: seats along the wall between the doors
      if (c.plan.facility?.kind === "clinic" || c.plan.facility?.kind === "ward" || c.plan.facility?.kind === "civic") {
        for (let i = 0; i < 4; i++) { const f = wallPut(along[i % 2], F.moved(F.beamSeats(P, X, 3), 0, 0.3), 1.75, 0.6, X0 + W * (0.3 + i * 0.15), 3); if (f) spot(at(f, -0.56, 0, 0.38), yawOf(f), "sit", "seat"); }
      }
      break;
    }
    // -------------------------------------------- offices
    case "openOffice": {
      // rows of desk pods along the room, aisles round them; storage along a side wall
      const s0 = sideW[0];
      if (s0) wallPut(s0, F.cabinets(P, Math.min(pl.len(s0) - 1.6, 3.6)), Math.min(pl.len(s0) - 1.6, 3.6), 0.47, null, 1.3);
      const doorZ = doorSide === "n" ? Z0 + 1.6 : doorSide === "s" ? Z1 - 1.6 : null;
      const za = doorSide === "n" ? Z0 + 1.7 : Z0 + 0.9, zb = doorSide === "s" ? Z1 - 1.7 : Z1 - 0.9;
      const rows = Math.max(1, Math.floor((zb - za + 1.3) / (2.9 + 1.3)));
      const xa = X0 + 1.1 + (s0 === "w" ? 0.5 : 0), xb = X1 - 1.1 - (s0 === "e" ? 0.5 : 0);
      const run = xb - xa, perPod = run > 9.5 ? Math.floor((run - 1.4) / 2 / 1.4) : Math.floor(run / 1.4);
      const pods = run > 9.5 ? 2 : 1;
      void doorZ;
      let sat = false;
      for (let r = 0; r < rows; r++) {
        const z = za + 1.45 + r * (2.9 + 1.3) + ((zb - za) - rows * 2.9 - (rows - 1) * 1.3) / 2;
        for (let k = 0; k < pods; k++) {
          const n = Math.max(1, Math.min(6, perPod)), len = n * 1.4;
          const x = pods === 1 ? (xa + xb) / 2 : k === 0 ? xa + len / 2 : xb - len / 2;
          const f = freeAt(x, z, len, 2.9);
          if (!f) continue;
          c.put(F.deskPod(P, X, n), f.m, zone, false);
          c.colliders.push(...rectSegs([x - len / 2, z - 0.73, x + len / 2, z + 0.73]));
          for (let i = 0; i < n; i++) for (const sgn of [-1, 1]) {
            const dx = (i - (n - 1) / 2) * 1.4, cz2 = z + sgn * 1.07;
            c.put(F.taskChair(P, X), new THREE.Matrix4().makeRotationY(sgn > 0 ? Math.PI : 0).setPosition(x + dx, pl.fy, cz2), zone, false);
            const face = sgn > 0 ? Math.PI : 0, p = new THREE.Vector3(x + dx, 0, cz2);
            if (!sat && r === 0 && i === 0) { seat("의자에 앉기", p, face); sat = true; } else spot(p, face, "sit", "desk");
          }
        }
      }
      plant(null, 1.5); plant(null, 1.2);
      // (a printer by the door)
      const pr = pl.against(doorSide, 0.6, 0.6, null, 3);
      if (pr) { c.put([M.rb(P.appliance, 0.58, 0.95, 0.58, 0.02, 0, 0.475, 0.29), M.rb(P.applianceDark, 0.5, 0.06, 0.45, 0.01, 0, 0.98, 0.29), M.bx(P.applianceDark, 0.2, 0.08, 0.02, 0.15, 0.85, 0.585)], pr, zone, true); pl.take(pr.rect); }
      break;
    }
    case "office": {
      deskOn(winSide !== doorSide ? (sideW[0] ?? winSide) : winSide, 1.6, 2, "의자에 앉기");
      const so = sideW[1] ? pl.against(sideW[1], 2.0, 0.98, null, 3) : null;
      if (so) { c.put(M.sofa(P, 2.0), so, zone, true); pl.take(so.rect); const t = freeAt(at(so, 0, 0, 1.5).x, at(so, 0, 0, 1.5).z, 1.1, 0.6, yawOf(so)); if (t) c.put(M.coffeeTable(P), t, zone, true); }
      const bs = solidSides.find(s => s !== sideW[1]) ?? doorSide;
      wallPut(bs, M.bookshelf(P, 1.6, 2.0), 1.6, 0.34, null, 3);
      plant(null);
      break;
    }
    case "meeting": {
      const long = W >= D, tw = Math.max(1.6, (long ? W : D) - 2.6), td = Math.min(1.4, (long ? D : W) - 2.4);
      if (td > 0.8) {
        const f = freeAt(cx, cz, tw, td, long ? 0 : Math.PI / 2);
        if (f) {
          c.put(F.meetingTable(P, tw, td), f.m, zone, false); c.colliders.push(...rectSegs(f.rect));
          const n = Math.max(1, Math.floor(tw / 0.75));
          for (let i = 0; i < n; i++) for (const sgn of [-1, 1]) {
            const u = -tw / 2 + (tw / n) * (i + 0.5), m = new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeRotationY(sgn > 0 ? Math.PI : 0).setPosition(u, 0, sgn * (td / 2 + 0.38)));
            c.put(F.taskChair(P, X), m, zone, false);
            const p = new THREE.Vector3().setFromMatrixPosition(m), face = yawOf(m);
            if (i === 0 && sgn < 0) seat("의자에 앉기", p, face); else spot(p, face, "sit", "desk");
          }
        }
      }
      const ts = long ? sideW[0] : solidSides[0];
      if (ts) { tvOn(ts, 1.65); wallPut(ts, F.cabinets(P, 1.6, 0.6, 0.4), 1.6, 0.42, null, 0.7); }
      break;
    }
    case "pantry": {
      const s = sideW[0] ?? solidSides[0] ?? opposite[doorSide], len = Math.min(2.4, pl.len(s) - 0.9);
      const f = pl.against(s, len, 0.62, null, 3);
      if (f) {
        c.put(M.lowerRun(P, len, { sinkAt: -len / 2 + 0.6 }), f, zone, true); pl.take(f.rect);
        c.put(M.upperRun(P, len, 1.5, H - 0.1), f, zone, false);
        c.put([{ m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.014, 0.022, 0.33, 20)).translate(-len / 2 + 0.6, 1.04, 0.07) }], f, zone, false);
        c.faucet(room, zone, at(f, -len / 2 + 0.6, 1.15, 0.24), pl.fy + 0.6, "싱크대 수전", "sink", 0.16, 0.02);
        c.put([M.rb(P.appliance, 0.42, 0.3, 0.32, 0.02, len / 2 - 0.35, 1.0, 0.2), M.rb(P.applianceDark, 0.3, 0.38, 0.3, 0.03, len / 2 - 0.9, 1.04, 0.2)], f, zone, false);
      }
      wallPut(sideW[1] ?? opposite[s], M.fridge(P, 0.7, 1.8), 0.72, 0.74, null, 3);
      const t = freeAt(cx, cz, 0.9, 0.9); if (t) { c.put(F.cafeTable(P, 0.4), t, zone, true); for (const sgn of [-1, 1]) c.put(F.stackChair(P, X), new THREE.Matrix4().makeRotationY(sgn > 0 ? Math.PI : 0).setPosition(cx, pl.fy, cz + sgn * 0.62), zone, false); }
      break;
    }
    case "storage": case "plant": {
      if (room.type === "plant") {
        let k = 0; for (const s of solidSides.concat(winSide)) { for (let i = 0; i < 2; i++) wallPut(s, F.machine(P, X, k++), k % 2 ? 1.6 : 2.4, 0.95, null, 3); }
        // pipes along the ceiling
        c.put([0.3, 0.7].map(o => { const g = new THREE.CylinderGeometry(0.08, 0.08, W - 0.2, 14); g.rotateZ(Math.PI / 2); return { m: P.steel, g: boxUV(g).translate(cx, H - o * 0.5 - 0.2, Z0 + o) }; }), new THREE.Matrix4(), zone, false);
      } else {
        for (const s of solidSides) wallPut(s, F.wallShelves(P, X, Math.min(3.6, pl.len(s) - 0.6), 2.0, 0.45, 5, s.charCodeAt(0)), Math.min(3.6, pl.len(s) - 0.6), 0.47, null, 3);
      }
      break;
    }
    // -------------------------------------------- the clinic
    case "waiting": {
      const s = sideW[0] ?? solidSides[0] ?? "w";
      const rw = Math.min(3.0, pl.len(s) - 1.4);
      const f = pl.against(s, rw, 2.25, null, 3);
      if (f) {
        c.put(F.reception(P, X, rw), f, zone, false); pl.take(f.rect); c.colliders.push(...rectSegs(f.rect));
        spot(at(f, -rw / 4, 0, 0.95), yawOf(f), "stand", "counter"); spot(at(f, rw / 4, 0, 0.95), yawOf(f), "sit", "counter");
        signOn(s, "number", ["진료 대기 0127"], 1.2, 0.3, uOf(f, s), 2.15);
      }
      // seats in rows facing the desk
      const face = FACE[s] + Math.PI;
      for (let r = 0; r < 3; r++) {
        const off = 3.3 + r * 1.25, p = s === "w" ? [X0 + off, cz] : s === "e" ? [X1 - off, cz] : s === "n" ? [cx, Z0 + off] : [cx, Z1 - off];
        const n = Math.max(2, Math.min(5, Math.floor(((s === "w" || s === "e") ? D - 2.4 : W - 2.4) / 0.56)));
        const g = freeAt(p[0], p[1], n * 0.56, 0.6, face);
        if (g) { c.put(F.beamSeats(P, X, n), g, zone, false); c.colliders.push(...rectSegs(g.rect)); spot(at(g, -0.56 * (n / 2 - 0.5), 0, 0.08), face, "sit", "seat"); spot(at(g, 0.56 * (n / 2 - 1.5), 0, 0.08), face, "sit", "seat"); if (r === 0) seat("의자에 앉기", at(g, 0.56 * (n / 2 - 0.5), 0, 0.05), face); }
      }
      const o = sideW[1]; if (o) tvOn(o, 1.4);
      plant(null, 1.3);
      break;
    }
    case "consult": {
      deskOn(sideW[0] ?? winSide, 1.4, 2);
      // the doctor at the desk; the patient's stool beside it
      const d0 = c.spots[c.spots.length - 1]; if (d0) d0.kind = "doctor";
      const st = freeAt(cx + (sideW[0] === "e" ? 0.6 : -0.6), cz, 0.45, 0.45); if (st) { c.put(F.stool(P, X), st, zone, false); spot(new THREE.Vector3(st.rect[0] + 0.22, 0, st.rect[1] + 0.22), sideW[0] === "e" ? Math.PI / 2 : -Math.PI / 2, "sit", "seat"); }
      const os = sideW[1] ?? opposite[sideW[0] ?? "w"];
      const couch = pl.against(os, 1.95, 0.7, null, 3);
      if (couch) { c.put(F.moved(F.examCouch(P, X), 0, 0.36), couch, zone, true); pl.take(couch.rect); c.put(F.moved(F.bedCurtain(X, 2.0, 1.2, H), 0, 0.1), couch, zone, false); }
      const b = pl.against(doorSide, 0.6, 0.48, null, 3) ?? pl.against(winSide, 0.6, 0.48, null, 0.7);
      if (b) { c.put(M.washbasinVanity(P, 0.6), b, zone, true); pl.take(b.rect); c.faucet(room, zone, at(b, 0, 1.045, 0.19), pl.fy + 0.86, "세면대 수전", "basin", 0.1, 0.012); c.put([{ m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.016, 0.02, 0.2, 20)).translate(0, 0.96, 0.08) }], b, zone, false); }
      wallPut(solidSides.find(s => s !== sideW[0] && s !== os) ?? winSide, F.cabinets(P, 1.2, 1.9, 0.45), 1.2, 0.47, null, 0.8);
      break;
    }
    case "treatment": {
      const n = Math.max(1, Math.min(3, Math.floor((pl.len(sideW[0] ?? "w") - 0.6) / 1.2)));
      for (let i = 0; i < n; i++) {
        const f = pl.against(sideW[0] ?? "w", 0.8, 2.0, null, 3);
        if (!f) break;
        c.put(F.moved(F.examCouch(P, X), 0, 1.0, Math.PI / 2), f, zone, true); pl.take(f.rect);
        c.put(F.moved(F.ivPole(P), 0.55, 0.25), f, zone, false);
        if (i === 0) spot(at(f, 0, 0, 1.0), yawOf(f), "lie", "bed", 0.72);
      }
      if (sideW[1]) wallPut(sideW[1], F.cabinets(P, 2.0, 1.9, 0.45), 2.0, 0.47, null, 3);
      const b = pl.against(doorSide, 0.6, 0.48, null, 3);
      if (b) { c.put(M.washbasinVanity(P, 0.6), b, zone, true); pl.take(b.rect); c.faucet(room, zone, at(b, 0, 1.045, 0.19), pl.fy + 0.86, "세면대 수전", "basin", 0.1, 0.012); }
      spot(new THREE.Vector3(cx, 0, cz), 0, "stand", "stand");
      break;
    }
    case "ward": {
      // four beds, heads to the side walls, each with its cabinet and its curtain
      for (const s of (["w", "e"] as SideName[])) {
        for (let i = 0; i < 2; i++) {
          const f = pl.against(s, 1.05, 2.15, (s === "w" || s === "e") ? (i ? Z1 - 1.0 - (D - 2) * 0.05 : Z0 + 1.6) : null, 3);
          if (!f) continue;
          const bedM = new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 0, 1.06));
          c.put(F.hospitalBed(P, X), bedM, zone, true); pl.take(f.rect);
          c.put(M.nightstand(P), new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0.85, 0, 0)), zone, false);
          c.put(F.moved(F.ivPole(P), -0.75, 0.6), f, zone, false);
          const head = at(f, 0, 0, 0.35), feet = at(f, 0, 0, 1.9), dir = feet.clone().sub(head).normalize();
          if ((i + (s === "w" ? 0 : 1)) % 2 === 0) spot(head, Math.atan2(dir.x, dir.z), "lie", "bed", 0.66);
          else spot(at(f, 0.62, 0, 1.2), yawOf(f, -Math.PI / 2), "stand", "stand");
        }
      }
      const tvs = winSide === "n" || winSide === "s" ? doorSide : winSide; void tvs;
      break;
    }
    // -------------------------------------------- service counters: 민원실, 간호사 스테이션, 프런트, 안내
    case "service": case "pharmacy": {
      const s = sideW[0] ?? solidSides[0] ?? "w";
      const rw = Math.min(room.type === "pharmacy" ? 3.0 : 5.0, pl.len(s) - 1.4);
      const f = pl.against(s, rw, 2.25, null, 3);
      if (f) {
        c.put(F.reception(P, X, rw), f, zone, false); pl.take(f.rect); c.colliders.push(...rectSegs(f.rect));
        const k = Math.max(1, Math.round(rw / 1.4));
        for (let i = 0; i < k; i++) spot(at(f, -rw / 2 + (rw / k) * (i + 0.5), 0, 0.95), yawOf(f), i % 2 ? "stand" : "sit", "counter");
        if (room.type === "pharmacy") c.put(F.wallShelves(P, X, rw, 1.9, 0.3, 6, 3), f, zone, false);
        signOn(s, room.type === "service" && /민원/.test(room.label) ? "number" : "brand", room.type === "service" && /민원/.test(room.label) ? ["0042 → 2번 창구"] : [room.label.replace(/\s*안내$/, "")], Math.min(2.4, rw - 0.2), 0.36, uOf(f, s), 2.15);
      }
      if (/민원|프런트|안내/.test(room.label) || room.type === "pharmacy") {
        const face = FACE[s] + Math.PI;
        for (let r = 0; r < 2; r++) {
          const off = 3.4 + r * 1.3, p = s === "w" ? [X0 + off, cz] : s === "e" ? [X1 - off, cz] : s === "n" ? [cx, Z0 + off] : [cx, Z1 - off];
          const g = freeAt(p[0], p[1], 4 * 0.56, 0.6, face);
          if (g) { c.put(F.beamSeats(P, X, 4), g, zone, false); c.colliders.push(...rectSegs(g.rect)); spot(at(g, -0.28, 0, 0.08), face, "sit", "seat"); if (r === 0) seat("의자에 앉기", at(g, 0.84, 0, 0.05), face); }
        }
      }
      if (room.type === "pharmacy" && sideW[1]) wallPut(sideW[1], F.wallShelves(P, X, Math.min(3.6, pl.len(sideW[1]) - 1), 1.9, 0.4, 5, 9), Math.min(3.6, pl.len(sideW[1]) - 1), 0.42, null, 3);
      plant(null, 1.3);
      break;
    }
    // -------------------------------------------- shops and cafés
    case "shop": {
      const conv = /편의점|마트/.test(room.label), flowers = /꽃/.test(room.label), desky = /부동산|세탁/.test(room.label);
      if (desky) { deskOn(sideW[0] ?? winSide, 1.4, 1); deskOn(sideW[1] ?? winSide, 1.4, 1); wallPut(winSide, F.cabinets(P, 2.0, 0.9, 0.4), 2.0, 0.42, null, 0.75); break; }
      for (const s of sideW) {
        const len = Math.min(pl.len(s) - 1.4, 4.5);
        if (conv && s === sideW[0]) wallPut(s, F.cooler(P, X, len), len, 0.72, null, 3);
        else if (flowers) for (let i = 0; i < 4; i++) { const f = pl.against(s, 0.5, 0.5, null, 3); if (f) { c.put(M.plant(P, 0.8 + i * 0.25, i + 3), f, zone, true); pl.take(f.rect); } }
        else wallPut(s, F.wallShelves(P, X, len, 1.9, 0.42, 5, s.charCodeAt(0) + room.id.length), len, 0.44, null, 3);
      }
      // gondolas down the middle (a convenience store's), a display table otherwise
      const runAlong = D > W ? "z" : "x";
      if (conv || W * D > 30) {
        const len = Math.min(3.6, (runAlong === "z" ? D : W) - 3.2), k = Math.max(1, Math.floor(((runAlong === "z" ? W : D) - 2.2) / 1.9));
        for (let i = 0; i < k; i++) {
          const o = -((k - 1) * 1.9) / 2 + i * 1.9;
          const f = runAlong === "z" ? freeAt(cx + o, cz, len, 0.9, Math.PI / 2) : freeAt(cx, cz + o, len, 0.9, 0);
          if (f) { c.put(F.gondola(P, X, len, i * 5 + 1), f, zone, true); }
        }
      } else { const f = freeAt(cx, cz, 1.4, 0.8); if (f) c.put([M.rb(X.accentDark, 1.4, 0.8, 0.8, 0.02, 0, 0.4, 0), ...F.moved(F.wallShelves(P, X, 1.2, 0.3, 0.3, 1, 4), 0, -0.15, 0, 0.8)], f, zone, true); }
      // the till near the way in
      const till = pl.against(doorSide, 1.6, 2.0, null, 3, 0);
      if (till) {
        c.put(F.moved(F.serviceCounter(P, X, 1.6, 0.6), 0, 1.4), till, zone, true); pl.take(till.rect);
        c.put([M.rb(P.applianceDark, 0.3, 0.25, 0.04, 0.01, 0, 1.18, 1.25)], till, zone, false);
        spot(at(till, 0, 0, 0.6), yawOf(till), "stand", "counter");
      }
      spot(new THREE.Vector3(cx, 0, cz + 0.4), 0.8, "stand", "stand");
      break;
    }
    case "cafe": {
      const s = sideW[0] ?? solidSides[0] ?? "w", bw = Math.min(4.2, pl.len(s) - 1.4);
      const f = pl.against(s, bw, 2.25, null, 3);
      if (f) {
        c.put(F.reception(P, X, bw), f, zone, false); pl.take(f.rect); c.colliders.push(...rectSegs(f.rect));
        // the espresso machine and grinder on the back bar; the cake case on the counter
        c.put([M.rb(P.steel, 0.75, 0.45, 0.5, 0.04, -bw / 4, 1.13, 0.25), M.rb(P.applianceDark, 0.2, 0.42, 0.22, 0.03, -bw / 4 + 0.6, 1.12, 0.2), M.bx(P.glass, 1.1, 0.4, 0.5, bw / 4, 1.32, 1.85), M.bx(P.ledWarm, 1.0, 0.01, 0.4, bw / 4, 1.5, 1.85)], f, zone, false);
        signOn(s, "brand", [room.label], Math.min(2.6, bw - 0.4), 0.4, uOf(f, s), 2.1);
        spot(at(f, -bw / 4, 0, 0.95), yawOf(f), "stand", "counter"); spot(at(f, bw / 4, 0, 0.95), yawOf(f), "stand", "counter");
      }
      // tables for two in a grid, pendants over them
      const step = 1.9;
      let first = true;
      for (let x = X0 + 1.2; x < X1 - 0.9; x += step) for (let z = Z0 + 1.2; z < Z1 - 0.9; z += step) {
        const t = freeAt(x, z, 1.6, 0.8, 0, false);
        if (!t) continue;
        pl.take(t.rect);
        c.put(F.cafeTable(P, 0.36), new THREE.Matrix4().makeTranslation(x, pl.fy, z), zone, false);
        c.colliders.push(...rectSegs([x - 0.36, z - 0.36, x + 0.36, z + 0.36]));
        for (const sgn of [-1, 1]) {
          const m = new THREE.Matrix4().makeRotationY(sgn > 0 ? -Math.PI / 2 : Math.PI / 2).setPosition(x + sgn * 0.6, pl.fy, z);
          c.put(F.stackChair(P, X), m, zone, false);
          const p = new THREE.Vector3(x + sgn * 0.6, 0, z), face = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
          if (first) { seat("의자에 앉기", p, face); first = false; } else spot(p, face, "sit", "seat");
        }
        c.put(M.pendant(P, 0.9), new THREE.Matrix4().makeTranslation(x, H, z), zone, false);
      }
      plant(null, 1.5);
      break;
    }
    // -------------------------------------------- classrooms, staff rooms
    case "classroom": {
      const s = sideW[0] ?? solidSides[0] ?? "w", face = FACE[s] + Math.PI;
      const wb = pl.frameAt(s, s === "w" || s === "e" ? cz : cx, Math.min(3.6, pl.len(s) - 0.8), 0.06);
      c.put(F.whiteboard(P, X, Math.min(3.6, pl.len(s) - 0.8)), wb, zone, false);
      const td = pl.against(s, 1.2, 1.8, null, 0.8, 0);
      if (td) { c.put(F.moved(M.desk(P, 1.2), 0, 1.1, Math.PI), td, zone, true); pl.take(td.rect); spot(at(td, 0.3, 0, 0.6), yawOf(td), "stand", "stand"); }
      // desks in rows facing the board
      const [ix, iz] = dirOf(FACE[s]), across: [number, number] = [-iz, ix];
      const depth = (s === "w" || s === "e") ? W : D, width = (s === "w" || s === "e") ? D : W;
      const base = s === "w" ? [X0, cz] : s === "e" ? [X1, cz] : s === "n" ? [cx, Z0] : [cx, Z1];
      const cols = Math.max(1, Math.floor((width - 1.6) / 0.95)), rows = Math.max(1, Math.floor((depth - 3.2) / 1.15));
      let sat = false;
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const a = 2.6 + r * 1.15, b = (k - (cols - 1) / 2) * 0.95;
        // (an aisle down the middle)
        const bb = b + (cols > 3 ? Math.sign(b) * 0.3 : 0);
        const x = base[0] + ix * a + across[0] * bb, z = base[1] + iz * a + across[1] * bb;
        const f = freeAt(x, z, 0.62, 0.95, face, false);
        if (!f) continue;
        pl.take(f.rect);
        c.put(F.schoolDesk(P, X), new THREE.Matrix4().makeRotationY(face).setPosition(x, pl.fy, z), zone, false);
        const tx = x - ix * 0.1, tz = z - iz * 0.1;
        c.colliders.push(...rectSegs([tx - 0.3, tz - 0.3, tx + 0.3, tz + 0.3]));
        const sitAt = new THREE.Vector3(x + ix * 0.35, 0, z + iz * 0.35);
        if (!sat) { seat("의자에 앉기", sitAt, face); sat = true; } else spot(sitAt, face, "sit", "desk");
      }
      // a clock over the board
      c.put([M.cy(P.appliance, 0.16, 0.16, 0.04, 0, 0, 0, 32), M.cy(P.blackMetal, 0.17, 0.17, 0.03, 0, 0, -0.005, 32)].map(p => ({ ...p, g: p.g.rotateX(Math.PI / 2) })), new THREE.Matrix4().multiplyMatrices(wb.m, new THREE.Matrix4().makeTranslation(0, 2.4, 0.03)), zone, false);
      break;
    }
    case "staffroom": {
      const s = sideW[0] ?? solidSides[0] ?? "w";
      wallPut(s, F.lockers(P, X, Math.min(3.2, pl.len(s) - 1)), Math.min(3.2, pl.len(s) - 1), 0.52, null, 3);
      const so = sideW[1] ? pl.against(sideW[1], 1.8, 0.98, null, 3) : null;
      if (so) { c.put(M.sofa(P, 1.8), so, zone, true); pl.take(so.rect); seat("소파에 앉기", at(so, 0, 0, 0.55), yawOf(so)); }
      const t = freeAt(cx, cz, 1.6, 0.9);
      if (t) { c.put(F.meetingTable(P, 1.6, 0.9), t, zone, false); c.colliders.push(...rectSegs(t.rect)); for (const sgn of [-1, 1]) { const m = new THREE.Matrix4().makeRotationY(sgn > 0 ? Math.PI : 0).setPosition(cx, pl.fy, cz + sgn * 0.85); c.put(F.stackChair(P, X), m, zone, false); spot(new THREE.Vector3(cx, 0, cz + sgn * 0.85), sgn > 0 ? Math.PI : 0, "sit", "seat"); } }
      if (/교무/.test(room.label)) deskOn(winSide, 1.4, 1);
      break;
    }
    // -------------------------------------------- galleries
    case "gallery": {
      let seed = room.id.length * 7;
      for (const s of sides) {
        const len = pl.len(s), n = Math.max(0, Math.floor((len - 0.8) / 2.6));
        const ops = pl.openingsOn(s).filter(o => o.type !== "window");
        for (let i = 0; i < n; i++) {
          const u = (s === "n" || s === "s" ? X0 : Z0) + (len / n) * (i + 0.5);
          const w = 1.1 + ((seed * 13) % 7) / 10, h = 0.8 + ((seed * 7) % 5) / 10;
          if (ops.some(o => Math.abs(o.center - u) < o.width / 2 + w / 2 + 0.2) || pl.windowsOn(s).some(o => u + w / 2 > o.a && u - w / 2 < o.b)) continue;
          const f = pl.frameAt(s, u, w, 0.06);
          const tex = c.own(M.artTexture(seed++)), mat = c.own(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.85 }));
          c.put(M.artFrame(P, w, h, mat), new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 1.5, 0)), zone, false);
          signOn(s, "label", [`작품 ${seed}`, "캔버스에 유채, 2019"], 0.28, 0.12, u + w / 2 + 0.3, 1.25);
        }
      }
      for (let i = 0; i < Math.min(3, Math.floor(W * D / 30)); i++) { const f = freeAt(cx + (i - 1) * 2.6, cz - 0.8, 0.62, 0.62); if (f) c.put(F.plinth(P, X, i + room.id.length), f, zone, true); }
      const b = freeAt(cx, cz + 1.2, 1.8, 0.45); if (b) { c.put(F.bench(P, X, 1.8), b, zone, true); seat("벤치에 앉기", new THREE.Vector3(cx, 0, cz + 1.2), Math.PI); }
      spot(new THREE.Vector3(X0 + 1.2, 0, cz), FACE.w + Math.PI, "stand", "stand"); spot(new THREE.Vector3(X1 - 1.2, 0, cz), FACE.e + Math.PI, "stand", "stand");
      break;
    }
    // -------------------------------------------- gym
    case "gym": {
      const face = FACE[winSide] + Math.PI;
      const n = Math.max(1, Math.min(6, Math.floor((pl.len(winSide) - 1) / 1.1)));
      for (let i = 0; i < n; i++) {
        const f = pl.against(winSide, 0.9, 2.3, null, 0.5);
        if (!f) break;
        c.put(F.moved(F.treadmill(P, X), 0, 1.25), f, zone, true); pl.take(f.rect);
        if (i % 2 === 0) spot(at(f, 0, 0.27, 1.5), face, "stand", "stand", 0.27);
      }
      const ms = sideW[0];
      if (ms) {
        const f = pl.frameAt(ms, ms === "w" || ms === "e" ? cz : cx, pl.len(ms) - 0.6, 0.02);
        c.put([M.bx(X.mirrorWall, pl.len(ms) - 0.6, 2.0, 0.01, 0, 1.25, 0.005)], f, zone, false);
        wallPut(ms, F.dumbbellRack(P, 2.2), 2.2, 0.55, null, 3);
      }
      for (let i = 0; i < 3; i++) { const f = freeAt(cx + (i - 1) * 1.5, cz, 0.5, 1.3); if (f) { c.put(F.weightBench(P, X), f, zone, true); if (i === 1) spot(new THREE.Vector3(cx, 0, cz), 0, "stand", "stand"); } }
      if (sideW[1]) for (let i = 0; i < 3; i++) { const f = pl.against(sideW[1], 0.7, 1.8, null, 3); if (f) { c.put([M.rb(X.mat, 0.65, 0.02, 1.75, 0.01, 0, 0.01, 0.9)], f, zone, false); pl.take(f.rect); } }
      break;
    }
    // -------------------------------------------- hotel rooms
    case "guest": {
      const s = sideW[0] ?? solidSides[0] ?? "w";
      const bf = pl.against(s, 1.7, 2.15, null, 3);
      if (bf) {
        c.put(M.bed(P, 1.6, 2.1), bf, zone, true); pl.take(bf.rect);
        for (const sgn of [-1, 1]) c.put([...M.nightstand(P), ...M.tableLamp(P).map(p => ({ ...p, g: p.g.translate(0, 0.52, 0.2) }))], new THREE.Matrix4().multiplyMatrices(bf.m, new THREE.Matrix4().makeTranslation(sgn * 1.15, 0, 0)), zone, false);
        c.seats.push({ label: "침대에 눕기", eye: at(bf, 0.35, 0.78, 0.42), yaw: yawOf(bf) + Math.PI, pose: "lie", hit: c.hitIn(bf, 1.6, 0.6, 1.9, 0, 0.4, 1.05), zone, room });
      }
      deskOn(winSide, 1.2, 0);
      if (sideW[1]) { tvOn(sideW[1], 1.1); wallPut(sideW[1], M.wardrobe(P, 1.0, 2.2, 0.6), 1.0, 0.62, null, 3); }
      break;
    }
    // -------------------------------------------- the car park
    case "parking": {
      const bay = 2.5, len = 5.1, xs0 = X0 + 0.4, nb = Math.floor((W - 0.8) / bay);
      const paint = (x: number, z: number, w: number, d: number) => c.put([M.bx(X.paintWhite, w, 0.006, d, 0, 0.003, 0)], new THREE.Matrix4().makeTranslation(x, pl.fy, z), zone, false);
      let k = 0;
      for (const [z0, dir] of [[Z0 + 0.2, 1], [Z1 - 0.2, -1]] as [number, number][]) {
        for (let i = 0; i <= nb; i++) paint(xs0 + i * bay, z0 + dir * len / 2, 0.1, len);
        for (let i = 0; i < nb; i++) {
          const x = xs0 + (i + 0.5) * bay, z = z0 + dir * len / 2;
          if (((i * 7 + (dir > 0 ? 3 : 5)) % 10) < 7) {
            const f = freeAt(x, z, 1.9, 4.7, dir > 0 ? 0 : Math.PI);
            if (f) c.put(F.parkedCar(P, X, X.carPaint[(k++) % X.carPaint.length]), f, zone, true);
          }
          c.put([M.rb(X.paintYellow, 0.7, 0.1, 0.15, 0.03, 0, 0.05, 0)], new THREE.Matrix4().makeTranslation(x, pl.fy, z0 + dir * 0.55), zone, false);
        }
        // columns at the aisle edge every third bay
        for (let i = 0; i <= nb; i += 3) {
          const x = xs0 + i * bay, z = z0 + dir * (len + 0.45);
          const f = freeAt(x, z, 0.74, 0.74); if (f) {
            c.put(F.column(P, X, H), f, zone, true);
            for (const yaw of [0, Math.PI]) { const g = c.signs.sign("number", [`${(c.plan.facility?.levelLabel ?? "").replace(/지하\s*/, "B").replace(/층$/, "")}-${String.fromCharCode(65 + (dir > 0 ? 0 : 1))}${i / 3 + 1}`], 0.5, 0.3); c.B.add(c.signs.material, zone, g, new THREE.Matrix4().makeRotationY(yaw).setPosition(x, pl.fy + 1.7, z + (yaw ? -0.356 : 0.356)), false); g.dispose(); }
          }
        }
      }
      // the aisle's arrows
      for (let x = X0 + 3; x < X1 - 2; x += 6) c.put([M.bx(X.paintWhite, 1.2, 0.006, 0.15, 0, 0.003, 0), M.bx(X.paintWhite, 0.4, 0.006, 0.12, 0.55, 0.003, 0.12), M.bx(X.paintWhite, 0.4, 0.006, 0.12, 0.55, 0.003, -0.12)], new THREE.Matrix4().makeTranslation(x, pl.fy, cz), zone, false);
      spot(new THREE.Vector3(X0 + 4, 0, cz + 0.5), Math.PI / 2, "stand", "stand");
      break;
    }
  }
  roomSign(c, room, corridorOp);
}

/** a room's name by its door on the corridor side; a shop's or a gallery's over its front */
function roomSign(c: FacCtx, room: Room, o: Opening | undefined) {
  if (!o) return;
  const otherId = o.a === room.id ? o.b : o.a, other = c.plan.rooms.find(r => r.id === otherId); if (!other) return;
  const zone = c.zoneOf(other);
  // (the face toward the public side, a little off the wall; along the wall: u)
  const zAxis = o.axis === "z";
  const roomBefore = zAxis ? room.rect[3] <= o.at + 1e-6 : room.rect[2] <= o.at + 1e-6;
  const off = (roomBefore ? 1 : -1) * (HALF_WALL + 0.012);
  const face = zAxis ? (roomBefore ? 0 : Math.PI) : (roomBefore ? Math.PI / 2 : -Math.PI / 2);
  const lo = zAxis ? room.rect[0] : room.rect[1], hi = zAxis ? room.rect[2] : room.rect[3];
  const place = (u: number, y: number) => zAxis ? new THREE.Matrix4().makeRotationY(face).setPosition(u, y, o.at + off) : new THREE.Matrix4().makeRotationY(face).setPosition(o.at + off, y, u);
  const big = o.type === "glass_door" || o.type === "open";
  if (big) {
    const w = Math.min(o.width + 1.2, hi - lo - 0.3), top = o.sill + o.height, h = Math.min(0.42, c.H - top - 0.06);
    if (h > 0.14 && w > 0.8) { const g = c.signs.sign("fascia", [room.label], w, h); c.B.add(c.signs.material, zone, g, place(o.center, top + 0.03 + h / 2), false); g.dispose(); return; }
  }
  let u = o.center + o.width / 2 + 0.42;
  if (u + 0.2 > hi) u = o.center - o.width / 2 - 0.42;
  const sub = room.type === "consult" ? "진료 중" : room.type === "ward" ? "4인실" : "";
  const g = c.signs.sign("plate", sub ? [room.label, sub] : [room.label], 0.5, 0.17);
  c.B.add(c.signs.material, zone, g, place(u, 1.55), false); g.dispose();
}

function hitBoxAt(c: FacCtx, w: number, h: number, d: number, p: THREE.Vector3) {
  return c.hitIn(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z), w, h, d, 0, 0, 0);
}
function rectSegs(r: Rect): Seg[] { const [a, b, c, d] = r; return [[a, b, c, b], [c, b, c, d], [c, d, a, d], [a, d, a, b]]; }
/** a wall frame's footprint w × d from the wall */
function rectOf(f: Frame, w: number, d: number): Rect {
  const p = [[-w / 2, 0], [w / 2, 0], [w / 2, d], [-w / 2, d]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(f.m));
  return [Math.min(...p.map(q => q.x)), Math.min(...p.map(q => q.z)), Math.max(...p.map(q => q.x)), Math.max(...p.map(q => q.z))];
}
