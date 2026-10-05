/* The driven vehicle: a bicycle model with an engine, gears (the truck's automatic; the EV a single
 * speed), brakes, rolling and air resistance and speed-dependent steering. Stepped at a fixed rate
 * (the game's 120 Hz clock) whatever the display does, so a slow frame never changes how it drives.
 * Collisions: other vehicles (oriented boxes), poles, building footprints — tested along the whole
 * outline every half metre at each step (at 180 km/h a step moves 0.42 m: nothing is passed through). */

export type VehicleName = "coupang" | "cyber";

export interface DriveSpec {
  wheelbase: number; length: number; width: number;
  vmax: number; accel: number; brake: number; reverseMax: number;
  gears: number[] | null; idleRpm: number; redline: number;
  lock: number;
  eye: [number, number, number];
  sound: string; loop?: [number, number]; pitch: [number, number];
  fuelUse: number; label: string;
}

export const SPECS: Record<VehicleName, DriveSpec> = {
  // 1톤급 냉동탑차 (쿠팡 로켓배송): a diesel, five speeds, about 120 km/h flat out
  coupang: { wheelbase: 3.3, length: 5.3, width: 1.95, vmax: 33, accel: 2.8, brake: 7.5, reverseMax: 4.5, gears: [6, 11, 17, 25, 33], idleRpm: 750, redline: 3600, lock: 0.62,
    eye: [0.42, 2.18, 1.55], sound: "/3d/audio/truck-diesel-loop.wav", pitch: [0.62, 1.55], fuelUse: 1, label: "쿠팡 트럭" },
  // 사이버트럭 (AWD): quick, single speed, about 180 km/h
  cyber: { wheelbase: 3.81, length: 5.68, width: 2.03, vmax: 50, accel: 6.4, brake: 9.5, reverseMax: 6, gears: null, idleRpm: 0, redline: 18000, lock: 0.58,
    eye: [0.42, 1.38, 0.05], sound: "/3d/audio/ev-motor.mp3", loop: [2.0, 12.0], pitch: [0.55, 1.9], fuelUse: 0.28, label: "사이버트럭" },
};

/** Pedals and wheel, each 0..1 (steer −1 right .. 1 left): keys give 0 or 1, a gamepad anything between. */
export interface Controls { throttle: number; brake: number; steer: number; hand: boolean; boost: boolean }
export const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, hand: false, boost: false };

export interface Body { x: number; y: number; hx: number; hy: number; speed: number; length: number; width: number }

export interface Surroundings {
  /** other vehicles near (x, y) */
  others(x: number, y: number, r: number): Body[];
  /** a building under any of these points (x, y pairs)? */
  building(points: number[]): boolean;
  /** a pole within the box? */
  pole(x: number, y: number, hx: number, hy: number, hl: number, hw: number): boolean;
}

export function boxesOverlap(a: Body, b: Body, pad = 0) {
  const dx = b.x - a.x, dy = b.y - a.y;
  for (let axis = 0; axis < 4; axis++) {
    const ux = axis === 0 ? a.hx : axis === 1 ? -a.hy : axis === 2 ? b.hx : -b.hy;
    const uy = axis === 0 ? a.hy : axis === 1 ? a.hx : axis === 2 ? b.hy : b.hx;
    const ra = Math.abs(ux * a.hx + uy * a.hy) * a.length / 2 + Math.abs(-ux * a.hy + uy * a.hx) * a.width / 2;
    const rb = Math.abs(ux * b.hx + uy * b.hy) * b.length / 2 + Math.abs(-ux * b.hy + uy * b.hx) * b.width / 2;
    if (Math.abs(dx * ux + dy * uy) > ra + rb + pad) return false;
  }
  return true;
}

export type Hit = "building" | "pole" | "vehicle";

