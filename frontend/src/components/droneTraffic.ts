import * as THREE from "three";
import { CAR_SPECS, carModelMaterial, loadCarModels } from "./sceneCars";
import { DIMS } from "./vehicleShapes";
import {trafficLaneCurve,sampleLaneCurve,type LaneCurve} from './trafficLaneCurve';

/* The traffic on the drone's roads (드론 mode): cars along the lanes of each tile (droneRoads.ts),
 * right-hand traffic, keeping their distance from the car ahead, on into the lane that continues
 * where theirs ends (the next piece of the road, across a tile's edge or a junction). Near the
 * camera the modelled cars (sceneCars: the view's own kit, in its paint), farther a body-and-glass
 * block in the same colour: the whole traffic is a draw or two per kind, however many tiles.
 * Each car drives by the intelligent-driver law against what is nearest ahead along its planned
 * way (the car in front, a red light, a bend, a crossing another car holds); where paths cross,
 * one car at a time holds the crossing, and a narrower road gives way where no signal stands.
 * A car with nowhere to go is set down again at a lane start out of sight. */

type JunctionRegion={key:string;revision:number;lanes:Set<Lane>};
type Lane = { id:number;tile: string; p: Float32Array; cum: Float32Array; orientation: Float64Array; startDir:[number,number];endDir:[number,number];len: number; cars: Car[]; width: number;
  /** its speed limit (m/s, by the road's width) */
  limit:number;minX:number;minY:number;maxX:number;maxY:number;renderOutside:boolean;junction?:JunctionRegion;
  /** the stop lines of the signalled junctions it meets: [s, junction, phase, …] (droneRoads) */
  stops?: Float32Array;bankStart?:string;bankEnd?:string;dead:boolean;cells?:number[];crosses?:Cross[] };
/** A curve across a junction (trafficLaneCurve), with what it crosses. */
type Curve = LaneCurve & {id:number;from:Lane;to:Lane;cells?:number[];crosses?:Cross[];samples?:Float64Array;sampleCum?:Float64Array};
/** Where two paths cross: held by one car at a time, from before it enters till its tail is out. */
type CP = {x:number;y:number;key:string;paths:(Lane|Curve)[];
  /** per side (the path paths[0], the path paths[1]): how many cars hold it, when one last said so, the last */
  n:[number,number];t:[number,number];by:[Car|null,Car|null];
  /** per side: when a car last stood waiting for it, since when without a break, and which car */
  want:[number,number];since:[number,number];asker:[Car|null,Car|null]};
type Claim = {cp:CP;side:number;release:number};
/** A path's segments k0…k1 within one grid cell: their chord's direction and their extent. */
type Run = {lane:Lane|null;curve:Curve|null;k0:number;k1:number;dx:number;dy:number;minX:number;minY:number;maxX:number;maxY:number};
/** A crossing on a path: at s along it, the other path (at os along that), its width, and whether
 * a signal governs the junction (then the lights decide, not the roads' sizes). */
type Cross = {s:number;cp:CP;side:number;other:Lane|Curve;os:number;w:number;sig:boolean};
type Car = { id:number;lane: Lane; s: number; v: number; vmax: number; kind: number; colour: THREE.Color; k: number; hidden: boolean;
  /** across a junction: from the end of the last lane to the start of this one (s < 0 on it) */
  via: Curve | null;
  /** the lanes it will take next, each with the curve into it; none found from the last: routeEnd */
  route:{lane:Lane;curve:Curve|null}[];routeEnd:boolean;routeRev:number;
  /** the crossings it holds, each till the odometer passes `release` */
  claims:Claim[];odo:number;
  /** seconds standing still; false once off the road */
  wait:number;alive:boolean;
  /** where it was at the start of the step (centre, level, heading): the guard's view */
  x:number;y:number;z:number;hx:number;hy:number;
  /** the driver: 0 gentle … 1 brisk */
  drv:number;stepped?:number;
  /** what it last slowed for, and the car behind that (checks read these) */
  why?:string;waitOn?:Car|null;
  /** till when it goes through a locked junction regardless (see drive) */
  force?:number };

// [model, share, length, top speed factor, livery]
const KINDS: [string, number, number, number, string?][] = [
  ["sedan", 12, 4.9, 1], ["sedan-large", 8, 5.0, 1], ["sedan-sports", 8, 4.65, 1.06], ["suv", 10, 4.63, 1], ["suv-small", 8, 4.4, 1.02],
  ["suv-luxury", 6, 4.95, 1], ["hatchback-sports", 5, 3.6, 1.02], ["kei-box", 4, 3.6, 1], ["taxi", 8, 4.9, 1, "#f2f0ea"], ["mpv", 5, 5.1, 0.98],
  ["van", 3, 5.2, 0.95], ["boxtruck", 3, 6.5, 0.9, "#e9e9e6"], ["cargo", 4, 5.1, 0.9, "#2d5fa8"], ["bus", 3, 11, 0.8, "#2a6fc4"],
  // 119: an ambulance (the white Staria-type van) and a fire engine (the red truck), a little
  // quicker than the rest, their roof lights flashing red and blue (beacons below)
  ["van", 1.4, 5.2, 1.2, "#f7f7f3"], ["boxtruck", 0.9, 6.5, 1.1, "#c8141c"],
];
/** The kinds with roof beacons: the ambulance and the fire engine (the last two KINDS). */
const EMERGENCY_FROM = KINDS.length - 2;
/** each kind's length (m), for the following distances: read for every car every frame */
const LEN = Float32Array.from(KINDS, k => k[2]);
const CAP_BEACON = 48;
// Korean roads' colours: white, black, grey and silver most; a few blues, reds and the rest.
const PAINT: [string, number][] = [["#f2f2ef", 30], ["#16181b", 20], ["#8d9196", 14], ["#c4c7cb", 13], ["#1f3a6b", 6], ["#8a1c1f", 5], ["#4b5a4a", 3], ["#b8a58a", 3], ["#5f3a24", 2], ["#2f6f9a", 2], ["#d8c24a", 2]];
const NEAR_M = 320, CAP_NEAR = 160;
/** the driving law's comfortable braking (m/s²) and the gap kept standing (m) */
const B_COMFORT = 2.5, S0 = 2;
/** within this of the camera cars take crossings in turn and the guard keeps bodies apart whatever
 * their lanes (m; past it a car is a few pixels); a car standing
 * this long (s) out of sight is set down elsewhere */
