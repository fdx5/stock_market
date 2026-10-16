import type {RealEstateRoad} from '../api/client';
import {sameRoadLevel,roadLevel,nearestRoadPoint} from './roadLevels';

/** Split only where a surveyed road endpoint actually touches another road.
 * Arbitrary centreline crossings (bridges/underpasses) are not connections. */
export function splitRoadJunctions(roads:readonly RealEstateRoad[],planarCrossings=false):RealEstateRoad[]{
 const endpoints=roads.flatMap((r,road)=>[r.line[0],r.line[r.line.length-1]].map(p=>({road,p})));
 // Each road's bounds: pairs apart (no crossing, no endpoint within 1.5 m) are skipped, the rest
 // tested as before, in the same order (the same cuts).
 const box=roads.map(r=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y]of r.line){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}return [x0,y0,x1,y1];});
 const apart=(a:number[],b:number[],m:number)=>a[0]>b[2]+m||b[0]>a[2]+m||a[1]>b[3]+m||b[1]>a[3]+m;
 // (every segment of every road by 20 m cell: a segment is tried only against those sharing a cell
 // with it — in the same order as before, other road then its segments, so the same cuts)
 const segCells=new Map<number,number[]>(),C=20,ck=(x:number,y:number)=>(x+65536)*131072+(y+65536);
 if(planarCrossings)roads.forEach((o,oi)=>{for(let j=1;j<o.line.length;j++){const c=o.line[j-1],d=o.line[j];
  for(let x=Math.floor(Math.min(c[0],d[0])/C);x<=Math.floor(Math.max(c[0],d[0])/C);x++)for(let y=Math.floor(Math.min(c[1],d[1])/C);y<=Math.floor(Math.max(c[1],d[1])/C);y++){const k=ck(x,y),l=segCells.get(k);if(l)l.push(oi*1e6+j);else segCells.set(k,[oi*1e6+j]);}}});
 return roads.flatMap((r,road)=>{
  const cum=[0];for(let i=1;i<r.line.length;i++)cum.push(cum[i-1]+Math.hypot(r.line[i][0]-r.line[i-1][0],r.line[i][1]-r.line[i-1][1]));
  const cuts:{s:number;p:[number,number]}[]=[];
  const cut=(s:number,p:[number,number],minimum=6)=>{if(s>minimum&&s<cum[cum.length-1]-minimum&&!cuts.some(c=>Math.abs(c.s-s)<minimum))cuts.push({s,p});};
  // Only known co-level strips can form planar junctions. Bridges/underpasses never
  // acquire a signal box just because their XY projections intersect.
  if(planarCrossings&&roadLevel(r)===0){
   const pairs=new Set<number>();
   for(let i=1;i<r.line.length;i++){const a=r.line[i-1],b=r.line[i];
    for(let x=Math.floor(Math.min(a[0],b[0])/C);x<=Math.floor(Math.max(a[0],b[0])/C);x++)for(let y=Math.floor(Math.min(a[1],b[1])/C);y<=Math.floor(Math.max(a[1],b[1])/C);y++)for(const q of segCells.get(ck(x,y))??[]){const oi=Math.floor(q/1e6);if(oi!==road)pairs.add(oi*2**40+(q%1e6)*2**20+i);}}
   // (each candidate pair once, ordered: the other road, then this road's segment, then its)
   const order=[...pairs].map(v=>[Math.floor(v/2**40),Math.floor(v/2**20)%2**20,v%2**20]).sort((p,q)=>p[0]-q[0]||p[2]-q[2]||p[1]-q[1]);
   for(const [oi,j,i] of order){const o=roads[oi];
    if(apart(box[road],box[oi],0)||!sameRoadLevel(r,o)||r.structure==='unknown'||o.structure==='unknown')continue;
    const a=r.line[i-1],b=r.line[i],c=o.line[j-1],d=o.line[j],dx=b[0]-a[0],dy=b[1]-a[1],ux=d[0]-c[0],uy=d[1]-c[1],den=dx*uy-dy*ux,l=Math.hypot(dx,dy),ol=Math.hypot(ux,uy);
    if(!l||!ol||Math.abs(den)/(l*ol)<.2)continue;
    const t=((c[0]-a[0])*uy-(c[1]-a[1])*ux)/den,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;
    if(t>=0&&t<=1&&u>=0&&u<=1)cut(cum[i-1]+t*l,[a[0]+dx*t,a[1]+dy*t]);
   }
  }
  for(const e of endpoints){
   if(e.road===road||roadLevel(r)!==0||apart(box[road],[e.p[0],e.p[1],e.p[0],e.p[1]],1.5))continue;
   const other=roads[e.road],bank=!sameRoadLevel(r,other)&&other.structure==='bridge'&&other.profile_line&&other.profile_z?nearestRoadPoint(other.profile_line,...e.p):null;
   if(!sameRoadLevel(r,other)&&(!bank||bank.along>6&&bank.along<bank.total-6))continue;
   let best=Infinity,at=0,q:[number,number]=[0,0];
   for(let i=1;i<r.line.length;i++){
    const a=r.line[i-1],b=r.line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=cum[i]-cum[i-1];if(!len)continue;
    if(bank&&Math.abs(dx*bank.dir[0]+dy*bank.dir[1])/len<.9)continue;
    const t=Math.max(0,Math.min(1,((e.p[0]-a[0])*dx+(e.p[1]-a[1])*dy)/(len*len))),x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(x-e.p[0],y-e.p[1]);
    if(d<best){best=d;at=cum[i-1]+t*len;q=[x,y];}
   }
   if(best<=1.5)cut(at,q,bank?.05:6);
  }
  if(!cuts.length)return [r];cuts.sort((a,b)=>a.s-b.s);
  const stops=[{s:0,p:r.line[0]},...cuts,{s:cum[cum.length-1],p:r.line[r.line.length-1]}];
  return stops.slice(1).map((end,i)=>({...r,line:[stops[i].p,...r.line.filter((_,j)=>cum[j]>stops[i].s+.001&&cum[j]<end.s-.001),end.p]}));
 });
}
