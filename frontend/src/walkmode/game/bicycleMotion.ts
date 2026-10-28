/** Metres and seconds, shared by keyboard and touch controls. No renderer or storage. */
export const BICYCLE_MAX_KMH = 60;
export const BICYCLE_MAX_SPEED = BICYCLE_MAX_KMH / 3.6;
export const BICYCLE_LENGTH = 1.92;
export const BICYCLE_WIDTH = 0.66;
export interface BicycleControls { throttle: number; brake: number; steer: number; /** at a stand, rolled back by the feet */ reverse?: number }
/** walked backwards astride the bike: a slow push with the feet */
export const BICYCLE_REVERSE_SPEED = 1.6;
export type BicycleClearance = (x: number, y: number, hx: number, hy: number) => boolean;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));

export class BicycleMotion {
  x = 0; y = 0; heading = 0; speed = 0; steer = 0;
  place(x: number, y: number, heading: number) { this.x = x; this.y = y; this.heading = heading; this.stop(); }
  stop() { this.speed = 0; this.steer = 0; }

  /** Swept 120 Hz motion: even at 60 km/h no collision sample is over 14 cm apart. */
  step(dt: number, controls: BicycleControls, clear: BicycleClearance): number {
    dt = clamp(dt, 0, 0.1);
    if (!dt) return 0;
    const count = Math.ceil(dt * 120), h = dt / count;
    const throttle = clamp(controls.throttle, 0, 1), brake = clamp(controls.brake, 0, 1), turn = clamp(controls.steer, -1, 1), back = clamp(controls.reverse ?? 0, 0, 1);
    // (wedged against something already: any way out is let through, or the rider is stuck for good)
    const wedged = !clear(this.x, this.y, Math.cos(this.heading), Math.sin(this.heading));
    let travelled = 0;
    for (let i = 0; i < count; i++) {
      const previous = this.speed;
      if (previous < 0 || (back > 0 && previous < 0.05)) {
        // rolling back: pushed by the feet, stopped by pedalling or letting go
        const want = -BICYCLE_REVERSE_SPEED * back;
        this.speed = throttle > 0 || brake > 0 ? Math.min(0, previous + 9 * h) : previous + clamp(want - previous, -2.2 * h, 2.2 * h);
      } else {
        const acceleration = brake > 0 ? -9 * brake : throttle > 0 ? 3.4 * throttle : -1.35;
        this.speed = clamp(previous + acceleration * h, 0, BICYCLE_MAX_SPEED);
      }
      const target = turn * 0.5 / (1 + Math.abs(this.speed) / 7);
      this.steer += clamp(target - this.steer, -2.4 * h, 2.4 * h);
      const distance = (previous + this.speed) * 0.5 * h;
      // At rest the rider can put a foot down to turn away from a wall.
      const rate = Math.abs(distance) > 0.00001 ? this.speed * Math.tan(this.steer) / 1.13 : turn * 0.8;
      const heading = this.heading - clamp(rate, -1.35, 1.35) * h;
      const hx = Math.cos(heading), hy = Math.sin(heading), nx = this.x + hx * distance, ny = this.y + hy * distance;
      if (!wedged && !clear(nx, ny, hx, hy)) { this.speed = 0; break; }
      this.x = nx; this.y = ny; this.heading = Math.atan2(Math.sin(heading), Math.cos(heading));
      travelled += distance;
    }
    return travelled;
  }
}
