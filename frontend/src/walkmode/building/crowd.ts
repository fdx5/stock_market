import * as THREE from "three";
import { findPath, type FloorPlan, type Spot, type ZoneKind } from "./plan";

/* The people of a building's floor: tens to a few hundred, by what the floor is (plan.ts). Drawn as
 * one instanced mesh per body part (torso, head, hair, arms, legs — a dozen draws for the whole
 * floor), posed each frame on the CPU from what each is doing:
 *   sit       at a desk (typing), in a waiting room, at a table (eating), in a classroom
 *   lie       in a hospital bed (a visitor sitting by some)
 *   stand     at a counter (staff behind it, a queue before it), at a shelf (looking), at the lifts
 *   walk      along a path found on the floor's grid, to the next thing they do
 * Their roles by the floor's use: office workers, receptionists, nurses in scrubs, doctors in white
 * coats, patients, shoppers and cashiers, diners and servers, students, drivers in the car park.
 * Each does something for a while, then gets up and walks to something else (most stay seated). */

type Act = "sit" | "lie" | "stand" | "walk" | "type";
interface Person {
  x: number; z: number; yaw: number; y: number; act: Act; timer: number; phase: number; speed: number;
  /** the gait's phase (radians), moved on by the distance walked; the shoes' colour */
  gait: number; shoe: THREE.Color;
  path: [number, number][] | null; target: Spot | null; home: Spot | null; role: Role; h: number;
  colors: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color];
  hidden: boolean;
}
type Role = "worker" | "staff" | "nurse" | "doctor" | "patient" | "visitor" | "shopper" | "diner" | "student" | "driver";
const PARTS = ["torso", "head", "hair", "upperL", "upperR", "foreL", "foreR", "thighL", "thighR", "shinL", "shinR", "hips", "shoeL", "shoeR"] as const;
/** a walking stride (two steps) in metres: the legs' cycle advances with the ground covered */
const STRIDE = 1.36;
const SHOES = ["#1b1c1f", "#3a2a20", "#f2f2f0", "#2d3a52", "#5a5f66"].map(c => new THREE.Color(c));
type Part = typeof PARTS[number];

const SKIN = ["#f1c9a5", "#e5b48f", "#d29c76", "#c48a63", "#f6d5b8"].map(c => new THREE.Color(c));
const HAIR = ["#1d1a17", "#2a211b", "#3b2b21", "#5a4636", "#8a8a88"].map(c => new THREE.Color(c));
const SUIT = ["#2b2f38", "#3d4350", "#1f2329", "#4a4f57", "#6b6f78", "#e9e6df", "#5d6b7e"].map(c => new THREE.Color(c));
const CASUAL = ["#c94f4f", "#3f6fb0", "#e0c050", "#4f9a6a", "#d8d2c5", "#8a5ca8", "#2f2f33", "#e88c3c", "#f0f0f0", "#6b8fa8"].map(c => new THREE.Color(c));
const PANTS = ["#23262c", "#3a3f4a", "#4a5568", "#5c4b3b", "#2e3b55", "#d6cfbf"].map(c => new THREE.Color(c));

function geos(): Record<Part, THREE.BufferGeometry> {
  const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 3, 8).translate(0, -(l / 2 + r), 0);
  return {
    torso: new THREE.CapsuleGeometry(0.15, 0.3, 4, 10).scale(1.15, 1, 0.7).translate(0, 0.3, 0),
    hips: new THREE.CapsuleGeometry(0.14, 0.06, 3, 10).scale(1.15, 1, 0.75).translate(0, 0.02, 0),
    head: new THREE.SphereGeometry(0.105, 14, 10).scale(0.95, 1.12, 1).translate(0, 0.12, 0),
    hair: new THREE.SphereGeometry(0.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.97, 1.08, 1.03).translate(0, 0.14, -0.01),
    upperL: cap(0.045, 0.2), upperR: cap(0.045, 0.2), foreL: cap(0.04, 0.19), foreR: cap(0.04, 0.19),
    thighL: cap(0.065, 0.3), thighR: cap(0.065, 0.3), shinL: cap(0.05, 0.33), shinR: cap(0.05, 0.33),
    // (a shoe: its heel under the ankle, the toe forward, a rounded box)
    shoeL: new THREE.CapsuleGeometry(0.048, 0.16, 3, 8).rotateX(Math.PI / 2).scale(1.05, 0.75, 1).translate(0, -0.035, 0.06),
    shoeR: new THREE.CapsuleGeometry(0.048, 0.16, 3, 8).rotateX(Math.PI / 2).scale(1.05, 0.75, 1).translate(0, -0.035, 0.06),
  };
}

