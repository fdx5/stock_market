import { bedCover, bedV, chairCover, chairMore, frameV, paintingTexture, propsV, sofaCover, switchMore } from "./decor";
import * as THREE from "three";
import { Batcher, boxUV, RoundedBoxGeometry } from "./geom";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HALF_WALL, type CeilingLight, type Seg, type Shell } from "./build";
import type { Palette } from "./materials";
import * as M from "./models";
import { ceilingCassette, chairV, coffeeTableV, pendantV, sofaV, switchV, toiletV, variantOf, wallAircon } from "./variants";
import type { FloorPlan, Room } from "./plan/types";
import type { WaterKind } from "../game/sound";
import { poolMaterial, splashMaterial, streamMaterial, washMaterial } from "./water";
import { ITEM_NAME, Pantry } from "./pantry";
import { FACILITY_ROOMS } from "./plan/types";
import { furnishFacilityRoom, type FacilityHooks, type Spot } from "./facilityFurnish";
import type { Extra } from "./facilityModels";
import type { SignAtlas } from "./facilitySigns";

/** a building other than flats: its extra materials, its signs, what its lifts do, where its people go */
export interface FacilityKit { X: Extra; signs: SignAtlas; hooks: FacilityHooks; spots: Spot[] }
export interface MonitorScreen { id: string; corners: THREE.Vector3[] }

/* Furnishing by rules: each room type gets its furniture against the walls that suit it (the TV on
 * the 아트월, the sofa facing it, the bed's head on a wall without a door…), slid along the wall to
 * the nearest free place; door swings and the ways through doorways stay clear. Then the moving
 * and working things: switches, taps, the toilet, the TV, curtains, the cooktop. */

export type SideName = "n" | "s" | "w" | "e";
export type Rect = [number, number, number, number];
export type Sound = "click" | "water" | "flush" | "door" | "curtain" | "beep" | "fridge" | "meow" | "bark";

export interface Interactable {
  id: string; zone: number; room: Room;
  /** what the button says now ("거실 전등 끄기") */
  label(): string;
  /** the shapes a look ray hits (invisible proxies) */
  hit: THREE.Object3D;
  act(): Sound | null;
  update?(dt: number): void;
  /** whether it can be looked at and used now (absent: always) */
  enabled?(): boolean;
  /** a running sound (taps, showers, a machine): its level 0..1, and what it is */
  loud?(): number;
  channel?: WaterKind;
}

export interface Furnished {
  roomTimings: { room: string; label: string; type: string; ms: number }[];
  interactables: Interactable[];
  colliders: Seg[];
  pendants: CeilingLight[];
  /** per window: how much daylight its curtains let in (0..1) */
  curtainOpen: Map<number, () => number>;
  tv?: { on: boolean; pos?: THREE.Vector3; normal?: THREE.Vector3; w?: number; h?: number; zone?: number; corners?: THREE.Vector3[]; power?(on: boolean): void; picture?(img: HTMLImageElement | null): void };
  /** places to sit or lie: where the eye goes and which way it looks */
  seats: { label: string; eye: THREE.Vector3; yaw: number; pose: "sit" | "lie"; hit: THREE.Object3D; zone: number; room: Room }[];
  /** where a robot vacuum docks (the living room) */
  dock: { pos: THREE.Vector3; out: THREE.Vector3 } | null;
  /** a laptop on a desk: its screen's corners (top-left, top-right, bottom-right, bottom-left) and facing */
  laptop: { on: boolean; open?: number; corners?: THREE.Vector3[]; cornersNow?(): THREE.Vector3[]; normal?: THREE.Vector3; screen?: THREE.MeshBasicMaterial };
  /** the groceries: the fridge's and the basket's, and the one in the hand */
  pantry: Pantry;
  /** extra mirrors: their planes (for the scene to give reflections) */
  mirrors: { pos: THREE.Vector3; normal: THREE.Vector3; w: number; h: number; zone: number }[];
  dispose(): void;
}

export interface Frame { m: THREE.Matrix4; rect: Rect }

export class Placer {
  occupied: Rect[] = [];
  /** the doorways' clear areas (walked through; where a way in starts) */
  doors: Rect[] = [];
  X0: number; X1: number; Z0: number; Z1: number; fy: number;
  constructor(public room: Room, private plan: FloorPlan) {
    const e = HALF_WALL;
    [this.X0, this.Z0, this.X1, this.Z1] = [room.rect[0] + e, room.rect[1] + e, room.rect[2] - e, room.rect[3] - e];
    this.fy = -(room.floorDrop ?? 0);
    // doorways: the swing of a door into this room, and a way through every opening
    for (const o of plan.openings) {
      if (o.a !== room.id && o.b !== room.id) continue;
      if (o.type === "window" || o.type === "balcony_window") continue;
      const s = this.sideOf(o.axis, o.at);
      if (!s) continue;
      const reach = o.type === "door" && o.swingInto === room.id ? o.width + 0.1 : 0.75;
      const r = this.rectAt(s, o.center, o.width + 0.12, reach);
      this.occupied.push(r); this.doors.push(r);
    }
  }
  /** a way on foot (0.1 m grid, a walker's 0.22 m half-width kept off everything placed) from a door to
   * (x, z); its cells, or null — so a desk is not put where the bed shuts it off */
  way(x: number, z: number): [number, number][] | null {
    const C = 0.1, nx = Math.max(1, Math.round((this.X1 - this.X0) / C)), nz = Math.max(1, Math.round((this.Z1 - this.Z0) / C)), R = 0.22;
    const block = new Uint8Array(nx * nz);
    const solid = this.occupied.filter(o => !this.doors.includes(o));
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const px = this.X0 + (i + 0.5) * C, pz = this.Z0 + (j + 0.5) * C;
      if (px < this.X0 + R - 0.05 || px > this.X1 - R + 0.05 || pz < this.Z0 + R - 0.05 || pz > this.Z1 - R + 0.05) { block[j * nx + i] = 1; continue; }
      if (solid.some(o => px > o[0] - R && px < o[2] + R && pz > o[1] - R && pz < o[3] + R)) block[j * nx + i] = 1;
    }
    const from = new Int32Array(nx * nz).fill(-2), q: number[] = [];
    for (const d of this.doors) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const px = this.X0 + (i + 0.5) * C, pz = this.Z0 + (j + 0.5) * C, k = j * nx + i;
      if (px > d[0] && px < d[2] && pz > d[1] && pz < d[3] && from[k] === -2) { from[k] = -1; block[k] = 0; q.push(k); }
    }
    const ti = Math.min(nx - 1, Math.max(0, Math.floor((x - this.X0) / C))), tj = Math.min(nz - 1, Math.max(0, Math.floor((z - this.Z0) / C))), t = tj * nx + ti;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]; if (c === t) break;
      const i = c % nx;
      for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx]) if (n >= 0 && n < nx * nz && from[n] === -2 && !block[n]) { from[n] = c; q.push(n); }
    }
    if (from[t] === -2) return null;
    const out: [number, number][] = [];
    for (let c = t; c >= 0; c = from[c]) out.push([this.X0 + ((c % nx) + 0.5) * C, this.Z0 + (Math.floor(c / nx) + 0.5) * C]);
    return out;
  }
  /** keep a way clear: the cells along it reserved (0.6 m wide) for nothing else to stand on */
  keep(way: [number, number][]) { for (let k = 0; k < way.length; k += 3) { const [x, z] = way[k]; this.occupied.push([x - 0.3, z - 0.3, x + 0.3, z + 0.3]); } }
  sideOf(axis: "x" | "z", at: number): SideName | null {
    const [x0, z0, x1, z1] = this.room.rect;
    if (axis === "z") return Math.abs(at - z0) < 1e-6 ? "n" : Math.abs(at - z1) < 1e-6 ? "s" : null;
    return Math.abs(at - x0) < 1e-6 ? "w" : Math.abs(at - x1) < 1e-6 ? "e" : null;
  }
  span(s: SideName): [number, number] { return s === "n" || s === "s" ? [this.X0, this.X1] : [this.Z0, this.Z1]; }
  len(s: SideName) { const [a, b] = this.span(s); return b - a; }
  depth(s: SideName) { return s === "n" || s === "s" ? this.Z1 - this.Z0 : this.X1 - this.X0; }
  rectAt(s: SideName, u: number, w: number, d: number): Rect {
    switch (s) {
      case "n": return [u - w / 2, this.Z0, u + w / 2, this.Z0 + d];
      case "s": return [u - w / 2, this.Z1 - d, u + w / 2, this.Z1];
      case "w": return [this.X0, u - w / 2, this.X0 + d, u + w / 2];
      case "e": return [this.X1 - d, u - w / 2, this.X1, u + w / 2];
    }
  }
  frameAt(s: SideName, u: number, w: number, d: number, lift = 0): Frame {
    const m = new THREE.Matrix4();
    const y = this.fy + lift;
    switch (s) {
      case "n": m.makeRotationY(0).setPosition(u, y, this.Z0); break;
      case "s": m.makeRotationY(Math.PI).setPosition(u, y, this.Z1); break;
      case "w": m.makeRotationY(Math.PI / 2).setPosition(this.X0, y, u); break;
      case "e": m.makeRotationY(-Math.PI / 2).setPosition(this.X1, y, u); break;
    }
    return { m, rect: this.rectAt(s, u, w, d) };
  }
  /** windows on a side: their spans and sills */
  windowsOn(s: SideName) {
    return this.plan.openings.filter(o => (o.a === this.room.id) && (o.type === "window" || o.type === "balcony_window") && this.sideOf(o.axis, o.at) === s).map(o => ({ a: o.center - o.width / 2, b: o.center + o.width / 2, sill: o.sill }));
  }
  openingsOn(s: SideName) { return this.plan.openings.filter(o => (o.a === this.room.id || o.b === this.room.id) && this.sideOf(o.axis, o.at) === s); }
  free(r: Rect) {
    const eps = 0.005;
    if (r[0] < this.X0 - eps || r[2] > this.X1 + eps || r[1] < this.Z0 - eps || r[3] > this.Z1 + eps) return false;
    return !this.occupied.some(o => r[0] < o[2] - eps && r[2] > o[0] + eps && r[1] < o[3] - eps && r[3] > o[1] + eps);
  }
  /** against a wall, as near `prefer` along it as fits; tall things keep off the windows */
  against(s: SideName, w: number, d: number, prefer: number | null, height = 0.8, clear = 0): Frame | null {
    const [lo, hi] = this.span(s);
    if (hi - lo < w) return null;
    const want = prefer ?? (lo + hi) / 2;
    const wins = this.windowsOn(s);
    for (let k = 0; k <= 400; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.025, u = Math.min(hi - w / 2, Math.max(lo + w / 2, want + off));
      if (wins.some(o => o.sill < height && u + w / 2 > o.a - 0.02 && u - w / 2 < o.b + 0.02)) continue;
      const f = this.frameAt(s, u, w, d);
      const probe: Rect = clear ? this.rectAt(s, u, w, d + clear) : f.rect;
      if (this.free(probe)) return f;
    }
    return null;
  }
  take(r: Rect) { this.occupied.push(r); }
}

