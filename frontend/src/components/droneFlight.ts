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
/** Manual flight has no altitude ceiling; automatic flight uses its own finite band. */
export const MAX_AGL = Infinity;
export const AUTO_MIN_AGL = 10;
export const AUTO_MAX_AGL = 1000;
/** Default cruise when autopilot is engaged from a hover. */
export const AUTO_SPEED = 100 / 3.6;
/** Everything within this distance ahead must be on screen (droneWorld.clearAhead). */
export const READY_AHEAD = 300;
/** A hold for the world ahead never lasts: after HOLD_MAX seconds the drone may go on at
 * CRAWL_SPEED, so a slow machine (tiles taking a minute each) is never left unable to fly. */
export const CRAWL_SPEED = 40 / 3.6, HOLD_MAX = 3;
/** Gentle clockwise panorama: one revolution in ninety seconds. */
export const AUTO_ROTATE_RATE = Math.PI * 2 / 90;

const ACCEL = 10.5, BRAKE = 8, VACCEL = 9, CLIMB = 15, SINK = 10, YAW_RATE = 1.5, RADIUS = 0.45;
const DRAG = ACCEL / (MAX_SPEED * MAX_SPEED * 1.32);

export interface DroneWorldQuery {
  groundAt(x: number, y: number): number;
  roofAt(x: number, y: number): number;
  clearAhead(x: number, y: number, dx: number, dy: number, max: number): number;
  /** the road deck under a point, where a lane is (a car on a bridge rides the deck) */
  roadZ?(x: number, y: number): number | null;
}

export type DroneSticks = {
  /** left stick: x yaw, y climb (−1…1) */
  left: [number, number];
  /** right stick: x sideways, y forward */
  right: [number, number];
};

