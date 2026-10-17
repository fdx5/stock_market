/** Geographic, geometry and motion logic shared with the worker and deterministic tests. */
export type RailMode = 'emu' | 'light' | 'monorail' | 'agt';
export interface RailLine { id:string; name:string; colour:string; mode:RailMode; cars:number; carLength:number; width:number; gauge:number; vehicle?:'val208' }
export interface RailFacility {id:string;kind:'station'|'platform';points:number[][];name:string;stationName:string;d:number;height:number|null;level:number;shelter:boolean;source:string}
/** A tunnel the track runs on into past a corridor's end (end 0: its first point, 1: its last):
 * its first few tens of metres, [lon, lat] from that end's point outwards. */
export interface RailPortal { end:0|1; points:number[][] }
export interface RailCorridor { id:string; line:string; route:number; points:number[][]; stops:{id:string;name:string;d:number;point:number[]}[]; length:number; ways:number[]; nodes?:number[]; overhead?:boolean; facilities?:RailFacility[]; portals?:RailPortal[] }
export interface RailManifest { version:number; cell:number; snapshot:string; attribution:string; sourceUrl:string; lines:RailLine[]; chunks:Record<string,string[]>; stats:Record<string,number> }
export interface RailPath { id:string; line:string; /** east, north, height, chainage, structure */ points:Float32Array; length:number; stops:RailCorridor['stops']; elevationEstimated:true }
export const STRIDE=5;
/** how steeply a track goes down into a tunnel past its portal (a subway's ramps: 3-4 %) */
export const TUNNEL_GRADE=.04;
export const RAIL_ROOT='/rail/20261017-v9';
export const BUDGET={radius:1400,cache:48,parallel:2,trains:40,detailDistance:420,farDistance:1800};

/** The corridor with its tunnel mouths' track added (structure -1, past each portal), its stops
 * moved along by what is added before its first point. */
export function withPortals(c:RailCorridor):RailCorridor{
  if(!c.portals?.length)return c;
  const metres=(a:number[],b:number[])=>Math.hypot((b[0]-a[0])*111320*Math.cos(a[1]*Math.PI/180),(b[1]-a[1])*110540);
  let points=c.points,shift=0,length=c.length;
  for(const p of c.portals){
    const extra=p.points.slice(1).map(q=>[q[0],q[1],-1,0]);if(!extra.length)continue;
    let added=0;for(let i=1;i<p.points.length;i++)added+=metres(p.points[i-1],p.points[i]);
    length+=added;
    if(p.end===0){points=[...extra.reverse(),...points];shift+=added;}else points=[...points,...extra];
  }
  return {...c,points,length,stops:c.stops.map(s=>({...s,d:s.d+shift}))};
}

export function neededCorridors(m:RailManifest,lon:number,lat:number,radius:number):string[] {
  const dx=radius/(111320*Math.cos(lat*Math.PI/180)),dy=radius/110540,ids=new Set<string>();
  const cells:{x:number;y:number;distance:number}[]=[];
  for(let x=Math.floor((lon-dx)/m.cell);x<=Math.floor((lon+dx)/m.cell);x++)
    for(let y=Math.floor((lat-dy)/m.cell);y<=Math.floor((lat+dy)/m.cell);y++)
      cells.push({x,y,distance:((x+.5)*m.cell-lon)**2*Math.cos(lat*Math.PI/180)**2+((y+.5)*m.cell-lat)**2});
  cells.sort((a,b)=>a.distance-b.distance);
  for(const {x,y}of cells)for(const id of m.chunks[`${x}_${y}`]??[])ids.add(id);
  return [...ids];
}

/** Elevations are visual estimates, never layer*height presented as surveyed data.
 * A whole mapped viaduct is interpolated between bank ground, rather than dipping
 * to river DEM samples. Eased 250 m approaches share the exact rendered path. */
