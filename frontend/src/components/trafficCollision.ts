export interface VehicleBody { x: number; y: number; hx: number; hy: number; length: number; width: number }
interface TravelState { conn: object; road: number; forward: boolean; lane: number; s: number; u: number; inConn: boolean }
interface Pose { x: number; y: number; hx: number; hy: number }
/** Exact trajectory samples reused across candidate bodies; no time-step reduction. */
export class VehicleTrajectoryCache<T extends TravelState> {
  private entries = new WeakMap<T, TravelState & { values: number[] }>();
  read(c: T, d: number, pose: Pose, compute: (c: T, d: number) => void) {
    let cached = this.entries.get(c);
    if (!cached) {
      cached = { conn: c.conn, road: c.road, forward: c.forward, lane: c.lane, s: c.s, u: c.u, inConn: c.inConn, values: [] };
      this.entries.set(c, cached);
    } else if (cached.conn !== c.conn || cached.road !== c.road || cached.forward !== c.forward || cached.lane !== c.lane || cached.s !== c.s || cached.u !== c.u || cached.inConn !== c.inConn) {
      cached.conn = c.conn; cached.road = c.road; cached.forward = c.forward; cached.lane = c.lane;
      cached.s = c.s; cached.u = c.u; cached.inConn = c.inConn; cached.values.length = 0;
    }
    const at = d * 4, values = cached.values;
    if (values[at] === undefined) {
      compute(c, d);
      values[at] = pose.x; values[at + 1] = pose.y; values[at + 2] = pose.hx; values[at + 3] = pose.hy;
    } else {
      pose.x = values[at]; pose.y = values[at + 1]; pose.hx = values[at + 2]; pose.hy = values[at + 3];
    }
  }
}
/** The same four separating-axis tests, without allocating axes per sample. */
export function vehicleOverlap(ax: number, ay: number, ahx: number, ahy: number, al: number, aw: number, b: VehicleBody): boolean {
  const dx = b.x - ax, dy = b.y - ay;
  for (let axis = 0; axis < 4; axis++) {
    const ux = axis === 0 ? ahx : axis === 1 ? ahy : axis === 2 ? b.hx : b.hy;
    const uy = axis === 0 ? ahy : axis === 1 ? -ahx : axis === 2 ? b.hy : -b.hx;
    const ra = al / 2 * Math.abs(ahx * ux + ahy * uy) + aw / 2 * Math.abs(ahy * ux - ahx * uy);
    const rb = b.length / 2 * Math.abs(b.hx * ux + b.hy * uy) + b.width / 2 * Math.abs(b.hy * ux - b.hx * uy);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}
