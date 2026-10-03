import * as THREE from "three";
import type { HeroName } from "./heroVehicles";
import type { Terrain } from "./sceneTerrain";

/** Driving a followed vehicle (쿠팡 트럭, 사이버트럭) by hand: a bicycle model with an engine,
 * gears (the truck's automatic; the EV a single speed), brakes, rolling and air resistance and
 * speed-dependent steering; collisions with the other vehicles (oriented boxes) and the buildings
 * (their roofs rasterised to a half-metre grid); the engine heard (recorded loops, pitched by
 * revs and loaded by the throttle) and a knock on impact; a driver's-seat cockpit. */

export interface DriveSpec {
  wheelbase: number;
  /** top speed (m/s), forward full-throttle acceleration at rest (m/s²), service brake (m/s²) */
  vmax: number; accel: number; brake: number; reverseMax: number;
  /** gear tops (m/s) for an automatic; null for one fixed ratio (an EV) */
  gears: number[] | null;
  idleRpm: number; redline: number;
  /** most front-wheel angle at a standstill (rad) */
  lock: number;
  /** the driver's eye in the vehicle's frame: x (+ the left, the driver's side here), up, forward */
  eye: [number, number, number];
  /** engine recording, and the part of it that loops cleanly (s) */
  sound: string; loop?: [number, number];
  /** playback rate at idle and at the redline */
  pitch: [number, number];
  /** fuel (charge) used per metre, against the truck's 1: the Cybertruck, quicker, drains faster */
  fuelUse: number;
}

export const DRIVE_SPECS: Record<HeroName, DriveSpec> = {
  // 1톤급 냉동탑차 (쿠팡 로켓배송): a diesel, five speeds, about 120 km/h flat out
  coupang: { wheelbase: 3.3, vmax: 33, accel: 2.6, brake: 7.0, reverseMax: 4.5, gears: [6, 11, 17, 25, 33], idleRpm: 750, redline: 3600, lock: 0.62,
    eye: [0.42, 2.18, 1.55], sound: "/3d/audio/truck-diesel-loop.wav", pitch: [0.62, 1.55], fuelUse: 1 },
  // 사이버트럭 (AWD): quick, single speed, about 180 km/h
  cyber: { wheelbase: 3.81, vmax: 50, accel: 6.2, brake: 9.0, reverseMax: 6, gears: null, idleRpm: 0, redline: 18000, lock: 0.58,
    eye: [0.42, 1.38, 0.05], sound: "/3d/audio/ev-motor.mp3", loop: [2.0, 12.0], pitch: [0.55, 1.9], fuelUse: 0.28 },
};

/** Street trees and lamp posts as the driven vehicle meets them: round trunks and posts
 * (centre, radius), bucketed by 8 m. */