export function preparePath(c:RailCorridor,origin:{lon:number;lat:number},ground:number[],denseGround?:Float32Array):RailPath {
  const kx=111320*Math.cos(origin.lat*Math.PI/180),raw=c.points.map((p,i)=>[ (p[0]-origin.lon)*kx,(p[1]-origin.lat)*110540,Number.isFinite(ground[i])?ground[i]:0,0,p[2] ]);
  for(let i=1;i<raw.length;i++)raw[i][3]=raw[i-1][3]+Math.hypot(raw[i][0]-raw[i-1][0],raw[i][1]-raw[i-1][1]);
  const rises:number[][]=[];
  for(let i=0;i<raw.length;i++)if(raw[i][4]>0){
    const a=i,level=Math.max(1,c.points[i][3]??1);while(i+1<raw.length&&raw[i+1][4]>0&&Math.max(1,c.points[i+1][3]??1)===level)i++;const b=i;
    // Keep mapped vertical ordering at stacked stations and crossings. These
    // metre offsets remain schematic; OSM layer numbers are not surveyed heights.
    const rise=8+6*(level-1),s0=raw[a][3],s1=raw[b][3],h0=raw[a][2]+rise,h1=raw[b][2]+rise;
    rises.push([s0,s1,h0,h1]);
  }
  const h=raw.map(p=>p[2]+.16);
  for(let i=0;i<raw.length;i++)for(const[a,b,ha,hb]of rises){
    const s=raw[i][3],d=s<a?a-s:s>b?s-b:0;
    if(d>250)continue;
    const t=b>a?Math.max(0,Math.min(1,(s-a)/(b-a))):0;
    const deck=ha+(hb-ha)*t+.16,w=1-Math.min(1,d/250),ease=w*w*(3-2*w);
    h[i]=Math.max(h[i],raw[i][2]+(deck-raw[i][2])*ease);
  }
  // Past a corridor's end into a tunnel (structure -1) the track goes down at TUNNEL_GRADE from
  // that end's height — off a viaduct, a ramp down first — and is never lifted onto the ground
  // over it (the hill, the street).
  const first=raw.findIndex(p=>p[4]>=0),lastSurface=raw.length-1-[...raw].reverse().findIndex(p=>p[4]>=0);
  if(first>=0)for(let i=0;i<raw.length;i++)if(raw[i][4]<0){const e=i<first?first:lastSurface;h[i]=h[e]-TUNNEL_GRADE*Math.abs(raw[i][3]-raw[e][3]);}
  const out:number[]=[];
  for(let i=1;i<raw.length;i++){
    const a=raw[i-1],b=raw[i],n=Math.max(1,Math.ceil((b[3]-a[3])/5)),bored=a[4]<0||b[4]<0;
    for(let k=0;k<n;k++){const t=k/n,dense=bored?NaN:denseGround?.[out.length/STRIDE],height=h[i-1]+(h[i]-h[i-1])*t;out.push(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,Number.isFinite(dense)?Math.max(height,dense!+.16):height,a[3]+(b[3]-a[3])*t,bored?-1:Math.max(a[4],b[4]));}
  }
  const last=raw[raw.length-1],dense=last[4]<0?NaN:denseGround?.[out.length/STRIDE];out.push(last[0],last[1],Number.isFinite(dense)?Math.max(h[h.length-1],dense!+.16):h[h.length-1],last[3],last[4]);
  // Down the tunnel from each end: -1 while the track is still over the ground (a ramp), -2 from
  // where it reaches the ground (the portal) on.
  const n=out.length/STRIDE;
  for(const [start,step] of [[0,1],[n-1,-1]] as const){
    if(out[start*STRIDE+4]>=0)continue;
    let k=start;while(k>=0&&k<n&&out[k*STRIDE+4]<0)k+=step;// (k: the end's surface vertex)
    let under=false;
    for(let j=k-step;j>=0&&j<n&&out[j*STRIDE+4]<0;j-=step){
      // (the ground: the dense samples, or between the source's points where there are none)
      const g=denseGround?.[j];under||=!Number.isFinite(g)||out[j*STRIDE+2]-.16<=g!+.05;
      out[j*STRIDE+4]=under?-2:-1;
    }
  }
  const ratio=c.length>0?last[3]/c.length:1;
  return {id:c.id,line:c.line,points:new Float32Array(out),length:last[3],stops:c.stops.map(s=>({...s,d:s.d*ratio})),elevationEstimated:true};
}

export function samplePath(p:RailPath,d:number,out={x:0,y:0,h:0,dx:1,dy:0,grade:0}):typeof out {
  const v=p.points,n=v.length/STRIDE;let lo=0,hi=n-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(v[mid*STRIDE+3]<=d)lo=mid;else hi=mid;}
  const a=lo*STRIDE,b=(lo+1)*STRIDE,len=v[b+3]-v[a+3]||1,t=(d-v[a+3])/len;
  out.x=v[a]+(v[b]-v[a])*t;out.y=v[a+1]+(v[b+1]-v[a+1])*t;out.h=v[a+2]+(v[b+2]-v[a+2])*t;
  out.dx=(v[b]-v[a])/len;out.dy=(v[b+1]-v[a+1])/len;out.grade=(v[b+2]-v[a+2])/len;return out;
}

