import type {RealEstateRoad} from '../api/client';
import type {Terrain} from './sceneTerrain';
import {surfaceGeometry} from './surfaceGeometry';
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
   next.push({...ra,...(!ra.lift_z&&rb.lift_z?{lift_line:rb.lift_line,lift_s:rb.lift_s,lift_z:rb.lift_z}:{}),line,width:Math.max(ra.width,rb.width),structure:ra.structure===rb.structure?ra.structure:'unknown',
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
// A long line's segments hashed in 20 m cells (once per line, for the page): its nearest point
// asked for every vertex of its asphalt, paint, kerbs, lamps and lanes walked the whole line each
// time — 3 s of a view's loading on the main thread.
type LineIndex={cell:number;cells:Map<number,number[]>;cum:Float64Array;total:number;seen:Uint32Array;query:number};
const lineIndex=new WeakMap<readonly Point[],LineIndex>();
const cellKey=(i:number,j:number)=>(i+32768)*65536+(j+32768);
function indexOf(line:readonly Point[]):LineIndex{
 let ix=lineIndex.get(line);if(ix)return ix;
 const cell=20,cells=new Map<number,number[]>(),cum=new Float64Array(line.length);
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];cum[i]=cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(let x=Math.floor(Math.min(a[0],b[0])/cell);x<=Math.floor(Math.max(a[0],b[0])/cell);x++)for(let y=Math.floor(Math.min(a[1],b[1])/cell);y<=Math.floor(Math.max(a[1],b[1])/cell);y++){
   const k=cellKey(x,y),l=cells.get(k);if(l)l.push(i);else cells.set(k,[i]);}
 }
 ix={cell,cells,cum,total:cum[line.length-1],seen:new Uint32Array(line.length),query:0};lineIndex.set(line,ix);return ix;
}
export function nearestRoadPoint(line:readonly Point[],x:number,y:number){
 let best=Infinity,bi=-1,bt=0;
 const seg=(i:number)=>{const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)return;
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l2)),d=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);if(d<best){best=d;bi=i;bt=t;}};
 let total=0,cum:Float64Array|null=null,done=false;
 if(line.length>8){
  // (the cells round the point, two rings out at most — 100 m: once the best found is no farther
  // than the ring scanned, nothing outside it is nearer; a point farther off walks the line)
  const ix=indexOf(line),ci=Math.floor(x/ix.cell),cj=Math.floor(y/ix.cell),q=++ix.query;cum=ix.cum;total=ix.total;
  for(let k=0;k<=2&&!done;k++){
   for(let i=ci-k;i<=ci+k;i++)for(let j=cj-k;j<=cj+k;j++){if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==k)continue;
    const l=ix.cells.get(cellKey(i,j));if(l)for(const s of l)if(ix.seen[s]!==q){ix.seen[s]=q;seg(s);}}
   if(best<=k*ix.cell)done=true;
  }
  if(!done){best=Infinity;bi=-1;for(let i=1;i<line.length;i++)seg(i);}
 }else{for(let i=1;i<line.length;i++){seg(i);total+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);}}
 if(bi<0)return {distance:Infinity,along:0,total,dir:[1,0] as Point,point:[x,y] as Point};
 const a=line[bi-1],b=line[bi],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
 let s0=0;if(cum)s0=cum[bi-1];else for(let i=1;i<bi;i++)s0+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);
 return {distance:best,along:s0+bt*len,total,dir:[dx/len,dy/len] as Point,point:[a[0]+dx*bt,a[1]+dy*bt] as Point};
}
/** Bridge heights are DEM-derived bank interpolation, not surveyed deck elevation.
 * No invented clearance, ramp, parapet or pier dimensions are substituted for source data. */
