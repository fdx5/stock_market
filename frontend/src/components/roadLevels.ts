import type {RealEstateRoad} from '../api/client';
import type {Terrain} from './sceneTerrain';
type Point=[number,number];
export function roadLevel(r:RealEstateRoad){return r.layer??(r.structure==='bridge'||r.structure==='elevated'?1:r.structure==='underpass'||r.structure==='tunnel'?-1:0);}
export function sameRoadLevel(a:RealEstateRoad,b:RealEstateRoad){return roadLevel(a)===roadLevel(b);}
export function roadProfileKey(r:RealEstateRoad){return r.link_id??r.id??JSON.stringify(r.profile_line??r.line);}
export function roadProfiles(roads:RealEstateRoad[]){const ids=new Map<string,number>();for(const r of roads){const k=roadProfileKey(r);if(!ids.has(k))ids.set(k,ids.size);}return ids;}
/** Clip every segment at the window edge, including segments with both vertices
 * outside. Separate excursions stay separate instead of acquiring a shortcut. */
export function clipRoadLine(line:Point[],radius:number):Point[][]{
 if(!Number.isFinite(radius)||radius<=0)return [];
 const out:Point[][]=[];let run:Point[]=[];const eps=1e-7;
 const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const flush=()=>{if(run.length>1)out.push(run);run=[];};
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];if(![...a,...b].every(Number.isFinite)){flush();continue;}
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1,visible=true;
  for(const [p,q]of [[-dx,a[0]+radius],[dx,radius-a[0]],[-dy,a[1]+radius],[dy,radius-a[1]]]){
   if(Math.abs(p)<eps){if(q < -eps){visible=false;break;}}
   else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
  }
  if(!visible||hi-lo<=eps){flush();continue;}
  const from:Point=[a[0]+dx*lo,a[1]+dy*lo],to:Point=[a[0]+dx*hi,a[1]+dy*hi];
  if(distance(from,to)<=eps)continue;
  if(run.length&&distance(run[run.length-1],from)>eps)flush();
  if(!run.length)run.push(from);if(distance(run[run.length-1],to)>eps)run.push(to);
  if(hi<1-eps)flush();
 }flush();return out;
}
/** Actual neighbouring cells are searched, then true distance is checked. Only
 * unbranched, compatible pieces join; an elevated profile never changes owner. */
export function stitchRoadSegments(input:RealEstateRoad[]):RealEstateRoad[]{
 let roads=input.filter(r=>r.line.length>1).map(r=>({...r,line:r.line.map(p=>[...p] as Point)}));
 const cell=1.5,distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 for(let pass=0;pass<50;pass++){
  const ends=roads.flatMap((r,i)=>[true,false].map(start=>({i,start,p:start?r.line[0]:r.line[r.line.length-1]})));
  const grid=new Map<string,number[]>(),parent=ends.map((_,i)=>i);
  const find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const key=(x:number,y:number)=>x+','+y;
  ends.forEach((e,i)=>{
   const x=Math.floor(e.p[0]/cell),y=Math.floor(e.p[1]/cell);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const j of grid.get(key(x+dx,y+dy))??[]){
    if(sameRoadLevel(roads[e.i],roads[ends[j].i])&&distance(e.p,ends[j].p)<=cell)parent[find(i)]=find(j);
   }
   const k=key(x,y);grid.set(k,[...(grid.get(k)??[]),i]);
  });
  const groups=new Map<number,typeof ends>();ends.forEach((e,i)=>{const k=find(i);groups.set(k,[...(groups.get(k)??[]),e]);});
  const used=new Set<number>(),next:RealEstateRoad[]=[];
  for(const group of groups.values()){
   if(group.length!==2)continue;const[a,b]=group;
   if(a.i===b.i||used.has(a.i)||used.has(b.i)||distance(a.p,b.p)>cell)continue;
   const ra=roads[a.i],rb=roads[b.i],level=roadLevel(ra);
   if(ra.lanes!==rb.lanes||Math.abs(ra.width-rb.width)>4)continue;
   if(level!==0&&(ra.structure!==rb.structure||roadProfileKey(ra)!==roadProfileKey(rb)))continue;
   const la=a.start?[...ra.line].reverse():ra.line,lb=b.start?rb.line:[...rb.line].reverse();
   // Keep both surveyed coordinates across a small gap; never drop the next bend.
   const line=[...la,...(distance(a.p,b.p)<1e-7?lb.slice(1):lb)];
   next.push({...ra,line,width:Math.max(ra.width,rb.width),structure:ra.structure===rb.structure?ra.structure:'unknown',
    id:ra.id||rb.id?`${ra.id??JSON.stringify(ra.line)}|${rb.id??JSON.stringify(rb.line)}`:undefined});
   used.add(a.i);used.add(b.i);
  }
  if(!used.size)break;roads=[...roads.filter((_,i)=>!used.has(i)),...next];
 }return roads;
}
/** Different levels may connect at a shared physical approach endpoint, never at an XY crossing. */
export function roadEndsConnect(a:RealEstateRoad,b:RealEstateRoad,x:number,y:number){
 if(sameRoadLevel(a,b))return true;
 const end=(r:RealEstateRoad)=>[r.line[0],r.line[r.line.length-1]].some(p=>Math.hypot(p[0]-x,p[1]-y)<=1.5);
 return end(a)&&end(b);
}
export function nearestRoadPoint(line:readonly Point[],x:number,y:number){
 let best=Infinity,along=0,s=0,total=0,dir:Point=[1,0],point:Point=[x,y];
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(len*len))),d=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
  if(d<best){best=d;along=s+t*len;dir=[dx/len,dy/len];point=[a[0]+dx*t,a[1]+dy*t];}s+=len;
 }total=s;return {distance:best,along,total,dir,point};
}
/** Bridge heights are DEM-derived bank interpolation, not surveyed deck elevation.
 * No invented clearance, ramp, parapet or pier dimensions are substituted for source data. */