/** A rigid coach is supported by its two bogies. Pitch is applied in the coach's
 * local frame after heading; XYZ Euler pitch gives the wrong grade when turned. */
export function coachPose(p:RailPath,d:number,length:number,reverse=false,lift=.055){
  const front=samplePath(p,d+length*.33),back=samplePath(p,d-length*.33);
  const sign=reverse?-1:1,dx=(front.x-back.x)*sign,dz=(back.y-front.y)*sign,dh=(front.h-back.h)*sign;
  return {x:(front.x+back.x)/2,h:(front.h+back.h)/2+lift,z:-(front.y+back.y)/2,
    heading:Math.atan2(dx,dz),pitch:-Math.atan2(dh,Math.hypot(dx,dz))};
}

/** One shared miter per vertex, so neighbouring ribbons have identical edges. */
export function pathMiters(p:RailPath):Float32Array {
  const v=p.points,n=v.length/STRIDE,out=new Float32Array(n*2);
  for(let i=0;i<n;i++){
    const a=Math.max(0,i-1)*STRIDE,b=i*STRIDE,c=Math.min(n-1,i+1)*STRIDE;
    let ax=v[b]-v[a],ay=v[b+1]-v[a+1],bx=v[c]-v[b],by=v[c+1]-v[b+1];
    if(i===0){ax=bx;ay=by;}if(i===n-1){bx=ax;by=ay;}
    const al=Math.hypot(ax,ay)||1,bl=Math.hypot(bx,by)||1;
    let nx=-ay/al-by/bl,ny=ax/al+bx/bl,ml=Math.hypot(nx,ny);
    if(ml<1e-5){nx=-by/bl;ny=bx/bl;ml=1;}
    nx/=ml;ny/=ml;const scale=Math.min(3,1/Math.max(.333,nx*(-by/bl)+ny*(bx/bl)));
    out[i*2]=nx*scale;out[i*2+1]=ny*scale;
  }return out;
}

export interface RunLeg { start:number; end:number; at:number; run:number; dwell:number; accel:number; cruise:number; peak:number }
export interface RailRun { legs:RunLeg[]; cycle:number; count:number; trainLength:number }
export function makeRun(p:RailPath,l:RailLine):RailRun {
  const trainLength=l.cars*(l.carLength+.6),positions=[-trainLength,...p.stops.map(s=>s.d).filter(s=>s>5&&s<p.length-5),p.length+trainLength].sort((a,b)=>a-b);
  const legs:RunLeg[]=[];let at=0;
  for(let i=1;i<positions.length;i++){
    const distance=positions[i]-positions[i-1];if(distance<1)continue;
    const acceleration=.75,peak=Math.min(l.mode==='emu'?18:13,Math.sqrt(distance*acceleration)),accel=peak/acceleration,cruise=Math.max(0,(distance-peak*peak/acceleration)/peak),run=accel*2+cruise,dwell=i<positions.length-1?16:0;
    legs.push({start:positions[i-1],end:positions[i],at,run,dwell,accel,cruise,peak});at+=run+dwell;
  }
  // One per station on each mapped direction; finite consists and dwell impose a
  // minimum headway. Never invent a parallel track or spawn overlapping trains.
  return {legs,cycle:at,count:p.length<trainLength*1.1?0:Math.max(1,Math.min(Math.max(1,p.stops.length),Math.floor(at/Math.max(65,trainLength/10+20)))),trainLength};
}
export function trainAt(run:RailRun,time:number,index:number):{d:number;speed:number;doors:number} {
  const t=((time+index*run.cycle/run.count)%run.cycle+run.cycle)%run.cycle;
  const leg=run.legs.find(l=>t<l.at+l.run+l.dwell)??run.legs[run.legs.length-1];
  const q=Math.max(0,t-leg.at),a=leg.peak/leg.accel;
  if(q>=leg.run)return {d:leg.end,speed:0,doors:Math.min(1,(q-leg.run)*2,(leg.run+leg.dwell-q)*2)};
  if(q<leg.accel)return {d:leg.start+.5*a*q*q,speed:a*q,doors:0};
  if(q<leg.accel+leg.cruise)return {d:leg.start+.5*leg.peak*leg.accel+leg.peak*(q-leg.accel),speed:leg.peak,doors:0};
  const left=leg.run-q;return {d:leg.end-.5*a*left*left,speed:a*left,doors:0};
}

export function hashPhase(id:string):number {let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)%10000;}
