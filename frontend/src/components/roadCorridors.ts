import type {RealEstateRoad} from '../api/client';
type Pt=[number,number];
function inside(p:Pt,r:Pt[]){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function pointSegment(p:Pt,a:Pt,b:Pt){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
function segments(a:Pt,b:Pt,c:Pt,d:Pt){const dx=b[0]-a[0],dy=b[1]-a[1],ux=d[0]-c[0],uy=d[1]-c[1],den=dx*uy-dy*ux;
 if(Math.abs(den)>1e-9){const t=((c[0]-a[0])*uy-(c[1]-a[1])*ux)/den,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return 0;}
 return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
}
/** Keep measured buildings and surveyed centrelines fixed. A registered width
 * is a ceiling, not permission to pave through a building. Narrow only when
 * physical clearance proves that width impossible; exclude impossible portions
 * instead of inventing a straight road or moving a measured building. */
export function constrainRoadCorridors(roads:readonly RealEstateRoad[],footprints:readonly Pt[][]):RealEstateRoad[]{
 const entries=footprints.filter(r=>r.length>=3).map(r=>({r,box:[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))]}));
 const out:RealEstateRoad[]=[];
 for(const road of roads){
  if(road.line.length<2)continue;
  // These blockers contain XY footprints only. A pier or a building beneath an
  // official elevated road is not evidence that its deck must be cut away.
  // Elevated collision exclusion needs measured vertical bounds as well.
  if((road.structure==='bridge'||road.structure==='elevated')&&road.structure_source){out.push(road);continue;}
  const pad=road.width/2+1,x0=Math.min(...road.line.map(p=>p[0]))-pad,y0=Math.min(...road.line.map(p=>p[1]))-pad,x1=Math.max(...road.line.map(p=>p[0]))+pad,y1=Math.max(...road.line.map(p=>p[1]))+pad;
  const near=entries.filter(e=>e.box[0]<=x1&&e.box[2]>=x0&&e.box[1]<=y1&&e.box[3]>=y0);let clearance=Infinity;
  for(const {r}of near)for(let i=1;i<road.line.length;i++){
   const a=road.line[i-1],b=road.line[i];if(inside(a,r)||inside(b,r)){clearance=0;break;}
   for(let j=0;j<r.length;j++)clearance=Math.min(clearance,segments(a,b,r[j],r[(j+1)%r.length]));
  }
  if(clearance>=road.width/2+.25){out.push(road);continue;}
  const minimum=Math.min(road.width,Math.max(1,road.lanes)*2.8);
  if(clearance>.25+minimum/2){out.push({...road,width:Math.min(road.width,2*(clearance-.25))});continue;}
  const width=Math.min(road.width,Math.max(1,road.lanes)*3.3),half=width/2+.75;
  const safe=(p:Pt)=>!near.some(({r})=>inside(p,r)||r.some((a,i)=>pointSegment(p,a,r[(i+1)%r.length])<half));
  let run:Pt[]=[];
  const flush=()=>{if(run.length>=2){const length=run.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-run[i][0],p[1]-run[i][1]),0);if(length>3)out.push({...road,width,line:run});}run=[];};
  for(let i=1;i<road.line.length;i++){
   const a=road.line[i-1],b=road.line[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len));
   for(let j=i===1?0:1;j<=n;j++){const p:Pt=[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n];if(safe(p))run.push(p);else flush();}
  }flush();
 }
 return out;
}
