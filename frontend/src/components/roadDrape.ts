import * as THREE from 'three';
import type {RoadTriangleIndex} from './roadBvh';

type Point = [number, number];
const cross = (a: Point,b: Point,p: Point) => (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function clip(polygon: Point[], triangle: Point[]) {
  const sign = Math.sign(cross(triangle[0],triangle[1],triangle[2]));
  for(let edge=0;edge<3&&polygon.length;edge++) {
    const a=triangle[edge],b=triangle[(edge+1)%3],out: Point[]=[];
    for(let i=0;i<polygon.length;i++) {
      const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign;
      if(dp>=-1e-8)out.push(p);
      if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    polygon=out;
  }
  return polygon;
}
function segment(axis: Float64Array,value: number,up: boolean) {
  let lo=0,hi=axis.length-1;
  while(hi-lo>1){const k=(lo+hi)>>1;if(up?axis[k]<=value:axis[k]>=value)lo=k;else hi=k;}
  return lo;
}
/** The same visible asphalt supports tyres; a DEM sample can lie centimetres
 * below the tessellated road and bury the tyre's lower sidewall. */
export function roadSurfaceHeight(geometry:THREE.BufferGeometry,index?:RoadTriangleIndex){
 // Four tyres repeatedly sample the same road cell. Cache the broad phase and
 // immutable vertex reads, retaining the exact asphalt barycentric calculation.
 // BVH traversal order is retained, including reference-height ties on bridges.
 type Triangle = {ax:number;ay:number;bx:number;by:number;cx:number;cy:number;az:number;bz:number;cz:number;den:number;minX:number;minY:number;maxX:number;maxY:number;level?:number;profile?:number};
 type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
 const version=(a:Attribute|undefined)=>a instanceof THREE.InterleavedBufferAttribute?a.data.version:a?.version;
 const cells=new Map<string,Triangle[]>(),bins=new Map<string,number[]>(),cell=6;
 let p:Attribute,levels:Attribute|undefined,profiles:Attribute|undefined,pv:number|undefined,lv:number|undefined,sv:number|undefined;
 const refresh=()=>{
  const next=geometry.getAttribute('position'),nl=geometry.getAttribute('roadLevel'),ns=geometry.getAttribute('roadProfile');
  const npv=version(next),nlv=version(nl),nsv=version(ns);
  if(next===p&&nl===levels&&ns===profiles&&npv===pv&&nlv===lv&&nsv===sv)return;
  p=next;levels=nl;profiles=ns;pv=npv;lv=nlv;sv=nsv;cells.clear();bins.clear();
  if(!index)for(let k=0;k<p.count;k+=3){
   const ax=p.getX(k),bx=p.getX(k+1),cx=p.getX(k+2),ay=-p.getZ(k),by=-p.getZ(k+1),cy=-p.getZ(k+2);
   for(let i=Math.floor(Math.min(ax,bx,cx)/cell);i<=Math.floor(Math.max(ax,bx,cx)/cell);i++)for(let j=Math.floor(Math.min(ay,by,cy)/cell);j<=Math.floor(Math.max(ay,by,cy)/cell);j++){
    const key=i+':'+j,l=bins.get(key);if(l)l.push(k);else bins.set(key,[k]);
   }
  }
 };
 return (x:number,y:number,reference?:number,level?:number,profile?:string)=>{
  refresh();let h=-Infinity,best=Infinity;
  const profileIds=geometry.userData.roadProfiles as Map<string,number>|undefined,profileId=profile?profileIds?.get(profile):undefined;
  const i=Math.floor(x/cell),j=Math.floor(y/cell),key=i+':'+j;let triangles=cells.get(key);
  if(!triangles){
   triangles=[];
   for(const k of index?.query(i*cell,j*cell,(i+1)*cell,(j+1)*cell)??bins.get(key)??[]){
    const ax=p.getX(k),ay=-p.getZ(k),bx=p.getX(k+1),by=-p.getZ(k+1),cx=p.getX(k+2),cy=-p.getZ(k+2),den=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const minX=Math.min(ax,bx,cx),maxX=Math.max(ax,bx,cx),minY=Math.min(ay,by,cy),maxY=Math.max(ay,by,cy);
    const marginX=(maxX-minX)*2e-6+1e-5,marginY=(maxY-minY)*2e-6+1e-5;
    if(Math.abs(den)>=1e-9)triangles.push({ax,ay,bx,by,cx,cy,az:p.getY(k),bz:p.getY(k+1),cz:p.getY(k+2),den,minX:minX-marginX,maxX:maxX+marginX,minY:minY-marginY,maxY:maxY+marginY,level:levels?.getX(k),profile:profiles?.getX(k)});
   }
   // Bound this computed cache during a long flight; no scene or stored data is affected.
   if(cells.size>=1024)cells.delete(cells.keys().next().value!);
   cells.set(key,triangles);
  }
  for(const t of triangles){
   if(x<t.minX||x>t.maxX||y<t.minY||y>t.maxY)continue;
   if(level!==undefined&&t.level!==undefined&&Math.abs(t.level-level)>.1)continue;
   if(profileId!==undefined&&t.profile!==undefined&&Math.abs(t.profile-profileId)>.1)continue;
   const u=((x-t.ax)*(t.cy-t.ay)-(y-t.ay)*(t.cx-t.ax))/t.den,v=((t.bx-t.ax)*(y-t.ay)-(t.by-t.ay)*(x-t.ax))/t.den;
   if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001){const z=t.az*(1-u-v)+t.bz*u+t.cz*v;if(reference===undefined)h=Math.max(h,z);else if(Math.abs(z-reference)<best){best=Math.abs(z-reference);h=z;}}
  }
  return Number.isFinite(h)?h:undefined;
 };
}

/** Paint must clear the rendered asphalt plane, including interiors between
 * samples. A per-triangle vertical correction adds no triangles or draw calls. */
export async function raiseRoadPaint(paint:THREE.BufferGeometry,asphalt:THREE.BufferGeometry,pace:()=>Promise<boolean>,lift=.015,index?:RoadTriangleIndex){
 const p=paint.getAttribute('position'),a=asphalt.getAttribute('position'),paintLevels=paint.getAttribute('roadLevel'),asphaltLevels=asphalt.getAttribute('roadLevel'),paintProfiles=paint.getAttribute('roadProfile'),asphaltProfiles=asphalt.getAttribute('roadProfile'),bins=new Map<string,number[]>(),size=6;
 if(!index)for(let k=0;k<a.count;k+=3){
  if(k%1500===0&&!await pace())return;
  const x=[0,1,2].map(i=>a.getX(k+i)),y=[0,1,2].map(i=>-a.getZ(k+i));
  for(let i=Math.floor(Math.min(...x)/size);i<=Math.floor(Math.max(...x)/size);i++)for(let j=Math.floor(Math.min(...y)/size);j<=Math.floor(Math.max(...y)/size);j++){
   const key=i+':'+j,l=bins.get(key);if(l)l.push(k);else bins.set(key,[k]);
  }
 }
 for(let k=0;k<p.count;k+=3){
  if(k%900===0&&!await pace())return;
  const triangle:Point[]=[0,1,2].map(i=>[p.getX(k+i),-p.getZ(k+i)]),heights=[0,1,2].map(i=>p.getY(k+i)),area=cross(triangle[0],triangle[1],triangle[2]);if(Math.abs(area)<1e-9)continue;
  const candidates=new Set<number>();
  const x0=Math.min(...triangle.map(q=>q[0])),y0=Math.min(...triangle.map(q=>q[1])),x1=Math.max(...triangle.map(q=>q[0])),y1=Math.max(...triangle.map(q=>q[1]));
  if(index)for(const id of index.query(x0,y0,x1,y1))candidates.add(id);
  else for(let i=Math.floor(x0/size);i<=Math.floor(x1/size);i++)for(let j=Math.floor(y0/size);j<=Math.floor(y1/size);j++)for(const id of bins.get(i+':'+j)??[])candidates.add(id);
  let raise=0;
  for(const id of candidates){
   if(paintLevels&&asphaltLevels&&Math.abs(paintLevels.getX(k)-asphaltLevels.getX(id))>.1)continue;
   if(paintLevels?.getX(k)&&paintProfiles&&asphaltProfiles&&Math.abs(paintProfiles.getX(k)-asphaltProfiles.getX(id))>.1)continue;
   const surface:Point[]=[0,1,2].map(i=>[a.getX(id+i),-a.getZ(id+i)]),den=cross(surface[0],surface[1],surface[2]);if(Math.abs(den)<1e-9)continue;
   for(const q of clip(triangle,surface)){
    const u=cross(surface[0],q,surface[2])/den,v=cross(surface[0],surface[1],q)/den,pu=cross(triangle[0],q,triangle[2])/area,pv=cross(triangle[0],triangle[1],q)/area;
    const ground=a.getY(id)*(1-u-v)+a.getY(id+1)*u+a.getY(id+2)*v,original=heights[0]*(1-pu-pv)+heights[1]*pu+heights[2]*pv;
    raise=Math.max(raise,ground+lift-original);
   }
  }
  if(raise>0)for(let i=0;i<3;i++)p.setY(k+i,heights[i]+raise);
 }
 p.needsUpdate=true;paint.computeVertexNormals();paint.computeBoundingSphere();
}

/** Partition asphalt at the rendered ground's triangle edges, not merely DEM posts.
 * On each piece both surfaces are planes. Interpolating their maximum keeps the
 * entire road piece above ground, including its interior, with shared edge heights.
 * Ground coordinates are footprint x/y/z; road coordinates are x/up/-y.
 */
export async function drapeRoadSurface(road: THREE.BufferGeometry,ground: THREE.BufferGeometry,pace:()=>Promise<boolean>,lift=.015) {
  const grid=ground.userData.grid as {xs:Float64Array;ys:Float64Array}|undefined;
  if(!grid)return;
  const {xs,ys}=grid,row=xs.length,P=ground.getAttribute('position'),source=road.getAttribute('position');
  const positions:number[]=[],uv:number[]=[],levels:number[]=[],sourceLevels=road.getAttribute('roadLevel'),profiles:number[]=[],sourceProfiles=road.getAttribute('roadProfile');
  for(let k=0;k<source.count;k+=3){
    if(k%300===0&&!await pace())return;
    const triangle:Point[]=[0,1,2].map(i=>[source.getX(k+i),-source.getZ(k+i)]);
    const heights=[0,1,2].map(i=>source.getY(k+i)),area=cross(triangle[0],triangle[1],triangle[2]);
    if(Math.abs(area)<1e-9)continue;
    const roadAt=(p:Point)=>{
      const u=cross(triangle[0],p,triangle[2])/area,v=cross(triangle[0],triangle[1],p)/area;
      return heights[0]*(1-u-v)+heights[1]*u+heights[2]*v;
    };
    const start=positions.length,startUv=uv.length;
    let needsDrape=false;
    const i0=segment(xs,Math.min(...triangle.map(p=>p[0])),true),i1=segment(xs,Math.max(...triangle.map(p=>p[0])),true);
    const j0=segment(ys,Math.max(...triangle.map(p=>p[1])),false),j1=segment(ys,Math.min(...triangle.map(p=>p[1])),false);
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const ids=[j*row+i,(j+1)*row+i,(j+1)*row+i+1,j*row+i+1];
      for(const indices of [[ids[0],ids[1],ids[3]],[ids[1],ids[2],ids[3]]]){
        const surface:Point[]=indices.map(id=>[P.getX(id),P.getY(id)]),polygon=clip(triangle,surface);
        if(polygon.length<3)continue;
        const a=cross(surface[0],surface[1],surface[2]);
        const height=(p:Point)=>{
          const u=cross(surface[0],p,surface[2])/a,v=cross(surface[0],surface[1],p)/a;
          const original=roadAt(p),raised=P.getZ(indices[0])*(1-u-v)+P.getZ(indices[1])*u+P.getZ(indices[2])*v+lift;
          if(original<raised-1e-5)needsDrape=true;
          return Math.max(original,raised);
        };
        for(let q=1;q+1<polygon.length;q++){
          const points=[polygon[0],polygon[q],polygon[q+1]];
          if(Math.abs(cross(...points as [Point,Point,Point]))<1e-9)continue;
          for(const p of points){positions.push(p[0],height(p),-p[1]);uv.push(p[0]/4,p[1]/4);}
        }
      }
    }
    // Clipped polygon vertices prove the clearance throughout every plane pair.
    // Keep the original triangle when safe, so ordinary roads gain no geometry.
    if(!needsDrape){
      positions.length=start;uv.length=startUv;
      for(let i=0;i<3;i++){const p=triangle[i];positions.push(p[0],heights[i],-p[1]);uv.push(p[0]/4,p[1]/4);}
    }
    if(sourceLevels)while(levels.length<positions.length/3)levels.push(sourceLevels.getX(k));
    if(sourceProfiles)while(profiles.length<positions.length/3)profiles.push(sourceProfiles.getX(k));
  }
  if(!await pace())return;
  if(sourceLevels)road.setAttribute('roadLevel',new THREE.Float32BufferAttribute(levels,1));
  if(sourceProfiles)road.setAttribute('roadProfile',new THREE.Float32BufferAttribute(profiles,1));
  road.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  road.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  road.computeVertexNormals();road.computeBoundingSphere();
}