/** On foot (걷기): the eye's height over the street, walking and running pace (m/s), the body's radius. */
export const EYE = 1.6, WALK = 1.5, RUN = 12.6, FOOT_R = 0.3;
/** On a bicycle: the eye over the street, the top speed (100 km/h), pedalling and braking (m/s²). */
/** how far a sidewalk's paving stands over the terrain the ground query returns (m) */
export const SURFACE_LIFT = 0.17;
export const BIKE_EYE = 1.75, BIKE_TOP = 100 / 3.6, BIKE_ACCEL = 3.2, BIKE_BRAKE = 7;

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
  /** seconds the world ahead has held the drone below CRAWL_SPEED */
  private held = 0;
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
  autoRotate = false;
  /** 걷기: on foot in the drone's world — on the ground, at a walker's pace, buildings solid */
  walking = false;
  private walkY = 0;
  /** on a bicycle (while walking): its speed along the heading and the bars' turn (−1…1) */
  cycling = false; bikeSpeed = 0; steer = 0;
  /** metres covered this frame (for the wheels and the pedals) */
  moved = 0;
  /** on foot facing a building within 3 m: its outline (view frame) and the point of the wall —
   * where E goes in (droneMode) */
  door: { ring: [number, number][]; x: number; y: number } | null = null;
  /** behind the wheel (while walking): the car's numbers and its speed along the heading (m/s) */
  car: { top: number; accel: number; brake: number; wheelbase: number; lock: number; length: number; width: number; eyeY: number } | null = null;
  carSpeed = 0; throttle = 0; braking = false;
  setDriving(car: DroneFlight["car"], speed = 0) { if (!this.walking) return false; this.cycling = false; this.car = car; this.carSpeed = speed; this.steer = 0; this.vel.set(0, 0, 0); return !!car; }
  setCycling(on: boolean) { if (!this.walking) return false; this.cycling = on; this.bikeSpeed = 0; this.steer = 0; this.vel.set(0, 0, 0); return on; }
  autopilotStatus: 'off' | 'cruise' | 'altitude' | 'obstacle' = 'off';
  autoTargetAgl = 175;
  /** Horizontal speed captured at engagement (m/s), retained through temporary holds. */
  autoCruiseSpeed = AUTO_SPEED;
  /** Selected height above local ground; terrain/roofs may require a higher clearance. */
  autoCruiseAgl = 175;
  private autoSpeedSetting: number | null = null;
  private autoAltitudeSetting: number | null = null;
  private autoClock = 0;
  private autoEntered = false;
  private autoHeldInput = { fwd: 0, side: 0, climb: 0 };

  setAutopilot(on: boolean) {
    if(on)this.setAutoRotate(false);
    if (on && !this.autopilot) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.autoCruiseSpeed = this.autoSpeedSetting ?? (speed > 1e-3 ? Math.min(speed, MAX_SPEED) : AUTO_SPEED);
      this.autoCruiseAgl = this.autoAltitudeSetting ?? THREE.MathUtils.clamp(this.agl, AUTO_MIN_AGL, AUTO_MAX_AGL);
      // A pilot can engage while holding the throttle. Only subsequent input takes over.
      const { fwd, side, climb } = this.input();
      this.autoHeldInput = { fwd, side, climb };
    }
    this.autopilot = on;
    this.autopilotStatus = on ? 'altitude' : 'off';
    this.autoClock = 0; this.autoEntered = false; this.wheel = 0;
    return on;
  }
  toggleAutopilot() { return this.setAutopilot(!this.autopilot); }

  /** Session-only user controls, also applied during an active cruise or loading hold. */
  setAutoSpeed(kmh: number) {
    if (!Number.isFinite(kmh)) return;
    this.autoSpeedSetting = THREE.MathUtils.clamp(kmh / 3.6, 0, MAX_SPEED);
    this.autoCruiseSpeed = this.autoSpeedSetting;
  }
  setAutoAltitude(agl: number) {
    if (!Number.isFinite(agl)) return;
    this.autoAltitudeSetting = THREE.MathUtils.clamp(agl, AUTO_MIN_AGL, AUTO_MAX_AGL);
    this.autoCruiseAgl = this.autoAltitudeSetting;
  }

  /** Hold the current position and tilt while continuously panning the heading.
   * Uses the flight frame, with no extra timer or retained scene resources. */
  setAutoRotate(on:boolean){
    if(on){this.setAutopilot(false);this.vel.set(0,0,0);this.wheel=0;this.yawRate=0;}
    this.autoRotate=on;
    return on;
  }
  toggleAutoRotate(){return this.setAutoRotate(!this.autoRotate);}

  /** Down to the street (the nearest open ground, out of any building, within 80 m) on foot, or
   * back up into the air. */
  setWalking(on: boolean, world: DroneWorldQuery) {
    this.setAutopilot(false); this.setAutoRotate(false);
    this.vel.set(0, 0, 0); this.wheel = 0; this.yawRate = 0; this.pitchBody = this.roll = 0;
    this.walking = on; if (!on) this.cycling = false;
    if (on) {
      let x = this.pos.x, y = -this.pos.z;
      const free = (px: number, py: number) => world.roofAt(px, py) < world.groundAt(px, py) + 0.5;
      if (!free(x, y)) search: for (let r = 2; r <= 80; r += 2) for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (free(px, py)) { x = px; y = py; break search; }
      }
      const g = Math.max(world.groundAt(x, y), world.roadZ?.(x, y) ?? -Infinity) + SURFACE_LIFT;
      this.pos.set(x, g + EYE, -y); this.walkY = this.pos.y; this.tilt = -0.04;
      this.agl = this.clearance = EYE;
    } else { this.pos.y += 25; this.tilt = -0.25; }
    return on;
  }

  /** A step on foot: the sticks walk (Shift runs), Q/E turn, the drag looks; walls and buildings
   * stop the walker (sliding along them), a rise of more than 0.6 m at once is a wall too; the eye
   * follows the ground's height smoothly (a kerb, a slope). */
  private walk(dt: number, world: DroneWorldQuery, fwd: number, side: number, turn: number) {
    const x0 = this.pos.x, z0 = this.pos.z;
    if (this.car) {
      // (a car: the throttle pulls to its top speed, the brake stops it and then backs it up; the
      // steering turns it about its rear axle, less lock at speed)
      const c = this.car, v = this.carSpeed;
      this.throttle = Math.max(0, fwd); this.braking = fwd < 0 && v > 0.3;
      if (fwd > 0) this.carSpeed += c.accel * fwd * Math.max(0, 1 - (v / c.top) ** 2) * dt;
      else if (fwd < 0) this.carSpeed = v > 0.3 ? Math.max(0, v - c.brake * -fwd * dt) : Math.max(-5, v - 2.5 * -fwd * dt);
      else this.carSpeed = v > 0 ? Math.max(0, v - (0.6 + v * 0.012) * dt) : Math.min(0, v + 1.5 * dt);
      const want = THREE.MathUtils.clamp(side + turn, -1, 1);
      this.steer += (want - this.steer) * Math.min(1, dt * 5);
      const angle = this.steer * c.lock * (1 - 0.65 * Math.min(1, Math.abs(this.carSpeed) / 35));
      this.yaw -= this.carSpeed * Math.tan(angle) / c.wheelbase * dt;
      this.vel.x = -Math.sin(this.yaw) * this.carSpeed; this.vel.z = -Math.cos(this.yaw) * this.carSpeed;
      fwd = 0; side = 0;
    } else if (this.cycling) {
      // (pedal and brake; the bars turn the bike, less sharply the faster it goes; it rolls to a stop)
      const want = THREE.MathUtils.clamp(side + turn, -1, 1);
      this.steer += (want - this.steer) * Math.min(1, dt * 6);
      if (fwd > 0) this.bikeSpeed += BIKE_ACCEL * fwd * (1 - this.bikeSpeed / BIKE_TOP) * dt * 1.6;
      else if (fwd < 0) this.bikeSpeed = Math.max(0, this.bikeSpeed - BIKE_BRAKE * -fwd * dt);
      else this.bikeSpeed = Math.max(0, this.bikeSpeed - 0.25 * dt - this.bikeSpeed * this.bikeSpeed * 0.0006 * dt);
      this.bikeSpeed = Math.min(BIKE_TOP, this.bikeSpeed);
      this.yaw -= this.steer * Math.min(1.6, 5 / (this.bikeSpeed + 2.5)) * dt * (this.bikeSpeed > 0.3 ? 1 : 0.4);
      this.vel.x = -Math.sin(this.yaw) * this.bikeSpeed; this.vel.z = -Math.cos(this.yaw) * this.bikeSpeed;
      fwd = 0; side = 0;
    } else this.yaw -= turn * 1.8 * dt;
    const run = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"), speed = run ? RUN : WALK;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    let ix = fx * fwd + rx * side, iz = fz * fwd + rz * side;
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    const k = Math.min(1, dt * 8);
    if (!this.cycling) { this.vel.x += (ix * speed - this.vel.x) * k; this.vel.z += (iz * speed - this.vel.z) * k; }
    this.vel.y = 0;
    const here = world.groundAt(this.pos.x, -this.pos.z);
    // (a car: its corners and the middle of its nose and tail; a walker or a bike: a small circle)
    const fxh = -Math.sin(this.yaw), fzh = -Math.cos(this.yaw), lx = -fzh, lz = fxh;
    const probes: [number, number][] = this.car ? [[0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([s, f]) => [lx * s * this.car!.width / 2 + fxh * f * this.car!.length / 2, lz * s * this.car!.width / 2 + fzh * f * this.car!.length / 2]) as [number, number][]
      : [[FOOT_R, 0], [-FOOT_R, 0], [0, FOOT_R], [0, -FOOT_R]];
    const solid = (px: number, pz: number) => {
      for (const [ox, oz] of probes) {
        const g = world.groundAt(px + ox, -(pz + oz));
        // (a car: only a building stops it — it rides decks and ramps; on foot a rise of 0.6 m is a wall)
        if (this.car) { if (world.roofAt(px + ox, -(pz + oz)) > g + 2.0 && world.roadZ?.(px + ox, -(pz + oz)) == null) return true; continue; }
        if (world.roofAt(px + ox, -(pz + oz)) > g + 0.8 || g - here > 0.6) return true;
      }
      return false;
    };
    this.bumped = 0;
    const nx = this.pos.x + this.vel.x * dt; if (!solid(nx, this.pos.z)) this.pos.x = nx; else { this.vel.x = 0; this.bumped = 1; }
    const nz = this.pos.z + this.vel.z * dt; if (!solid(this.pos.x, nz)) this.pos.z = nz; else { this.vel.z = 0; this.bumped = 1; }
    // (a bike into a wall stops)
    if (this.cycling && this.bumped) this.bikeSpeed = Math.min(this.bikeSpeed, 1);
    // (a car into a wall: it stops dead, bouncing back a little — the impact for the sound)
    if (this.car && this.bumped) { this.bumped = Math.abs(this.carSpeed); this.carSpeed *= -0.15; }
    this.moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
    // (the surface stood on: the road deck where a lane is, else the ground — and on foot or on the
    // bike the paving's thickness over the terrain, so the feet stand on it, not sunk into it)
    const g0 = world.groundAt(this.pos.x, -this.pos.z), deck = world.roadZ?.(this.pos.x, -this.pos.z) ?? null;
    const g = (deck != null ? Math.max(g0, deck) : g0) + (this.car ? 0 : SURFACE_LIFT);
    this.walkY += (g + (this.car ? this.car.eyeY : this.cycling ? BIKE_EYE : EYE) - this.walkY) * Math.min(1, dt * 12); this.pos.y = this.walkY;
    this.agl = this.clearance = EYE; this.limit = MAX_SPEED; this.ahead = Infinity; this.load = 0;
  }

  /** Start hovering at (x, y) of the view frame, `alt` over the ground, facing `yaw`. */
  place(x: number, y: number, ground: number, alt: number, yaw: number) {
    this.pos.set(x, ground + alt, -y);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitchBody = this.roll = this.yawRate = 0;
    this.agl = this.clearance = alt;
    this.setAutopilot(false);
    this.setAutoRotate(false);
  }

  /** Mouse or finger drag on the view: turn and tilt the camera. */
  look(dx: number, dy: number) {
    if(dx||dy)this.setAutoRotate(false);
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
  wheelClimb(deltaY: number) { if(deltaY)this.setAutoRotate(false);if (deltaY && this.autopilot) this.setAutopilot(false); this.wheel = THREE.MathUtils.clamp(this.wheel - deltaY * 0.004, -1, 1); }

  /** Fly along the current camera heading. Gentle height changes and terrain/roof
   * look-ahead fit inside 10–1,000 m AGL. An impassable tower causes a hover before it. */
  private autoControls(dt: number, world: DroneWorldQuery, fx: number, fz: number) {
    this.autoClock += dt;
    const x=this.pos.x,y=-this.pos.z,ground=world.groundAt(x,y),agl=this.pos.y-ground;
    let target=ground+this.autoCruiseAgl+(this.autoAltitudeSetting===null ? 40*Math.sin(this.autoClock*Math.PI/40) : 0),cap=this.autoCruiseSpeed,obstacle=false;
    for(let distance=15;distance<=180;distance+=15){
      const px=x+fx*distance,py=y-fz*distance,g=world.groundAt(px,py),roof=world.roofAt(px,py);
      const impassable=roof-g>AUTO_MAX_AGL-24;
      if(impassable){
        obstacle=true;cap=Math.min(cap,Math.sqrt(Math.max(0,2*BRAKE*(distance-30))));
        continue;
      }
      const top=roof>g+.4 ? Math.max(g+AUTO_MIN_AGL,roof+24) : g+AUTO_MIN_AGL;
      target=Math.max(target,top);
      const rise=top-this.pos.y;
      if(rise>8)cap=Math.min(cap,Math.max(0,distance-15)/(rise/8+2));
    }
    target=THREE.MathUtils.clamp(target,ground+AUTO_MIN_AGL,ground+AUTO_MAX_AGL);
    this.autoTargetAgl=target-ground;
    const inBand=agl>=AUTO_MIN_AGL && agl<=AUTO_MAX_AGL;
    if(inBand)this.autoEntered=true;
    if(!inBand)cap=0;
    this.autopilotStatus=obstacle ? 'obstacle' : !inBand || Math.abs(target-this.pos.y)>8 ? 'altitude' : 'cruise';
    const vy=THREE.MathUtils.clamp((target-this.pos.y)*.65,-6,10);
    const along=this.vel.x*fx+this.vel.z*fz;
    // Balance the same drag and partial-throttle braking used below, so the captured
    // speed is maintained rather than settling a few km/h below the requested cruise.
    const controlSpeed=Math.min(cap,Math.max(0,this.limit));
    const holdThrust=(BRAKE*.6+controlSpeed*controlSpeed*DRAG)/(ACCEL+BRAKE*.6);
    const fwd=controlSpeed>0 ? THREE.MathUtils.clamp((controlSpeed-along)*.3+holdThrust,0,1) : 0;
    return {fwd,climb:vy>0 ? vy/CLIMB : vy/SINK,cap};
  }

  /** One step of `dt` seconds. */
  step(dt: number, world: DroneWorldQuery) {
    const rotationDt=Math.max(0,Math.min(dt,.1));
    dt = Math.min(dt, 0.05);
    this.wheel *= Math.exp(-dt * 2.5);
    if (Math.abs(this.wheel) < 0.02) this.wheel = 0;
    let { fwd, side, climb, turn } = this.input();
    if (this.walking) { this.walk(dt, world, fwd, side, turn); return; }
    if(this.autoRotate){
      if(Math.max(Math.abs(fwd),Math.abs(side),Math.abs(climb),Math.abs(turn))>.08)this.setAutoRotate(false);
      else{
        this.vel.set(0,0,0);this.yaw-=AUTO_ROTATE_RATE*rotationDt;
        this.pitchBody*=Math.exp(-dt*5);this.roll*=Math.exp(-dt*5);this.bumped=0;
        this.limit=MAX_SPEED;this.ahead=Infinity;this.load=.35;
        const ground=world.groundAt(this.pos.x,-this.pos.z),under=Math.max(ground,world.roofAt(this.pos.x,-this.pos.z));
        this.pos.y=Math.min(Math.max(this.pos.y,under+MIN_AGL),ground+MAX_AGL);
        this.agl=this.pos.y-ground;this.clearance=this.pos.y-under;
        return;
      }
    }
    // Looking/turning steers the cruise. A direct movement or altitude input takes over.
    if(this.autopilot){
      const movement={fwd,side,climb};
      for(const axis of ['fwd','side','climb'] as const){
        if(Math.abs(movement[axis]-this.autoHeldInput[axis])>.08)this.autoHeldInput[axis]=0;
      }
      if((['fwd','side','climb'] as const).some(axis=>Math.abs(movement[axis])>.08 && Math.abs(this.autoHeldInput[axis])<=.08))this.setAutopilot(false);
    }
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
    let ax = ix * ACCEL - this.vel.x * h * DRAG, az = iz * ACCEL - this.vel.z * h * DRAG;
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
      this.held = this.limit < CRAWL_SPEED ? this.held + dt : 0;
      if (this.held > HOLD_MAX) this.limit = Math.max(this.limit, CRAWL_SPEED);
    } else {
      // (a hover between pushes keeps the hold counted: each push is braked back under 0.5 m/s)
      this.limit = MAX_SPEED; this.ahead = Infinity;
      if (this.held > 0 && this.held <= HOLD_MAX) this.held += dt;
    }
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

    // Keep manual flight above ground/roofs; the autopilot has its separate altitude band.
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
    const far = Math.max(9000, this.agl + 5000);
    if (Math.abs(camera.far - far) > 200) { camera.far = far; camera.updateProjectionMatrix(); }
    camera.position.copy(this.pos);
    const e = new THREE.Euler(this.tilt + this.pitchBody * 0.12, this.yaw, -this.roll * 0.25, "YXZ");
    camera.quaternion.setFromEuler(e);
  }

  /** speed (km/h), horizontal */
  get kmh() { return Math.hypot(this.vel.x, this.vel.z) * 3.6; }
  /** compass heading, degrees from north clockwise */
  get heading() { return ((-this.yaw * 180) / Math.PI % 360 + 360) % 360; }
}
