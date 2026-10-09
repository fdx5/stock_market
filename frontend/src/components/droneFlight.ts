import * as THREE from "three";

/* The drone's flight (the 3D view's 드론 mode): a quadcopter flown in the usual "mode 2" way —
 * one stick climbs and turns, the other flies forward / back and sideways — from the keyboard,
 * two on-screen sticks, or a drag to look. Position in the scene's frame (x east, y up, z south);
 * the world answers for the ground, the roofs and how far ahead everything is on screen.
 *
 * Feel: thrust eases in (~3 s to 100 km/h, ~9 s to the 200 km/h top speed against the drag),
 * with no stick the drone brakes to a hover as a real one does (about 7 s from top speed), the
 * body pitches into its acceleration and banks into turns; the camera is on a gimbal (it keeps
 * the horizon level and only follows a little of the bank). */

export const MAX_SPEED = 200 / 3.6;
export const MIN_AGL = 2;
export const MAX_AGL = 500;
export const AUTO_MIN_AGL = 100;
export const AUTO_MAX_AGL = 250;
/** A sightseeing cruise, with time to climb before the terrain or a roof ahead. */
export const AUTO_SPEED = 90 / 3.6;
/** Everything within this distance ahead must be on screen (droneWorld.clearAhead). */
export const READY_AHEAD = 300;

const ACCEL = 10.5, BRAKE = 8, VACCEL = 9, CLIMB = 15, SINK = 10, YAW_RATE = 1.5, RADIUS = 0.45;

export interface DroneWorldQuery {
  groundAt(x: number, y: number): number;
  roofAt(x: number, y: number): number;
  clearAhead(x: number, y: number, dx: number, dy: number, max: number): number;
}

export type DroneSticks = {
  /** left stick: x yaw, y climb (−1…1) */
  left: [number, number];
  /** right stick: x sideways, y forward */
  right: [number, number];
};

export class DroneFlight {
  /** scene coordinates */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  /** the camera's tilt (gimbal), radians: down is negative */
  tilt = -0.12;
  /** body attitude for the look of the flight (radians: nose down, right wing down) */
  pitchBody = 0;
  roll = 0;
  /** the wheel's climb (−1…1), easing back to 0 */
  private wheel = 0;
  private yawRate = 0;
  readonly keys = new Set<string>();
  readonly sticks: DroneSticks = { left: [0, 0], right: [0, 0] };
  /** The fastest the drone may go now (the world still loading ahead), m/s. */
  limit = MAX_SPEED;
  /** How far ahead along the flight everything is on screen (m; checked up to the stopping
   * distance + 300 m). */
  ahead = Infinity;
  /** height over the ground under it (m) and over whatever is under it (a roof) */
  agl = 0;
  clearance = 0;
  /** the throttle the motors are giving (0 idle … 1 full), for the sound */
  load = 0;
  /** hit a wall this frame (for the sound) */
  bumped = 0;
  autopilot = false;
  autopilotStatus: 'off' | 'cruise' | 'altitude' | 'obstacle' = 'off';
  autoTargetAgl = 175;
  private autoClock = 0;
  private autoEntered = false;

  setAutopilot(on: boolean) {
    this.autopilot = on;
    this.autopilotStatus = on ? 'altitude' : 'off';
    this.autoClock = 0; this.autoEntered = false; this.wheel = 0;
    return on;
  }
  toggleAutopilot() { return this.setAutopilot(!this.autopilot); }

  /** Start hovering at (x, y) of the view frame, `alt` over the ground, facing `yaw`. */
  place(x: number, y: number, ground: number, alt: number, yaw: number) {
    this.pos.set(x, ground + alt, -y);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitchBody = this.roll = this.yawRate = 0;
    this.agl = this.clearance = alt;
    this.setAutopilot(false);
  }