export function roadHeight(r:RealEstateRoad,t:Terrain,x:number,y:number){
 if(t.roadAt)return t.roadAt(r,x,y);
 if(r.structure==='bridge'||r.structure==='elevated'){
  const line=r.profile_line??r.line,a=line[0],b=line[line.length-1],p=nearestRoadPoint(line,x,y);
  return t.at(a[0],a[1])+(t.at(b[0],b[1])-t.at(a[0],a[1]))*p.along/(p.total||1);
 }
 return t.at(x,y);
}
/** A manually driven vehicle keeps its height/heading context at grade crossings. */
export function vehicleRoad(roads:RealEstateRoad[],terrain:Terrain,c:{x:number;y:number;z?:number;hx:number;hy:number;road:number}){
 let best=c.road,score=Infinity;
 for(const [i,r] of roads.entries()){
  const p=nearestRoadPoint(r.line,c.x,c.y);if(p.distance>r.width/2+6||Math.abs(p.dir[0]*c.hx+p.dir[1]*c.hy)<.5)continue;
  const h=roadHeight(r,terrain,c.x,c.y),height=c.z===undefined?0:Math.max(0,Math.abs(h-c.z)-1)*3;
  const level=roads[c.road]&&!roadEndsConnect(roads[c.road],r,c.x,c.y)?6:0;
  const next=p.distance+height+level;if(next<score){score=next;best=i;}
 }return best;
}
export interface RoadStructureLink {id:string;line:Point[];structure:NonNullable<RealEstateRoad['structure']>}
/** Clip long provider river polygons to the rendered window, retaining exact edge intersections. */
export function clipRoadContextRing(ring:Point[],radius:number):Point[]{
 let pts=ring;
 for(const axis of [0,1])for(const side of [-1,1]){
  const bound=side*radius,out:Point[]=[];
  for(let i=0;i<pts.length;i++){
   const a=pts[(i+pts.length-1)%pts.length],b=pts[i],inside=(p:Point)=>side*p[axis]<=radius;
   if(inside(a)!==inside(b)){const t=(bound-a[axis])/(b[axis]-a[axis]);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
   if(inside(b))out.push(b);
  }pts=out;
 }return pts;
}
/** Match direction as well as distance, and split at structure changes. Ambiguous parallel
 * mappings stay unknown instead of borrowing the nearby bridge's level. Geometry is never moved. */
export function attachRoadStructures(roads:RealEstateRoad[],links:RoadStructureLink[]):RealEstateRoad[]{
 const out:RealEstateRoad[]=[];
 for(const r of roads){
  let run:Point[]=[],owner:RoadStructureLink|undefined;
  const flush=()=>{if(run.length>1)out.push({...r,line:run,structure:owner?.structure??'unknown',layer:owner?roadLevel({line:[],width:0,lanes:0,structure:owner.structure}):undefined,
   link_id:owner?.id,profile_line:owner?.structure==='bridge'||owner?.structure==='elevated'?owner.line:undefined,structure_source:owner?'VWorld LT_L_MOCTLINK':undefined});};
  for(let i=1;i<r.line.length;i++){
   const a=r.line[i-1],b=r.line[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
   const count=Math.max(1,Math.ceil(len/8));
   for(let k=0;k<count;k++){
    const p:Point=[a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count],q:Point=[a[0]+(b[0]-a[0])*(k+1)/count,a[1]+(b[1]-a[1])*(k+1)/count];
    const x=(p[0]+q[0])/2,y=(p[1]+q[1])/2;
    const candidates=links.map(l=>({l,...nearestRoadPoint(l.line,x,y)})).filter(c=>c.distance<=Math.min(18,r.width/2+6)&&Math.abs(c.dir[0]*(b[0]-a[0])/len+c.dir[1]*(b[1]-a[1])/len)>.9).sort((a,b)=>a.distance-b.distance);
    const best=candidates[0],ambiguous=best&&candidates.some(c=>c.l.structure!==best.l.structure&&c.distance-best.distance<2);
    const next=ambiguous?undefined:best?.l;
    // Opposite directional links of the same structure do not create duplicate fragments.
    if(run.length&&(next?.structure!==owner?.structure||((next?.structure==='bridge'||next?.structure==='elevated')&&next?.id!==owner?.id))){flush();run=[p];}
    if(!run.length)run=[p];owner=next;run.push(q);
   }
  }flush();
 }return out;
}