export function roadHeight(r:RealEstateRoad,t:Terrain,x:number,y:number){
 if(t.roadAt)return t.roadAt(r,x,y);
 if(r.structure==='bridge'||r.structure==='elevated'){
  if(r.profile_line&&r.profile_s&&r.profile_z)return surfaceGeometry.profileAt(r.profile_line,r.profile_s,r.profile_z,x,y);
  return surfaceGeometry.profileHeight(r.profile_line??r.line,x,y,t.at,t.waterAt,t.grid?(x,y)=>Math.abs(x)<t.grid!.R&&Math.abs(y)<t.grid!.R:undefined,t.waterRevision?.()??undefined);
 }
 // A road at grade is laid smooth: level across (its centre line's height at the nearest point)
 // and along it the ground's ±16 m mean — the ground under it is cut to it (roadDrape.cutGroundToRoads),
 // never the road lifted onto every post of the relief. The streamed tiles' rule (droneRoads).
 // (asked again and again at the same points — a vertex each of its asphalt, paint, kerbs, lamps
 // and lanes: kept per terrain and water state, by the 5 cm point)
 const memoBy:object=t.waterRevision?.()??t;let byRoad=heightMemo.get(memoBy);if(!byRoad)heightMemo.set(memoBy,byRoad=new WeakMap());
 let memo=byRoad.get(r);if(!memo)byRoad.set(r,memo=new Map());
 const mk=(Math.round(x*20)+1e6)*4e6+(Math.round(y*20)+1e6),hit=memo.get(mk);if(hit!==undefined)return hit;
 const h=groundRoadHeight(r,t,x,y);if(memo.size<200000)memo.set(mk,h);return h;
}
const heightMemo=new WeakMap<object,WeakMap<RealEstateRoad,Map<number,number>>>();
function groundRoadHeight(r:RealEstateRoad,t:Terrain,x:number,y:number){
 let g=t.at(x,y);
 // (the water's surface in it too: where the road runs on into the water's area, it rises over it
 // along that same ±16 m — never a step up at the water's edge)
 const dry=(px:number,py:number)=>{const h=t.at(px,py),wv=t.waterAt?.(px,py);return wv!=null&&wv+.3>h?wv+.3:h;};
 if(r.line.length>1){const p=nearestRoadPoint(r.line,x,y);if(p.distance<=r.width/2+3){const [cx,cy]=p.point;let sum=0;for(let d=-16;d<=16;d+=4)sum+=dry(cx+p.dir[0]*d,cy+p.dir[1]*d);g=sum/9;}}
 // (where a bridge's deck runs on along it to the bank, no lower than that deck)
 if(r.lift_line&&r.lift_s&&r.lift_z){const p=nearestRoadPoint(r.lift_line,x,y);if(p.distance<=r.width/2+4&&p.along>0&&p.along<p.total)g=Math.max(g,surfaceGeometry.profileAt(r.lift_line,r.lift_s,r.lift_z,x,y));}
 // And never under the water's surface: where the data lays it across the water at the relief's
 // height (the surface's own there), it is kept over it.
 const w=t.waterAt?.(x,y);
 return w!=null&&w+.3>g?w+.3:g;
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
 // (the links by 20 m cell: only those within 18 m of a sample can own it — every sample against
 // every link was 0.7 s on the main thread, a frame held that long)
 const cells=new Map<number,Set<RoadStructureLink>>();
 for(const l of links)for(let i=1;i<l.line.length;i++){const a=l.line[i-1],b=l.line[i];
  for(let x=Math.floor((Math.min(a[0],b[0])-18)/20);x<=Math.floor((Math.max(a[0],b[0])+18)/20);x++)for(let y=Math.floor((Math.min(a[1],b[1])-18)/20);y<=Math.floor((Math.max(a[1],b[1])+18)/20);y++){
   const k=cellKey(x,y);let set=cells.get(k);if(!set)cells.set(k,set=new Set());set.add(l);}}
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
    const candidates=[...(cells.get(cellKey(Math.floor(x/20),Math.floor(y/20)))??[])].map(l=>({l,...nearestRoadPoint(l.line,x,y)})).filter(c=>c.distance<=Math.min(18,r.width/2+6)&&Math.abs(c.dir[0]*(b[0]-a[0])/len+c.dir[1]*(b[1]-a[1])/len)>.9).sort((a,b)=>a.distance-b.distance);
    const best=candidates[0],ambiguous=best&&candidates.some(c=>c.l.structure!==best.l.structure&&c.distance-best.distance<2);
    const next=ambiguous?undefined:best?.l;
    // Opposite directional links of the same structure do not create duplicate fragments.
    if(run.length&&(next?.structure!==owner?.structure||((next?.structure==='bridge'||next?.structure==='elevated')&&next?.id!==owner?.id))){flush();run=[p];}
    if(!run.length)run=[p];owner=next;run.push(q);
   }
  }flush();
 }return out;
}