export class Crowd {
  readonly group = new THREE.Group();
  private people: Person[] = [];
  private meshes = new Map<Part, THREE.InstancedMesh>();
  private geos = geos();
  private mats: THREE.Material[] = [];
  private m = new THREE.Matrix4(); private base = new THREE.Matrix4(); private t1 = new THREE.Matrix4(); private t2 = new THREE.Matrix4();
  private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private pathBudget = 0;
  private taken = new Set<Spot>();
  private rnd: () => number;

  constructor(private plan: FloorPlan, seed: number) {
    let s = (seed * 2654435761) >>> 0 || 1;
    this.rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.82 }), skin = new THREE.MeshStandardMaterial({ roughness: 0.55 }), hair = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    this.mats.push(cloth, skin, hair);
    const n = Math.max(1, plan.crowd);
    for (const p of PARTS) {
      const mat = p === "head" ? skin : p === "hair" ? hair : p.startsWith("fore") ? skin : p.startsWith("shoe") ? hair : cloth;
      const im = new THREE.InstancedMesh(this.geos[p], mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false;
      im.setColorAt(0, new THREE.Color()); im.count = 0;
      this.meshes.set(p, im); this.group.add(im);
    }
    this.populate(n);
  }

  private pick<T>(a: T[]) { return a[Math.floor(this.rnd() * a.length)]; }
  private roleFor(kind: ZoneKind, spot: Spot | null): Role {
    if (kind === "parking") return "driver";
    if (spot?.kind === "counter") return kind === "clinic" || kind === "ward" ? "nurse" : "staff";
    if (kind === "clinic") return spot?.kind === "desk" ? "doctor" : spot?.kind === "exam" || spot?.kind === "seat" || spot?.kind === "wait" ? "patient" : this.rnd() < 0.5 ? "nurse" : "patient";
    if (kind === "ward") return spot?.kind === "bed" ? "patient" : spot?.kind === "seat" ? "visitor" : this.rnd() < 0.6 ? "nurse" : "doctor";
    if (kind === "retail") return "shopper";
    if (kind === "food") return spot?.kind === "table" ? "diner" : "staff";
    if (kind === "class") return "student";
    return "worker";
  }
  private dress(role: Role): Person["colors"] {
    const skin = this.pick(SKIN), hair = this.pick(HAIR);
    switch (role) {
      case "nurse": return [new THREE.Color(this.pick(["#7fb6d6", "#9cc7b4", "#b9a6d3"])), new THREE.Color("#7fb6d6"), skin, hair, new THREE.Color("#f2f2f2")];
      case "doctor": return [new THREE.Color("#f4f4f2"), this.pick(PANTS), skin, hair, new THREE.Color("#f4f4f2")];
      case "patient": return this.rnd() < 0.55 || this.gown ? [new THREE.Color("#a9c4dd"), new THREE.Color("#a9c4dd"), skin, hair, new THREE.Color("#a9c4dd")] : [this.pick(CASUAL), this.pick(PANTS), skin, hair, this.pick(CASUAL)];
      case "staff": return [new THREE.Color(this.pick(["#20242b", "#f2f2f2", "#7a1e24"])), this.pick(PANTS), skin, hair, new THREE.Color("#20242b")];
      case "worker": { const c = this.rnd() < 0.6 ? this.pick(SUIT) : this.pick(CASUAL); return [c, this.pick(PANTS), skin, hair, c]; }
      default: { const c = this.pick(CASUAL); return [c, this.pick(PANTS), skin, hair, c]; }
    }
  }
  private populate(n: number) {
    const sp = this.plan.spots;
    const zoneKind = (s: Spot | null) => (s && s.zone >= 0 ? this.plan.zones[s.zone]?.kind : this.plan.kinds[0]) ?? "office";
    // seats and beds filled first (most people are at something), the rest walking
    const order = [...sp].sort(() => this.rnd() - 0.5).sort((a, b) => rank(a) - rank(b));
    function rank(s: Spot) { return s.kind === "counter" ? 0 : s.kind === "bed" ? 1 : s.kind === "desk" || s.kind === "exam" ? 2 : s.kind === "class" ? 3 : 4; }
    const occupancy: Partial<Record<Spot["kind"], number>> = { desk: 0.78, counter: 0.9, bed: 0.72, seat: 0.55, table: 0.5, class: 0.7, exam: 0.5, wait: 0.6, shelf: 0.18, stand: 0.4, lift: 0.3, treadmill: 0.45, car: 0.04, toilet: 0 };
    for (const s of order) {
      if (this.people.length >= n * 0.82) break;
      if (this.rnd() > (occupancy[s.kind] ?? 0.2)) continue;
      this.spawn(s, zoneKind(s));
    }
    // walkers
    const g = this.plan.grid;
    let tries = 0;
    while (this.people.length < n && tries++ < n * 20) {
      const i = Math.floor(this.rnd() * g.nx), j = Math.floor(this.rnd() * g.nz);
      if (!g.free[j * g.nx + i]) continue;
      const zk = this.plan.zones.find(z => (i + 0.5) * g.cell >= z.rect[0] && (i + 0.5) * g.cell <= z.rect[2])?.kind ?? this.plan.kinds[0];
      const p = this.spawn(null, zk); p.x = (i + 0.5) * g.cell; p.z = (j + 0.5) * g.cell; p.act = "walk"; p.timer = 0;
    }
  }
  /** (a patient in a bed always in the hospital's gown) */
  private gown = false;
  private spawn(s: Spot | null, kind: ZoneKind): Person {
    const role = this.roleFor(kind, s);
    this.gown = s?.kind === "bed";
    const p: Person = { x: s?.x ?? 0, z: s?.z ?? 0, yaw: s?.yaw ?? 0, y: s?.y ?? 0, act: "stand", timer: 4 + this.rnd() * 40, phase: this.rnd() * 6.28,
      speed: role === "nurse" || role === "staff" ? 1.25 : 1.05 + this.rnd() * 0.25, path: null, gait: this.rnd() * 6.28,
      shoe: role === "nurse" || role === "doctor" ? new THREE.Color("#f4f4f2") : role === "patient" && s?.kind === "bed" ? new THREE.Color("#c9d6e2") : this.pick(SHOES), target: s, home: s, role, h: 0.92 + this.rnd() * 0.16, colors: this.dress(role), hidden: false };
    this.gown = false;
    if (s) { this.taken.add(s); p.act = this.actAt(s); if (s.kind === "desk" || s.kind === "counter" || s.kind === "bed") p.timer = 30 + this.rnd() * 120; }
    this.people.push(p);
    return p;
  }
  private actAt(s: Spot): Act { return s.kind === "bed" ? "lie" : s.kind === "desk" ? "type" : s.y > 0.3 ? "sit" : "stand"; }
  /** the next thing to do: somewhere free of the kinds this person goes to */
  private next(p: Person) {
    const want: Spot["kind"][] = p.role === "worker" ? ["desk", "stand", "seat", "lift", "toilet"] : p.role === "shopper" ? ["shelf", "shelf", "shelf", "wait", "lift"]
      : p.role === "patient" ? ["seat", "wait", "exam", "lift", "toilet"] : p.role === "nurse" || p.role === "doctor" ? ["counter", "bed", "desk", "stand", "lift"]
      : p.role === "diner" ? ["table", "lift"] : p.role === "student" ? ["class", "toilet", "lift"] : p.role === "driver" ? ["lift", "car"] : ["stand", "seat", "lift"];
    const k = this.pick(want);
    const cand = this.plan.spots.filter(s => s.kind === k && !this.taken.has(s));
    const s = cand.length ? cand[Math.floor(this.rnd() * Math.min(cand.length, 40))] : null;
    if (p.target) this.taken.delete(p.target);
    p.target = s;
    if (s) this.taken.add(s);
    p.act = "walk"; p.path = null;
  }

  update(dt: number, eye: THREE.Vector3) {
    this.pathBudget = 6;
    for (const p of this.people) {
      p.phase += dt;
      if (p.act === "walk") {
        if (!p.target) { p.timer -= dt; if (p.timer < 0) { this.next(p); p.timer = 2; } continue; }
        if (!p.path) {
          if (this.pathBudget-- <= 0) continue;
          p.path = findPath(this.plan.grid, p.x, p.z, p.target.x, p.target.z) ?? [];
          if (!p.path.length) { this.next(p); continue; }
        }
        const [tx, tz] = p.path[0], dx = tx - p.x, dz = tz - p.z, l = Math.hypot(dx, dz);
        if (l < 0.15) { p.path.shift(); if (!p.path.length) { p.x = p.target.x; p.z = p.target.z; p.yaw = p.target.yaw; p.y = p.target.y; p.act = this.actAt(p.target); p.timer = p.act === "stand" ? 6 + this.rnd() * 20 : 20 + this.rnd() * 90; if (p.target.kind === "lift" || p.target.kind === "car") p.timer = 3 + this.rnd() * 6; } continue; }
        const want = Math.atan2(dx, dz); let dy = want - p.yaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        p.yaw += dy * Math.min(1, dt * 8); p.y = 0;
        const step = Math.min(l, p.speed * dt); p.x += dx / l * step; p.z += dz / l * step;
        p.gait += step / STRIDE * Math.PI * 2;
      } else {
        p.timer -= dt;
        if (p.timer < 0) {
          // (someone at the lifts or a car leaves the floor: they reappear walking from the lifts)
          if (p.target && (p.target.kind === "lift" || p.target.kind === "car")) { const l = this.plan.lifts[Math.floor(this.rnd() * Math.max(1, this.plan.lifts.length))]; if (l) { p.x = l.x; p.z = l.z - 0.6; } }
          this.next(p);
        }
      }
    }
    this.draw(eye);
  }

  private part(_p: Person, name: Part, slot: number, m: THREE.Matrix4, color: THREE.Color) {
    const im = this.meshes.get(name)!;
    im.setMatrixAt(slot, m); im.setColorAt(slot, color);
  }
  private draw(eye: THREE.Vector3) {
    let n = 0;
    const B = this.base, M = this.m, T1 = this.t1, T2 = this.t2;
    const R = (x: number, y: number, z: number) => T2.makeRotationFromEuler(this.e.set(x, y, z));
    for (const p of this.people) {
      // (beyond 60 m, not drawn)
      if (Math.hypot(p.x - eye.x, p.z - eye.z) > 60) continue;
      const k = p.h, walk = p.act === "walk", sg = Math.sin(p.gait), cg = Math.cos(p.gait), sit = p.act === "sit" || p.act === "type", lie = p.act === "lie";
      const hipY = lie ? p.y + 0.12 : sit ? p.y + 0.08 : 0.9 * k - (walk ? 0.012 + 0.014 * Math.cos(2 * p.gait) : 0);
      B.makeRotationY(p.yaw).setPosition(p.x, hipY, p.z);
      if (lie) B.multiply(R(-Math.PI / 2, 0, 0));
      B.multiply(T1.makeScale(k, k, k));
      const torsoLean = p.act === "type" ? 0.18 : walk ? 0.05 : 0;
      const torso = M.copy(B).multiply(R(torsoLean, 0, 0));
      this.part(p, "torso", n, torso, p.colors[0]);
      this.part(p, "hips", n, B, p.colors[1]);
      const head = new THREE.Matrix4().copy(torso).multiply(T1.makeTranslation(0, 0.62, 0)).multiply(R(p.act === "type" ? 0.25 : 0, Math.sin(p.phase * 0.3) * 0.25, 0));
      this.part(p, "head", n, head, p.colors[2]);
      this.part(p, "hair", n, head, p.colors[3]);
      // arms: swing walking, forward on a desk typing, at the sides otherwise
      for (const side of [-1, 1]) {
        const sh = new THREE.Matrix4().copy(torso).multiply(T1.makeTranslation(side * 0.2, 0.52, 0));
        const swing = walk ? 0.36 * (side < 0 ? sg : -sg) : p.act === "type" ? -0.9 : sit ? -0.35 : 0.05;
        const up = sh.multiply(R(swing, 0, side * 0.08));
        this.part(p, side < 0 ? "upperL" : "upperR", n, up, p.colors[4]);
        const fore = new THREE.Matrix4().copy(up).multiply(T1.makeTranslation(0, -0.29, 0)).multiply(R(p.act === "type" ? -0.9 + Math.sin(p.phase * 9 + side) * 0.06 : walk ? -0.25 - 0.2 * Math.max(0, -side * sg) : sit ? -0.9 : -0.1, 0, 0));
        this.part(p, side < 0 ? "foreL" : "foreR", n, fore, p.colors[2]);
      }
      // legs: a walk's stride, a sitter's right angles, straight lying or standing
      for (const side of [-1, 1]) {
        const hip = new THREE.Matrix4().copy(B).multiply(T1.makeTranslation(side * 0.09, 0, 0));
        // (left leg forward as sin > 0, the right half a stride after; forward is −x rotation here)
        const ls = side < 0 ? sg : -sg, lc = side < 0 ? cg : -cg;
        const th = walk ? -0.42 * ls : sit ? -Math.PI / 2 : 0;
        const thigh = hip.multiply(R(th, 0, 0));
        this.part(p, side < 0 ? "thighL" : "thighR", n, thigh, p.colors[1]);
        const knee = walk ? 0.08 + 0.85 * Math.max(0, lc) * (0.6 + 0.4 * Math.max(0, -ls)) : sit ? Math.PI / 2 : 0;
        const shin = new THREE.Matrix4().copy(thigh).multiply(T1.makeTranslation(0, -0.43, 0)).multiply(R(knee, 0, 0));
        this.part(p, side < 0 ? "shinL" : "shinR", n, shin, p.colors[1]);
        // (the foot kept level: the shin's turn and the thigh's undone, the toe lifting in the swing)
        const foot = new THREE.Matrix4().copy(shin).multiply(T1.makeTranslation(0, -0.45, 0)).multiply(R(-(th + knee) + (walk ? -0.25 * Math.max(0, lc) : 0), 0, 0));
        this.part(p, side < 0 ? "shoeL" : "shoeR", n, foot, p.shoe);
      }
      n++;
    }
    for (const im of this.meshes.values()) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  /** someone near (x, z) to talk to (the nearest within 1.6 m), for the HUD */
  nearest(x: number, z: number): { role: Role; act: Act } | null {
    let best: Person | null = null, bd = 1.6;
    for (const p of this.people) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best ? { role: best.role, act: best.act } : null;
  }
  get count() { return this.people.length; }
  /** circles to keep the player out of people (standing and seated ones) */
  near(x: number, z: number, r: number) { return this.people.filter(p => Math.abs(p.x - x) < r && Math.abs(p.z - z) < r); }
  dispose() { this.group.removeFromParent(); for (const im of this.meshes.values()) im.dispose(); Object.values(this.geos).forEach(g => g.dispose()); this.mats.forEach(m => m.dispose()); }
}