export class Vehicle {
  readonly body: Body;
  steer = 0; gear = 1; rpm = 0; throttle = 0; braking = false; slip = 0; boosting = false;
  theta: number;
  /** the last knock this step: how hard (m/s), what, which vehicle */
  bump = 0; bumpHit: Hit | null = null; bumpCar: Body | null = null;
  private shiftT = 0;
  private outline: number[] = [];
  constructor(readonly spec: DriveSpec, x: number, y: number, heading: number, private env: Surroundings) {
    this.theta = heading;
    this.body = { x, y, hx: Math.cos(heading), hy: Math.sin(heading), speed: 0, length: spec.length, width: spec.width };
    this.rpm = spec.idleRpm;
  }
  place(x: number, y: number, heading: number) {
    const b = this.body; b.x = x; b.y = y; this.theta = heading; b.hx = Math.cos(heading); b.hy = Math.sin(heading); b.speed = 0; this.steer = 0;
  }
  private hits(x: number, y: number, hx: number, hy: number, ignore: Set<Body>): Hit | Body | null {
    const me: Body = { ...this.body, x, y, hx, hy };
    for (const o of this.env.others(x, y, 14)) if (o !== this.body && !ignore.has(o) && boxesOverlap(me, o, 0.05)) return o;
    const L = this.body.length / 2, W = this.body.width / 2, rx = hy, ry = -hx;
    if (this.env.pole(x, y, hx, hy, L, W)) return "pole";
    const p = this.outline; p.length = 0;
    for (let s = -L; s <= L + 1e-6; s += 0.5) for (const w of [-W, 0, W]) p.push(x + hx * s + rx * w, y + hy * s + ry * w);
    for (let w = -W + 0.5; w < W; w += 0.5) for (const s of [-L, L]) p.push(x + hx * s + rx * w, y + hy * s + ry * w);
    if (this.env.building(p)) return "building";
    return null;
  }
  /** One fixed step of `h` seconds. */
  step(h: number, k: Controls) {
    const s = this.spec, c = this.body;
    this.bump = 0; this.bumpHit = null; this.bumpCar = null;
    // already touching a vehicle (one that pulled into this): free to drive out of it
    const ignore = new Set<Body>();
    for (const o of this.env.others(c.x, c.y, 14)) if (o !== c && boxesOverlap(c, o, 0.05)) ignore.add(o);
    let v = c.speed;
    // pedals: forward throttle drives (brakes first when rolling back); the brake pedal brakes, then reverses
    let drive = 0, brake = 0;
    if (k.throttle > 0.05 && k.throttle >= k.brake) { if (v < -0.3) brake = k.throttle; else drive = k.throttle; }
    else if (k.brake > 0.05) { if (v > 0.3) brake = k.brake; else drive = -k.brake; }
    this.braking = brake > 0.05 || k.hand;
    this.throttle += (Math.abs(drive) - this.throttle) * Math.min(1, h * 6);
    let a = 0;
    if (drive > 0) {
      if (s.gears) {
        const top = s.gears[this.gear - 1], prev = this.gear > 1 ? s.gears[this.gear - 2] : 0;
        if (v > top * 0.97 && this.gear < s.gears.length) { this.gear++; this.shiftT = 0.3; }
        else if (v < prev * 0.7 && this.gear > 1) this.gear--;
        const pull = 1.25 - 0.13 * (this.gear - 1);
        a = this.shiftT > 0 ? 0 : s.accel * pull * Math.max(0, 1 - (v / s.vmax) ** 2) * drive;
      } else a = s.accel * Math.max(0, 1 - (v / s.vmax) ** 3) * drive;
      if (k.boost) a = Math.max(a, 0) * 1.7 + s.accel * 0.9 * Math.max(0, 1 - v / (s.vmax * 1.2));
    } else if (drive < 0) a = -s.accel * 0.6 * Math.max(0, 1 - (-v / s.reverseMax) ** 2) * -drive;
    if (this.shiftT > 0) this.shiftT -= h;
    const drag = (s.accel * 0.35 / (s.vmax * s.vmax)) * v * Math.abs(v) * (k.boost ? 0.6 : 1), roll = 0.12 * Math.sign(v), engine = drive === 0 ? 0.55 * Math.sign(v) : 0;
    let dec = drag + roll + engine;
    if (brake) dec += s.brake * brake * Math.sign(v);
    if (k.hand) dec += 8.5 * Math.sign(v);
    const nv = v + (a - dec) * h;
    v = drive === 0 || brake ? (Math.sign(nv) !== Math.sign(v) && v !== 0 ? 0 : nv) : nv;
    if (Math.abs(v) < 0.02 && drive === 0) v = 0;
    // steering at a hand's pace, centring by itself; less lock the faster it goes
    const lock = s.lock / (1 + Math.abs(v) / 7), target = k.steer * lock, rate = Math.abs(k.steer) > 0.05 ? 1.6 : 2.6;
    this.steer += Math.max(-rate * h, Math.min(rate * h, target - this.steer));
    const th = this.theta + (v * Math.tan(this.steer) / s.wheelbase) * h;
    const hx = Math.cos(th), hy = Math.sin(th), nx = c.x + hx * v * h, ny = c.y + hy * v * h;
    const lateral = Math.abs(v * v * Math.tan(this.steer) / s.wheelbase);
    this.slip = Math.max(this.slip * Math.exp(-h * 6), Math.min(1, Math.max(0, (lateral - 4.5) / 5)), brake > 0.5 && Math.abs(v) > 6 ? 0.55 : 0, k.hand && Math.abs(v) > 3 ? 0.9 : 0);
    const hit = this.hits(nx, ny, hx, hy, ignore);
    if (hit) {
      const solid = hit === "building" || hit === "pole";
      this.bump = Math.abs(v); this.bumpHit = solid ? (hit as Hit) : "vehicle";
      if (!solid) { this.bumpCar = hit as Body; (hit as Body).speed = Math.max(0, (hit as Body).speed * 0.5); }
      c.speed = -v * (solid ? 0.15 : 0.25);
    } else {
      this.theta = th; c.x = nx; c.y = ny; c.hx = hx; c.hy = hy; c.speed = v;
    }
    this.boosting = k.boost && k.throttle > 0.1;
    this.revs(h);
  }
  private revs(dt: number) {
    const s = this.spec, v = Math.abs(this.body.speed);
    if (s.gears) {
      const top = s.gears[this.gear - 1], lo = this.gear > 1 ? s.gears[this.gear - 2] * 0.6 : 0;
      const want = s.idleRpm + (s.redline - s.idleRpm) * Math.min(1, Math.max(0, (v - lo) / (top - lo))) * (this.gear === 1 ? 1 : 0.55) + (this.gear === 1 ? 0 : (s.redline - s.idleRpm) * 0.42);
      const free = s.idleRpm + this.throttle * (v < 0.5 ? 900 : 0);
      this.rpm += (Math.max(v < 0.5 ? free : want, s.idleRpm) - this.rpm) * Math.min(1, dt * 8);
    } else this.rpm += ((v / s.vmax) * s.redline - this.rpm) * Math.min(1, dt * 10);
  }
  get revsShare() { const s = this.spec; return Math.min(1, Math.max(0, (this.rpm - s.idleRpm) / (s.redline - s.idleRpm))); }
  get gearLabel() {
    const v = this.body.speed;
    return v < -0.2 ? "R" : this.spec.gears ? (Math.abs(v) < 0.2 && this.throttle < 0.1 ? "N" : String(this.gear)) : Math.abs(v) < 0.2 && this.throttle < 0.1 ? "P" : "D";
  }
}