const GUARD_M = 400, WAIT_GIVE_UP = 40;
/** and within this the guard against bodies in one place (m): past it they are specks */
const BODY_M = 250;
/** the slowest a curve is taken (m/s): a kink in the data is no hairpin */
const CURVE_MIN = 3.5;
const EMPTY: Car[] = [];
const NO_CROSSES: Cross[] = [];
/** segment pairs tested for crossings in one frame, at most (well under a millisecond) */
const CROSS_WORK = 4000;
/** A signalled junction's cycle (s): the phase along the widest road, then across it, each with
 * its amber and then a moment of red both ways (the junction clears before the other phase goes);
 * every junction offset by its place, so neighbours do not all change at once. */
const CYCLE = 64, GREEN = 27, AMBER = 3, ALL_RED = 2;
export function signalState(time: number, junction: number, phase: number): 'green' | 'amber' | 'red' {
  const offset = ((junction * 2654435761) >>> 0) % CYCLE, t = ((time + offset) % CYCLE + CYCLE) % CYCLE;
  const local = phase === 0 ? t : (t - (GREEN + AMBER + ALL_RED) + CYCLE) % CYCLE;
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
  private curves=new WeakMap<Lane,WeakMap<Lane,Curve|null>>();
  private curvePose={x:0,y:0,z:0,dx:0,dy:0,dz:0};
  private curve(from:Lane,to:Lane):Curve|null{
    let cache=this.curves.get(from);if(!cache){cache=new WeakMap();this.curves.set(from,cache);}
    if(!cache.has(to)){const c=trafficLaneCurve(from,to) as Curve|null;if(c){c.id=++this.ids;c.from=from;c.to=to;}cache.set(to,c);}
    return cache.get(to)!;
  }
  readonly group = new THREE.Group();
  private lanes = new Map<string, Lane[]>();
  private starts = new Map<string, Lane[]>();
  private networkRevision=0;
  private junctionRegions=new Map<string,JunctionRegion>();
  private continuations=new WeakMap<Lane,{revision:number;choices:[Lane,number][]}>();
  private laneList:{revision:number;lanes:Lane[]}|null=null;
  private cars: Car[] = [];
  private ids=0;
  /** every lane segment and every junction curve by 16 m cell: where paths cross (crossings) */
  private segGrid=new Map<number,Run[]>();
  private conflictPoints=new Map<string,CP>();
  /** the cars by 16 m cell, this frame: the guard against bodies in the same place */
  private carGrid=new Map<number,Car[]>();
  private near: (THREE.InstancedMesh | null)[] = KINDS.map(() => null);
  private far: THREE.InstancedMesh;
  private farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  private nearMat: THREE.MeshStandardMaterial | null = null;
  /** the emergency vehicles' roof lights, red and blue, flashing in turn (near only) */
  private beaconGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  private beaconMats = [new THREE.MeshStandardMaterial({ color: "#ff2a2a", emissive: "#ff1a1a", emissiveIntensity: 6, roughness: .3 }),
    new THREE.MeshStandardMaterial({ color: "#2a5cff", emissive: "#1a4cff", emissiveIntensity: 6, roughness: .3 })];
  private beacons = this.beaconMats.map(m => { const b = new THREE.InstancedMesh(this.beaconGeo, m, CAP_BEACON); b.count = 0; b.frustumCulled = false; b.castShadow = false; b.name = "drone emergency beacons"; return b; });
  /** each kind's roof: height and how far forward the light bar sits (from its model) */
  private roofs: [number, number][] = KINDS.map(([, , L]) => [2, L / 2 - .8]);
  private rnd: () => number;
  private disposed = false;

  /** how far a car is placed (m), and how many there are at most — a phone's drone: fewer, nearer */
  private readonly FAR_M: number;
  private readonly CAP_FAR: number;
  constructor(seed: number, lite = false) {
    this.FAR_M = lite ? 560 : 1100; this.CAP_FAR = lite ? 400 : 3000;
    let s = (seed % 2147483646) + 1;
    this.rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    this.group.name = "drone traffic";
    this.far = new THREE.InstancedMesh(blockGeometry(), this.farMat, this.CAP_FAR);
    this.far.count = 0; this.far.frustumCulled = false; this.far.castShadow = false; this.far.receiveShadow = true;
    this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.CAP_FAR * 3), 3);
    this.group.add(this.far, ...this.beacons);
    // The modelled cars once the kit is in (it is the view's: usually loaded already).
    void loadCarModels().then(models => {
      if (this.disposed) return;
      this.nearMat = carModelMaterial();
      KINDS.forEach(([name], i) => {
        const g = models.get(name);
        if (!g) return;
        if (i >= EMERGENCY_FROM) { g.computeBoundingBox(); const b = g.boundingBox!; this.roofs[i] = [b.max.y, b.max.z - (name === "van" ? 1.3 : .7)]; }
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
  addTile(tile: string, packed: Float32Array, stops?: Float32Array,banks?:Float32Array) {
    if(this.disposed)return;
    if (this.lanes.has(tile)) this.removeTile(tile);
    const list: Lane[] = [];
    let so = 0;
    for (let o = 0; o < packed.length;) {
      const count = packed[o++], width = packed[o++], raw = packed.subarray(o, o + count * 3);
      o += count * 3;
      // Pavement triangle intersections can round to duplicate Float32 points.
      // They must not turn a real bank heading into a zero-length direction.
      const clean:number[]=[];
      for(let k=0;k<raw.length;k+=3)if(!clean.length||Math.hypot(raw[k]-clean[clean.length-3],raw[k+1]-clean[clean.length-2])>.001)clean.push(raw[k],raw[k+1],raw[k+2]);
      const p=new Float32Array(clean),n=p.length/3;
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
      if(n<2)continue;
      const direction=(start:boolean):[number,number]=>{
        const end=start?0:n-1;let k=start?1:n-2;
        while(k>0&&k<n-1&&Math.abs(cum[k]-cum[end])<.5)k+=start?1:-1;
        const sign=start?1:-1,dx=(p[k*3]-p[end*3])*sign,dy=(p[k*3+1]-p[end*3+1])*sign,l=Math.hypot(dx,dy)||1;
        return [dx/l,dy/l];
      };
      // (the city's limits: 60 km/h on a boulevard, 50 on a street, 30 in a lane)
      const limit=width>=15?16.7:width>=8?13.9:8.3;
      const lane: Lane = { id:++this.ids,tile, p, cum, orientation,startDir:direction(true),endDir:direction(false),len: cum[n - 1], cars: [], width,limit, minX,minY,maxX,maxY,renderOutside:false, stops: laneStops,dead:false,cells:undefined,crosses:undefined,junction:undefined,bankStart:undefined,bankEnd:undefined };
      for(let k=0;banks&&k<banks.length;k+=2){
        const key=`${Math.round(banks[k]*10)},${Math.round(banks[k+1]*10)}`,end=p.length-3;
        if(Math.hypot(p[0]-banks[k],p[1]-banks[k+1])<=width/2+2)lane.bankStart=key;
        if(Math.hypot(p[end]-banks[k],p[end+1]-banks[k+1])<=width/2+2)lane.bankEnd=key;
      }
      // Short surveyed connectors carry cars between longer paths even though
      // they cannot spawn one themselves. Dropping them severs bridge banks
      // and tile/junction seams after the road geometry has already joined.
      if (lane.len < .05) continue;
      list.push(lane);
      const end=p.length-3,junctionKey=`${Math.floor(p[end]/64)},${Math.floor(p[end+1]/64)}`;
      let junction=this.junctionRegions.get(junctionKey);
      if(!junction){junction={key:junctionKey,revision:this.networkRevision+1,lanes:new Set()};this.junctionRegions.set(junctionKey,junction);}
      junction.lanes.add(lane);lane.junction=junction;
      const key = this.cell(p[0], p[1]);
      this.starts.set(key, [...(this.starts.get(key) ?? []), lane]);
      this.index(lane,null,p,n);
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

  /** A path's segments into the crossing grid (16 m cells), one run of consecutive segments per
   * cell with its overall direction and extent; a new lane makes the lanes it meets there work their
   * crossings out again. */
  private index(lane:Lane|null,curve:Curve|null,p:ArrayLike<number>,n:number){
    const runs=new Map<number,Run>(),cells:number[]=[];
    for(let k=0;k<n-1;k++){
      const ax=p[k*3],ay=p[k*3+1],bx=p[k*3+3],by=p[k*3+4];
      const x0=Math.floor(Math.min(ax,bx)/16),x1=Math.floor(Math.max(ax,bx)/16),y0=Math.floor(Math.min(ay,by)/16),y1=Math.floor(Math.max(ay,by)/16);
      for(let i=x0;i<=x1;i++)for(let j=y0;j<=y1;j++){
        const key=i*100003+j;let r=runs.get(key);
        if(r&&r.k1===k-1){r.k1=k;}
        else{
          if(r)this.closeRun(r,p);
          r={lane,curve,k0:k,k1:k,dx:0,dy:0,minX:0,minY:0,maxX:0,maxY:0};runs.set(key,r);
          let at=this.segGrid.get(key);
          if(!at)this.segGrid.set(key,at=[]);
          else if(lane)for(const e of at){if(e.lane&&e.lane!==lane)e.lane.crosses=undefined;}
          at.push(r);cells.push(key);
        }
      }
    }
    for(const r of runs.values())this.closeRun(r,p);
    if(lane)lane.cells=cells;else if(curve)curve.cells=cells;
  }
  private closeRun(r:Run,p:ArrayLike<number>){
    const a=r.k0*3,b=(r.k1+1)*3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],l=Math.hypot(dx,dy)||1;
    r.dx=dx/l;r.dy=dy/l;r.minX=Infinity;r.minY=Infinity;r.maxX=-Infinity;r.maxY=-Infinity;
    for(let k=r.k0;k<=r.k1+1;k++){r.minX=Math.min(r.minX,p[k*3]);r.maxX=Math.max(r.maxX,p[k*3]);r.minY=Math.min(r.minY,p[k*3+1]);r.maxY=Math.max(r.maxY,p[k*3+1]);}
  }
  private unindex(cells:number[]|undefined,lane:Lane|null,curve:Curve|null){
    for(const key of cells??[]){const at=this.segGrid.get(key);if(!at)continue;
      const kept=at.filter(e=>e.lane!==lane||e.curve!==curve);
      if(kept.length)this.segGrid.set(key,kept);else this.segGrid.delete(key);
    }
  }

  /** Where a path (a lane, or a curve across a junction) crosses others: at an angle (20° and
   * more), at one level, not where both end (a seam, a curve's join). A conflict point each, shared.
   * Worked out when first needed, a few paths a frame (`crossWork`); till then a path has none. */
  private crossWork=0;
  private crossings(lane:Lane|null,curve:Curve|null):Cross[]{
    const own=lane??curve!;
    if(own.crosses)return own.crosses;
    if(this.crossWork>CROSS_WORK)return NO_CROSSES;
    let p:ArrayLike<number>,cum:ArrayLike<number>,len:number;
    if(lane){p=lane.p;cum=lane.cum;len=lane.len;}
    else{
      const c=curve!,pts:number[]=[],cs:number[]=[];
      for(let i=0;i<=24;i++){const u=c.len*i/24,a=sampleLaneCurve(c,u,this.curvePose);pts.push(a.x,a.y,a.z);cs.push(u);}
      p=c.samples=new Float64Array(pts);cum=c.sampleCum=new Float64Array(cs);len=c.len;
      if(!c.cells)this.index(null,c,p,25);
    }
    const out:Cross[]=[];
    for(const key of own.cells??[])for(const r of this.segGrid.get(key)??[]){
      if((r.lane??r.curve)!==own)continue;
      for(const e of this.segGrid.get(key)!){
        const o=e.lane??e.curve!;
        if(o===own||(e.lane&&e.lane.dead)||(curve&&(e.lane===curve.from||e.lane===curve.to))||(lane&&e.curve&&(e.curve.from===lane||e.curve.to===lane)))continue;
        // (runs side by side — the lanes of one road — or apart: nothing to test)
        if(Math.abs(r.dx*e.dx+r.dy*e.dy)>.985||e.minX>r.maxX||e.maxX<r.minX||e.minY>r.maxY||e.maxY<r.minY)continue;
        const op=e.lane?e.lane.p:e.curve!.samples,oc=e.lane?e.lane.cum:e.curve!.sampleCum;
        if(!op||!oc)continue;
        this.crossWork+=(r.k1-r.k0+1)*(e.k1-e.k0+1)+4;
        for(let k=r.k0;k<=r.k1;k++){
          const ax=p[k*3],ay=p[k*3+1],ex=p[k*3+3]-ax,ey=p[k*3+4]-ay,el=Math.hypot(ex,ey);
          if(el<1e-4)continue;
          for(let q=e.k0;q<=e.k1;q++){
            const cx=op[q*3],cy=op[q*3+1],fx=op[q*3+3]-cx,fy=op[q*3+4]-cy,fl=Math.hypot(fx,fy);
            if(fl<1e-4||Math.abs(ex*fx+ey*fy)/(el*fl)>.94)continue;
            const den=ex*fy-ey*fx;if(Math.abs(den)<1e-9)continue;
            const t=((cx-ax)*fy-(cy-ay)*fx)/den,u=((cx-ax)*ey-(cy-ay)*ex)/den;
            if(t<0||t>=1||u<0||u>=1)continue;
            const s=cum[k]+(cum[k+1]-cum[k])*t,os=oc[q]+(oc[q+1]-oc[q])*u,olen=e.lane?e.lane.len:e.curve!.len;
            // (two paths' ends meet at a seam or across a junction's curve: no crossing there; a lane
            // that starts or ends across another one's middle does cross it)
            if((s<.3||s>len-.3)&&(os<.3||os>olen-.3))continue;
            const z=p[k*3+2]+(p[k*3+5]-p[k*3+2])*t,oz=op[q*3+2]+(op[q*3+5]-op[q*3+2])*u;
            if(Math.abs(z-oz)>2.5)continue;
            if(out.some(c=>c.other===o&&Math.abs(c.s-s)<3))continue;
            const key=own.id<o.id?`${own.id}:${k}:${o.id}:${q}`:`${o.id}:${q}:${own.id}:${k}`;
            let cp=this.conflictPoints.get(key);
            if(!cp){
              cp={x:ax+ex*t,y:ay+ey*t,key,paths:[own,o],n:[0,0],t:[-1e9,-1e9],by:[null,null],want:[-1e9,-1e9],since:[0,0],asker:[null,null]};this.conflictPoints.set(key,cp);
              // (a crossing found late — a curve worked out only now — is held at once by the cars
              // already on it or about to be, as if they had taken it on their way in)
              this.occupy(cp,own,s);this.occupy(cp,o,os);
            }
            let sig=false;
            if(lane?.stops)for(let i=0;i<lane.stops.length;i+=3)if(lane.stops[i]<s&&lane.stops[i]>s-40)sig=true;
            out.push({s,cp,side:cp.paths[0]===own?0:1,other:o,os,w:e.lane?e.lane.width:e.curve!.from.width,sig});
            // (a path that has its crossings already learns of this one)
            if(o.crosses&&!o.crosses.some(c=>c.cp===cp)){o.crosses.push({s:os,cp,side:cp.paths[0]===o?0:1,other:own,os:s,w:lane?lane.width:curve!.from.width,sig:false});o.crosses.sort((a,b)=>a.s-b.s);}
          }
        }
      }
    }
    out.sort((a,b)=>a.s-b.s);
    own.crosses=out;
    return out;
  }

  private spawn(lane: Lane, s: number) {
    const kind = pick(KINDS.map((k, i) => [i, k[1]] as [number, number]), this.rnd());
    const livery = KINDS[kind][4];
    const colour = new THREE.Color(livery ?? pick(PAINT, this.rnd()));
    // (each driver their own: a little over or under the limit, a gentler or a brisker start)
    const vmax = 16.7 * (0.88 + this.rnd() * 0.22) * KINDS[kind][3];
    const car: Car = { id:++this.ids,lane, s, v: Math.min(vmax,lane.limit) * 0.8, vmax, kind, colour, k: 0, hidden: false, via: null,route:[],routeEnd:false,routeRev:-1,claims:[],odo:0,wait:0,alive:true,x:0,y:0,z:0,hx:1,hy:0,drv:this.rnd(),stepped:0,why:'',waitOn:null,force:0 };
    let at=lane.cars.length;while(at>0&&lane.cars[at-1].s>s)at--;
    lane.cars.splice(at,0,car);
    this.cars.push(car);
  }

  removeTile(tile: string) {
    const list = this.lanes.get(tile);
    if (!list) return;
    this.lanes.delete(tile);
    this.networkRevision++;
    this.invalidateJunctions(list);
    for (const lane of list) {
      lane.dead=true;
      const junction=lane.junction;
      if(junction){junction.lanes.delete(lane);if(!junction.lanes.size)this.junctionRegions.delete(junction.key);}
      const key = this.cell(lane.p[0], lane.p[1]);
      const at = this.starts.get(key)?.filter(l => l !== lane);
      if (at?.length) this.starts.set(key, at); else this.starts.delete(key);
      this.unindex(lane.cells,lane,null);lane.cells=undefined;
      for(const c of lane.crosses??[])this.conflictPoints.delete(c.cp.key);
      for(const c of lane.cars){c.alive=false;this.release(c,Infinity);}
    }
    // (the curves to and from them, and their crossings, go too)
    for(const [key,at] of this.segGrid){
      const kept=at.filter(e=>!e.curve||!(e.curve.from.dead||e.curve.to.dead));
      if(kept.length!==at.length){for(const e of at)if(e.curve&&!kept.includes(e)){for(const c of e.curve.crosses??[])this.conflictPoints.delete(c.cp.key);}if(kept.length)this.segGrid.set(key,kept);else this.segGrid.delete(key);}
    }
    for(const [key,cp] of this.conflictPoints)if(cp.paths.some(o=>'dead' in o?o.dead:(o.from.dead||o.to.dead)))this.conflictPoints.delete(key);
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
    [dx,dy]=from.endDir;
    const cx = Math.round(x / 4), cy = Math.round(y / 4), out: [Lane, number][] = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) for (const l of this.starts.get(`${cx + i},${cy + j}`) ?? []) {
      if (l === from) continue;
      const ox = l.p[0] - x, oy = l.p[1] - y, d = Math.hypot(ox, oy);
      if (d > 22) continue;
      const z = from.p[from.p.length - 1], dz = Math.abs(l.p[2] - z);
      // A tile seam allows rounding noise; a junction allows an ordinary approach slope.
      // Stacked carriageways seven metres apart cannot become a continuation in XY.
      if (dz > Math.max(.35, d * .12)) continue;
      const turn = l.startDir[0]*dx+l.startDir[1]*dy;
      const bankMerge=!!from.bankEnd&&from.bankEnd===l.bankStart&&turn>.97;
      if (d <= 4) { if (turn > 0.2) out.push([l, 4]); continue; }
      if(bankMerge&&d<=12){out.push([l,4]);continue;}
      // (across a junction: ahead of the car, not back; straight on most likely)
      if ((ox * dx + oy * dy) / d < 0.2 || turn < -0.3) continue;
      out.push([l, turn > 0.8 ? 2 : 1]);
    }
    const near = out.filter(o => o[1] === 4);
    let choices=near.length?near:out;
    // A tile seam should continue in the matching lane, rather than randomly
    // jumping to a parallel adjacent lane. Merge only if that lane has ended.
    const parallel=choices.filter(([l])=>l.startDir[0]*dx+l.startDir[1]*dy>.97);
    if(parallel.length){
      const side=(l:Lane)=>Math.abs((l.p[0]-x)*dy-(l.p[1]-y)*dx),best=Math.min(...parallel.map(([l])=>side(l)));
      const matching=parallel.filter(([l])=>side(l)<=best+.25&&side(l)<=(from.bankEnd&&from.bankEnd===l.bankStart?12:4.2));
      // Keep real junction turn choices; lane matching governs straight travel.
      choices=near.length?matching:[...choices.filter(o=>!parallel.includes(o)),...matching];
    }
    this.continuations.set(from,{revision,choices});
    return choices.length?pick(choices,this.rnd()):null;
  }

  /** The car's way on, chosen ahead far enough to see what is coming (the car ahead on the next
   * piece, its stop line, the paths it crosses): lane by lane, each with the curve into it. */
  private plan(c:Car,look:number){
    let route=c.route;const cut=route.findIndex(r=>r.lane.dead);
    if(cut>=0){route=route.slice(0,cut);c.routeEnd=false;}
    if(c.routeEnd&&c.routeRev!==this.networkRevision)c.routeEnd=false;
    // (how far it is to the end of the last planned lane)
    let last=c.lane,ahead=-c.s;
    for(const r of route){ahead+=(r.curve?r.curve.startS-(r.curve.endS-r.curve.len):last.len);last=r.lane;}
    ahead+=last.len;
    while(!c.routeEnd&&ahead<look&&route.length<5){
      const n=last.p.length/3,k=(n-1)*3,j=k-3;
      const on=this.next(last.p[k],last.p[k+1],last.p[k]-last.p[j],last.p[k+1]-last.p[j+1],last);
      if(!on){c.routeEnd=true;c.routeRev=this.networkRevision;break;}
      const curve=this.curve(last,on);
      if(route===c.route)route=route.slice();
      route.push({lane:on,curve});
      ahead+=-last.len+(curve?curve.startS-(curve.endS-curve.len):last.len)+on.len;
      last=on;
    }
    c.route=route;
  }

  private release(c:Car,odo:number){
    if(!c.claims.length)return;
    const kept=c.claims.filter(cl=>{if(cl.release>odo)return true;this.unclaim(c,cl);return false;});
    if(kept.length!==c.claims.length)c.claims=kept;
  }

  private occupy(cp:CP,path:Lane|Curve,at:number){
    const side=cp.paths[0]===path?0:1,lane='cars' in path?path:path.to,curve='cars' in path?null:path;
    for(const c of lane.cars){
      if(!c.alive)continue;
      const onCurve=!!c.via&&c.s<c.via.endS;
      if(curve?(c.via!==curve||!onCurve):onCurve)continue;
      const here=curve?curve.len+c.s-curve.endS:c.s,d=at-here,half=LEN[c.kind]/2;
      if(d<-half-1||d>half+3)continue;
      cp.n[side]++;cp.t[side]=this.clock;cp.by[side]=c;
      c.claims=[...c.claims,{cp,side,release:c.odo+d+half+2.5}];
    }
  }
  private unclaim(c:Car,cl:Claim){
    const cp=cl.cp;cp.n[cl.side]=Math.max(0,cp.n[cl.side]-1);if(cp.by[cl.side]===c)cp.by[cl.side]=null;
  }
  private holds(c:Car,cp:CP){for(const cl of c.claims)if(cl.cp===cp)return true;return false;}

  /** Where the car is (its centre, heading), on its lane or on the curve into it. */
  private pose(c:Car){
    const l=c.lane;
    if(c.via&&c.s<c.via.endS){
      const at=sampleLaneCurve(c.via,c.via.len+c.s-c.via.endS,this.curvePose),h=Math.hypot(at.dx,at.dy)||1;
      c.x=at.x;c.y=at.y;c.z=at.z;c.hx=at.dx/h;c.hy=at.dy/h;return;
    }
    let k=c.k;while(k<l.cum.length-2&&l.cum[k+1]<c.s)k++;while(k>0&&l.cum[k]>c.s)k--;c.k=k;
    const p=l.p,seg=l.cum[k+1]-l.cum[k]||1,f=Math.min(1,Math.max(0,(c.s-l.cum[k])/seg));
    c.x=p[k*3]+(p[k*3+3]-p[k*3])*f;c.y=p[k*3+1]+(p[k*3+4]-p[k*3+1])*f;c.z=p[k*3+2]+(p[k*3+5]-p[k*3+2])*f;
    c.hx=l.orientation[k*4+1];c.hy=-l.orientation[k*4];
  }

  /** One step: every car on (gap-keeping), then the instances placed for the camera at (cx, cz). */
  update(dt: number, camera: THREE.Vector3, look?: THREE.Vector3) {
    if (!this.cars.length) { this.far.count = 0; this.near.forEach(im => { if (im) im.count = 0; }); return; }
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const step=++this.stepNo,clock=this.clock;
    this.crossWork=0;
    const lx = look ? look.x / (Math.hypot(look.x, look.z) || 1) : 0, lz = look ? look.z / (Math.hypot(look.x, look.z) || 1) : 0, behind = -0.34;
    // (lanes far off are not driven: their cars wait, unseen, till the drone comes back near)
    const reach2 = (this.FAR_M + 150) ** 2;
    const driven=this.driven;driven.length=0;
    // Where every car near enough is, before any moves: the guard grid (16 m cells).
    if(this.carGrid.size>4096)this.carGrid.clear();else for(const at of this.carGrid.values())at.length=0;
    for (const list of this.lanes.values()) for (const lane of list) {
      // The whole polyline is enclosed, including long roads whose endpoints
      // are off screen. This only skips placement already rejected at FAR_M.
      const bx=Math.max(lane.minX-camera.x,0,camera.x-lane.maxX),by=Math.max(lane.minY+camera.z,0,-camera.z-lane.maxY),d2=bx*bx+by*by;
      lane.renderOutside=d2>this.FAR_M*this.FAR_M+1e-6;
      if (d2 > reach2) continue;
      if(d2<BODY_M*BODY_M)for(const c of lane.cars){this.pose(c);const key=Math.floor(c.x/16)*100003+Math.floor(c.y/16);let at=this.carGrid.get(key);if(!at)this.carGrid.set(key,at=[]);at.push(c);}
      // (past 250 m a car is a few pixels long: its lane is driven every other frame,
      // with both frames' time — half the lanes one frame, half the next)
      let ldt = dt;
      if (this.farStagger && d2 > 250 * 250) {
        // (and past 450 m every third, past 750 m, where a car is a pixel or two, every fourth)
        const every = d2 > 750 * 750 ? 4 : d2 > 450 * 450 ? 3 : 2;
        if ((step + (lane.cum.length % every)) % every !== 0) continue;
        ldt = Math.min(dt * every, 0.25);
      }
      driven.push(lane,ldt,d2);
    }
    for(let q=0;q<driven.length;q+=3){
      const lane=driven[q] as Lane,ldt=driven[q+1] as number,near2=driven[q+2] as number,guard=near2<GUARD_M*GUARD_M,body=near2<BODY_M*BODY_M;
      const cs = lane.cars;
      for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        if(c.stepped===step||c.lane!==lane)continue;c.stepped=step;
        this.drive(c,i,ldt,clock,guard,body);
        // (a car stuck for long, out of sight, is set down elsewhere: no jam lasts for ever)
        if(c.wait>WAIT_GIVE_UP&&(!body||Math.hypot(c.x-camera.x,c.y+camera.z)>300||(c.x-camera.x)*lx+(-c.y-camera.z)*lz<0)){cs.splice(i,1);this.moved.push(c);}
      }
      // cars past their lane's end: on into the next piece of their way, or set down elsewhere
      for(let i=cs.length-1;i>=0;i--){
        const c=cs[i];
        if(c.via&&c.s<c.via.endS)continue;
        const r=c.route[0],exit=r?.curve?.startS??lane.len;
        if(c.s<=exit)continue;
        cs.splice(i,1);
        if(!r){this.moved.push(c);continue;}
        const to=r.lane;
        c.s=r.curve?r.curve.endS-r.curve.len+c.s-r.curve.startS:c.s-lane.len;
        c.via=r.curve;c.lane=to;c.k=0;c.route=c.route.slice(1);
        let at=0;while(at<to.cars.length&&to.cars[at].s<c.s)at++;
        to.cars.splice(at,0,c);
      }
    }
    for(const c of this.moved)this.relocate(c,camera,lx,lz);
    this.moved.length=0;
    // Place them: the modelled cars near, the blocks beyond, none past FAR_M.
    const counts = this.near.map(() => 0);
    let farN = 0, beaconN = 0;
    const flash = clock, beaconA = [this.beacons[0].instanceMatrix.array as Float32Array, this.beacons[1].instanceMatrix.array as Float32Array];
    const cx = camera.x, cz = camera.z;
    // (behind the camera — past 110° off its heading, beyond 40 m — a car is neither placed nor drawn)
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
        const k=c.k*4,o=l.orientation;cyaw=o[k];syaw=o[k+1];cp=o[k+2];sp=o[k+3];
        // (round a bend: the heading turns over the last and first 1.5 m of the segments either side
        // of a corner, not at once on its point)
        const into=c.s-l.cum[c.k],left=l.cum[c.k+1]-c.s;
        let w=0,j=-1;
        if(into<1.5&&c.k>0){w=.5-into/3;j=k-4;}
        else if(left<1.5&&c.k<l.cum.length-2){w=.5-left/3;j=k+4;}
        if(j>=0&&w>0){const ny=cyaw*(1-w)+o[j]*w,nx=syaw*(1-w)+o[j+1]*w,h=Math.hypot(ny,nx)||1;cyaw=ny/h;syaw=nx/h;}
      }
      const near = ddx * ddx + ddz * ddz < NEAR_M * NEAR_M;
      const im = near ? this.near[c.kind] : null;
      if (im && counts[c.kind] < CAP_NEAR) {
        const i = counts[c.kind]++;
        writeMatrix(im.instanceMatrix.array as Float32Array, i, x, z, -y, cyaw, syaw, cp, sp, 1, 1, 1);
        const ca = im.instanceColor!.array as Float32Array; ca[i * 3] = c.colour.r; ca[i * 3 + 1] = c.colour.g; ca[i * 3 + 2] = c.colour.b;
        if (c.kind >= EMERGENCY_FROM && beaconN < CAP_BEACON) {
          // (two lamps across the roof's front, red left and blue right, each on in its turn:
          // ~2.5 flashes a second, every vehicle on its own beat)
          const [H, F] = this.roofs[c.kind], beat = Math.floor(flash * 5 + (c.vmax * 7.3) % 2) & 1;
          const fx = syaw * cp, fy = -sp, fz = cyaw * cp, ux = syaw * sp, uy = cp, uz = cyaw * sp;
          for (let side = 0; side < 2; side++) {
            const u = side === 0 ? -.42 : .42, on = (beat === side) ? 1 : .35;
            const bx = x + fx * F + ux * H + cyaw * u, by = z + fy * F + uy * H, bz = -y + fz * F + uz * H - syaw * u;
            writeMatrix(beaconA[side], beaconN, bx, by, bz, cyaw, syaw, cp, sp, .7 * on, .2 * on, .3);
          }
          beaconN++;
        }
      } else if (farN < this.CAP_FAR) {
        const b = BLOCK[c.kind];
        writeMatrix(this.far.instanceMatrix.array as Float32Array, farN, x, z, -y, cyaw, syaw, cp, sp, b[0], b[1], b[2]);
        const ca = this.far.instanceColor!.array as Float32Array; ca[farN * 3] = c.colour.r; ca[farN * 3 + 1] = c.colour.g; ca[farN * 3 + 2] = c.colour.b;
        farN++;
      }
    }
    this.far.count = farN;
    // (no emergency vehicle near, and none last frame: nothing to send)
    if (beaconN || this.beacons[0].count) for (const b of this.beacons) { b.count = beaconN; this.uploadPrefix(b, beaconN); }
    this.uploadPrefix(this.far,farN);
    for (let i = 0; i < this.near.length; i++) {
      const im = this.near[i];
      if (!im || (!counts[i] && !im.count)) continue;
      im.count = counts[i];
      this.uploadPrefix(im,counts[i]);
    }
  }
  private driven:(Lane|number)[]=[];
  private moved:Car[]=[];
  /** the conflict points ahead of the car being driven: distance, point, its crossing */
  private aheadD:number[]=[];private aheadC:Cross[]=[];

  /** One car's step: the intelligent-driver law (IDM) against whatever is nearest ahead — the car
   * in front (on this lane or the next pieces of its way), a red light's stop line, a bend's speed,
   * a crossing another car holds — and never past any of them. */
  private drive(c:Car,i:number,dt:number,clock:number,guard:boolean,body:boolean){
    const lane=c.lane,cs=lane.cars,v=c.v,L=LEN[c.kind],half=L/2;
    this.release(c,c.odo);
    // (standing a while for something else, it lets go of the crossings it has not reached yet:
    // a car holds nothing it cannot use, so no two wait on each other)
    if(c.claims.length&&c.wait>2&&c.claims.some(cl=>cl.release-c.odo>L+3)){
      c.claims=c.claims.filter(cl=>{if(cl.release-c.odo<=L+3)return true;this.unclaim(c,cl);return false;});
    }
    for(const cl of c.claims)cl.cp.t[cl.side]=clock;
    const look=Math.min(90,Math.max(45,v*v/(2*B_COMFORT)+30));
    const endOfLane=(c.route[0]?.curve?.startS??lane.len)-c.s;
    let dead=false;for(const r of c.route)if(r.lane.dead)dead=true;
    if(endOfLane<look&&!c.routeEnd&&c.route.length<5||dead||c.routeEnd&&c.routeRev!==this.networkRevision)this.plan(c,look);
    const onCurve=c.via&&c.s<c.via.endS?c.via:null;
    let v0=Math.min(c.vmax,lane.limit*(c.kind>=EMERGENCY_FROM?1.25:.92+.16*c.drv));
    if(onCurve)v0=Math.min(v0,Math.max(CURVE_MIN,onCurve.speedLimit));
    v0=Math.max(v0,.01);
    const heavy=c.kind>=11&&c.kind<=13;
    const A=(heavy?1.0:1.5)+.6*c.drv,T=1.0+.5*(1-c.drv);
    const r0=v/v0,free=1-r0*r0*r0*r0,dv=2*Math.sqrt(A*B_COMFORT);
    let acc=A*free,hard=Infinity;
    // a thing ahead at bumper gap `gap` moving at `vl`: its IDM term, and the distance not to pass
    let why='',on:Car|null=null;
    const obstacle=(gap:number,vl:number,s0:number,tag:string,by:Car|null)=>{
      const g=gap>.05?gap:.05,ss=s0+Math.max(0,v*T+v*(v-vl)/dv),q=ss/g;
      const a=A*(free-q*q);
      if(a<acc){acc=a;why=tag;on=by;}
      if(gap-.25<hard)hard=gap>.25?gap-.25:0;
    };
    // walk the way ahead: this piece from the car on, then each planned piece
    let leader:Car|null=cs[i+1]??null,leaderGap=Infinity,stopAt=Infinity;
    let base=-c.s,pieceLane=lane,from=c.s,nC=0;
    if(leader){leaderGap=leader.s-c.s-(LEN[leader.kind]/2+half);}
    const curveAhead=(curve:Curve,dStart:number)=>{
      const vc=Math.max(CURVE_MIN,curve.speedLimit);
      if(v>vc&&dStart>-1)acc=Math.min(acc,-(v*v-vc*vc)/(2*Math.max(dStart,1)));
    };
    for(let r=-1;r<c.route.length;r++){
      if(r>=0){
        const step=c.route[r],prevLane=r===0?lane:c.route[r-1].lane,K=step.curve;
        const xt=K?K.startS:prevLane.len,yt=K?K.endS-K.len:0;
        const dT=base+xt;
        if(dT>look)break;
        base=dT-yt;pieceLane=step.lane;from=yt-.01;
        if(K){
          curveAhead(K,dT-half);
          // (a merge into a lane whose first car stands at its start: wait in this one)
          const first=step.lane.cars[0];
          if(!leader&&first&&first.v<3&&first.s-LEN[first.kind]/2<K.endS+2)obstacle(dT-.3,0,.5,'merge',first);
          if(guard)for(const x of this.crossings(null,K))if(nC<24){this.aheadD[nC]=dT+x.s;this.aheadC[nC++]=x;}
        }
        if(!leader){const first=step.lane.cars[0];if(first&&first!==c){leader=first;leaderGap=base+first.s-(LEN[first.kind]/2+half);}}
      }else if(onCurve){
        // (on the curve now: what crosses the rest of it)
        const u0=onCurve.len+c.s-onCurve.endS;
        if(guard)for(const x of this.crossings(null,onCurve))if(x.s>u0-half-2&&nC<24){this.aheadD[nC]=x.s-u0;this.aheadC[nC++]=x;}
      }
      // the signal ahead on this piece: stop at its line on red, and on amber unless too close to stop
      const st=pieceLane.stops;
      if(st&&stopAt===Infinity)for(let q=0;q<st.length;q+=3){
        if(st[q]<from)continue;
        const d=base+st[q]-half;
        if(d<-.3)continue;
        if(d>look)break;
        const light=signalState(this.clock,st[q+1],st[q+2]);
        if(light==='red'||(light==='amber'&&d>v*v/(2*4)+1))stopAt=d;
        break;
      }
      if(guard){
        const xs=this.crossings(pieceLane,null);
        let lo=0,hi=xs.length;while(lo<hi){const m=(lo+hi)>>1;if(xs[m].s<from-half-2)lo=m+1;else hi=m;}
        for(let q=lo;q<xs.length&&nC<24;q++){const d=base+xs[q].s;if(d>look)break;this.aheadD[nC]=d;this.aheadC[nC++]=xs[q];}
      }
      if(leader)break;
    }
    if(leader)obstacle(leaderGap,leader.v,S0,'leader',leader);
    if(stopAt<Infinity)obstacle(stopAt-.5,0,.5,'signal',null);
    // A body in the way that is not on this car's lanes (a lane drawn twice, a merge, a duplicate
    // piece): the guard follows the car in front in the same direction, whatever its lane.
    if(body){
      const gx=Math.floor(c.x/16),gy=Math.floor(c.y/16);
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const o of this.carGrid.get((gx+a)*100003+gy+b)??EMPTY){
        if(o===c||o===leader||Math.abs(o.z-c.z)>2.5)continue;
        const rx=o.x-c.x,ry=o.y-c.y,along=rx*c.hx+ry*c.hy,lat=Math.abs(rx*c.hy-ry*c.hx),dot=o.hx*c.hx+o.hy*c.hy;
        // (within 25° of this car's heading: sharper meetings are crossings, held above)
        if(dot<.9||lat>1.7||along>18||along<-.05||(along<.05&&o.id>c.id)||(o.waitOn===c&&(o.why==='crossing'||o.why==='guard'&&c.id<o.id)))continue;
        obstacle(along-(LEN[o.kind]/2+half),o.v*dot,S0,'guard',o);
      }
    }
    // Crossings: those of the junction ahead taken at once, or none, and only while no car on the
    // other path holds them (cars on one path share them: they follow each other through). Not past
    // a red light.
    const H=Math.max(14,v*v/(2*B_COMFORT)+10);
    let first=Infinity,blocked=false,last=-Infinity,holder:Car|null=null,count=0;
    for(let q=0;q<nC;q++){const d=this.aheadD[q];if(d>=-half-1&&d-half<=H&&d<=stopAt+.5&&!this.holds(c,this.aheadC[q].cp))first=Math.min(first,d);}
    if(first<Infinity)for(let q=0;q<nC;q++){
      const d=this.aheadD[q],x=this.aheadC[q],cp=x.cp;
      if(d<first||d>first+30||d>stopAt+.5||this.holds(c,cp))continue;
      count++;last=Math.max(last,d);
      // (a crossing it is already on, it can only clear: never wait there)
      if(d<half+.5)continue;
      const other=1-x.side;
      // (its own way crossing itself: no wait on itself)
      if(cp.by[other]===c||cp.asker[other]===c)continue;
      if(cp.n[other]>0&&clock-cp.t[other]<1.5){blocked=true;holder=cp.by[other];}
      // (turn and turn about: a car that has stood waiting on the other path goes first, unless this
      // one could no longer stop; of two waiting, the one waiting longer)
      else if(clock-cp.want[other]<.5&&clock-cp.since[other]>(x.sig?2:4)&&d-half-2>v*v/12&&
        (clock-cp.want[x.side]>=.5||cp.since[other]<cp.since[x.side]||cp.since[other]===cp.since[x.side]&&other===0)){blocked=true;holder=cp.asker[other];}
      // (no signal: the narrower road gives way to cars coming on the wider one)
      else if(!x.sig&&x.w>lane.width+1.5&&'cars' in x.other){
        for(const o of x.other.cars){const dd=x.os-o.s;if(dd>-LEN[o.kind]/2&&dd<Math.max(12,o.v*3.5)&&o.v>1){blocked=true;holder=o;break;}}
      }
    }
    // (into a junction only with room to leave it: not behind a car that stands beyond it)
    if(count&&!blocked&&leader&&leader.v<2&&leaderGap+half<last+L+2){blocked=true;holder=leader;}
    // A ring of cars each waiting on the next (a junction locked solid): the one of them waiting at
    // a crossing with the lowest number goes, and the rest follow it out.
    if(blocked&&holder&&(c.force??0)<clock&&c.wait>6){
      let o:Car|null|undefined=holder,lowest=c.id;
      for(let n=0;o&&o!==c&&n<16;n++){if(o.why==='crossing')lowest=Math.min(lowest,o.id);o=o.waitOn;}
      // (or, failing a ring it can see, after a long wait at a crossing in any case)
      if(o===c&&lowest===c.id||c.wait>15+c.drv*5)c.force=clock+4;
    }
    if((c.force??0)>=clock)blocked=false;
    if(count){
      if(blocked){
        obstacle(first-half-2,0,.5,'crossing',holder);
        // (and says so on the crossings it waits for)
        if(v<1)for(let q=0;q<nC;q++){
          const d=this.aheadD[q],x=this.aheadC[q],cp=x.cp;
          if(d<half+.5||d>last||this.holds(c,cp))continue;
          if(clock-cp.want[x.side]>1)cp.since[x.side]=clock;
          cp.want[x.side]=clock;cp.asker[x.side]=c;
        }
      }
      else{
        const add:Claim[]=[];
        for(let q=0;q<nC;q++){
          const d=this.aheadD[q],x=this.aheadC[q],cp=x.cp;
          if(d<first||d>last||this.holds(c,cp)||add.some(a=>a.cp===cp))continue;
          cp.n[x.side]++;cp.t[x.side]=clock;cp.by[x.side]=c;
          add.push({cp,side:x.side,release:c.odo+d+half+2.5});
        }
        c.claims=[...c.claims,...add];
      }
    }
    // the step: braking at most 8 m/s², never past what is ahead
    acc=Math.max(-8,Math.min(A,acc));
    let nv=Math.max(0,v+acc*dt),ds=nv*dt;
    if(ds>hard){ds=hard;nv=Math.min(nv,hard/dt);}
    c.v=nv;c.s+=ds;c.odo+=ds;
    c.wait=nv<.2?c.wait+dt:0;
    c.why=why;c.waitOn=on;
  }

  /** A car whose way ends (no lane goes on from there) is set down at a lane start out of sight,
   * within the driven reach, with room ahead of it. */
  private relocate(c:Car,camera:THREE.Vector3,lx:number,lz:number){
    this.release(c,Infinity);
    c.route=[];c.routeEnd=false;c.via=null;c.k=0;c.wait=0;
    const to=this.elsewhere(camera,lx,lz);
    if(!to){c.alive=false;this.cars=this.cars.filter(x=>x!==c);return;}
    c.lane=to;c.s=Math.min(2,to.len/2);c.v=Math.min(c.vmax,to.limit)*.6;
    let at=0;while(at<to.cars.length&&to.cars[at].s<c.s)at++;
    to.cars.splice(at,0,c);
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

  /** A lane start out of sight (over 300 m from the camera, or behind it), still within the reach
   * where cars are driven, its start clear. */
  private elsewhere(camera: THREE.Vector3,lx=0,lz=0): Lane | null {
    if(this.laneList?.revision!==this.networkRevision)this.laneList={revision:this.networkRevision,lanes:[...this.lanes.values()].flat()};
    const all = this.laneList.lanes;
    let fallback:Lane|null=null;
    for (let t = 0; t < 24 && all.length; t++) {
      const l = all[Math.floor(this.rnd() * all.length)];
      const dx=l.p[0]-camera.x,dz=-l.p[1]-camera.z,d=Math.hypot(dx,dz);
      if(l.len<30||(l.cars.length&&l.cars[0].s-LEN[l.cars[0].kind]<12))continue;
      // (not on a crossing, nor on another car)
      if(this.crossings(l,null).some(x=>x.s<14))continue;
      const gx=Math.floor(l.p[0]/16),gy=Math.floor(l.p[1]/16);let taken=false;
      for(let a=-1;a<=1&&!taken;a++)for(let b=-1;b<=1&&!taken;b++)for(const o of this.carGrid.get((gx+a)*100003+gy+b)??EMPTY)if(Math.hypot(o.x-l.p[0],o.y-l.p[1])<9&&Math.abs(o.z-l.p[2])<2.5){taken=true;break;}
      if(taken)continue;
      const unseen=d>300||(d>60&&dx*lx+dz*lz<-.2*d);
      if(!unseen)continue;
      if(d<this.FAR_M+100)return l;
      fallback??=l;
    }
    return fallback;
  }

  materials(): THREE.Material[] { return [this.farMat, ...this.beaconMats, ...(this.nearMat ? [this.nearMat] : [])]; }

  dispose() {
    this.disposed = true;
    this.cars.length=0;this.lanes.clear();this.starts.clear();this.junctionRegions.clear();
    this.segGrid.clear();this.conflictPoints.clear();this.carGrid.clear();
    this.continuations=new WeakMap();this.curves=new WeakMap();this.laneList=null;
    this.group.removeFromParent();
    this.far.geometry.dispose(); this.far.dispose();
    this.near.forEach(im => im?.dispose());
    this.farMat.dispose(); this.nearMat?.dispose();
    for (const b of this.beacons) b.dispose(); this.beaconGeo.dispose(); for (const m of this.beaconMats) m.dispose();
  }
}
