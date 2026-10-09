export interface VehicleBody { x: number; y: number; z?:number; hx: number; hy: number; length: number; width: number }
interface TravelState { conn: object; road: number; forward: boolean; lane: number; s: number; u: number; inConn: boolean }
interface Pose { x: number; y: number; hx: number; hy: number }
interface TrajectorySweep { values: number[]; filled: number; length: number; width: number; minX: number; minY: number; maxX: number; maxY: number; degenerate: boolean }

/** Exact pair results for stationary road traffic. Every input to the path/body
 * test is checked; moving cars and height-dependent crossings bypass this cache. */
export class VehiclePathHitCache<T extends TravelState & VehicleBody>{
 private entries=new WeakMap<T,TravelState & VehicleBody & {pairs:WeakMap<VehicleBody,VehicleBody & {reach:number;result:number}>}>();
 readonly stats={hits:0,misses:0};
 read(c:T,o:VehicleBody,reach:number,compute:()=>number){
  let entry=this.entries.get(c);
  if(!entry||entry.conn!==c.conn||entry.road!==c.road||entry.forward!==c.forward||entry.lane!==c.lane||entry.s!==c.s||entry.u!==c.u||entry.inConn!==c.inConn||entry.x!==c.x||entry.y!==c.y||entry.hx!==c.hx||entry.hy!==c.hy||entry.length!==c.length||entry.width!==c.width){
   entry={conn:c.conn,road:c.road,forward:c.forward,lane:c.lane,s:c.s,u:c.u,inConn:c.inConn,x:c.x,y:c.y,hx:c.hx,hy:c.hy,length:c.length,width:c.width,pairs:new WeakMap()};this.entries.set(c,entry);
  }
  const pair=entry.pairs.get(o);
  if(pair&&pair.reach===reach&&pair.x===o.x&&pair.y===o.y&&pair.z===o.z&&pair.hx===o.hx&&pair.hy===o.hy&&pair.length===o.length&&pair.width===o.width){this.stats.hits++;return pair.result;}
  this.stats.misses++;const result=compute();entry.pairs.set(o,{x:o.x,y:o.y,z:o.z,hx:o.hx,hy:o.hy,length:o.length,width:o.width,reach,result});return result;
 }
}
/** Clamp a movement along its actual lane/turn curve before any other body.
 * Short sweep samples prevent a thin vehicle being crossed between frames;
 * binary refinement stops at the last safe pose instead of allowing penetration. */
