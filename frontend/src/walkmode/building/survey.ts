import { inPoly, kindOf, planFloor, type Box, type BuildingPlan, type FloorPlan, type Seg, type ZoneKind } from "./plan";

type Point = [number, number];
export type Polygon = Point[][];
export interface SurveyBuilding {
  status: string; id?: string; name?: string; year: number;
  outlines?:Polygon[];
  frame?: { x: number; y: number; lon: number; lat: number; width: number; depth: number };
}
export interface SurveyFloor {
  status: string; year: number; level: number; outlines?: Polygon[];
  rooms?: { polygons: Polygon[]; type: string }[];
  companies?: { x: number; y: number; name: string; category: string }[];
  facilities?: { x: number; y: number; type: string }[];
  partitionsAvailable?: boolean; facilitiesAvailable?: boolean;
}
export async function getSurvey<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(18000) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
export const contains = (x: number, z: number, p: Polygon) => inPoly(x, z, p[0]) && !p.slice(1).some(h => inPoly(x, z, h));
const area = (p: Point[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** Geometry remains in metres. Partitions are SGIS polygons; furniture and passage openings are
 * reconstructed, explicitly labelled as such. A floor without a boundary uses the register fallback. */
export function measuredFloor(b: BuildingPlan, data: SurveyFloor, source: SurveyBuilding, entry: Point, seed=7): FloorPlan | null {
  const f = source.frame;
  if (data.status !== "available" || !f || !data.outlines?.length) return null;
  const P = (p: Point): Point => [p[0] - f.x, f.depth - (p[1] - f.y)];
  const polygons = data.outlines.map(p => p.map(r => r.map(P))).filter(p => p[0]?.length >= 3);
  if (!polygons.length) return null;
  const inside = (x: number, z: number) => polygons.some(p => contains(x, z, p));
  const bounds = polygons.flatMap(p => p[0]);
  const W = Math.max(b.W, ...bounds.map(p => p[0] + 1)), D = Math.max(b.D, ...bounds.map(p => p[1] + 1));
  if (W > 700 || D > 700 || bounds.some(p => p[0] < -1 || p[1] < -1)) return null;
  b.W = W; b.D = D;
  const reg = b.regFloors.find(f => f.level === data.level), height = data.level === 1 ? 4.5 : 3.8;
  const boxes: Box[] = [], segs: Seg[] = [], zones: FloorPlan["zones"] = [], spots: FloorPlan["spots"] = [], decor: FloorPlan["decor"] = [];
  const lifts: FloorPlan["lifts"] = [], stairs: FloorPlan["stairs"] = [];
  const regions=(data.rooms??[]).flatMap(r=>r.polygons.map(p=>({type:r.type,p:p.map(r=>r.map(P))})));
  const openingAt=(ring:Point[])=>{
    let best=-Infinity,result={x:ring[0][0],z:ring[0][1],nx:0,nz:-1,edge:0,w:2};
    for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len<1.2)continue;
      const x=(a[0]+c[0])/2,z=(a[1]+c[1])/2;let nx=(c[1]-a[1])/len,nz=-(c[0]-a[0])/len;
      if(inPoly(x+nx*.2,z+nz*.2,ring)){nx=-nx;nz=-nz;}
      const ox=x+nx,oz=z+nz;
      const corridor=inside(ox,oz)&&!regions.some(r=>r.p[0]!==ring&&r.type!=="20"&&r.type!=="31"&&contains(ox,oz,r.p));
      const score=(corridor?1000:inside(ox,oz)?10:0)+Math.min(len,12);
      if(score>best){best=score;result={x,z,nx,nz,edge:i,w:Math.min(2.1,len-.4)};}
    }
    return result;
  };
  const walls = (ring: Point[], material: Seg["m"], opening: boolean) => {
    const doorway=openingAt(ring);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < .05) continue;
      const add = (t0: number, t1: number) => segs.push({ ax: a[0] + (c[0] - a[0]) * t0, az: a[1] + (c[1] - a[1]) * t0, bx: a[0] + (c[0] - a[0]) * t1, bz: a[1] + (c[1] - a[1]) * t1, t: .12, y0: 0, y1: height, m: material, solid: true });
      if (opening && i === doorway.edge && len > 1.2) { const gap = doorway.w/2 / len; add(0, .5 - gap); add(.5 + gap, 1); }
      else add(0, 1);
    }
  };
  // Exterior walls are kept solid. The exit is an interactive portal within the measured boundary.
  polygons.forEach(p => p.forEach(r => walls(r, "wall", false)));
  const obstacles: Polygon[] = [];
  for (const room of regions) {
    const p = room.p; if (!p[0]?.length) continue;
    const xs = p[0].map(q => q[0]), zs = p[0].map(q => q[1]);
    const rect: [number, number, number, number] = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    const company = data.companies?.find(c => contains(...P([c.x, c.y]), p));
    const kind = kindOf(company?.category ?? b.info.use ?? "", "", data.level, b.info);
    if (room.type==="40") { obstacles.push(p); p.forEach(r => walls(r, "concrete", false)); continue; }
    if(/^3/.test(room.type)){
      if(room.type==="31")continue;
      p.forEach(r=>walls(r,"wall",true));
      const o=openingAt(p[0]);
      if(room.type==="32")lifts.push({x:o.x,z:o.z,w:o.w,yaw:Math.atan2(o.nx,o.nz),nx:o.nx,nz:o.nz,index:lifts.length});
      if(room.type==="34"||room.type==="33"){
        stairs.push({x:rect[0],z:rect[1],w:rect[2]-rect[0],d:rect[3]-rect[1],entry:[o.x+o.nx*1.1,o.z+o.nz*1.1]});
        for(let i=0;i<10;i++){const x=o.x-o.nx*(.3+i*.25),z=o.z-o.nz*(.3+i*.25);if(contains(x,z,p))segs.push({ax:x-o.nz*.7,az:z+o.nx*.7,bx:x+o.nz*.7,bz:z-o.nx*.7,t:.26,y0:i*.14,y1:(i+1)*.14,m:"concrete",solid:false});}
      }
      const label=({"32":"엘리베이터","33":"에스컬레이터","34":"계단","35":"화장실"} as Record<string,string>)[room.type];
      if(label)decor.push({kind:"sign",x:o.x+o.nx*.1,z:o.z+o.nz*.1,y:2.6,yaw:Math.atan2(o.nx,o.nz),w:2,h:.45,text:label});
      continue;
    }
    if (room.type === "20" || room.type === "white") continue;
    zones.push({ kind, label: company?.name ?? "공간", rect, polygon: p });
    // SGIS does not supply door leaves or furniture. The opening and contents are reconstructed.
    walls(p[0], kind === "retail" ? "glass" : "wall", true);
    const zi = zones.length - 1;
    const add = (x: number, z: number, w: number, d: number, h: number, m: Box["m"]) => {
      if ([[x,z],[x+w,z],[x,z+d],[x+w,z+d]].every(([a,c]) => contains(a,c,p))) boxes.push({ x0:x,z0:z,x1:x+w,z1:z+d,y0:0,y1:h,m,solid:true });
    };
    let placed = 0;
    for (let z = rect[1] + 1.5; z < rect[3] - 2; z += 3.8) for (let x = rect[0] + 1.5; x < rect[2] - 2; x += 3.8) {
      if (!contains(x,z,p) || !inside(x,z) || placed++ > 60) continue;
      const medical = kind === "clinic" || kind === "ward";
      if(medical){
        add(x,z,1.0,1.9,.6,"sheet");add(x+1.5,z,1.2,.65,.74,"desk");
        spots.push({x:x+.5,z:z+.8,y:.62,yaw:0,kind:"bed",zone:zi});
        if(contains(x+2.1,z-.6,p))spots.push({x:x+2.1,z:z-.6,y:.46,yaw:0,kind:"desk",zone:zi});
        if(contains(x+1.4,z+1,p))spots.push({x:x+1.4,z:z+1,y:0,yaw:-Math.PI/2,kind:"counter",zone:zi});
      }else if(kind==="civic"){
        add(x,z,2,.7,1.05,"counter");if(contains(x+1,z+1.2,p))spots.push({x:x+1,z:z+1.2,y:.46,yaw:Math.PI,kind:"clerk",zone:zi});
      }else if(kind==="museum"){
        add(x,z,1.4,1.4,.85,"white");add(x,z,1.4,1.4,1.5,"glass");if(contains(x+.7,z-.7,p))spots.push({x:x+.7,z:z-.7,y:0,yaw:0,kind:"stand",zone:zi});
      }else if(kind==="station"){
        add(x,z,.7,.55,1.5,"metal");if(contains(x+.3,z-.7,p))spots.push({x:x+.3,z:z-.7,y:0,yaw:0,kind:"stand",zone:zi});
      }else if(kind==="food"){
        add(x,z,1.2,.75,.74,"wood");for(const dz of [-.5,1.2])if(contains(x+.6,z+dz,p))spots.push({x:x+.6,z:z+dz,y:.46,yaw:dz<0?0:Math.PI,kind:"table",zone:zi});
      }else{
        add(x,z,kind==="retail"?.7:1.5,kind==="retail"?2.4:.75,kind==="retail"?1.65:.74,kind==="retail"?"shelf":"desk");
        if (contains(x+.6,z- .7,p)) spots.push({ x:x+.6,z:z-.7,y:kind==="retail"?0:.46,yaw:0,kind:kind === "retail" ? "shelf" : "desk",zone:zi });
      }
    }
  }
  const facilities = (data.facilities ?? []).map(p => ({ ...p, p:P([p.x,p.y]) }));
  facilities.forEach(({ type, p:[x,z] }) => {
    if (!inside(x,z)) return;
    const region=regions.find(r=>contains(x,z,r.p)&&/^3/.test(r.type));
    if (type === "0002"&&region?.type!=="32") lifts.push({ x,z,w:2.1,yaw:Math.PI,index:lifts.length,nx:0,nz:-1 });
    if ((type === "0004" || type === "0003")&&region?.type!=="34"&&region?.type!=="33") stairs.push({ x:x-1.4,z:z-2,w:2.8,d:4,entry:[x,z] });
    const text = ({ "0001":"출입구", "0002":"엘리베이터", "0003":"에스컬레이터", "0004":"계단", "0005":"화장실", "0007":"비상구" } as Record<string,string>)[type];
    if (text) decor.push({ kind:"sign",x,z,y:2.5,yaw:Math.PI,w:2.2,h:.45,text });
  });
  const companySpots = (data.companies ?? []).map(c => ({ ...c, p:P([c.x,c.y]) }));
  companySpots.forEach(({ name, p:[x,z] }) => { if (inside(x,z)) decor.push({ kind:"sign",x,z,y:2.8,yaw:Math.PI,w:Math.min(5,name.length*.35+.8),h:.5,text:name }); });
  const cell = Math.max(.5, Math.sqrt(W*D/180000)), nx = Math.ceil(W/cell), nz = Math.ceil(D/cell), free = new Uint8Array(nx*nz);
  for (let j=0;j<nz;j++) for (let i=0;i<nx;i++) {
    const x=(i+.5)*cell,z=(j+.5)*cell;
    if (inside(x,z) && !obstacles.some(p=>contains(x,z,p))) free[j*nx+i]=1;
  }
  const mark = (x0:number,z0:number,x1:number,z1:number) => { for(let j=Math.max(0,Math.floor(z0/cell));j<Math.min(nz,Math.ceil(z1/cell));j++) for(let i=Math.max(0,Math.floor(x0/cell));i<Math.min(nx,Math.ceil(x1/cell));i++) free[j*nx+i]=0; };
  boxes.forEach(q=>mark(q.x0-.3,q.z0-.3,q.x1+.3,q.z1+.3));
  segs.forEach(s=>{ const n=Math.ceil(Math.hypot(s.bx-s.ax,s.bz-s.az)/.2); for(let i=0;i<=n;i++){const x=s.ax+(s.bx-s.ax)*i/n,z=s.az+(s.bz-s.az)*i/n;mark(x-.36,z-.36,x+.36,z+.36);} });
  const entrances = facilities.filter(p=>p.type==="0001"||p.type==="0007");
  const closest = (pts:Point[], target:Point) => pts.reduce((a,p)=>Math.hypot(p[0]-target[0],p[1]-target[1])<Math.hypot(a[0]-target[0],a[1]-target[1])?p:a);
  const candidate = entrances.length ? closest(entrances.map(p=>p.p), entry) : entry;
  const open:Point[]=[];
  for(let j=0;j<nz;j++) for(let i=0;i<nx;i++) if(free[j*nx+i]) open.push([(i+.5)*cell,(j+.5)*cell]);
  if (!open.length) return null;
  const spawn = closest(open,candidate);
  // A guaranteed nearby attendant is used for the directory; no personal data or real transactions.
  const attendant = closest(open,[spawn[0]+2,spawn[1]+2]);
  spots.unshift({ x:attendant[0],z:attendant[1],y:0,yaw:Math.PI,kind:"clerk",zone:-1 });
  const kinds:ZoneKind[]=[...new Set(zones.map(z=>z.kind))]; if(!kinds.length) kinds.push(kindOf(b.info.use??"","",data.level,b.info));
  if(!zones.length&&!regions.length){
    // A measured boundary is not a measured interior. Keep the real envelope and reconstruct the
    // furnishings from the register, with the distinction retained in the HUD and minimap.
    const main=[...polygons].sort((a,c)=>area(c[0])-area(a[0]))[0];
    const inferred=planFloor({...b,poly:main[0],doorX:Math.max(2,Math.min(W-2,entry[0]))},data.level,seed);
    const safe=(x:number,z:number)=>inside(x,z)&&!obstacles.some(p=>contains(x,z,p));
    inferred.boxes=inferred.boxes.filter(q=>[[q.x0,q.z0],[q.x0,q.z1],[q.x1,q.z0],[q.x1,q.z1]].every(([x,z])=>safe(x,z)));
    inferred.spots=inferred.spots.filter(s=>safe(s.x,s.z));
    for(let j=0;j<inferred.grid.nz;j++)for(let i=0;i<inferred.grid.nx;i++)if(!safe((i+.5)*inferred.grid.cell,(j+.5)*inferred.grid.cell))inferred.grid.free[j*inferred.grid.nx+i]=0;
    inferred.polygons=polygons;inferred.survey={year:data.year,partitions:false,facilities:!!data.facilitiesAvailable};
    inferred.spawn=spawn;inferred.door=data.level===1?{x:spawn[0],z:spawn[1],w:2}:null;
    // Actual supplied facilities take precedence over reconstructed circulation.
    if(lifts.length)inferred.lifts=lifts;if(stairs.length)inferred.stairs=stairs;
    inferred.decor.push(...decor);
    return inferred;
  }
  return { level:data.level,label:reg?.label??`${data.level}층`,height,kinds,zones,boxes,spots,lifts,stairs,escalators:[],decor,segs,
    grid:{nx,nz,cell,free},door:data.level===1?{x:spawn[0],z:spawn[1],w:2}:null,crowd:Math.min(140,Math.max(8,Math.round(polygons.reduce((s,p)=>s+area(p[0]),0)/25))),
    polygons,spawn,survey:{year:data.year,partitions:!!data.partitionsAvailable,facilities:!!data.facilitiesAvailable} };
}