export class PoleGrid {
  private cells = new Map<string, { x: number; y: number; r: number }[]>();
  constructor(poles: { x: number; y: number; r: number }[]) {
    for (const p of poles) { const k = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`, l = this.cells.get(k); if (l) l.push(p); else this.cells.set(k, [p]); }
  }
  /** Any pole within the footprint (middle x, y, unit heading hx, hy, half length and width)? */
  hits(x: number, y: number, hx: number, hy: number, hl: number, hw: number) {
    const reach = hl + 1, i0 = Math.floor((x - reach) / 8), i1 = Math.floor((x + reach) / 8), j0 = Math.floor((y - reach) / 8), j1 = Math.floor((y + reach) / 8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const p of this.cells.get(`${i},${j}`) ?? []) {
      const dx = p.x - x, dy = p.y - y, al = dx * hx + dy * hy, la = dx * hy - dy * hx;
      if (Math.abs(al) <= hl + p.r && Math.abs(la) <= hw + p.r) return true;
    }
    return false;
  }
}

/** What a vehicle is to the simulation: its pose (x east, y north, unit heading), speed, size. */
export interface Body { x: number; y: number; hx: number; hy: number; speed: number; length: number; width: number }

/** Buildings as ground cover: a half-metre grid of cells under a roof, about the view's middle. */
export class SolidGrid {
  readonly cell = 0.5;
  readonly n: number;
  readonly cells: Uint8Array;
  constructor(readonly half: number) {
    this.n = Math.ceil((2 * half) / this.cell);
    this.cells = new Uint8Array(this.n * this.n);
  }
  at(x: number, y: number) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((y + this.half) / this.cell);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && this.cells[j * this.n + i] === 1;
  }
  /** Fill a triangle given in footprint metres. */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    const c = this.cell, h = this.half, n = this.n;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) + h) / c)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) + h) / c));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) + h) / c)), j1 = Math.min(n - 1, Math.floor((Math.max(ay, by, cy) + h) / c));
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-6) return;
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * c - h;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c - h;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
        if (w0 >= -0.02 && w1 >= -0.02 && w0 + w1 <= 1.02) this.cells[j * n + i] = 1;
      }
    }
  }
}

/** The roofs of `meshes` (faces looking up, 2 m or more over the ground under them) into a grid;
 * a slice at a time (`yieldFn` between meshes) so a frame never waits on it. */
export async function solidGrid(meshes: THREE.Mesh[], terrain: Terrain, half: number, yieldFn: () => Promise<unknown>) {
  const g = new SolidGrid(half);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  let slice = performance.now();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    const idx = m.geometry.index, mw = m.matrixWorld, count = idx ? idx.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3) {
      if ((k & 4095) === 0 && performance.now() - slice > 6) { await yieldFn(); slice = performance.now(); }
      const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mw); b.fromBufferAttribute(pos, i1).applyMatrix4(mw); c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
      const l = e1.length();
      if (l < 1e-6 || Math.abs(e1.y / l) < 0.6) continue;   // (a wall)
      const mx = (a.x + b.x + c.x) / 3, my = -(a.z + b.z + c.z) / 3, top = (a.y + b.y + c.y) / 3;
      if (top - terrain.at(mx, my) < 2) continue;              // (the ground, a deck, a plinth)
      g.tri(a.x, -a.z, b.x, -b.z, c.x, -c.z);
    }
  }
  return g;
}

/** Oriented boxes overlap (separating axes)? Each given by centre, unit heading, length, width. */
export function boxesOverlap(a: Body, b: Body, pad = 0) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const axes = [[a.hx, a.hy], [-a.hy, a.hx], [b.hx, b.hy], [-b.hy, b.hx]];
  for (const [ux, uy] of axes) {
    const ra = Math.abs(ux * a.hx + uy * a.hy) * a.length / 2 + Math.abs(-ux * a.hy + uy * a.hx) * a.width / 2;
    const rb = Math.abs(ux * b.hx + uy * b.hy) * b.length / 2 + Math.abs(-ux * b.hy + uy * b.hx) * b.width / 2;
    if (Math.abs(dx * ux + dy * uy) > ra + rb + pad) return false;
  }
  return true;
}

export interface Keys { up: boolean; down: boolean; left: boolean; right: boolean; hand: boolean; boost?: boolean }

/** The simulation of one driven vehicle. `others` gives the vehicles near a point. */
export class DriveSim {
  steer = 0;
  gear = 1;
  rpm = 0;
  throttle = 0;
  braking = false;
  private shiftT = 0;
  private theta: number;
  /** the last knock (for its sound), and how hard (m/s); what was hit */
  bump = 0;
  bumpHit: "solid" | "vehicle" | "pole" | null = null;
  /** the vehicle struck, if it was one */
  bumpCar: Body | null = null;
  /** the tyres' slip (0 gripping .. 1 squealing): hard cornering, braking, the handbrake */
  slip = 0;
  /** the boost on (Shift, while it lasts) */
  boosting = false;
  constructor(readonly car: Body, readonly spec: DriveSpec, readonly others: (x: number, y: number, r: number) => Body[], readonly solids: () => SolidGrid | null,
    readonly poles: () => PoleGrid | null = () => null) {
    this.theta = Math.atan2(car.hy, car.hx);
    this.rpm = spec.idleRpm;
  }
  private hitsAt(x: number, y: number, hx: number, hy: number, ignore: Set<Body>) {
    const me: Body = { ...this.car, x, y, hx, hy };
    for (const o of this.others(x, y, 14)) if (o !== this.car && !ignore.has(o) && boxesOverlap(me, o, 0.05)) return o;
    if (this.poles()?.hits(x, y, hx, hy, this.car.length / 2, this.car.width / 2)) return "pole";
    const g = this.solids();
    if (g) {
      // (round the outline every half metre, and through the middle)
      const L = this.car.length / 2, W = this.car.width / 2, rx = hy, ry = -hx;
      for (let s = -L; s <= L + 1e-6; s += 0.5) for (const w of [-W, 0, W]) if (g.at(x + hx * s + rx * w, y + hy * s + ry * w)) return "solid";
      for (let w = -W; w <= W; w += 0.5) for (const s of [-L, L]) if (g.at(x + hx * s + rx * w, y + hy * s + ry * w)) return "solid";
    }
    return null;
  }
  step(dt: number, k: Keys) {
    const s = this.spec, c = this.car;
    // Already touching something (a vehicle that pulled into this one): free to drive out of it.
    const ignore = new Set<Body>();
    for (const o of this.others(c.x, c.y, 14)) if (o !== c && boxesOverlap(c, o, 0.05)) ignore.add(o);
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    this.bump = 0; this.bumpHit = null; this.bumpCar = null;
    let slip = 0;
    for (let i = 0; i < n; i++) {
      let v = c.speed;
      // Pedals: the up key drives on (brakes first when rolling back), the down key brakes then reverses.
      let drive = 0, brake = 0;
      if (k.up && !k.down) { if (v < -0.3) brake = 1; else drive = 1; }
      else if (k.down && !k.up) { if (v > 0.3) brake = 1; else drive = -1; }
      this.braking = brake > 0 || k.hand;
      this.throttle += ((drive !== 0 ? 1 : 0) - this.throttle) * Math.min(1, h * 6);
      let a = 0;
      if (drive > 0) {
        if (s.gears) {
          // automatic: shift up near the top of a gear, down below the one before; a beat with no drive while shifting
          const top = s.gears[this.gear - 1], prev = this.gear > 1 ? s.gears[this.gear - 2] : 0;
          if (v > top * 0.97 && this.gear < s.gears.length) { this.gear++; this.shiftT = 0.32; }
          else if (v < prev * 0.7 && this.gear > 1) this.gear--;
          const pull = 1.25 - 0.13 * (this.gear - 1);   // a lower gear pulls harder
          a = this.shiftT > 0 ? 0 : s.accel * pull * Math.max(0, 1 - (v / s.vmax) ** 2);
        } else a = s.accel * Math.max(0, 1 - (v / s.vmax) ** 3);
        // the boost: much more pull, and past the usual top speed
        if (k.boost) a = Math.max(a, 0) * 1.7 + s.accel * 0.9 * Math.max(0, 1 - v / (s.vmax * 1.2));
      } else if (drive < 0) a = -s.accel * 0.6 * Math.max(0, 1 - (-v / s.reverseMax) ** 2);
      if (this.shiftT > 0) this.shiftT -= h;
      // resistance: air (the top speed where it equals the drive), rolling, the engine's own braking off the throttle
      const drag = (s.accel * 0.35 / (s.vmax * s.vmax)) * v * Math.abs(v) * (k.boost ? 0.6 : 1), roll = 0.12 * Math.sign(v), engine = drive === 0 ? 0.55 * Math.sign(v) : 0;
      let dec = drag + roll + engine;
      if (brake) dec += s.brake * Math.sign(v);
      if (k.hand) dec += 8.5 * Math.sign(v);
      const nv = v + (a - dec) * h;
      // (resistance and brakes stop a vehicle; they never send it the other way)
      v = drive === 0 || brake ? (Math.sign(nv) !== Math.sign(v) && v !== 0 ? 0 : nv) : nv;
      if (Math.abs(v) < 0.02 && drive === 0) v = 0;
      // Steering: the wheel turns at a hand's pace and centres by itself; less lock the faster it goes.
      const want = (k.left ? 1 : 0) - (k.right ? 1 : 0), lock = s.lock / (1 + Math.abs(v) / 7);
      const target = want * lock, rate = want ? 1.6 : 2.6;
      this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * h, rate * h);
      // The bicycle model: yaw from the front wheels' angle over the wheelbase.
      const th = this.theta + (v * Math.tan(this.steer) / s.wheelbase) * h;
      const hx = Math.cos(th), hy = Math.sin(th), nx = c.x + hx * v * h, ny = c.y + hy * v * h;
      // slip: sideways pull past ~0.45 g, a hard stop at speed, the locked rear wheels
      const lateral = Math.abs(v * v * Math.tan(this.steer) / s.wheelbase);
      slip = Math.max(slip, Math.min(1, Math.max(0, (lateral - 4.5) / 5)), brake && Math.abs(v) > 6 ? 0.55 : 0, k.hand && Math.abs(v) > 3 ? 0.9 : 0);
      const hit = this.hitsAt(nx, ny, hx, hy, ignore);
      if (hit) {
        // A knock: stopped short and pushed back a little (a building harder than a car).
        this.bump = Math.max(this.bump, Math.abs(v)); this.bumpHit = hit === "solid" || hit === "pole" ? hit : "vehicle";
        if (hit !== "solid" && hit !== "pole") this.bumpCar = hit;
        c.speed = -v * (hit === "solid" || hit === "pole" ? 0.15 : 0.25);
        if (hit !== "solid" && hit !== "pole") hit.speed = Math.max(0, hit.speed * 0.5);
        break;
      }
      this.theta = th; c.x = nx; c.y = ny; c.hx = hx; c.hy = hy; c.speed = v;
    }
    this.slip = slip; this.boosting = !!k.boost && k.up;
    this.revsFor(dt);
  }
  /** Before the driver takes over (the traffic driving it): the gauges and the sound follow it. */
  observe(dt: number, accelerating: boolean) {
    const c = this.car, s = this.spec;
    this.theta = Math.atan2(c.hy, c.hx);
    this.throttle += ((accelerating ? 0.8 : 0.1) - this.throttle) * Math.min(1, dt * 4);
    if (s.gears) {
      while (this.gear < s.gears.length && c.speed > s.gears[this.gear - 1] * 0.97) this.gear++;
      while (this.gear > 1 && c.speed < s.gears[this.gear - 2] * 0.7) this.gear--;
    }
    this.revsFor(dt);
  }
  private revsFor(dt: number) {
    // Revs: from the road speed through the gear (the EV's motor straight from it).
    const s = this.spec, c = this.car, v = Math.abs(c.speed);
    if (s.gears) {
      const top = s.gears[this.gear - 1], lo = this.gear > 1 ? s.gears[this.gear - 2] * 0.6 : 0;
      const want = s.idleRpm + (s.redline - s.idleRpm) * THREE.MathUtils.clamp((v - lo) / (top - lo), 0, 1) * (this.gear === 1 ? 1 : 0.55) + (this.gear === 1 ? 0 : (s.redline - s.idleRpm) * 0.42);
      const free = s.idleRpm + this.throttle * (v < 0.5 ? 900 : 0);
      this.rpm += (Math.max(v < 0.5 ? free : want, s.idleRpm) - this.rpm) * Math.min(1, dt * 8);
    } else this.rpm += ((v / s.vmax) * s.redline - this.rpm) * Math.min(1, dt * 10);
  }
  /** The revs as a share of the range (0 idle, 1 the redline). */
  get revs() { const s = this.spec; return THREE.MathUtils.clamp((this.rpm - s.idleRpm) / (s.redline - s.idleRpm), 0, 1); }
  get gearLabel() { return this.car.speed < -0.2 ? "R" : this.spec.gears ? (Math.abs(this.car.speed) < 0.2 && this.throttle < 0.1 ? "N" : String(this.gear)) : Math.abs(this.car.speed) < 0.2 && this.throttle < 0.1 ? "P" : "D"; }
}

/** The engine heard: a recorded loop, its rate following the revs and its level the throttle;
 * a low knock on impact. Made from a click (browsers start sound only from a gesture). */
export class EngineSound {
  readonly ctx: AudioContext;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private tone: BiquadFilterNode;
  readonly master: GainNode;
  private dead = false;
  constructor(private spec: DriveSpec) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
    this.tone = this.ctx.createBiquadFilter(); this.tone.type = "lowpass"; this.tone.frequency.value = 2400; this.tone.connect(this.master);
    this.gain = this.ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(this.tone);
    void this.load();
  }
  private async load() {
    try {
      const res = await fetch(this.spec.sound);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      if (this.dead) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      if (this.spec.loop) { src.loopStart = this.spec.loop[0]; src.loopEnd = Math.min(buf.duration, this.spec.loop[1]); }
      src.connect(this.gain);
      src.start(0, this.spec.loop?.[0] ?? 0);
      this.src = src;
    } catch (err) { console.info("[3D] engine sound unavailable:", err); }
  }
  set(revs: number, throttle: number, speed: number) {
    if (!this.src) return;
    const t = this.ctx.currentTime, [p0, p1] = this.spec.pitch, ev = !this.spec.gears;
    this.src.playbackRate.setTargetAtTime(p0 + (p1 - p0) * revs, t, 0.05);
    // (a diesel idles audibly; a parked EV is near silent and whines up with speed)
    const level = ev ? Math.min(0.75, 0.04 + revs * 0.9 + throttle * 0.15 * Math.min(1, speed / 3)) : 0.32 + throttle * 0.38 + revs * 0.2;
    this.gain.gain.setTargetAtTime(level, t, 0.06);
    this.tone.frequency.setTargetAtTime(1200 + 3800 * Math.max(revs, throttle * 0.6), t, 0.08);
  }
  /** the engine dead (a wreck) */
  mute() { this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); }
  knock(strength: number) {
    if (strength < 0.6) return;
    const ctx = this.ctx, t = ctx.currentTime, len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = "lowpass"; f.frequency.value = 520; g.gain.value = Math.min(1.4, 0.25 + strength / 6);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
  resume() { if (this.ctx.state === "suspended") void this.ctx.resume(); }
  dispose() {
    this.dead = true;
    try { this.src?.stop(); } catch { /* not started */ }
    void this.ctx.close();
  }
}

/** The driver's view from inside: dashboard, instrument hood, A-pillars, the roof's edge, the
 * steering wheel (turning with the front wheels), mirrors; in the vehicle's frame (+z forward,
 * +x the left, y up from the road). */
export function cockpit(name: HeroName) {
  const s = DRIVE_SPECS[name], [ex, ey, ez] = s.eye, truck = name === "coupang";
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: truck ? "#2b2e33" : "#1d1f22", roughness: 0.8, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: truck ? "#d9dadb" : "#8d9298", roughness: truck ? 0.5 : 0.35, metalness: truck ? 0.1 : 0.75 });
  const soft = new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.95 });
  const glow = new THREE.MeshStandardMaterial({ color: "#000000", emissive: truck ? "#7fd0ff" : "#dfe9f5", emissiveIntensity: 0.9, roughness: 0.4 });
  const mats = [dark, trim, soft, glow];
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z); me.rotation.set(rx, ry, rz); group.add(me); return me;
  };
  const W = truck ? 1.86 : 2.0;
  // dashboard: a deep shelf under the windscreen, from door to door
  const dashZ = ez + (truck ? 0.62 : 0.78), dashY = ey - (truck ? 0.48 : 0.42);
  box(W - 0.08, 0.1, 0.62, dark, 0, dashY, dashZ, truck ? -0.04 : -0.08);
  box(W - 0.08, 0.42, 0.1, soft, 0, dashY - 0.24, dashZ - 0.28);
  // the instrument hood over the gauges (the truck), or a slab screen (the Cybertruck's 18.5")
  if (truck) {
    box(0.46, 0.1, 0.24, soft, ex, dashY + 0.1, dashZ - 0.2, 0.25);
    box(0.36, 0.13, 0.01, glow, ex, dashY + 0.05, dashZ - 0.31, -0.35);
  } else {
    box(0.47, 0.29, 0.03, soft, 0, dashY + 0.2, dashZ - 0.32, -0.18);
    box(0.44, 0.26, 0.01, glow, 0, dashY + 0.2, dashZ - 0.34, -0.18);
  }
  // A-pillars, raked (the truck's cab almost upright; the Cybertruck's long glass)
  const rake = truck ? 0.16 : 0.92, pillarH = truck ? 1.0 : 0.95;
  for (const sd of [1, -1]) {
    const p = box(0.09, pillarH, 0.12, dark, sd * (W / 2 - 0.08), dashY + pillarH / 2 * Math.cos(rake), dashZ + 0.08 - pillarH / 2 * Math.sin(rake) * 0.9, -rake);
    p.rotation.z = sd * 0.04;
    // mirrors, out past the doors
    box(0.05, truck ? 0.34 : 0.13, truck ? 0.2 : 0.22, dark, sd * (W / 2 + 0.2), dashY + (truck ? 0.18 : 0.12), dashZ - 0.05);
    box(0.012, truck ? 0.3 : 0.1, truck ? 0.17 : 0.19, trim, sd * (W / 2 + 0.17), dashY + (truck ? 0.18 : 0.12), dashZ - 0.05);
    // door tops and window sills
    box(0.07, 0.07, 1.4, dark, sd * (W / 2 - 0.04), dashY + 0.02, ez - 0.2);
  }
  // the roof's front edge and a sun visor each side
  const roofY = ey + (truck ? 0.34 : 0.3), roofZ = truck ? dashZ - 0.02 : ez + 0.12;
  box(W - 0.1, 0.07, truck ? 0.3 : 0.5, soft, 0, roofY, roofZ);
  for (const sd of [1, -1]) box(0.62, 0.02, 0.24, soft, sd * 0.42, roofY - 0.06, roofZ - 0.12, 0.25);
  // the rear-view mirror (the truck's box behind has no window: none there)
  if (!truck) box(0.22, 0.07, 0.02, dark, -0.02, roofY - 0.12, roofZ + 0.08);
  // the steering wheel in front of the driver, tilted toward them
  const wheel = new THREE.Group();
  const rimG = truck ? new THREE.TorusGeometry(0.21, 0.022, 10, 40) : new THREE.TorusGeometry(0.18, 0.024, 10, 4, Math.PI * 2);
  const rim = new THREE.Mesh(rimG, soft); if (!truck) { rim.rotation.z = Math.PI / 4; rim.scale.set(1.25, 0.82, 1); }
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20), dark); hub.rotation.x = Math.PI / 2; wheel.add(hub);
  for (const a of [Math.PI / 2, Math.PI * 1.17, -Math.PI * 0.17]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.02), trim);
    sp.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); sp.rotation.z = a; wheel.add(sp);
  }
  const tilt = new THREE.Group();
  tilt.position.set(ex, ey - 0.42, ez + 0.44); tilt.rotation.x = truck ? -0.45 : -0.28;
  tilt.add(wheel); group.add(tilt);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.4, 12), dark);
  col.position.set(ex, ey - 0.52, ez + 0.62); col.rotation.x = Math.PI / 2 - 0.5; group.add(col);
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return {
    group,
    /** the steering wheel's turn, for the front wheels' angle (about 15:1, the truck's slower) */
    setSteer(rad: number) { wheel.rotation.z = rad * (truck ? 18 : 12); },
    dispose() { group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mats.forEach(m => m.dispose()); },
  };
}
