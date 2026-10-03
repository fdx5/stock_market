import * as THREE from 'three';

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

/** Partition asphalt at the rendered ground's triangle edges, not merely DEM posts.
 * On each piece both surfaces are planes. Interpolating their maximum keeps the
 * entire road piece above ground, including its interior, with shared edge heights.
 * Ground coordinates are footprint x/y/z; road coordinates are x/up/-y.
 */
export async function drapeRoadSurface(road: THREE.BufferGeometry,ground: THREE.BufferGeometry,pace:()=>Promise<boolean>,lift=.015) {
  const grid=ground.userData.grid as {xs:Float64Array;ys:Float64Array}|undefined;
  if(!grid)return;
  const {xs,ys}=grid,row=xs.length,P=ground.getAttribute('position'),source=road.getAttribute('position');
  const positions:number[]=[],uv:number[]=[];
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
  }
  if(!await pace())return;
  road.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  road.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  road.computeVertexNormals();road.computeBoundingSphere();
}
