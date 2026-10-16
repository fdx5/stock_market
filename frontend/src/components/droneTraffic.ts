import * as THREE from "three";
import { CAR_SPECS, carModelMaterial, loadCarModels } from "./sceneCars";
import { DIMS } from "./vehicleShapes";
import {trafficLaneCurve,sampleLaneCurve,type LaneCurve} from './trafficLaneCurve';

/* The traffic on the drone's roads (드론 mode): cars along the lanes of each tile (droneRoads.ts),
 * right-hand traffic, keeping their distance from the car ahead, on into the lane that continues
 * where theirs ends (the next piece of the road, across a tile's edge or a junction). Near the
 * camera the modelled cars (sceneCars: the view's own kit, in its paint), farther a body-and-glass
 * block in the same colour: the whole traffic is a draw or two per kind, however many tiles.
 * A car with nowhere to go is set down again at a lane start out of sight. */

type JunctionRegion={key:string;revision:number;lanes:Set<Lane>};
type Lane = { tile: string; p: Float32Array; cum: Float32Array; orientation: Float64Array; len: number; cars: Car[]; width: number; minX:number;minY:number;maxX:number;maxY:number;renderOutside:boolean;junction?:JunctionRegion;
  /** the stop lines of the signalled junctions it meets: [s, junction, phase, …] (droneRoads) */
  stops?: Float32Array };
type Car = { lane: Lane; s: number; v: number; vmax: number; kind: number; colour: THREE.Color; k: number; hidden: boolean;
  /** across a junction: from the end of the last lane to the start of this one (s < 0 on it) */
  via: LaneCurve | null; planned?: {lane:Lane;curve:LaneCurve|null;revision:number}; stepped?:number };

// [model, share, length, top speed factor, livery]
const KINDS: [string, number, number, number, string?][] = [
  ["sedan", 12, 4.9, 1], ["sedan-large", 8, 5.0, 1], ["sedan-sports", 8, 4.65, 1.06], ["suv", 10, 4.63, 1], ["suv-small", 8, 4.4, 1.02],
  ["suv-luxury", 6, 4.95, 1], ["hatchback-sports", 5, 3.6, 1.02], ["kei-box", 4, 3.6, 1], ["taxi", 8, 4.9, 1, "#f2f0ea"], ["mpv", 5, 5.1, 0.98],
  ["van", 3, 5.2, 0.95], ["boxtruck", 3, 6.5, 0.9, "#e9e9e6"], ["cargo", 4, 5.1, 0.9, "#2d5fa8"], ["bus", 3, 11, 0.8, "#2a6fc4"],
];
// Korean roads' colours: white, black, grey and silver most; a few blues, reds and the rest.
const PAINT: [string, number][] = [["#f2f2ef", 30], ["#16181b", 20], ["#8d9196", 14], ["#c4c7cb", 13], ["#1f3a6b", 6], ["#8a1c1f", 5], ["#4b5a4a", 3], ["#b8a58a", 3], ["#5f3a24", 2], ["#2f6f9a", 2], ["#d8c24a", 2]];
const NEAR_M = 320, CAP_NEAR = 160;
/** A signalled junction's cycle (s): the phase along the widest road, then across it, each with
 * its amber; every junction offset by its place, so neighbours do not all change at once. */
const CYCLE = 64, GREEN = 28, AMBER = 4;
export function signalState(time: number, junction: number, phase: number): 'green' | 'amber' | 'red' {
  const offset = ((junction * 2654435761) >>> 0) % CYCLE, t = ((time + offset) % CYCLE + CYCLE) % CYCLE;
  const local = phase === 0 ? t : (t - (GREEN + AMBER) + CYCLE) % CYCLE;
  return local < GREEN ? 'green' : local < GREEN + AMBER ? 'amber' : 'red';
}
// the blocks' size per kind (width, height, length)
const BLOCK: [number, number, number][] = KINDS.map(([name, , L]) => {
  const spec = CAR_SPECS[name], dims = DIMS[name];
  return [spec?.width ?? dims?.[1] ?? 2.4, (spec?.height ?? dims?.[2] ?? 2.6) / 1.35, L];
});
/** An instance's matrix written straight into its array: turned `yaw` about the vertical (cos,
 * sin), pitched along the slope (cos, sin), scaled (sx, sy, sz), at (x, y, z). (Composing it
 * through Matrix4 and setMatrixAt for every car, every frame, was a tenth of the frame.) */