  /** Mouse or finger drag on the view: turn and tilt the camera. */
  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0042;
    this.tilt = THREE.MathUtils.clamp(this.tilt - dy * 0.0035, -1.45, 0.6);
  }

  private axis(neg: string[], pos: string[]) {
    let v = 0;
    for (const k of pos) if (this.keys.has(k)) { v += 1; break; }
    for (const k of neg) if (this.keys.has(k)) { v -= 1; break; }
    return v;
  }

  /** Input as -1…1 per axis: forward, right, climb, turn (right). */
  input() {
    const s = this.sticks;
    const fwd = THREE.MathUtils.clamp(this.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]) + s.right[1], -1, 1);
    const side = THREE.MathUtils.clamp(this.axis(["KeyA"], ["KeyD"]) + s.right[0], -1, 1);
    const climb = THREE.MathUtils.clamp(this.axis(["ShiftLeft", "ShiftRight", "KeyF", "KeyC", "PageDown", "BtnDown"], ["Space", "KeyR", "PageUp", "BtnUp"]) + s.left[1] + this.wheel, -1, 1);
    const turn = THREE.MathUtils.clamp(this.axis(["KeyQ", "ArrowLeft"], ["KeyE", "ArrowRight"]) + s.left[0], -1, 1);
    return { fwd, side, climb, turn };
  }

  /** The mouse wheel: up climbs, down sinks (a notch about a second of half climb). */
  wheelClimb(deltaY: number) { if (deltaY && this.autopilot) this.setAutopilot(false); this.wheel = THREE.MathUtils.clamp(this.wheel - deltaY * 0.004, -1, 1); }

  /** Fly along the current camera heading. Gentle height changes and terrain/roof
   * look-ahead fit inside 100–250 m AGL. An impassable tower causes a hover before it. */
  private autoControls(dt: number, world: DroneWorldQuery, fx: number, fz: number) {
    this.autoClock += dt;
    const x=this.pos.x,y=-this.pos.z,ground=world.groundAt(x,y),agl=this.pos.y-ground;
    let target=ground+175+40*Math.sin(this.autoClock*Math.PI/40),cap=AUTO_SPEED,obstacle=false;
    for(let distance=15;distance<=180;distance+=15){
      const px=x+fx*distance,py=y-fz*distance,g=world.groundAt(px,py),roof=world.roofAt(px,py);
      const impassable=roof-g>AUTO_MAX_AGL-24;
      if(impassable){
        obstacle=true;cap=Math.min(cap,Math.sqrt(Math.max(0,2*BRAKE*(distance-30))));
        continue;
      }
      const top=Math.max(g+AUTO_MIN_AGL,roof+24);
      target=Math.max(target,top);
      const rise=top-this.pos.y;
      if(rise>8)cap=Math.min(cap,Math.max(0,distance-15)/(rise/8+2));
    }
    target=THREE.MathUtils.clamp(target,ground+AUTO_MIN_AGL,ground+AUTO_MAX_AGL);
    this.autoTargetAgl=target-ground;
    const inBand=agl>=AUTO_MIN_AGL && agl<=AUTO_MAX_AGL;
    if(inBand)this.autoEntered=true;
    if(!inBand)cap=0;
    this.autopilotStatus=obstacle ? 'obstacle' : !inBand ? 'altitude' : 'cruise';
    const vy=THREE.MathUtils.clamp((target-this.pos.y)*.65,-6,10);
    const along=this.vel.x*fx+this.vel.z*fz;
    const fwd=cap>0 ? THREE.MathUtils.clamp((cap-along)*.3+.16,0,1) : 0;
    return {fwd,climb:vy>0 ? vy/CLIMB : vy/SINK,cap};
  }

  /** One step of `dt` seconds. */
  step(dt: number, world: DroneWorldQuery) {
    dt = Math.min(dt, 0.05);
    this.wheel *= Math.exp(-dt * 2.5);
    if (Math.abs(this.wheel) < 0.02) this.wheel = 0;
    let { fwd, side, climb, turn } = this.input();
    // Looking/turning steers the cruise. A direct movement or altitude input takes over.
    if(this.autopilot && (Math.abs(fwd)>.08 || Math.abs(side)>.08 || Math.abs(climb)>.08))this.setAutopilot(false);
    // Turning: eased, a little slower at speed (a wider arc, as a real drone flies it).
    const h = Math.hypot(this.vel.x, this.vel.z);
    const want = -turn * YAW_RATE * (1 - 0.35 * Math.min(1, h / MAX_SPEED));
    this.yawRate += (want - this.yawRate) * Math.min(1, dt * 6);
    this.yaw += this.yawRate * dt;
    // Heading in the scene: yaw 0 looks along −z (north).
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    let autoCap=MAX_SPEED;
    if(this.autopilot){const a=this.autoControls(dt,world,fx,fz);fwd=a.fwd;side=0;climb=a.climb;autoCap=a.cap;}
    // Thrust along the sticks (diagonals no faster), drag up to the top speed.
    let ix = fx * fwd + rx * side, iz = fz * fwd + rz * side;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    // (drag balancing the thrust a little past the top speed: ~8 s to 200 km/h, where it is held)
    const drag = ACCEL / (MAX_SPEED * MAX_SPEED * 1.32);
    let ax = ix * ACCEL - this.vel.x * h * drag, az = iz * ACCEL - this.vel.z * h * drag;
    // Braking: whatever motion the sticks don't ask for is taken off (a hover hold).
    if (h > 1e-3) {
      const ux = this.vel.x / h, uz = this.vel.z / h;
      const along = ix * ux + iz * uz;   // how much of the stick keeps the current motion
      const brake = BRAKE * (1 - Math.max(0, along)) * (il > 0.05 ? 0.6 : 1);
      ax -= ux * Math.min(brake, h / dt);
      az -= uz * Math.min(brake, h / dt);
    }
    this.vel.x += ax * dt; this.vel.z += az * dt;
    // Climb and sink: eased toward the stick, braked to a hold.
    const vy = climb > 0 ? climb * CLIMB : climb * SINK;
    this.vel.y += THREE.MathUtils.clamp(vy - this.vel.y, -VACCEL * dt, VACCEL * dt);

    // The world ahead: never faster than lets the drone stop 300 m short of what is not yet
    // on screen (stopping distance v² / 2·BRAKE).
    const x = this.pos.x, y = -this.pos.z;
    let hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.5 || this.autopilot) {
      const dx = hs > .5 ? this.vel.x / hs : fx, dy = hs > .5 ? -this.vel.z / hs : -fz;
      const look = READY_AHEAD + (hs * hs) / (2 * BRAKE) + 40;
      const clear = world.clearAhead(x, y, dx, dy, look);
      this.ahead = clear;
      this.limit = clear >= look ? MAX_SPEED : Math.sqrt(Math.max(0, 2 * BRAKE * (clear - READY_AHEAD)));
    } else { this.limit = MAX_SPEED; this.ahead = Infinity; }
    const cap = Math.min(MAX_SPEED, autoCap, Math.max(this.limit, 0));
    hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > cap) {
      // (a firm brake, not a jump: the drone slows as it would with the stick pulled back)
      const k = Math.max(cap, hs - BRAKE * 1.5 * dt) / hs;
      this.vel.x *= k; this.vel.z *= k;
    }

    // Move, sliding along walls: x and z apart, against the roofs over the drone's height.
    let blockTop = -Infinity;
    const solid = (px: number, pz: number) => {
      const top = Math.max(
        world.roofAt(px + RADIUS, -pz), world.roofAt(px - RADIUS, -pz),
        world.roofAt(px, -pz + RADIUS), world.roofAt(px, -pz - RADIUS));
      if (top > this.pos.y - 0.4) { blockTop = Math.max(blockTop, top); return true; }
      return false;
    };
    this.bumped = 0;
    const nx = this.pos.x + this.vel.x * dt;
    if (!solid(nx, this.pos.z)) this.pos.x = nx; else { this.bumped = Math.max(this.bumped, Math.abs(this.vel.x)); this.vel.x *= -0.15; }
    const nz = this.pos.z + this.vel.z * dt;
    if (!solid(this.pos.x, nz)) this.pos.z = nz; else { this.bumped = Math.max(this.bumped, Math.abs(this.vel.z)); this.vel.z *= -0.15; }
    // Against something low ahead (trees on a rising slope, a low roof: up to 30 m over the drone)
    // while flying on into it, the drone lifts over it — it never sticks there, held for good.
    if (this.bumped > 0 && blockTop - this.pos.y < 30 && Math.hypot(ix, iz) > 0.1) this.vel.y = Math.max(this.vel.y, CLIMB);
    this.pos.y += this.vel.y * dt;

    // Height: 2 m over whatever is beneath (ground or roof), at most 500 m over the ground.
    const gx = this.pos.x, gy = -this.pos.z;
    const ground = world.groundAt(gx, gy);
    const under = Math.max(ground, world.roofAt(gx, gy));
    if (this.pos.y < under + MIN_AGL) { this.pos.y = under + MIN_AGL; if (this.vel.y < 0) this.vel.y = 0; }
    if (this.pos.y > ground + MAX_AGL) { this.pos.y = ground + MAX_AGL; if (this.vel.y > 0) this.vel.y = 0; }
    if(this.autopilot && this.autoEntered && under+MIN_AGL<=ground+AUTO_MAX_AGL){
      const low=Math.max(ground+AUTO_MIN_AGL,under+MIN_AGL),high=ground+AUTO_MAX_AGL;
      if(this.pos.y<low){this.pos.y=low;if(this.vel.y<0)this.vel.y=0;}
      if(this.pos.y>high){this.pos.y=high;if(this.vel.y>0)this.vel.y=0;}
    }
    this.agl = this.pos.y - ground;
    this.clearance = this.pos.y - under;

    // Attitude for the look: pitched into the acceleration, banked into turns and sideways moves.
    const fa = (ax * fx + az * fz) / ACCEL, sa = (ax * rx + az * rz) / ACCEL;
    this.pitchBody += (THREE.MathUtils.clamp(-fa, -1, 1) * 0.32 - this.pitchBody) * Math.min(1, dt * 5);
    this.roll += (THREE.MathUtils.clamp(sa * 0.28 + this.yawRate * h * 0.004, -0.5, 0.5) - this.roll) * Math.min(1, dt * 5);
    this.load = THREE.MathUtils.clamp(0.35 + 0.45 * Math.min(1, Math.hypot(ax, az) / ACCEL) + 0.25 * Math.max(0, this.vel.y / CLIMB) - 0.15 * Math.max(0, -this.vel.y / SINK) + 0.15 * h / MAX_SPEED, 0, 1);
  }

  /** Set the camera: at the drone, looking along the yaw and the gimbal's tilt; the gimbal
   * passes on a little of the body's motion (the picture lives, the horizon stays). */
  apply(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.pos);
    const e = new THREE.Euler(this.tilt + this.pitchBody * 0.12, this.yaw, -this.roll * 0.25, "YXZ");
    camera.quaternion.setFromEuler(e);
  }

  /** speed (km/h), horizontal */
  get kmh() { return Math.hypot(this.vel.x, this.vel.z) * 3.6; }
  /** compass heading, degrees from north clockwise */
  get heading() { return ((-this.yaw * 180) / Math.PI % 360 + 360) % 360; }
}