const opposite: Record<SideName, SideName> = { n: "s", s: "n", w: "e", e: "w" };

/** shadowMoved(): something that casts a sun shadow moved (a curtain, the fridge door) */
export const shadowMoved = { at: 0 };

export function furnish(plan: FloorPlan, shell: Shell, P: Palette, B: Batcher, dynamic: THREE.Group, hits: THREE.Group, fac?: FacilityKit): Furnished {
  const roomTimings: Furnished["roomTimings"] = [];
  const zoneOf = (r: Room) => shell.zones.get(r.zone)!;
  const interactables: Interactable[] = [], colliders: Seg[] = [], pendants: CeilingLight[] = [], disposables: { dispose(): void }[] = [];
  const curtainOpen = new Map<number, () => number>();
  const mirrors: Furnished["mirrors"] = [];
  const seats: Furnished["seats"] = [];
  let dock: Furnished["dock"] = null;
  /** an invisible box in a frame (for the look ray) */
  const hitIn = (f: Frame | THREE.Matrix4, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    me.applyMatrix4(new THREE.Matrix4().multiplyMatrices(f instanceof THREE.Matrix4 ? f : f.m, new THREE.Matrix4().makeTranslation(x, y, z)));
    me.updateMatrixWorld(); hits.add(me); disposables.push(me.geometry, me.material as THREE.Material);
    return me;
  };
  const yawOut = (f: Frame) => { const d = local(f, 0, 0, 1).sub(local(f, 0, 0, 0)); return Math.atan2(-d.x, -d.z); };
  const furnishedTv: Furnished["tv"] = { on: false };
  const furnishedLaptop: Furnished["laptop"] = { on: false };
  const H = plan.ceilingHeightM;
  // (which of each thing's kinds this flat has: by the complex, the 동 and the floor — variants.ts)
  const VS = `${plan.complexId}|${plan.dong}|${plan.floor}|${plan.style}`, built = plan.basis.built ?? 2005;
  // (the dining chairs: one of nine — not the low lounge chair — in this flat's wood and fabric)
  const dcv = [0, 1, 2, 3, 4, 5, 6, 7, 9][variantOf(VS, "chair", 9)], diningChair = () => (dcv < 5 ? chairV(P, dcv) : chairMore(P, dcv));
  const chairSwap = chairCover(P, VS, disposables);
  const lamps = shell.lampMeshes;
  // (the lamps' materials are shared; their glow follows the zone of their vertices)
  const zoneLamp = (_zone: number, base: THREE.MeshPhysicalMaterial) => base;
  void lamps;
  /** put a kit in the batches with a frame; its footprint blocks walking if `solid` */
  const put = (kit: M.Kit, f: Frame | THREE.Matrix4, zone: number, solid = true, swap?: Map<THREE.Material, THREE.Material>) => {
    const m = f instanceof THREE.Matrix4 ? f : f.m;
    for (const p of kit) { B.add(swap?.get(p.m) ?? p.m, zone, p.g, m, p.cast !== false); p.g.dispose(); }
    if (solid && !(f instanceof THREE.Matrix4)) {
      const [a, b, c, d] = f.rect;
      colliders.push([a, b, c, b], [c, b, c, d], [c, d, a, d], [a, d, a, b]);
    }
  };
  const hitBox = (w: number, h: number, d: number, at: THREE.Vector3) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    me.position.copy(at); me.updateMatrixWorld(); hits.add(me); disposables.push(me.geometry, me.material as THREE.Material);
    return me;
  };
  const local = (f: Frame, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(f.m);


  const pantry = new Pantry(dynamic); disposables.push(pantry);
  /** a look box that follows a moving part (a fridge door): its world matrix set from the part's each frame */
  const follow = (w: number, h: number, d: number, part: THREE.Object3D, at: THREE.Vector3) => {
    const me = hitBox(w, h, d, new THREE.Vector3());
    me.matrixAutoUpdate = false; me.matrixWorldAutoUpdate = false;
    const off = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
    return { me, sync: () => { me.matrixWorld.multiplyMatrices(part.matrixWorld, off); } };
  };
  /** a grocery slot's look box and what it does: take what is there, or put the hand's item in */
  const slotUse = (id: string, room: Room, zone: number, hit: THREE.Object3D, place: string, open: () => boolean) => {
    interactables.push({
      id: `slot-${id}`, zone, room, hit,
      enabled: () => open() && (pantry.hand ? pantry.fits(id) : pantry.kindAt(id) !== null),
      label: () => {
        const k = pantry.kindAt(id), h = pantry.handKind();
        return h ? `${place}에 ${ITEM_NAME[h]} 넣기` : k ? `${place}에서 ${ITEM_NAME[k]} 꺼내기` : "";
      },
      act: () => (pantry.hand ? pantry.put(id) : pantry.take(id)) ? "click" : null,
    });
  };

  // ---------------------------------------------------------------- taps, toilets, showers
  const faucet = (room: Room, zone: number, spout: THREE.Vector3, bottom: number, label: string, kind: "basin" | "sink" | "tub" | "shower", poolR = 0.12, poolMax = 0.05): void => {
    const len = Math.max(0.05, spout.y - bottom);
    const streamM = streamMaterial(); disposables.push(streamM);
    const streams = new THREE.Group();
    const lines = kind === "shower" ? 26 : 1;
    for (let i = 0; i < lines; i++) {
      const g = new THREE.CylinderGeometry(kind === "shower" ? 0.0025 : kind === "tub" ? 0.012 : 0.0095, kind === "shower" ? 0.002 : kind === "tub" ? 0.009 : 0.007, len, 14, 1, true);
      g.translate(0, -len / 2, 0); disposables.push(g);
      const s = new THREE.Mesh(g, streamM);
      if (kind === "shower") { const a = i * 2.39996, r = 0.115 * Math.sqrt((i + 0.5) / lines); s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); }
      s.renderOrder = 2; streams.add(s);
    }
    streams.position.copy(spout); streams.visible = false; dynamic.add(streams);
    // (a tap's stream splashes where it lands; a shower's spray is too fine for that)
    const splashM = kind === "shower" ? null : splashMaterial();
    let splash: THREE.Mesh | null = null;
    if (splashM) {
      disposables.push(splashM);
      const r0 = kind === "tub" ? 0.012 : 0.008, sg = new THREE.CylinderGeometry(r0 * 4.5, r0, 0.03, 24, 1, true); disposables.push(sg);
      splash = new THREE.Mesh(sg, splashM); splash.position.set(spout.x, bottom + 0.015, spout.z); splash.visible = false; splash.renderOrder = 3; dynamic.add(splash);
    }
    const poolM = poolMaterial(); disposables.push(poolM);
    const pg = new THREE.CircleGeometry(poolR, 40).rotateX(-Math.PI / 2); disposables.push(pg);
    const pool = new THREE.Mesh(pg, poolM); pool.position.set(spout.x, bottom + 0.004, spout.z); pool.visible = false; pool.renderOrder = 1; dynamic.add(pool);
    let on = false, flow = 0, level = 0;
    const hit = hitBox(kind === "shower" ? 0.3 : 0.12, kind === "shower" ? 0.5 : 0.18, kind === "shower" ? 0.3 : 0.12, spout.clone().add(new THREE.Vector3(0, kind === "shower" ? -0.9 : 0.02, 0)));
    interactables.push({
      id: `tap-${interactables.length}`, zone, room, hit,
      label: () => `${label} ${on ? "잠그기" : "틀기"}`,
      act: () => { on = !on; return "click"; },
      update: dt => {
        flow += ((on ? 1 : 0) - flow) * Math.min(1, dt * (on ? 6 : 9));
        streamM.uniforms.uOn.value = flow; streams.visible = flow > 0.01;
        level = Math.max(0, Math.min(poolMax, level + (on ? 0.012 : -0.03) * dt * (kind === "tub" ? 2.5 : 1)));
        const show = kind === "shower" ? flow : Math.max(level / poolMax, flow * 0.6);
        pool.visible = show > 0.02; poolM.uniforms.uRipple.value = flow;
        // (shut, what is left swirls away down the plughole)
        poolM.uniforms.uSwirl.value = on ? 0 : Math.min(1, level / poolMax * 3) * 1.3;
        pool.position.y = bottom + 0.004 + level;
        if (splash && splashM) { splashM.uniforms.uOn.value = flow; splash.visible = flow > 0.02; splash.position.y = bottom + 0.012 + level; }
        const sc = kind === "tub" ? 1 : 0.6 + 0.4 * Math.min(1, level / poolMax + flow * 0.3);
        pool.scale.set(sc, 1, sc);
      },
      loud: () => flow, channel: kind,
    });
  };

  for (const room of plan.rooms) {
    const zone = zoneOf(room), pl = new Placer(room, plan);
    const sides: SideName[] = ["n", "s", "w", "e"];
    const solidSides = sides.filter(s => pl.openingsOn(s).length === 0);
    const windowSide = sides.find(s => pl.windowsOn(s).some(w => w.b - w.a > 1.2)) ?? sides.find(s => pl.windowsOn(s).length) ?? "s";

    // ------------------------------------------------ a building's rooms (facilityFurnish.ts)
    if (fac && FACILITY_ROOMS.has(room.type)) {
      const began = performance.now();
      const facilityPut: typeof put = (kit, f, zone, solid, swap) => {
        for (const p of kit) if (p.m === fac.X.monitor && p.g.getAttribute("position").count === 4) {
          const m = f instanceof THREE.Matrix4 ? f : f.m, a = p.g.getAttribute("position");
          const corners = [0, 1, 3, 2].map(i => new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m));
          const screen: MonitorScreen = { id: `monitor-${interactables.length}`, corners };
          const hit = new THREE.Mesh(p.g.clone(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
          hit.applyMatrix4(m); hit.updateMatrixWorld(); hits.add(hit); disposables.push(hit.geometry, hit.material as THREE.Material);
          interactables.push({ id: screen.id, zone, room, hit, label: () => "컴퓨터 사용하기", act: () => { fac.hooks.monitor?.(screen); return "beep"; } });
        }
        put(kit, f, zone, solid, swap);
      };
      furnishFacilityRoom({ plan, P, X: fac.X, signs: fac.signs, B, dynamic, H, put: facilityPut, hitIn, local, interactables, seats, colliders, mirrors, faucet, spots: fac.spots, hooks: fac.hooks,
        zoneOf, own: x => { disposables.push(x); return x; } }, room, pl);
      roomTimings.push({ room: room.id, label: room.label, type: room.type, ms: +(performance.now() - began).toFixed(2) });
      // roller blinds, a third down, at its windows
      for (const w of shell.windows.filter(w => w.room === room)) {
        const wi = shell.windows.indexOf(w), top = H - 0.04, yaw = Math.atan2(w.inward.x, w.inward.z), drop = (top - (w.bottom + pl.fy)) * 0.32;
        const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(w.center.x + w.inward.x * (HALF_WALL + 0.06), 0, w.center.z + w.inward.z * (HALF_WALL + 0.06));
        put([M.rb(P.trim, w.width + 0.08, 0.07, 0.08, 0.02, 0, top - 0.035, 0), M.bx(P.linen, w.width + 0.02, drop, 0.006, 0, top - 0.07 - drop / 2, 0), M.bx(P.blackMetal, w.width + 0.02, 0.025, 0.02, 0, top - 0.07 - drop, 0)], base, zone, false);
        curtainOpen.set(wi, () => 0.8);
      }
      continue;
    }

    // ------------------------------------------------ living room
    if (room.type === "living") {
      const tvSide = solidSides.find(s => s === "w" || s === "e") ?? solidSides[0] ?? "w";
      const sofaSide = opposite[tvSide];
      const span = pl.len(tvSide), across = pl.depth(tvSide);
      // centred a little toward the window (the dining side stays open)
      const [lo, hi] = pl.span(tvSide), mid = windowSide === "s" ? (lo + hi) / 2 + span * 0.08 : (lo + hi) / 2;
      const cabW = Math.min(2.4, span - 0.6);
      const cab = pl.against(tvSide, cabW, 0.42, mid);
      if (cab) {
        put(M.tvCabinet(P, cabW), cab, zone); pl.take(cab.rect);
        if (cabW > 1.5) for (const s of [-1, 1]) put(propsV(P, variantOf(VS, `propsCab${s}`, 12), disposables), new THREE.Matrix4().multiplyMatrices(cab.m, new THREE.Matrix4().makeTranslation(s * (cabW / 2 - 0.2), 0.48, 0.2)), zone, false);
      }
      const tvW = Math.min(1.68, cabW * 0.78), tvH = tvW * 0.5625;
      const tvF = pl.frameAt(tvSide, cab ? centreAlong(cab.rect, tvSide) : mid, tvW, 0.04);
      put(M.tvFrame(P, tvW, tvH), new THREE.Matrix4().multiplyMatrices(tvF.m, new THREE.Matrix4().makeTranslation(0, 1.15, 0.01)), zone, false);
      // the screen: its own mesh (it lights up)
      const tex = tvTexture(); disposables.push(tex);
      // (what the screen shows can be swapped: the video playing in the TV's browser, its thumbnail)
      const still = document.createElement("canvas"); still.width = 1280; still.height = 720; still.getContext("2d")!.drawImage(tex.image as HTMLCanvasElement, 0, 0);
      furnishedTv.picture = (img: HTMLImageElement | null) => {
        const g = (tex.image as HTMLCanvasElement).getContext("2d")!;
        if (!img) g.drawImage(still, 0, 0);
        else { const k = Math.max(1280 / img.width, 720 / img.height), w = img.width * k, h = img.height * k; g.fillStyle = "#000"; g.fillRect(0, 0, 1280, 720); g.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h); }
        tex.needsUpdate = true;
      };
      const screenM = (P.screen as THREE.MeshPhysicalMaterial).clone(); screenM.emissiveMap = tex; screenM.emissiveIntensity = 0; disposables.push(screenM);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), screenM); disposables.push(scr.geometry);
      scr.applyMatrix4(new THREE.Matrix4().multiplyMatrices(tvF.m, new THREE.Matrix4().makeTranslation(0, 1.15, 0.0392)));
      dynamic.add(scr);
      // (its corners, where the page lays the TV's browser: top-left, top-right, bottom-right, bottom-left)
      scr.updateMatrixWorld();
      furnishedTv.corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => new THREE.Vector3(x * tvW / 2, y * tvH / 2, 0.001).applyMatrix4(scr.matrixWorld));
      Object.assign(furnishedTv, { pos: local(tvF, 0, 1.15, 0.05), normal: local(tvF, 0, 1.15, 1.05).sub(local(tvF, 0, 1.15, 0.05)), w: tvW, h: tvH, zone });
      let tvOn = false;
      furnishedTv.power = (on: boolean) => { tvOn = on; furnishedTv.on = tvOn; screenM.emissiveIntensity = tvOn ? 1.6 : 0; screenM.roughness = tvOn ? 0.3 : 0.05; };
      interactables.push({ id: "tv", zone, room, hit: scr, label: () => (tvOn ? "TV 메뉴 열기" : "TV 켜기"), act: () => { furnishedTv.power!(!tvOn); return "beep"; } });
      // the sofa facing it, a rug and a table between
      // the widest sofa that fits beside the doors (a 4-seater down to a 2.5-seater)
      let sofaW = 0, so: Frame | null = null;
      for (const w of [2.9, 2.6, 2.3, 2.0]) { if (w > pl.len(sofaSide) - 0.3) continue; so = pl.against(sofaSide, w, 0.98, mid); if (so) { sofaW = w; break; } }
      // (a door in the middle of that wall: the sofa slid along it, clear of the door)
      if (!so) for (const w of [2.6, 2.3, 2.0, 1.8]) { if (w > pl.len(sofaSide) - 0.3) continue; so = pl.against(sofaSide, w, 0.98, null); if (so) { sofaW = w; break; } }
      if (so) {
        // (the L-shaped corner one only where the room is deep enough for its chaise)
        let sv = variantOf(VS, "sofa", 5); if (sv === 3 && across < 4.4) sv = 0;
        put(sofaV(P, sofaW, sv), so, zone, true, sofaCover(P, VS, disposables)); pl.take(so.rect);
        if (sv === 3) { const ch0 = local(so, sofaW / 2 - 0.9, 0, 0.98), ch1 = local(so, sofaW / 2, 0, 1.6); colliders.push(...boxSegs((ch0.x + ch1.x) / 2, (ch0.z + ch1.z) / 2, Math.abs(ch1.x - ch0.x) || 0.9, Math.abs(ch1.z - ch0.z) || 0.9)); }
        seats.push({ label: "소파에 앉기", eye: local(so, 0.15, 1.12, 0.6), yaw: yawOut(so), pose: "sit", hit: hitIn(so, sofaW * 0.85, 0.5, 0.7, 0, 0.45, 0.55), zone, room });

        const c = rectCentre(so.rect), t = rectCentre(cab?.rect ?? tvF.rect);
        const mx = (c[0] + t[0]) / 2, mz = (c[1] + t[1]) / 2;
        const alongX = tvSide === "n" || tvSide === "s";
        const rot = alongX ? 0 : Math.PI / 2;
        const rw = Math.min(sofaW + 0.3, across - 0.5), rd = Math.min(2.0, Math.max(1.4, across - 1.4));
        put(M.rug(P, rw, rd), new THREE.Matrix4().makeRotationY(rot).setPosition(mx, pl.fy, mz), zone, false);
        const ctx = mx + (alongX ? 0 : (c[0] - t[0]) * 0.12), ctz = mz + (alongX ? (c[1] - t[1]) * 0.12 : 0);
        const cv = variantOf(VS, "coffee", 3);
        put(coffeeTableV(P, cv), new THREE.Matrix4().makeRotationY(rot).setPosition(ctx, pl.fy, ctz), zone, false);
        put(propsV(P, variantOf(VS, "propsTable", 12), disposables), new THREE.Matrix4().makeRotationY(rot + 0.4).setPosition(ctx + (cv === 2 ? (alongX ? -0.18 : 0) : 0), pl.fy + [0.385, 0.38, 0.415][cv], ctz + (cv === 2 ? (alongX ? 0 : -0.18) : 0)), zone, false);
        colliders.push(...boxSegs(ctx, ctz, alongX ? 1.3 : 0.74, alongX ? 0.74 : 1.3));
        // the art over the sofa
        // (one of ten kinds of picture, painted for this flat, in one of six frames; its shape varies too)
        const art = new THREE.MeshPhysicalMaterial({ map: paintingTexture(variantOf(VS, "art", 9973)), roughness: 0.92 }); disposables.push(art, art.map!);
        const aw = Math.min(1.6, sofaW * [0.6, 0.5, 0.7, 0.45][variantOf(VS, "artShape", 4)]), ah = [0.95, 0.8, 0.7, 1.05][variantOf(VS, "artShape", 4)];
        put(frameV(P, aw, ah, art, variantOf(VS, "frame", 6), disposables), new THREE.Matrix4().multiplyMatrices(so.m, new THREE.Matrix4().makeTranslation(0, 1.55, 0.005)), zone, false);
        // a floor lamp beside the sofa (window end)
        const lampSide = windowSide === "s" ? 1 : -1;
        const fl = local(so, (sofaW / 2 + 0.25) * (sofaSide === "e" ? -lampSide : lampSide), 0, 0.3);
        if (pl.free([fl.x - 0.2, fl.z - 0.2, fl.x + 0.2, fl.z + 0.2])) {
          const shade = zoneLamp(zone, P.lampShade as THREE.MeshPhysicalMaterial);
          put(M.floorLamp(P), new THREE.Matrix4().setPosition(fl.x, pl.fy, fl.z), zone, false, new Map([[P.lampShade, shade]]));
          colliders.push(...boxSegs(fl.x, fl.z, 0.3, 0.3));
        }
      }
      // the robot vacuum's dock: a free bit of wall, away from the window
      const dk = pl.against(sofaSide, 0.4, 0.45, windowSide === "s" || windowSide === "e" ? pl.span(sofaSide)[0] + 0.3 : pl.span(sofaSide)[1] - 0.3, 0.3)
        ?? pl.against(tvSide, 0.4, 0.45, null, 0.3);
      if (dk) { dock = { pos: local(dk, 0, 0, 0.04), out: local(dk, 0, 0, 1).sub(local(dk, 0, 0, 0)) }; pl.take(dk.rect); }
      // 스탠드 에어컨 in the window corner on the TV side, a big plant in the other
      const winSpan = pl.span(windowSide);
      const acU = tvSide === "w" || tvSide === "n" ? winSpan[0] + 0.25 : winSpan[1] - 0.25;
      const ac = pl.against(tvSide, 0.36, 0.36, windowSide === "s" || windowSide === "e" ? pl.span(tvSide)[1] - 0.25 : pl.span(tvSide)[0] + 0.25, 2);
      // which aircon: a newer flat often has ceiling cassettes (시스템 에어컨), an older a wall unit or a stand
      const acKind = built >= 2015 ? [2, 2, 0][variantOf(VS, "aircon", 3)] : [0, 1, 1][variantOf(VS, "aircon", 3)];
      if (ac && acKind !== 0) {
        let on = false, k = 0;
        if (acKind === 1) put(wallAircon(P), ac, zone, false);
        else { const c = local(ac, 0, 0, 0), sofaC = so ? local(so, 0, 0, 1.6) : c; put(ceilingCassette(P), new THREE.Matrix4().setPosition((c.x + sofaC.x) / 2, H, (c.z + sofaC.z) / 2), zone, false); }
        interactables.push({ id: "aircon", zone, room, hit: acKind === 1 ? hitIn(ac, 0.95, 0.35, 0.3, 0, 2.15, 0.12) : hitIn(ac, 0.5, 1.8, 0.4, 0, 0.9, 0.2), label: () => `에어컨 ${on ? "끄기" : "켜기"}`, act: () => { on = !on; return "beep"; },
          update: dt => { k += ((on ? 1 : 0) - k) * Math.min(1, dt * 2); }, loud: () => k * 0.1, channel: "air" });
      } else if (ac) {
        put(M.standAircon(P), ac, zone); pl.take(ac.rect);
        // 무풍 에어컨: the outlets' rings light when on, and it hums
        const glowM = new THREE.MeshBasicMaterial({ color: "#7fd8ff", transparent: true, opacity: 0, depthWrite: false }); disposables.push(glowM);
        const glow = new THREE.Group();
        for (const y of [1.48, 1.2, 0.92]) { const g = new THREE.RingGeometry(0.105, 0.112, 40); disposables.push(g); const me = new THREE.Mesh(g, glowM); me.position.set(0, y, 0.3612); glow.add(me); }
        glow.applyMatrix4(ac.m); dynamic.add(glow);
        let on = false, k = 0;
        interactables.push({ id: "aircon", zone, room, hit: hitIn(ac, 0.36, 1.8, 0.36, 0, 0.9, 0.18), label: () => `에어컨 ${on ? "끄기" : "켜기"}`, act: () => { on = !on; return "beep"; },
          update: dt => { k += ((on ? 1 : 0) - k) * Math.min(1, dt * 2); glowM.opacity = 0.85 * k; glow.visible = k > 0.01; }, loud: () => k * 0.12, channel: "air" });
      }
      void acU;
      const pf = pl.against(sofaSide, 0.45, 0.45, windowSide === "s" || windowSide === "e" ? pl.span(sofaSide)[1] - 0.3 : pl.span(sofaSide)[0] + 0.3, 0.3);
      if (pf) { put(M.plant(P, 1.6, 3), new THREE.Matrix4().multiplyMatrices(pf.m, new THREE.Matrix4().makeTranslation(0, 0, 0.24)), zone); pl.take(pf.rect); }
    }

    // ------------------------------------------------ kitchen and dining
    if (room.type === "kitchen") {
      const sink = plan.fixtures.find(f => f.type === "sink" && f.room === room.id);
      const back: SideName = "n";
      const [lo, hi] = pl.span(back);
      // the back run: from the first free point to the corner
      const ops = pl.openingsOn(back).filter(o => o.type !== "window");
      const start = Math.max(lo, ...ops.map(o => o.center + o.width / 2 + 0.08));
      const runA = hi - start;
      const sideRun: SideName = pl.openingsOn("e").length === 0 ? "e" : "w";
      const runBLen = Math.min(pl.len(sideRun) * 0.55, 2.4);
      if (runA > 1.2) {
        const u = start + runA / 2;
        const sinkLocal = sink ? Math.min(runA / 2 - 0.5, Math.max(-runA / 2 + 0.5, sink.pos[0] - u)) : undefined;
        const fA = pl.frameAt(back, u, runA, 0.62);
        put(M.lowerRun(P, runA, { sinkAt: sinkLocal }), fA, zone); pl.take(fA.rect);
        // 상부장 where there is no window, and the backsplash
        const wins = pl.windowsOn(back);
        const top = H - 0.02, bottom = 0.85 + 0.62;
        const pieces: [number, number][] = [];
        let a = start;
        for (const w of wins.sort((p, q) => p.a - q.a)) { if (w.a - 0.05 > a) pieces.push([a, w.a - 0.05]); a = Math.max(a, w.b + 0.05); }
        if (hi > a) pieces.push([a, hi]);
        for (const [p0, p1] of pieces) if (p1 - p0 > 0.3) put(M.upperRun(P, p1 - p0, bottom, top), pl.frameAt(back, (p0 + p1) / 2, p1 - p0, 0.35), zone, false);
        const bs = new THREE.PlaneGeometry(runA, 0.62); bs.translate(0, 0.85 + 0.31, 0.002);
        B.add(P.counter, zone, boxUV(bs), fA.m);
        // under-cabinet light
        const strip = new THREE.PlaneGeometry(runA - 0.1, 0.02).rotateX(Math.PI / 2); strip.translate(0, bottom - 0.003, 0.3);
        B.add(zoneLamp(zone, P.ledWarm), zone, strip, fA.m, false); strip.dispose();
        // the tap (a gooseneck), working
        if (sinkLocal !== undefined) {
          const neck = new THREE.TorusGeometry(0.11, 0.011, 12, 32, Math.PI); neck.rotateY(Math.PI / 2); neck.translate(0, 1.18, 0.12 + 0.0);
          const parts = [{ m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.014, 0.022, 0.33, 20)).translate(0, 1.04, 0.07) }, { m: P.chrome, g: boxUV(neck).translate(0, 0, 0.05) }, { m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.004, 0.006, 0.08, 10).rotateZ(Math.PI / 2)).translate(0.03, 0.95, 0.07) }];
          put(parts, new THREE.Matrix4().multiplyMatrices(fA.m, new THREE.Matrix4().makeTranslation(sinkLocal, 0, 0)), zone, false);
          const spout = local(fA, sinkLocal, 1.15, 0.28);
          faucet(room, zone, spout, pl.fy + 0.85 - 0.03 - 0.22 + 0.004, "주방 수전", "sink", 0.16, 0.02);
        }
      }
      // the side run with the cooktop and hood
      const fB = pl.against(sideRun, runBLen, 0.62, pl.span(sideRun)[0] + 0.62 + runBLen / 2);
      if (fB) {
        put(M.lowerRun(P, runBLen, { cookAt: 0 }), fB, zone); pl.take(fB.rect);
        put(M.hood(P, 0.75, 0.85 + 0.65, H - 0.02), fB, zone, false);
        for (const [p0, p1] of [[-runBLen / 2, -0.4], [0.4, runBLen / 2]] as [number, number][]) if (p1 - p0 > 0.3) put(M.upperRun(P, p1 - p0, 0.85 + 0.62, H - 0.02), new THREE.Matrix4().multiplyMatrices(fB.m, new THREE.Matrix4().makeTranslation((p0 + p1) / 2, 0, 0)), zone, false);
        const bs = new THREE.PlaneGeometry(runBLen, 0.62); bs.translate(0, 0.85 + 0.31, 0.002); B.add(P.counter, zone, boxUV(bs), fB.m);
        // the induction rings: glow when on
        const ringM = new THREE.MeshBasicMaterial({ color: "#ff3b1f", transparent: true, opacity: 0, depthWrite: false }); disposables.push(ringM);
        const rings = new THREE.Group();
        for (const [x, z, r] of [[-0.14, 0.42, 0.1], [0.14, 0.42, 0.08], [-0.14, 0.2, 0.08], [0.14, 0.2, 0.1]]) {
          const g = new THREE.RingGeometry(r - 0.006, r, 48).rotateX(-Math.PI / 2); disposables.push(g);
          const me = new THREE.Mesh(g, ringM); me.position.set(x, 0.85 + 0.0085, z); rings.add(me);
        }
        rings.applyMatrix4(fB.m); dynamic.add(rings);
        let cook = false;
        interactables.push({ id: "cooktop", zone, room, hit: hitBox(0.58, 0.04, 0.5, local(fB, 0, 0.87, 0.31)), label: () => `인덕션 ${cook ? "끄기" : "켜기"}`, act: () => { cook = !cook; return "beep"; },
          update: dt => { ringM.opacity += ((cook ? 0.9 : 0) - ringM.opacity) * Math.min(1, dt * 3); rings.visible = ringM.opacity > 0.01; } });
      }
      // the fridge and the 김치냉장고 as one tall built-in run: on the wall across from the side
      // run if it is free at the back, else after the side run
      const fh = Math.min(1.86, H - 0.4);
      for (const [s, prefer] of [[opposite[sideRun], pl.span(opposite[sideRun])[0] + 0.5], [sideRun, pl.span(sideRun)[0] + 0.62 + runBLen + 0.48]] as [SideName, number][]) {
        const fr = pl.against(s, 0.92, 0.74, prefer, 2);
        if (!fr) continue;
        fridge(fr, 0.91, fh, zone, room); pl.take(fr.rect);
        const u = centreAlong(fr.rect, s), dir = u < (pl.span(s)[0] + pl.span(s)[1]) / 2 ? 1 : -1;
        const kf = pl.against(s, 0.7, 0.74, u + dir * 0.82, 2);
        if (kf && Math.abs(centreAlong(kf.rect, s) - (u + dir * 0.82)) < 0.05) { put(M.kimchiFridge(P, 0.69, fh), kf, zone); pl.take(kf.rect); }
        break;
      }
      // the dining table in what's left, toward the living room, pendants over it
      // (the table and its chairs need ~0.6 m round it: tried from the middle of the free floor out)
      let cx = 0, cz = 0, tw = 0;
      const td = 0.9;
      search: for (const w of [1.8, 1.6, 1.4, 1.2]) {
        for (let k = 0; k < 120; k++) {
          const ox = ((k % 11) - 5) * 0.08, oz = (Math.floor(k / 11) - 5) * 0.08;
          const x = (pl.X0 + pl.X1) / 2 + ox, z = (pl.Z0 + pl.Z1) / 2 + oz + 0.25;
          if (pl.free([x - w / 2 - 0.1, z - td / 2 - 0.55, x + w / 2 + 0.1, Math.min(pl.Z1, z + td / 2 + 0.55)])) { cx = x; cz = z; tw = w; break search; }
        }
      }
      /** a shopping basket (six places) standing at (x, top, z) */
      const basket = (bx0: number, top: number, bz: number) => {
        const bw = 0.6, bd = 0.32, bh = 0.11;
        const kit: M.Kit = [M.bx(P.woodLight, bw, 0.008, bd, 0, 0.004, 0)];
        for (const sx of [-1, 1]) { kit.push(M.bx(P.woodLight, 0.008, bh, bd, sx * bw / 2, bh / 2, 0)); kit.push(M.bx(P.woodLight, bw, bh, 0.008, 0, bh / 2, sx * bd / 2)); }
        kit.push(M.rb(P.woodDark, bw + 0.012, 0.012, 0.012, 0.004, 0, bh, bd / 2), M.rb(P.woodDark, bw + 0.012, 0.012, 0.012, 0.004, 0, bh, -bd / 2));
        for (let i = 0; i < 6; i++) kit.push(M.bx(P.woodDark, bw, 0.004, 0.0085, 0, 0.02 + i * 0.016, bd / 2 + 0.001));
        put(kit, new THREE.Matrix4().setPosition(bx0, top, bz), zone, false);
        for (let i = 0; i < 6; i++) {
          const x = bx0 + ((i % 3) - 1) * 0.19, z = bz + (i < 3 ? -0.075 : 0.075);
          const a = new THREE.Group(); a.position.set(x, top + 0.008, z); dynamic.add(a);
          pantry.addSlot({ id: `b:${i}`, anchor: a, slim: false, where: "basket" });
          slotUse(`b:${i}`, room, zone, hitBox(0.18, 0.22, 0.15, new THREE.Vector3(x, top + 0.11, z)), "장바구니", () => true);
        }
      };
      // (no room for a table: the basket on the floor, out of the way)
      if (!tw) {
        floor: for (let k = 0; k < 200; k++) {
          const x = pl.X0 + 0.4 + ((k * 0.37) % 1) * (pl.X1 - pl.X0 - 0.8), z = pl.Z0 + 0.3 + (((k * 0.61) % 1)) * (pl.Z1 - pl.Z0 - 0.6);
          const r: Rect = [x - 0.33, z - 0.2, x + 0.33, z + 0.2];
          if (pl.free([r[0] - 0.05, r[1] - 0.05, r[2] + 0.05, r[3] + 0.05])) { basket(x, pl.fy, z); pl.take(r); colliders.push(...rectSegs(r)); break floor; }
        }
      }
      if (tw) {
        put(M.diningTable(P, tw, td), new THREE.Matrix4().setPosition(cx, pl.fy, cz), zone, false);
        // a shopping basket at the table's end: groceries to put away, or taken out of the fridge
        basket(cx - tw / 2 + 0.36, pl.fy + 0.7525, cz);
        colliders.push(...boxSegs(cx, cz, tw, td));
        for (const sx of tw > 1.5 ? [-0.45, 0.45] : [-0.3, 0.3]) for (const sz of [-1, 1]) {
          put(diningChair(), new THREE.Matrix4().makeRotationY(sz > 0 ? Math.PI : 0).setPosition(cx + sx, pl.fy, cz - sz * (td / 2 + 0.12)), zone, false, chairSwap);
        }
        const shade = zoneLamp(zone, P.lampShade as THREE.MeshPhysicalMaterial);
        for (const px of [-tw / 3, 0, tw / 3]) put(pendantV(P, H - 1.55, variantOf(VS, "pendant", 5)), new THREE.Matrix4().setPosition(cx + px, H, cz), zone, false, new Map([[P.lampShade, shade]]));
        pendants.push({ room, zone, kind: "linear", pos: new THREE.Vector3(cx, 1.45, cz), w: tw * 0.8, h: 0.25 });
      }
    }

    // ------------------------------------------------ bedrooms
    if (room.type === "master" || room.type === "bedroom") {
      const big = room.type === "master";
      const bw = big ? 1.6 : 1.1, bl = 2.08;
      // the head on a wall without a door, along which the room is long enough
      const order = (["w", "e", "n", "s"] as SideName[]).filter(s => s !== windowSide);
      let bedF: Frame | null = null, bedSide: SideName = "w";
      // a double bed's head against a wall (45 cm to pass at its foot), nightstands if they fit
      if (big) for (const s of [...order.filter(s => pl.openingsOn(s).length === 0), ...order]) {
        if (pl.depth(s) < bl + 0.45) continue;
        const f = pl.against(s, bw + 1.1, bl, null, 0.8, 0) ?? pl.against(s, bw + 0.1, bl, null, 0.8, 0);
        if (f) { bedF = pl.frameAt(s, centreAlong(f.rect, s), bw, bl); bedSide = s; break; }
      }
      if (!big) {
        // a single bed along a wall, its long side against it, the head in a corner
        for (const s of [...order.filter(s => pl.openingsOn(s).length === 0), ...order]) {
          const [lo, hi] = pl.span(s);
          const f = pl.against(s, bl, bw, lo + bl / 2, 0.8) ?? pl.against(s, bl, bw, hi - bl / 2, 0.8);
          if (!f) continue;
          const atLo = Math.abs(centreAlong(f.rect, s) - (lo + bl / 2)) < Math.abs(centreAlong(f.rect, s) - (hi - bl / 2));
          // the model (head at its z = 0, length along +z) turned to run along the wall
          const turn = new THREE.Matrix4().makeRotationY(atLo ? Math.PI / 2 : -Math.PI / 2);
          const m = new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(atLo ? -bl / 2 : bl / 2, 0, bw / 2)).multiply(turn);
          put(bedV(P, bw, bl, variantOf(VS + room.id, "bed", 8), bedCover(P, VS + room.id, disposables)), m, zone, false);
          colliders.push(...rectSegs(f.rect)); pl.take(f.rect); bedSide = s;
          const fwd = new THREE.Vector3(0, 0, 1).transformDirection(m);
          seats.push({ label: "침대에 눕기", eye: new THREE.Vector3(0, 0.78, 0.4).applyMatrix4(m), yaw: Math.atan2(-fwd.x, -fwd.z), pose: "lie", hit: hitIn(m, bw, 0.6, bl * 0.9, 0, 0.4, bl / 2), zone, room });
          break;
        }
      } else if (bedF) {
        put(bedV(P, bw, bl, variantOf(VS + room.id, "bed", 8), bedCover(P, VS + room.id, disposables)), bedF, zone); pl.take(bedF.rect);
        seats.push({ label: "침대에 눕기", eye: local(bedF, bw * 0.22, 0.78, 0.42), yaw: yawOut(bedF), pose: "lie", hit: hitIn(bedF, bw, 0.6, bl * 0.9, 0, 0.4, bl / 2), zone, room });
        const u = centreAlong(bedF.rect, bedSide);
        for (const s of [-1, 1]) {
          const nf = pl.against(bedSide, 0.48, 0.4, u + s * (bw / 2 + 0.3), 0.6);
          if (nf && Math.abs(centreAlong(nf.rect, bedSide) - (u + s * (bw / 2 + 0.3))) < 0.15) {
            put(M.nightstand(P), nf, zone); pl.take(nf.rect);
            const shade = zoneLamp(zone, P.lampShade as THREE.MeshPhysicalMaterial);
            put(M.tableLamp(P), new THREE.Matrix4().multiplyMatrices(nf.m, new THREE.Matrix4().makeTranslation(0, 0.52, 0.2)), zone, false, new Map([[P.lampShade, shade]]));
          }
        }
        // art over the head
        const art = new THREE.MeshPhysicalMaterial({ map: paintingTexture(variantOf(VS + room.id, "art", 9973)), roughness: 0.92 }); disposables.push(art, art.map!);
        put(frameV(P, Math.min(1.2, bw + 0.2), 0.6, art, variantOf(VS + room.id, "frame", 6), disposables), new THREE.Matrix4().multiplyMatrices(bedF.m, new THREE.Matrix4().makeTranslation(0, 1.45, 0.005)), zone, false);
      }
      if (big) {
        const v = pl.against(opposite[bedSide], 0.9, 0.42, null, 0.9) ?? pl.against(windowSide === "s" ? "n" : "s", 0.9, 0.42, null, 0.9);
        if (v) { put(M.vanity(P), v, zone); pl.take(v.rect); }
        const pf = pl.against(windowSide, 0.45, 0.45, pl.span(windowSide)[0] + 0.3, 0.3);
        if (pf) { put(M.plant(P, 1.2, 7), new THREE.Matrix4().multiplyMatrices(pf.m, new THREE.Matrix4().makeTranslation(0, 0, 0.24)), zone); pl.take(pf.rect); }
      } else {
        // a desk under the window, a wardrobe and a bookcase where they fit
        // (a small room: a 1 m desk, on any wall that takes it)
        // (with room to pull the chair out — 0.8 m clear before it — and a way to it from the door: the
        // bed once shut a desk off; the way kept clear of what comes after)
        let deskW = 1.2;
        const got: { f: Frame | null; way: [number, number][] | null } = { f: null, way: null };
        const tryDesk = (sd: SideName, w: number, d: number) => {
          const [lo, hi] = pl.span(sd);
          for (let u = lo + w / 2 + 0.05; u <= hi - w / 2 - 0.05; u += 0.2) {
            const f = pl.against(sd, w, d, u, 0.7, 0.8);
            if (!f) continue;
            const seat = local(f, 0, 0, 0.95), wy = pl.way(seat.x, seat.z);
            if (wy) { got.f = f; got.way = wy; deskW = w; return true; }
          }
          return false;
        };
        for (const sd of [windowSide, ...(["n", "s", "e", "w"] as SideName[]).filter(x => x !== windowSide)]) if (tryDesk(sd, 1.2, 0.6) || tryDesk(sd, 1.0, 0.55)) break;
        const dk = got.f;
        if (dk && got.way) pl.keep(got.way);
        if (dk) { put(M.desk(P, deskW), dk, zone); pl.take(dk.rect); put((v => (v < 5 ? chairV(P, v) : chairMore(P, v)))([0, 2, 3, 6, 9][variantOf(VS + room.id, "deskchair", 5)]), new THREE.Matrix4().multiplyMatrices(dk.m, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, 0.95)), zone, false); if (!furnishedLaptop.corners) laptop(dk, zone, room); }
        for (const s of sides.filter(s => s !== windowSide)) {
          const wd = Math.min(1.8, pl.len(s) - 0.4);
          const w = wd > 0.9 ? pl.against(s, wd, 0.6, null, 2.5) : null;
          if (w) { put(M.wardrobe(P, wd, Math.min(2.2, H - 0.12)), w, zone); pl.take(w.rect); break; }
        }
        const bk = sides.map(s => pl.against(s, 0.8, 0.32, null, 2.5)).find(Boolean);
        if (bk) { put(M.bookshelf(P, 0.8, 1.8), bk, zone); pl.take(bk.rect); }
      }
    }

    // ------------------------------------------------ dressroom, entrance, utility
    if (room.type === "dressroom") {
      const colours = [P.linen, P.drape, P.velvet, P.fabricBed, P.leather];
      for (const s of sides) { const L = pl.len(s) - 0.1; if (L < 0.8) continue; const f = pl.against(s, L, 0.5, null, 3); if (f) { put(M.closetSystem(P, L, Math.min(2.2, H - 0.1), colours), f, zone); pl.take(f.rect); } }
    }
    if (room.type === "entrance") {
      for (const s of (["w", "e", "n", "s"] as SideName[])) {
        const L = Math.min(2.0, pl.len(s) - 0.15);
        if (L < 0.9) continue;
        const f = pl.against(s, L, 0.38, null, 3);
        if (f) { put(M.shoeCabinet(P, L, Math.min(2.25, H - 0.02 - pl.fy)), f, zone); pl.take(f.rect); break; }
      }
    }
    if (room.type === "utility") {
      const w = plan.fixtures.find(f => f.type === "washer" && f.room === room.id);
      if (w) { const f = pl.against("n", 0.62, 0.68, w.pos[0], 2) ?? pl.against("w", 0.62, 0.68, null, 2); if (f) { put(M.washerDryer(P), f, zone); pl.take(f.rect); } }
      const b = pl.against("n", 0.46, 0.27, pl.X1 - 0.35, 0.5) ?? pl.against("e", 0.46, 0.27, null, 0.5);
      if (b) put(M.boiler(P), b, zone, false);
    }

    // ------------------------------------------------ bathrooms
    if (room.type === "bathroom" || room.type === "ensuite") {
      const fx = plan.fixtures.filter(f => f.room === room.id);
      const tub = fx.find(f => f.type === "bathtub"), sh = fx.find(f => f.type === "shower"), wc = fx.find(f => f.type === "toilet"), wb = fx.find(f => f.type === "washbasin");
      if (tub) {
        const l = Math.min(1.6, pl.depth("w") - 0.05), wd = 0.75;
        const f: Frame = { m: new THREE.Matrix4().setPosition(pl.X0, pl.fy, pl.Z0), rect: [pl.X0, pl.Z0, pl.X0 + wd, pl.Z0 + l] };
        put(M.bathtub(P, l, wd), f, zone); pl.take(f.rect);
        // the spout on the wall at the tub's end, and its pool
        const sp = new THREE.Vector3(pl.X0 + wd / 2, pl.fy + 0.72, pl.Z0 + 0.06);
        put([{ m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 16).rotateX(Math.PI / 2)).translate(0, 0, 0.08) }, M.rb(P.chrome, 0.2, 0.06, 0.06, 0.02, 0, 0.12, 0.03)], new THREE.Matrix4().setPosition(sp.x, sp.y - 0.01, pl.Z0), zone, false);
        faucet(room, zone, sp.clone().setZ(pl.Z0 + 0.16), pl.fy + 0.55 - 0.42, "욕조 수전", "tub", 0.3, 0.32);
        // (the pool in a tub is the tub's shape)
        const last = dynamic.children[dynamic.children.length - 1] as THREE.Mesh;
        last.position.set(pl.X0 + wd / 2, pl.fy + 0.13 + 0.004, pl.Z0 + l / 2); last.scale.set(1, 1, 1);
        last.geometry = new THREE.PlaneGeometry(wd - 0.26, l - 0.26).rotateX(-Math.PI / 2); disposables.push(last.geometry);
      }
      if (sh) {
        const w = Math.min(1.0, pl.len("n") * 0.45), d = 0.95;
        const f: Frame = { m: new THREE.Matrix4().setPosition(pl.X1 - w / 2, pl.fy, pl.Z0), rect: [pl.X1 - w, pl.Z0, pl.X1, pl.Z0 + d] };
        pl.take(f.rect);
        put(M.showerSet(P, H - pl.fy), f.m, zone, false);
        // glass panels: the front, and the side toward the room
        const glass: M.Kit = [
          { m: P.glass, g: new THREE.PlaneGeometry(w * 0.55, 1.95).translate(-w * 0.2, 0.975 + 0.02, d), cast: false },
          { m: P.glass, g: new THREE.PlaneGeometry(d, 1.95).rotateY(Math.PI / 2).translate(-w / 2, 0.975 + 0.02, d / 2), cast: false },
          M.bx(P.blackMetal, 0.02, 1.97, 0.02, -w / 2, 0.985, d), M.bx(P.blackMetal, w * 0.6, 0.02, 0.02, -w * 0.2, 1.97, d),
          M.bx(P.blackMetal, 0.02, 0.02, d, -w / 2, 1.97, d / 2), M.bx(P.threshold, w, 0.04, 0.04, 0, 0.02, d),
        ];
        put(glass, f.m, zone, false);
        colliders.push([pl.X1 - w, pl.Z0 + d, pl.X1 - w * 0.25, pl.Z0 + d], [pl.X1 - w, pl.Z0, pl.X1 - w, pl.Z0 + d]);
        const head = new THREE.Vector3(pl.X1 - w / 2, pl.fy + Math.min(2.13, H - pl.fy - 0.12), pl.Z0 + 0.3);
        faucet(room, zone, head, pl.fy + 0.005, "샤워기", "shower", 0.3, 0.003);
      }
      if (wc) {
        const f = pl.against("n", 0.45, 0.7, wc.pos[0], 0.9);
        if (f) {
          put(toiletV(P, variantOf(VS, "toilet", 3)), f, zone); pl.take(f.rect);
          const waterM = poolMaterial(); disposables.push(waterM);
          const wg = new THREE.CircleGeometry(0.1, 32).rotateX(-Math.PI / 2); wg.scale(1, 1, 1.3); disposables.push(wg);
          const w = new THREE.Mesh(wg, waterM); w.position.copy(local(f, 0, 0.27, 0.44)); dynamic.add(w);
          // the rim wash: a skin just inside the bowl's wall (models.toilet's lathe), from under the rim to the water
          const washM = washMaterial(); disposables.push(washM);
          const wgeo = new THREE.LatheGeometry([[0.146, 0.391], [0.124, 0.362], [0.097, 0.329], [0.075, 0.298], [0.06, 0.272]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
          wgeo.scale(1, 1, 1.38); wgeo.translate(0, 0, 0.43); disposables.push(wgeo);
          const wash = new THREE.Mesh(wgeo, washM); wash.applyMatrix4(f.m); wash.visible = false; wash.renderOrder = 2; dynamic.add(wash);
          const y0 = w.position.y, sc0 = w.scale.clone();
          // a flush (the recording's 6.8 s): the rim jets rush down and the bowl swirls, the siphon pulls
          // the water down and away, it gurgles, then the tank refills it slowly with a thin wash
          const FLUSH = 6.8; let t = 0;
          const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
          interactables.push({ id: `wc-${room.id}`, zone, room, hit: hitBox(0.42, 0.85, 0.7, local(f, 0, 0.42, 0.35)), label: () => t > 0 ? "변기 물 내리는 중…" : "변기 물 내리기",
            act: () => { if (t > 0) return null; t = FLUSH; return "flush"; },
            update: dt => {
              t = Math.max(0, t - dt);
              const e = t > 0 ? FLUSH - t : 99;
              const rush = ss(0, 0.3, e) * (1 - ss(2.6, 3.6, e)), refill = ss(3.8, 4.4, e) * (1 - ss(6.0, 6.8, e));
              washM.uniforms.uOn.value = Math.max(rush, refill * 0.35);
              washM.uniforms.uFront.value = Math.min(1.15, e / 0.35);
              wash.visible = washM.uniforms.uOn.value > 0.01;
              const swirl = ss(0.1, 0.8, e) * (1 - ss(3.0, 4.2, e));
              waterM.uniforms.uSwirl.value = swirl * 1.6;
              waterM.uniforms.uFoam.value = ss(0.2, 0.9, e) * (1 - ss(2.8, 3.8, e));
              waterM.uniforms.uRipple.value = refill * 0.8;
              // (the level: down as the siphon breaks, back up as it refills; smaller lower in the bowl)
              const down = ss(1.2, 2.8, e) * (1 - ss(3.9, 6.5, e));
              w.position.y = y0 - 0.045 * down;
              w.scale.set(sc0.x * (1 - 0.35 * down), 1, sc0.z * (1 - 0.35 * down));
            },
          });
          // a towel rail and a roll holder on the side wall
          put(M.towelRail(P), new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 1.2, 0)), zone, false);
        }
      }
      if (wb) {
        const vw = Math.min(0.9, pl.len("n") * 0.4);
        const f = pl.against("n", vw, 0.48, wb.pos[0], 0.9);
        if (f) {
          put(M.washbasinVanity(P, vw), f, zone); pl.take(f.rect);
          // the mirror cabinet: a real reflection (the scene renders it when in view)
          put(M.mirrorCabinet(P, vw), new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(0, 1.55, 0)), zone, false);
          const c = local(f, 0, 1.55, 0.141), n = local(f, 0, 1.55, 1.141).sub(c).normalize();
          mirrors.push({ pos: c, normal: n, w: vw - 0.01, h: 0.73, zone });
          // the basin tap
          put([{ m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.016, 0.02, 0.2, 20)).translate(0, 0.96, 0.08) }, { m: P.chrome, g: boxUV(new THREE.BoxGeometry(0.03, 0.02, 0.13)).translate(0, 1.055, 0.13) }, { m: P.chrome, g: boxUV(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10)).rotateX(-0.6).translate(0, 1.085, 0.06) }], f.m, zone, false);
          faucet(room, zone, local(f, 0, 1.045, 0.19), pl.fy + 0.86, "세면대 수전", "basin", 0.1, 0.012);
        }
      }
    }

    // ------------------------------------------------ curtains on the bigger windows
    for (const w of shell.windows.filter(w => w.room === room)) {
      if (room.type === "kitchen" || room.type === "utility" || room.type === "bathroom" || room.type === "ensuite") { curtainOpen.set(shell.windows.indexOf(w), () => 1); continue; }
      const wi = shell.windows.indexOf(w);
      const top = H - 0.03, len = top - pl.fy - 0.01, span = w.width + 0.5;
      const yaw = Math.atan2(w.inward.x, w.inward.z);
      const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(w.center.x + w.inward.x * (HALF_WALL + 0.13), 0, w.center.z + w.inward.z * (HALF_WALL + 0.13));
      // the rail
      put([M.bx(P.trim, span + 0.1, 0.03, 0.1, 0, top + 0.0, 0)], base, zone, false);
      // a pair of pleated panels, gathered toward the two ends of the rail: one mesh a fabric,
      // its vertices moved (on the CPU, only while it moves) to gather or spread it
      const pair = (mat: THREE.Material, depth: number, folds: number, front: number) => {
        const half = span / 2, parts: THREE.BufferGeometry[] = [];
        for (const sideSign of [1, -1]) {
          const g = new THREE.PlaneGeometry(half, len, folds * 6, 1);
          const p = g.getAttribute("position");
          for (let j = 0; j < p.count; j++) p.setZ(j, Math.sin((p.getX(j) / half) * folds * Math.PI * 2) * depth);
          g.computeVertexNormals();
          // (each panel's outer edge at the rail's end: x from the end inward)
          g.translate(sideSign * half / 2, top - len / 2 - 0.02, 0);
          g.translate(-sideSign * half, 0, 0);
          const uv = g.getAttribute("uv"); for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * half * 1.3, uv.getY(j) * len);
          parts.push(g.index ? g.toNonIndexed() : g);
          g.dispose();
        }
        const n0 = parts[0].getAttribute("position").count;
        const g = mergeGeometries(parts)!; parts.forEach(x => x.dispose());
        const home = Float32Array.from(g.getAttribute("position").array as Float32Array);
        const me = new THREE.Mesh(g, mat); me.castShadow = true; me.receiveShadow = true;
        me.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().makeTranslation(0, 0, front)));
        dynamic.add(me); disposables.push(g);
        return (k: number) => {
          const a = g.getAttribute("position") as THREE.BufferAttribute;
          for (let j = 0; j < a.count; j++) { const x = home[j * 3], end = j < n0 ? -half : half; a.setX(j, end + (x - end) * k); }
          a.needsUpdate = true; g.computeBoundingSphere();
        };
      };
      const sheer = pair(P.sheer, 0.025, 7, 0), drape = pair(P.drape, 0.05, 6, 0.06);
      (P.sheer as THREE.MeshPhysicalMaterial).transparent = true; (P.sheer as THREE.MeshPhysicalMaterial).opacity = 0.55; (P.sheer as THREE.MeshPhysicalMaterial).depthWrite = false; (P.sheer as THREE.MeshPhysicalMaterial).forceSinglePass = true; // (a transparent double-sided material is otherwise drawn twice, re-picking its program each time)
      let shut = 0, want = 0, sheerShut = 0, sheerWant = 0.6;
      const setScale = () => {
        // gathered to the sides: a drape squeezes to 18% of its width when open
        drape(0.18 + 0.82 * shut);
        sheer(0.15 + 0.85 * sheerShut);
      };
      setScale();
      curtainOpen.set(wi, () => (1 - shut * 0.92) * (1 - sheerShut * 0.35));
      const hit = hitBox(span, len * 0.9, 0.12, w.center.clone().setY(pl.fy + len / 2).addScaledVector(w.inward, HALF_WALL + 0.16));
      interactables.push({ id: `curtain-${wi}`, zone, room, hit, label: () => `${room.label} 커튼 ${want > 0.5 ? "열기" : "치기"}`,
        act: () => { want = want > 0.5 ? 0 : 1; sheerWant = want ? 1 : 0.6; return "curtain"; },
        update: dt => { const s0 = shut, h0 = sheerShut; shut += Math.sign(want - shut) * Math.min(Math.abs(want - shut), dt * 0.9); sheerShut += Math.sign(sheerWant - sheerShut) * Math.min(Math.abs(sheerWant - sheerShut), dt * 0.9); if (s0 !== shut || h0 !== sheerShut) { setScale(); shadowMoved.at = performance.now(); } } });
    }
  }

  // ---------------------------------------------------------------- the fridge, opening
  function fridge(f: Frame, w: number, h: number, zone: number, room: Room) {
    const d = 0.72, upper = h * 0.62, lower = h * 0.235, gap = 0.006;
    const k: M.Kit = [M.bx(P.rubber, w, h, 0.03, 0, h / 2, 0.015), M.bx(P.rubber, 0.03, h, d - 0.04, -w / 2 + 0.015, h / 2, (d - 0.04) / 2), M.bx(P.rubber, 0.03, h, d - 0.04, w / 2 - 0.015, h / 2, (d - 0.04) / 2), M.bx(P.rubber, w, 0.03, d - 0.04, 0, h - 0.015, (d - 0.04) / 2)];
    // the lower drawers (closed), the middle band, and the cabinet inside: lit when the doors open
    for (const x of [-w / 4, w / 4]) k.push(M.rb(P.appliance, w / 2 - gap, lower, 0.04, 0.006, x, lower / 2 + 0.01, d - 0.02, 2));
    k.push(M.bx(P.rubber, w, h - upper - lower - 0.02, d - 0.04, 0, lower + 0.02 + (h - upper - lower - 0.02) / 2, (d - 0.04) / 2));
    put(k, f, zone);
    const inner = new THREE.MeshPhysicalMaterial({ color: "#f4f6f7", roughness: 0.4, emissive: "#eef6ff", emissiveIntensity: 0 });
    inner.userData.glow = 0.45; disposables.push(inner);
    const y0 = h - upper, front = d - 0.215;
    // the cabinet: liner walls, a back panel with its air vents, an LED bar under the top, glass
    // shelves with a chrome nosing, and a crisper drawer across the floor's back half
    const inside: M.Kit = [
      M.bx(inner, w - 0.06, 0.02, d - 0.1, 0, y0 + 0.01, (d - 0.1) / 2 + 0.03), M.bx(inner, w - 0.06, upper - 0.04, 0.02, 0, y0 + upper / 2, 0.04),
      M.bx(inner, 0.02, upper - 0.04, d - 0.1, -w / 2 + 0.04, y0 + upper / 2, (d - 0.1) / 2 + 0.03), M.bx(inner, 0.02, upper - 0.04, d - 0.1, w / 2 - 0.04, y0 + upper / 2, (d - 0.1) / 2 + 0.03),
      M.bx(inner, w - 0.06, 0.02, d - 0.1, 0, y0 + upper - 0.03, (d - 0.1) / 2 + 0.03),
      M.bx(P.ledPanel, w * 0.5, 0.008, 0.03, 0, y0 + upper - 0.045, d - 0.25),
    ];
    for (let i = 0; i < 7; i++) inside.push(M.bx(P.rubber, 0.012, 0.09, 0.004, -0.09 + i * 0.03, y0 + upper - 0.15, 0.052));
    const shelfYs = [0.33, 0.62].map(k => y0 + upper * k);
    for (const y of shelfYs) {
      inside.push({ m: P.glass, g: new THREE.BoxGeometry(w - 0.1, 0.008, front - 0.05).translate(0, y, 0.05 + (front - 0.05) / 2), cast: false });
      inside.push(M.bx(P.chrome, w - 0.1, 0.014, 0.008, 0, y, front));
    }
    inside.push(M.bx(inner, w - 0.1, 0.004, 0.24, 0, y0 + 0.16, 0.17), { m: P.glass, g: new THREE.BoxGeometry(w - 0.1, 0.13, 0.004).translate(0, y0 + 0.09, 0.29), cast: false });
    for (const p of inside) { B.add(p.m, 0, p.g, f.m, false); p.g.dispose(); }
    let open = false, t = 0;
    const isOpen = () => open && t > 0.85;
    // the shelves' slots: three levels (the floor in front of the crisper, two glass shelves), four across
    const levelYs = [y0 + 0.02, ...shelfYs.map(y => y + 0.004)];
    const shelfRoot = new THREE.Group(); shelfRoot.applyMatrix4(f.m); shelfRoot.visible = false; dynamic.add(shelfRoot);
    const across = (w - 0.12) / 4;
    levelYs.forEach((y, lv) => {
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + 0.06 + across * (i + 0.5), z = front - 0.1;
        const a = new THREE.Group(); a.position.set(x, y, z); shelfRoot.add(a);
        const id = `f:${lv}:${i}`;
        pantry.addSlot({ id, anchor: a, slim: false, where: "fridge" });
        slotUse(id, room, zone, hitIn(f, across - 0.01, 0.2, 0.2, x, y + 0.1, z), `냉장고 ${lv + 1}층`, isOpen);
      }
    });
    // the two upper doors on hinges at the sides, each with two pockets inside
    const doors: THREE.Group[] = [], pockets: THREE.Group[] = [], follows: { sync(): void }[] = [];
    [-1, 1].forEach((side, di) => {
      const pivot = new THREE.Group(), dw = w / 2 - gap;
      const panel = new THREE.Mesh(boxUV(new RoundedBoxGeometry(dw, upper - 0.01, 0.045, 2, 0.006)), P.appliance); panel.position.set(-side * dw / 2, (upper - 0.01) / 2, 0.0225); panel.castShadow = true;
      const liner = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.06, upper - 0.08, 0.06), inner); liner.position.set(-side * dw / 2, (upper - 0.01) / 2, -0.03);
      pivot.add(panel, liner);
      disposables.push(panel.geometry, liner.geometry);
      // the pockets: a white tray with a clear front lip, two places in each
      const pk = new THREE.Group(); pivot.add(pk); pockets.push(pk); pk.visible = false;
      const trays: THREE.BufferGeometry[] = [], lips: THREE.BufferGeometry[] = [];
      [0.16, 0.58].forEach((by, bi) => {
        trays.push(new THREE.BoxGeometry(dw - 0.1, 0.006, 0.1).translate(-side * dw / 2, by, -0.11));
        lips.push(new THREE.BoxGeometry(dw - 0.1, 0.06, 0.004).translate(-side * dw / 2, by + 0.03, -0.16));
        for (let i = 0; i < 2; i++) {
          const x = -side * dw / 2 + (i ? 1 : -1) * (dw - 0.1) / 4;
          const a = new THREE.Group(); a.position.set(x, by + 0.003, -0.11); pk.add(a);
          const id = `d:${di}:${bi}:${i}`;
          pantry.addSlot({ id, anchor: a, slim: true, where: "door" });
          const fh = follow((dw - 0.12) / 2, 0.22, 0.12, pivot, new THREE.Vector3(x, by + 0.11, -0.11)); follows.push(fh);
          slotUse(id, room, zone, fh.me, `냉장고 문 ${bi ? "위" : "아래"} 칸`, isOpen);
        }
      });
      const tray = new THREE.Mesh(mergeGeometries(trays)!, inner), lip = new THREE.Mesh(mergeGeometries(lips)!, P.glass);
      trays.forEach(g => g.dispose()); lips.forEach(g => g.dispose()); disposables.push(tray.geometry, lip.geometry);
      lip.renderOrder = 2; pk.add(tray, lip);
      pivot.applyMatrix4(new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(side * w / 2, y0, d - 0.045)));
      dynamic.add(pivot); doors.push(pivot);
      // (open, the door itself closes it)
      const dh = follow(dw, upper - 0.1, 0.06, pivot, new THREE.Vector3(-side * dw / 2, upper / 2, 0.02)); follows.push(dh);
      interactables.push({ id: `fridge-door-${di}`, zone, room, hit: dh.me, enabled: () => open, label: () => "냉장고 닫기", act: () => { open = false; return "fridge"; } });
    });
    const base = doors.map(p => p.rotation.y);
    interactables.push({ id: "fridge", zone, room, hit: hitIn(f, w, upper, 0.1, 0, y0 + upper / 2, d), enabled: () => !open, label: () => "냉장고 열기",
      act: () => { open = true; return "fridge"; },
      update: dt => {
        for (const fl of follows) fl.sync();
        const want = open ? 1 : 0;
        if (t === want) return;
        t += Math.sign(want - t) * Math.min(Math.abs(want - t), dt * 1.8);
        const e = t * t * (3 - 2 * t);
        doors.forEach((p, i) => { p.rotation.y = base[i] + (i === 0 ? -1 : 1) * e * 1.75; });
        inner.emissiveIntensity = e * 0.16;
        // (what is inside drawn only while it can be seen)
        shelfRoot.visible = t > 0; pockets.forEach(p => (p.visible = t > 0));
        shadowMoved.at = performance.now();
      } });
  }

  // ---------------------------------------------------------------- a laptop, open on the desk
  /** a 14" aluminium laptop in the MacBook manner (no maker's mark): a thin unibody, a black glass
   * display with slim bezels, a black keyboard in a recess, a wide trackpad; the lid at 110°. Its
   * screen's corners are where the page lays a real browser. */
  function laptop(f: Frame, zone: number, room: Room) {
    const bw = 0.313, bd = 0.221, x0 = -0.12, z0 = 0.32, top = 0.75;
    const alu = new THREE.MeshPhysicalMaterial({ color: "#c9ccd1", roughness: 0.32, metalness: 0.85, clearcoat: 0.2 }); disposables.push(alu);
    const keyM = new THREE.MeshPhysicalMaterial({ color: "#16171a", roughness: 0.55 }); disposables.push(keyM);
    const kit: M.Kit = [M.rb(alu, bw, 0.0155, bd, 0.007, x0, top + 0.0078, z0)];
    // the keyboard: six rows of keys in a dark well, the trackpad below it
    kit.push(M.bx(P.applianceDark, bw - 0.05, 0.0006, 0.105, x0, top + 0.0154, z0 - 0.045));
    const rows = [14, 14, 14, 13, 12, 10];
    rows.forEach((n, r) => {
      const kw = (bw - 0.062) / 14 - 0.0025, y = top + 0.0158, z = z0 - 0.092 + r * 0.0176;
      for (let i = 0; i < n; i++) {
        const w = r === 5 && i === 4 ? kw * 5 + 0.01 : kw;
        const x = x0 - (bw - 0.062) / 2 + (i + 0.5) * ((bw - 0.062) / n);
        kit.push(M.rb(keyM, r === 5 ? w * (n === 10 ? 1.1 : 1) : w, 0.0012, r === 0 ? 0.008 : 0.0148, 0.0012, x, y, z));
      }
    });
    kit.push(M.rb(alu, 0.13, 0.0003, 0.08, 0.002, x0, top + 0.0156, z0 + 0.06));               // trackpad (a hairline in the deck)
    put(kit, f, zone, false);
    // the lid on its hinge at the back edge: shut flat over the deck until opened, then back to 110°;
    // aluminium back with the apple, lit from inside while the machine is on; black glass front
    // (the hinge turns about the desk's own x: a child of a group carrying the desk's frame)
    const mount = new THREE.Group();
    mount.applyMatrix4(new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(x0, top + 0.015, z0 - bd / 2)));
    dynamic.add(mount);
    const pivot = new THREE.Group(); mount.add(pivot);
    const lidG = mergeGeometries([boxUV(new RoundedBoxGeometry(bw, 0.215, 0.0055, 2, 0.006)).translate(0, 0.1075, -0.0028)])!;
    const lid = new THREE.Mesh(lidG, alu); lid.castShadow = true; disposables.push(lidG);
    const glassG = boxUV(new RoundedBoxGeometry(bw - 0.004, 0.211, 0.0008, 2, 0.005)).translate(0, 0.1075, 0.0004);
    const glass = new THREE.Mesh(glassG, P.applianceDark); disposables.push(glassG);
    const sw = 0.297, sh = 0.192, sy = 0.11;
    const scrM = new THREE.MeshBasicMaterial({ color: "#05070a" }); disposables.push(scrM);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), scrM); scr.position.set(0, sy, 0.0012); disposables.push(scr.geometry);
    // the apple: a whole apple's silhouette (no bite) and its leaf, on the back, glowing when on
    const ap = new THREE.Shape();
    ap.moveTo(0, -0.42); ap.bezierCurveTo(0.08, -0.47, 0.18, -0.5, 0.3, -0.44); ap.bezierCurveTo(0.46, -0.34, 0.52, -0.1, 0.5, 0.08);
    ap.bezierCurveTo(0.48, 0.3, 0.32, 0.46, 0.12, 0.38); ap.bezierCurveTo(0.06, 0.35, 0.03, 0.34, 0, 0.34);
    ap.bezierCurveTo(-0.03, 0.34, -0.06, 0.35, -0.12, 0.38); ap.bezierCurveTo(-0.32, 0.46, -0.48, 0.3, -0.5, 0.08);
    ap.bezierCurveTo(-0.52, -0.1, -0.46, -0.34, -0.3, -0.44); ap.bezierCurveTo(-0.18, -0.5, -0.08, -0.47, 0, -0.42);
    const leaf = new THREE.Shape(); leaf.moveTo(0.0, 0.42); leaf.bezierCurveTo(0.02, 0.58, 0.14, 0.7, 0.24, 0.72); leaf.bezierCurveTo(0.24, 0.56, 0.12, 0.44, 0.0, 0.42);
    const logoG = new THREE.ShapeGeometry([ap, leaf], 12); logoG.scale(0.045, 0.045, 1); logoG.rotateY(Math.PI); logoG.translate(0, 0.11, -0.0058); disposables.push(logoG);
    const logoM = new THREE.MeshBasicMaterial({ color: "#d9dde2" }); disposables.push(logoM);
    const logo = new THREE.Mesh(logoG, logoM);
    pivot.add(lid, glass, scr, logo);
    const SHUT = Math.PI / 2 - 0.012, OPEN = -0.35;
    pivot.rotation.x = SHUT;
    furnishedLaptop.screen = scrM;
    furnishedLaptop.cornersNow = () => {
      mount.updateMatrixWorld();
      const c = (x: number, y: number) => new THREE.Vector3(x, sy + y, 0.0012).applyMatrix4(pivot.matrixWorld);
      return [c(-sw / 2, sh / 2), c(sw / 2, sh / 2), c(sw / 2, -sh / 2), c(-sw / 2, -sh / 2)];
    };
    furnishedLaptop.normal = new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeRotationX(OPEN)));
    furnishedLaptop.corners = furnishedLaptop.cornersNow();
    let t = 0;
    const hit = hitIn(f, bw, 0.2, bd, x0, top + 0.08, z0);
    interactables.push({ id: "laptop", zone, room, hit, label: () => furnishedLaptop.on ? "노트북 닫기" : "노트북 열기 (게임)",
      act: () => { furnishedLaptop.on = !furnishedLaptop.on; return "click"; },
      update: dt => {
        const want = furnishedLaptop.on ? 1 : 0;
        if (t === want) return;
        t += Math.sign(want - t) * Math.min(Math.abs(want - t), dt * 1.1);
        const e = t * t * (3 - 2 * t);
        pivot.rotation.x = SHUT + (OPEN - SHUT) * e;
        // (the apple lights as it opens; the screen wakes once it is up)
        logoM.color.set("#d9dde2").lerp(new THREE.Color("#ffffff").multiplyScalar(2.4), ss01(t * 1.6));
        scrM.color.set("#05070a").lerp(new THREE.Color("#e9f1f7"), ss01((t - 0.7) / 0.3));
        furnishedLaptop.open = t;
        shadowMoved.at = performance.now();
      } });
  }

  // ---------------------------------------------------------------- light switches
  for (const f of plan.fixtures.filter(f => f.type === "switch")) {
    const room = plan.rooms.find(r => r.id === f.room)!, zone = zoneOf(room);
    const yaw = (f.rot * Math.PI) / 180;
    const inward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const at = new THREE.Vector3(f.pos[0], 1.2, f.pos[1]).addScaledVector(inward, HALF_WALL);
    const pm = new THREE.Matrix4().makeRotationY(yaw).setPosition(at.clone().addScaledVector(inward, 0.006));
    const svn = variantOf(VS, "switch", 12), sw = svn < 4 ? switchV(P, svn) : switchMore(P, svn, disposables);
    B.add(sw.plateM, zone, sw.plate, pm, false); sw.plate.dispose();
    const rocker = new THREE.Mesh(sw.rocker, sw.rockerM);
    rocker.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pm, new THREE.Matrix4().makeTranslation(0, 0, 0.008)));
    disposables.push(rocker.geometry);
    dynamic.add(rocker);
    const plate = hitIn(pm, 0.09, 0.14, 0.04, 0, 0, 0.01);
    interactables.push({ id: `switch-${room.id}`, zone, room, hit: plate, label: () => `${room.label} 전등 ${switchState.get(zone) === false ? "켜기" : "끄기"}`,
      act: () => { const on = switchState.get(zone) !== false; switchState.set(zone, !on); return "click"; },
      update: () => { rocker.rotation.x = switchState.get(zone) === false ? 0.12 : -0.12; } });
  }

  pantry.stock();
  return {
    interactables, colliders, pendants, curtainOpen, tv: furnishedTv, laptop: furnishedLaptop, mirrors, seats, dock, pantry, roomTimings,
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}