function writeMatrix(a: Float32Array, i: number, x: number, y: number, z: number, cy: number, sy: number, cp: number, sp: number, sx: number, sh: number, sz: number) {
  const o = i * 16;
  a[o] = cy * sx; a[o + 1] = 0; a[o + 2] = -sy * sx; a[o + 3] = 0;
  a[o + 4] = sy * sp * sh; a[o + 5] = cp * sh; a[o + 6] = cy * sp * sh; a[o + 7] = 0;
  a[o + 8] = sy * cp * sz; a[o + 9] = -sp * sz; a[o + 10] = cy * cp * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

function pick<T>(list: [T, number][], r: number): T {
  const total = list.reduce((a, b) => a + b[1], 0);
  let x = r * total;
  for (const [v, w] of list) { if ((x -= w) <= 0) return v; }
  return list[list.length - 1][0];
}

/** A car seen from afar: its body and a darker glasshouse on top, about the size of the kind. */
function blockGeometry() {
  const body = new THREE.BoxGeometry(1, 0.55, 1).translate(0, 0.45, 0);
  const cabin = new THREE.BoxGeometry(0.86, 0.42, 0.55).translate(0, 0.93, -0.04);
  const paint = (g: THREE.BufferGeometry, c: number) => { const n = g.getAttribute("position").count; g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(c), 3)); return g; };
  const merged = new THREE.BufferGeometry();
  const parts = [paint(body, 1), paint(cabin, 0.32)];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute("position").array as Float32Array)); nor.push(...(g.getAttribute("normal").array as Float32Array)); col.push(...(g.getAttribute("color").array as Float32Array));
    idx.push(...Array.from(g.index!.array, i => i + base));
    g.dispose();
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  merged.setIndex(idx);
  return merged;
}

export class DroneTraffic {
  private stepNo=0;
  private curves=new WeakMap<Lane,WeakMap<Lane,LaneCurve|null>>();
  private curvePose={x:0,y:0,z:0,dx:0,dy:0,dz:0};
  private curve(from:Lane,to:Lane){
    let cache=this.curves.get(from);if(!cache){cache=new WeakMap();this.curves.set(from,cache);}
    if(!cache.has(to))cache.set(to,trafficLaneCurve(from,to));return cache.get(to)!;
  }
  readonly group = new THREE.Group();
  private lanes = new Map<string, Lane[]>();
  private starts = new Map<string, Lane[]>();
  private networkRevision=0;
  private junctionRegions=new Map<string,JunctionRegion>();
  private continuations=new WeakMap<Lane,{revision:number;choices:[Lane,number][]}>();
  private laneList:{revision:number;lanes:Lane[]}|null=null;
  private cars: Car[] = [];
  private near: (THREE.InstancedMesh | null)[] = KINDS.map(() => null);
  private far: THREE.InstancedMesh;
  private farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  private nearMat: THREE.MeshStandardMaterial | null = null;
  private rnd: () => number;
  private disposed = false;