export function collisionFreeTravel(distance:number,poseAt:(d:number)=>VehicleBody,others:readonly VehicleBody[],self:VehicleBody){
  if(distance<=0)return 0;
  const free=(d:number)=>{const p=poseAt(d);return !others.some(o=>o!==self&&!(p.z!==undefined&&o.z!==undefined&&Math.abs(p.z-o.z)>3.5)&&vehicleOverlap(p.x,p.y,p.hx,p.hy,p.length+.06,p.width+.06,o));};
  let safe=0;
  for(let d=Math.min(.25,distance);;d=Math.min(distance,d+.25)){
    if(!free(d)){
      let lo=safe,hi=d;
      for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(free(mid))lo=mid;else hi=mid;}
      return lo;
    }
    safe=d;if(d>=distance)return distance;
  }
}
/** Exact trajectory samples reused across candidate bodies; no time-step reduction. */
export class VehicleTrajectoryCache<T extends TravelState> {
  private entries = new WeakMap<T, TravelState & { values: number[]; sweep?: TrajectorySweep }>();
  /** Validate once for a whole synchronous sweep, rather than at each metre. */
  samples(c: T): number[] {
    return this.entry(c).values;
  }
  private entry(c: T) {
    let cached = this.entries.get(c);
    if (!cached) {
      cached = { conn: c.conn, road: c.road, forward: c.forward, lane: c.lane, s: c.s, u: c.u, inConn: c.inConn, values: [] };
      this.entries.set(c, cached);
    } else if (cached.conn !== c.conn || cached.road !== c.road || cached.forward !== c.forward || cached.lane !== c.lane || cached.s !== c.s || cached.u !== c.u || cached.inConn !== c.inConn) {
      cached.conn = c.conn; cached.road = c.road; cached.forward = c.forward; cached.lane = c.lane;
      cached.s = c.s; cached.u = c.u; cached.inConn = c.inConn; cached.values.length = 0;
      cached.sweep = undefined;
    }
    return cached;
  }
  /** Bounds enclose every exact metre sample, including rotated bodies on curves.
   * Rejection only skips bodies that cannot meet any of those samples. */
  sweep(c: T, reach: number, pose: Pose, compute: (c: T, d: number) => void, length: number, width: number): TrajectorySweep {
    const entry = this.entry(c);
    let sweep = entry.sweep;
    if (!sweep || sweep.length !== length || sweep.width !== width) {
      sweep = entry.sweep = { values: entry.values, filled: 0, length, width, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, degenerate: false };
    }
    for (let d = sweep.filled; d <= reach; d++) {
      this.read(c, d, pose, compute, entry.values);
      const rx = (Math.abs(pose.hx) * length + Math.abs(pose.hy) * width) / 2;
      const ry = (Math.abs(pose.hy) * length + Math.abs(pose.hx) * width) / 2;
      if ((pose.hx === 0 && pose.hy === 0) || !Number.isFinite(rx + ry + pose.x + pose.y)) sweep.degenerate = true;
      sweep.minX = Math.min(sweep.minX, pose.x - rx); sweep.maxX = Math.max(sweep.maxX, pose.x + rx);
      sweep.minY = Math.min(sweep.minY, pose.y - ry); sweep.maxY = Math.max(sweep.maxY, pose.y + ry);
      sweep.filled = d + 1;
    }
    return sweep;
  }
  read(c: T, d: number, pose: Pose, compute: (c: T, d: number) => void, values = this.samples(c)) {
    const at = d * 4;
    if (values[at] === undefined) {
      compute(c, d);
      values[at] = pose.x; values[at + 1] = pose.y; values[at + 2] = pose.hx; values[at + 3] = pose.hy;
    } else {
      pose.x = values[at]; pose.y = values[at + 1]; pose.hx = values[at + 2]; pose.hy = values[at + 3];
    }
  }
}
/** The same four separating axes, reusing their symmetric dot products. */
export function vehicleOverlap(ax: number, ay: number, ahx: number, ahy: number, al: number, aw: number, b: VehicleBody): boolean {
  const dx = b.x - ax, dy = b.y - ay;
  const dot = Math.abs(ahx * b.hx + ahy * b.hy), cross = Math.abs(ahy * b.hx - ahx * b.hy);
  const aa = ahx * ahx + ahy * ahy, bb = b.hx * b.hx + b.hy * b.hy;
  const la = al / 2, wa = aw / 2, lb = b.length / 2, wb = b.width / 2;
  // Do not assume unit headings: the original tests also accept scaled axes.
  if (Math.abs(dx * ahx + dy * ahy) > la * aa + (lb * dot + wb * cross)) return false;
  if (Math.abs(dx * ahy - dy * ahx) > wa * aa + (lb * cross + wb * dot)) return false;
  if (Math.abs(dx * b.hx + dy * b.hy) > (la * dot + wa * cross) + lb * bb) return false;
  if (Math.abs(dx * b.hy - dy * b.hx) > (la * cross + wa * dot) + wb * bb) return false;
  return true;
}
export function missesTrajectory(sweep: TrajectorySweep, body: VehicleBody) {
  if (sweep.degenerate || (body.hx === 0 && body.hy === 0)) return false;
  const rx = (Math.abs(body.hx) * body.length + Math.abs(body.hy) * body.width) / 2;
  const ry = (Math.abs(body.hy) * body.length + Math.abs(body.hx) * body.width) / 2;
  if (!Number.isFinite(rx + ry + body.x + body.y)) return false;
  // A conservative margin leaves near-touch floating-point cases to the SAT test.
  const epsilon = 1e-6;
  return body.x + rx < sweep.minX - epsilon || body.x - rx > sweep.maxX + epsilon
    || body.y + ry < sweep.minY - epsilon || body.y - ry > sweep.maxY + epsilon;
}