/** zone → lights on (true unless switched off): read by the scene each frame */
export const switchState = new Map<number, boolean>();

const ss01 = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
function rectCentre(r: Rect): [number, number] { return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; }
function centreAlong(r: Rect, s: SideName) { return s === "n" || s === "s" ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2; }
function rectSegs(r: Rect): Seg[] { const [a, b, c, d] = r; return [[a, b, c, b], [c, b, c, d], [c, d, a, d], [a, d, a, b]]; }
function boxSegs(x: number, z: number, w: number, d: number): Seg[] { return rectSegs([x - w / 2, z - d / 2, x + w / 2, z + d / 2]); }

/** what the TV shows: a still of a mountain lake at dawn, painted */
function tvTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 720); sky.addColorStop(0, "#1d3557"); sky.addColorStop(0.45, "#e9a46a"); sky.addColorStop(0.62, "#f6d6a8"); sky.addColorStop(1, "#24364a");
  g.fillStyle = sky; g.fillRect(0, 0, 1280, 720);
  g.fillStyle = "#fff4d6"; g.beginPath(); g.arc(820, 400, 46, 0, Math.PI * 2); g.fill();
  const ridge = (y: number, amp: number, col: string, seed: number) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, 720); for (let x = 0; x <= 1280; x += 8) g.lineTo(x, y - Math.abs(Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.013 + seed * 3) * amp * 0.35)); g.lineTo(1280, 720); g.fill(); };
  ridge(450, 120, "#5b6b84", 1); ridge(480, 80, "#3d4b62", 2.3); ridge(520, 50, "#283447", 4.1);
  const lake = g.createLinearGradient(0, 520, 0, 720); lake.addColorStop(0, "#d9a774"); lake.addColorStop(1, "#1a2433");
  g.fillStyle = lake; g.fillRect(0, 525, 1280, 200);
  g.globalAlpha = 0.25; g.fillStyle = "#fff4d6"; for (let i = 0; i < 40; i++) g.fillRect(780 + Math.sin(i) * 60, 530 + i * 4, 80 - i, 2); g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