  /** how far a car is placed (m), and how many there are at most — a phone's drone: fewer, nearer */
  private readonly FAR_M: number;
  private readonly CAP_FAR: number;
  constructor(seed: number, lite = false) {
    this.FAR_M = lite ? 760 : 1100; this.CAP_FAR = lite ? 800 : 3000;
    let s = (seed % 2147483646) + 1;
    this.rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    this.group.name = "drone traffic";
    this.far = new THREE.InstancedMesh(blockGeometry(), this.farMat, this.CAP_FAR);
    this.far.count = 0; this.far.frustumCulled = false; this.far.castShadow = false; this.far.receiveShadow = true;
    this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.CAP_FAR * 3), 3);
    this.group.add(this.far);
    // The modelled cars once the kit is in (it is the view's: usually loaded already).
    void loadCarModels().then(models => {
      if (this.disposed) return;
      this.nearMat = carModelMaterial();
      KINDS.forEach(([name], i) => {
        const g = models.get(name);
        if (!g) return;
        const im = new THREE.InstancedMesh(g, this.nearMat!, CAP_NEAR);
        im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP_NEAR * 3), 3);
        this.near[i] = im;
        this.group.add(im);
      });
    }).catch(() => {});
  }

  private cell = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`;

  /** A continuation only reads starts within 22 m. Keep its cache when an
   * unrelated tile arrives; preserve global car planning/random-choice order.
   * 64 m query buckets and their eight neighbours cover that entire radius,
   * including negative coordinates and bucket boundaries. Only active lane
   * endpoints own buckets, so long flights do not retain an ever-growing map. */
  private invalidateJunctions(lanes:readonly Lane[]){
    const changed=new Set<string>();
    for(const lane of lanes){const x=Math.floor(lane.p[0]/64),y=Math.floor(lane.p[1]/64);
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)changed.add(`${x+i},${y+j}`);
    }
    for(const key of changed){const region=this.junctionRegions.get(key);if(!region)continue;
      region.revision=this.networkRevision;
      for(const lane of region.lanes)this.continuations.delete(lane);
    }
  }

  /** A tile's lanes (droneRoads: [n, road width, x, y, z, …]…), and cars on them by the road's width. */
  private clock = 0;
  /** far lanes driven every other frame (off: every lane every frame, for frame-exact checks) */
  farStagger = true;
  addTile(tile: string, packed: Float32Array, stops?: Float32Array) {
    if(this.disposed)return;
    if (this.lanes.has(tile)) this.removeTile(tile);
    const list: Lane[] = [];
    let so = 0;
    for (let o = 0; o < packed.length;) {
      const n = packed[o++], width = packed[o++], p = packed.slice(o, o + n * 3);
      o += n * 3;
      let laneStops: Float32Array | undefined;
      if (stops && so < stops.length) { const m = stops[so++]; if (m) laneStops = stops.slice(so, so + m * 3); so += m * 3; }
      const cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 3] - p[k * 3 - 3], p[k * 3 + 1] - p[k * 3 - 2]);
      // Immutable lane segments share their exact double-precision heading
      // and pitch. Recomputing their square roots for every car adds no detail.
      const orientation = new Float64Array(Math.max(0,n-1)*4);
      for(let k=0;k<n-1;k++){
        const dx=p[k*3+3]-p[k*3],dy=p[k*3+4]-p[k*3+1],dz=p[k*3+5]-p[k*3+2];
        const seg=cum[k+1]-cum[k]||1,hl=Math.hypot(dx,dy)||1,pl=Math.hypot(seg,dz)||1;
        orientation[k*4]=-dy/hl;orientation[k*4+1]=dx/hl;orientation[k*4+2]=seg/pl;orientation[k*4+3]=-dz/pl;
      }
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(let k=0;k<n;k++){minX=Math.min(minX,p[k*3]);maxX=Math.max(maxX,p[k*3]);minY=Math.min(minY,p[k*3+1]);maxY=Math.max(maxY,p[k*3+1]);}
      const lane: Lane = { tile, p, cum, orientation, len: cum[n - 1], cars: [], width, minX,minY,maxX,maxY,renderOutside:false, stops: laneStops };
      if (lane.len < 8) continue;
      list.push(lane);
      const end=p.length-3,junctionKey=`${Math.floor(p[end]/64)},${Math.floor(p[end+1]/64)}`;
      let junction=this.junctionRegions.get(junctionKey);
      if(!junction){junction={key:junctionKey,revision:this.networkRevision+1,lanes:new Set()};this.junctionRegions.set(junctionKey,junction);}
      junction.lanes.add(lane);lane.junction=junction;
      const key = this.cell(p[0], p[1]);
      this.starts.set(key, [...(this.starts.get(key) ?? []), lane]);
    }
    this.lanes.set(tile, list);
    this.networkRevision++;
    this.invalidateJunctions(list);
    for (const lane of list) {
      // (the city's density: a car every ~30–55 m on a boulevard, 45–85 m on a street, sparse on lanes)
      const gap = lane.width >= 15 ? [30, 25] : lane.width >= 8 ? [45, 40] : [80, 60];
      for (let s = 5 + this.rnd() * gap[0]; s < lane.len - 6; s += gap[0] + this.rnd() * gap[1]) {
        if (this.cars.length >= this.CAP_FAR) return;
        this.spawn(lane, s);
      }
    }
  }

  private spawn(lane: Lane, s: number) {
    const kind = pick(KINDS.map((k, i) => [i, k[1]] as [number, number]), this.rnd());
    const livery = KINDS[kind][4];
    const colour = new THREE.Color(livery ?? pick(PAINT, this.rnd()));
    const vmax = (9 + this.rnd() * 7) * KINDS[kind][3];
    const car: Car = { lane, s, v: vmax * 0.8, vmax, kind, colour, k: 0, hidden: false, via: null };
    lane.cars.push(car);
    lane.cars.sort((a, b) => a.s - b.s);
    this.cars.push(car);
  }

  removeTile(tile: string) {
    const list = this.lanes.get(tile);
    if (!list) return;
    this.lanes.delete(tile);
    this.networkRevision++;
    this.invalidateJunctions(list);
    for (const lane of list) {
      const junction=lane.junction;
      if(junction){junction.lanes.delete(lane);if(!junction.lanes.size)this.junctionRegions.delete(junction.key);}
      const key = this.cell(lane.p[0], lane.p[1]);
      const at = this.starts.get(key)?.filter(l => l !== lane);
      if (at?.length) this.starts.set(key, at); else this.starts.delete(key);
    }
    const gone = new Set(list);
    this.cars = this.cars.filter(c => !gone.has(c.lane));
  }

  /** Where a lane that ends at (x, y) heading (dx, dy) carries on: a lane starting within 4 m
   * (the same road, across a tile's edge) or, across a junction, within 22 m ahead of it — straight
   * on twice as likely as a turn, never back the way it came. */
  private next(x: number, y: number, dx: number, dy: number, from: Lane): Lane | null {
    const cached=this.continuations.get(from);
    const revision=from.junction?.revision??this.networkRevision;
    if(cached?.revision===revision)return cached.choices.length?pick(cached.choices,this.rnd()):null;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const cx = Math.round(x / 4), cy = Math.round(y / 4), out: [Lane, number][] = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) for (const l of this.starts.get(`${cx + i},${cy + j}`) ?? []) {
      if (l === from) continue;
      const ox = l.p[0] - x, oy = l.p[1] - y, d = Math.hypot(ox, oy);
      if (d > 22) continue;
      const z = from.p[from.p.length - 1], dz = Math.abs(l.p[2] - z);
      // A tile seam allows rounding noise; a junction allows an ordinary approach slope.
      // Stacked carriageways seven metres apart cannot become a continuation in XY.
      if (dz > Math.max(.35, d * .12)) continue;
      const ex = l.p[3] - l.p[0], ey = l.p[4] - l.p[1], el = Math.hypot(ex, ey) || 1, turn = (ex * dx + ey * dy) / el;
      if (d <= 4) { if (turn > 0.2) out.push([l, 4]); continue; }
      // (across a junction: ahead of the car, not back; straight on most likely)
      if ((ox * dx + oy * dy) / d < 0.2 || turn < -0.3) continue;
      out.push([l, turn > 0.8 ? 2 : 1]);
    }
    const near = out.filter(o => o[1] === 4);
    let choices=near.length?near:out;
    // A tile seam should continue in the matching lane, rather than randomly
    // jumping to a parallel adjacent lane. Merge only if that lane has ended.
    const parallel=choices.filter(([l])=>{const ex=l.p[3]-l.p[0],ey=l.p[4]-l.p[1];return(ex*dx+ey*dy)/(Math.hypot(ex,ey)||1)>.97;});
    if(parallel.length){
      const side=(l:Lane)=>Math.abs((l.p[0]-x)*dy-(l.p[1]-y)*dx),best=Math.min(...parallel.map(([l])=>side(l)));
      const matching=parallel.filter(([l])=>side(l)<=best+.25&&side(l)<=4.2);
      // Keep real junction turn choices; lane matching governs straight travel.
      choices=near.length?matching:[...choices.filter(o=>!parallel.includes(o)),...matching];
    }
    this.continuations.set(from,{revision,choices});
    return choices.length?pick(choices,this.rnd()):null;
  }

  /** One step: every car on (gap-keeping), then the instances placed for the camera at (cx, cz). */
  update(dt: number, camera: THREE.Vector3, look?: THREE.Vector3) {
    if (!this.cars.length) { this.far.count = 0; this.near.forEach(im => { if (im) im.count = 0; }); return; }
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const step=++this.stepNo;
    // (lanes far off are not driven: their cars wait, unseen, till the drone comes back near)
    const reach2 = (this.FAR_M + 150) ** 2;
    for (const list of this.lanes.values()) for (const lane of list) {
      // The whole polyline is enclosed, including long roads whose endpoints
      // are off screen. This only skips placement already rejected at FAR_M.
      const bx=Math.max(lane.minX-camera.x,0,camera.x-lane.maxX),by=Math.max(lane.minY+camera.z,0,-camera.z-lane.maxY);
      lane.renderOutside=bx*bx+by*by>this.FAR_M*this.FAR_M+1e-6;
      if (bx * bx + by * by > reach2) continue;
      // (past 450 m a car is a block of a few pixels: its lane is driven every other frame,
      // with both frames' time — half the lanes one frame, half the next)
      let ldt = dt;
      if (this.farStagger && bx * bx + by * by > 450 * 450) {
        // (and past 750 m, where a car is a pixel or two, every third frame)
        const every = bx * bx + by * by > 750 * 750 ? 3 : 2;
        if ((step + (lane.cum.length % every)) % every !== 0) continue;
        ldt = Math.min(dt * every, 0.2);
      }
      const cs = lane.cars;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        if(c.stepped===step)continue;c.stepped=step;
        if((!c.via||c.s>=c.via.endS)&&c.s>lane.len-25&&(!c.planned||c.planned.revision!==this.networkRevision)){
          const n=lane.p.length/3,k=(n-1)*3,j=k-3;
          const on=this.next(lane.p[k],lane.p[k+1],lane.p[k]-lane.p[j],lane.p[k+1]-lane.p[j+1],lane);
          c.planned=on?{lane:on,curve:this.curve(lane,on),revision:this.networkRevision}:undefined;
        }
        // the car ahead: on this lane, or the start of the next if near the end (not looked up: a margin)
        const ahead = cs[i + 1];
        const gap = ahead ? ahead.s - c.s - KINDS[ahead.kind][2] : Infinity;
        let want = gap < 6 ? 0 : gap < 40 ? c.vmax * (gap - 6) / 34 : c.vmax;
        const plan=c.planned,merge=plan?.curve;
        // the signal ahead: stop at its line on red, and on amber unless too close to stop
        const st = lane.stops;
        if (st) for (let q = 0; q < st.length; q += 3) {
          const d = st[q] - c.s;
          if (d < -0.5) continue;
          if (d > 70) break;
          const light = signalState(this.clock, st[q + 1], st[q + 2]);
          if (light === 'red' || (light === 'amber' && d > c.v * c.v / 8 + 1)) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 4 * (d - 0.5))));
          break;
        }
        if(c.via&&c.s<c.via.endS)want=Math.min(want,c.via.speedLimit);
        else if(merge){
          want=Math.min(want,merge.speedLimit);
          const first=plan.lane.cars[0];
          if(first&&first.s<merge.endS+KINDS[c.kind][2]+8)want=Math.min(want,Math.sqrt(Math.max(0,2*6*(merge.startS-c.s-.5))));
        }
        c.v += THREE.MathUtils.clamp(want - c.v, -6 * ldt, 2.5 * ldt);
        c.s += Math.max(0, c.v) * ldt;
      }
      // cars past the end: on into the next lane, or set down elsewhere
      while (cs.length && (!cs[cs.length-1].via||cs[cs.length-1].s>=cs[cs.length-1].via!.endS) && cs[cs.length - 1].s > (cs[cs.length-1].planned?.curve?.startS ?? lane.len)) {
        const c = cs.pop()!, n = lane.p.length / 3;
        const ex = lane.p[(n - 1) * 3], ey = lane.p[(n - 1) * 3 + 1];
        const nx = lane.p[(n - 1) * 3] - lane.p[(n - 2) * 3], ny = lane.p[(n - 1) * 3 + 1] - lane.p[(n - 2) * 3 + 1];
        const on = c.planned?.lane ?? this.next(ex, ey, nx, ny, lane), to = on ?? this.elsewhere(camera);
        if (!to) { this.cars = this.cars.filter(x => x !== c); continue; }
        const curve=on?(c.planned?.curve??this.curve(lane,to)):null;
        const enter=curve?.endS??0;
        // Wait in the current lane for a safe target gap. Never clamp a negative
        // connector coordinate to zero (that teleported cars sideways).
        if(on&&to.cars.length&&to.cars[0].s<enter+KINDS[c.kind][2]+8){
          c.s=Math.min(c.s,(curve?.startS??lane.len)-.05);c.v=0;cs.push(c);break;
        }
        c.via=curve;
        c.s=on?(curve?curve.endS-curve.len+c.s-curve.startS:c.s-lane.len):0;
        c.planned=undefined;
        c.lane = to; c.k = 0;
        to.cars.unshift(c);
      }
    }
    // Place them: the modelled cars near, the blocks beyond, none past FAR_M.
    const counts = this.near.map(() => 0);
    let farN = 0;
    const cx = camera.x, cz = camera.z;
    // (behind the camera — past 110° off its heading, beyond 40 m — a car is neither placed nor drawn)
    const lx = look ? look.x / (Math.hypot(look.x, look.z) || 1) : 0, lz = look ? look.z / (Math.hypot(look.x, look.z) || 1) : 0, behind = -0.34;
    for (const c of this.cars) {
      const l = c.lane, p = l.p;
      // Junction transfers can lie outside the new lane's bounds; preserve
      // their original point test and the original vehicle/random-choice order.
      if(l.renderOutside&&!(c.via&&c.s<c.via.endS))continue;
      let x: number, y: number, z: number, dx: number, dy: number, dz: number, seg: number;
      if (c.via && c.s < c.via.endS) {
        const at=sampleLaneCurve(c.via,c.via.len+c.s-c.via.endS,this.curvePose);
        x=at.x;y=at.y;z=at.z;dx=at.dx;dy=at.dy;dz=at.dz;seg=Math.hypot(dx,dy)||1;
      } else {
        c.via=null;
        while (c.k < l.cum.length - 2 && l.cum[c.k + 1] < c.s) c.k++;
        const k = c.k; seg = l.cum[k + 1] - l.cum[k] || 1;
        const f = Math.min(1, Math.max(0, (c.s - l.cum[k]) / seg));
        x = p[k * 3] + (p[k * 3 + 3] - p[k * 3]) * f; y = p[k * 3 + 1] + (p[k * 3 + 4] - p[k * 3 + 1]) * f; z = p[k * 3 + 2] + (p[k * 3 + 5] - p[k * 3 + 2]) * f;
        dx = p[k * 3 + 3] - p[k * 3]; dy = p[k * 3 + 4] - p[k * 3 + 1]; dz = p[k * 3 + 5] - p[k * 3 + 2];
      }
      const ddx = x - cx, ddz = -y - cz, dd = ddx * ddx + ddz * ddz;
      if (dd > this.FAR_M * this.FAR_M) continue;
      if (look && dd > 1600 && (ddx * lx + ddz * lz) < behind * Math.sqrt(dd)) continue;
      // heading (scene: forward +z, x east, z south) and slope, without trigonometry
      let cyaw:number,syaw:number,cp:number,sp:number;
      if(c.via&&c.s<c.via.endS){
        const hl=Math.hypot(dx,dy)||1,pl=Math.hypot(seg,dz)||1;
        cyaw=-dy/hl;syaw=dx/hl;cp=seg/pl;sp=-dz/pl;
      }else{
        const k=c.k*4;cyaw=l.orientation[k];syaw=l.orientation[k+1];cp=l.orientation[k+2];sp=l.orientation[k+3];
      }
      const near = ddx * ddx + ddz * ddz < NEAR_M * NEAR_M;
      const im = near ? this.near[c.kind] : null;
      if (im && counts[c.kind] < CAP_NEAR) {
        const i = counts[c.kind]++;
        writeMatrix(im.instanceMatrix.array as Float32Array, i, x, z, -y, cyaw, syaw, cp, sp, 1, 1, 1);
        const ca = im.instanceColor!.array as Float32Array; ca[i * 3] = c.colour.r; ca[i * 3 + 1] = c.colour.g; ca[i * 3 + 2] = c.colour.b;
      } else if (farN < this.CAP_FAR) {
        const b = BLOCK[c.kind];
        writeMatrix(this.far.instanceMatrix.array as Float32Array, farN, x, z, -y, cyaw, syaw, cp, sp, b[0], b[1], b[2]);
        const ca = this.far.instanceColor!.array as Float32Array; ca[farN * 3] = c.colour.r; ca[farN * 3 + 1] = c.colour.g; ca[farN * 3 + 2] = c.colour.b;
        farN++;
      }
    }
    this.far.count = farN;
    this.uploadPrefix(this.far,farN);
    this.near.forEach((im, i) => {
      if (!im) return;
      im.count = counts[i];
      this.uploadPrefix(im,counts[i]);
    });
  }

  /** All visible instances are rewritten above; unused capacity never draws.
   * Replace pending ranges with the complete current prefix so an off-screen
   * or empty batch cannot accumulate redundant uploads between draws. */
  private uploadPrefix(mesh:THREE.InstancedMesh,count:number){
    for(const attr of [mesh.instanceMatrix,mesh.instanceColor]){
      if(!attr)continue;attr.clearUpdateRanges();if(!count)continue;
      attr.addUpdateRange(0,count*attr.itemSize);attr.needsUpdate=true;
    }
  }

  /** A lane start out of sight (over 300 m from the camera), for a car with nowhere to go. */
  private elsewhere(camera: THREE.Vector3): Lane | null {
    if(this.laneList?.revision!==this.networkRevision)this.laneList={revision:this.networkRevision,lanes:[...this.lanes.values()].flat()};
    const all = this.laneList.lanes;
    for (let t = 0; t < 8 && all.length; t++) {
      const l = all[Math.floor(this.rnd() * all.length)];
      if (Math.hypot(l.p[0] - camera.x, -l.p[1] - camera.z) > 300) return l;
    }
    return null;
  }

  materials(): THREE.Material[] { return [this.farMat, ...(this.nearMat ? [this.nearMat] : [])]; }

  dispose() {
    this.disposed = true;
    this.cars.length=0;this.lanes.clear();this.starts.clear();this.junctionRegions.clear();
    this.continuations=new WeakMap();this.curves=new WeakMap();this.laneList=null;
    this.group.removeFromParent();
    this.far.geometry.dispose(); this.far.dispose();
    this.near.forEach(im => im?.dispose());
    this.farMat.dispose(); this.nearMat?.dispose();
  }
}
