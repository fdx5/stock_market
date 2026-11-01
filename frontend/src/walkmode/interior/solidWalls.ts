import * as THREE from 'three';
import type {Batcher} from './geom';

export interface WallVolume {axis:'x'|'z';at:number;lo:number;hi:number;bottom:number;top:number;mat:THREE.Material;zone:number;inward:number}
interface Box {x0:number;x1:number;z0:number;z1:number;y0:number;y1:number;wall:WallVolume}
const EPS=.001;
const coordinates=(values:number[])=>{
 const result:number[]=[];
 for(const v of [...new Set(values)].sort((a,b)=>a-b))if(!result.length||v-result[result.length-1]>EPS)result.push(v);
 return result;
};
const nearest=(values:number[],v:number)=>{let best=0;for(let i=1;i<values.length;i++)if(Math.abs(values[i]-v)<Math.abs(values[best]-v))best=i;return best;};

/** Emit only the outer surfaces of the union of solid wall volumes. Overlapping
 * observations, T junctions, corners and decomposition pieces have no internal
 * coplanar faces, cracks or frame-only structural strips. */
export function solidWallUnion(B:Batcher,walls:WallVolume[],half:number){
 if(!walls.length)return;
 const boxes:Box[]=walls.filter(w=>w.hi-w.lo>EPS&&w.top-w.bottom>EPS).map(w=>({
  x0:w.axis==='x'?w.at-half:w.lo,x1:w.axis==='x'?w.at+half:w.hi,
  z0:w.axis==='z'?w.at-half:w.lo,z1:w.axis==='z'?w.at+half:w.hi,y0:w.bottom,y1:w.top,wall:w,
 }));
 // A real junction gets solid corner infill. An open decomposition seam has no
 // wall volume and therefore cannot create an extra pillar.
 for(const a of walls.filter(w=>w.axis==='x'))for(const b of walls.filter(w=>w.axis==='z')){
  if(b.at<a.lo-EPS||b.at>a.hi+EPS||a.at<b.lo-EPS||a.at>b.hi+EPS)continue;
  const bottom=Math.max(a.bottom,b.bottom),top=Math.min(a.top,b.top);if(top-bottom<=EPS)continue;
  boxes.push({x0:a.at-half,x1:a.at+half,z0:b.at-half,z1:b.at+half,y0:bottom,y1:top,wall:a});
 }
 const xs=coordinates(boxes.flatMap(b=>[b.x0,b.x1])),zs=coordinates(boxes.flatMap(b=>[b.z0,b.z1])),ys=coordinates(boxes.flatMap(b=>[b.y0,b.y1]));
 const nx=xs.length-1,nz=zs.length-1,ny=ys.length-1;
 // Apartment decomposition is bounded upstream. Avoid an unbounded allocation
 // for a malformed or exceptionally complex plan.
 if(nx*nz*ny>2_000_000)throw Error('wall topology exceeds the validated geometry limit');
 const layers=Array.from({length:ny},()=>new Int32Array(nx*nz).fill(-1));
 boxes.forEach((b,id)=>{
  const x0=nearest(xs,b.x0),x1=nearest(xs,b.x1),z0=nearest(zs,b.z0),z1=nearest(zs,b.z1),y0=nearest(ys,b.y0),y1=nearest(ys,b.y1);
  for(let y=y0;y<y1;y++)for(let z=z0;z<z1;z++)layers[y].fill(id,z*nx+x0,z*nx+x1);
 });
 const cell=(x:number,z:number,y:number)=>x<0||z<0||y<0||x>=nx||z>=nz||y>=ny?-1:layers[y][z*nx+x];
 const quad=(id:number,normal:THREE.Vector3,vertices:number[][])=>{
  const box=boxes[id],p=vertices.map(v=>new THREE.Vector3(...v as [number,number,number]));
  const center=p.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(.25);
  // Opposite sides of a shared wall retain their own room's finish and light zone.
  const axis=Math.abs(normal.x)>.5?'x':Math.abs(normal.z)>.5?'z':null;
  const owner=axis?walls.find(w=>w.axis===axis&&Math.sign(w.inward)===(axis==='x'?Math.sign(normal.x):Math.sign(normal.z))&&Math.abs(w.at-(axis==='x'?center.x:center.z))<=half+EPS&&w.lo-EPS<=(axis==='x'?center.z:center.x)&&w.hi+EPS>=(axis==='x'?center.z:center.x)&&w.bottom-EPS<=center.y&&w.top+EPS>=center.y):undefined;
  const w=owner??box.wall;
  let uv=p.map(v=>[axis==='x'?v.z:v.x,axis?v.y:v.z] as [number,number]);
  if(new THREE.Vector3().subVectors(p[1],p[0]).cross(new THREE.Vector3().subVectors(p[3],p[0])).dot(normal)<0){[p[1],p[3]]=[p[3],p[1]];[uv[1],uv[3]]=[uv[3],uv[1]];}
  B.quad(w.mat,w.zone,p,normal,uv);
 };
 for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const id=cell(x,z,y);if(id<0)continue;
  const a=xs[x],b=xs[x+1],c=zs[z],d=zs[z+1],lo=ys[y],hi=ys[y+1];
  if(cell(x-1,z,y)<0)quad(id,new THREE.Vector3(-1,0,0),[[a,lo,c],[a,lo,d],[a,hi,d],[a,hi,c]]);
  if(cell(x+1,z,y)<0)quad(id,new THREE.Vector3(1,0,0),[[b,lo,c],[b,hi,c],[b,hi,d],[b,lo,d]]);
  if(cell(x,z-1,y)<0)quad(id,new THREE.Vector3(0,0,-1),[[a,lo,c],[a,hi,c],[b,hi,c],[b,lo,c]]);
  if(cell(x,z+1,y)<0)quad(id,new THREE.Vector3(0,0,1),[[a,lo,d],[b,lo,d],[b,hi,d],[a,hi,d]]);
  if(cell(x,z,y-1)<0)quad(id,new THREE.Vector3(0,-1,0),[[a,lo,c],[b,lo,c],[b,lo,d],[a,lo,d]]);
  if(cell(x,z,y+1)<0)quad(id,new THREE.Vector3(0,1,0),[[a,hi,c],[a,hi,d],[b,hi,d],[b,hi,c]]);
 }
}
