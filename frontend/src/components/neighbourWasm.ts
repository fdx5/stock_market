import * as THREE from 'three';
import type {NeighbourJob,NeighbourArrays} from './neighbourGeometry';
import wasmUrl from '../wasm/scene-geometry/scene_geometry.wasm?url';
export function packNeighbourJobs(jobs:NeighbourJob[]){
 let size=0;
 const prepared=jobs.map(j=>{const b=j.building,area=(r:[number,number][])=>r.reduce((s,[x,y],i)=>{const [u,v]=r[(i+1)%r.length];return s+x*v-u*y;},0),outer=area(b.rings[0])>=0?b.rings[0]:[...b.rings[0]].reverse(),holes=b.rings.slice(1).map(r=>area(r)<=0?r:[...r].reverse()),rings=[outer,...holes],pts=rings.flat();
  const tris=THREE.ShapeUtils.triangulateShape(outer.map(p=>new THREE.Vector2(...p)),holes.map(r=>r.map(p=>new THREE.Vector2(...p)))).flat();
  const depth=Math.max(2,b.height-b.base),z0=j.ground+b.base-(b.base>0?0:3),z1=j.ground+b.base+depth,k=THREE.MathUtils.clamp(j.floorM/(depth/Math.max(1,b.floors)),.5,2);
  size+=10+pts.length*6+tris.length;return {j,rings,pts,tris,z0,z1,k};
 });
 if(size>4000000)throw Error('geometry batch exceeds memory budget');
 const input=new Float64Array(size);let at=0;
 for(const {j,rings,pts,tris,z0,z1,k}of prepared){input.set([pts.length,pts.length,tris.length,j.ground,z0,z1,k,...j.color],at);at+=10;
  for(const r of rings)for(let i=0;i<r.length;i++){input.set(r[i],at);input.set(r[(i+1)%r.length],at+2);at+=4;}
  for(const p of pts){input.set(p,at);at+=2;}input.set(tris,at);at+=tris.length;
 }return input;
}
export type GeometryKernel={memory:WebAssembly.Memory;alloc_input:(n:number)=>number;free_input:(p:number,n:number)=>void;geometry_build:(p:number,n:number)=>number;geometry_attrs:(p:number)=>number;geometry_vertices:(p:number)=>number;geometry_ids:(p:number)=>number;geometry_offsets:(p:number)=>number;geometry_free:(p:number)=>void};
let pending:Promise<GeometryKernel>|undefined;
export const neighbourWasmStats={memoryBytes:0,inputBytes:0};
export async function neighbourWasmArrays(jobs:NeighbourJob[],supplied?:GeometryKernel):Promise<NeighbourArrays[]>{
 if(!jobs.length)return [];
 pending??=supplied?Promise.resolve(supplied):(async()=>{const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),1000);try{const r=await fetch(wasmUrl,{signal:abort.signal});if(!r.ok)throw Error('geometry kernel unavailable');return (await WebAssembly.instantiate(await r.arrayBuffer(),{})).instance.exports as unknown as GeometryKernel;}finally{clearTimeout(timer);}})();
 const k=supplied??await pending,input=packNeighbourJobs(jobs),p=k.alloc_input(input.length);let handle=0;
 neighbourWasmStats.inputBytes=input.byteLength;
 try{new Float64Array(k.memory.buffer,p,input.length).set(input);handle=k.geometry_build(p,input.length);if(!handle)throw Error('invalid geometry batch');
  const vertices=k.geometry_vertices(handle),attr=k.geometry_attrs(handle),base=k.geometry_ids(handle),offsets=new Uint32Array(k.memory.buffer,k.geometry_offsets(handle),jobs.length*4);
  return jobs.map((_,i)=>{const[v,n,t,nt]=offsets.subarray(i*4,i*4+4),copy=(off:number,start:number,len:number)=>new Float32Array(k.memory.buffer,attr+(off+start)*4,len).slice();
   const ids=new Uint32Array(k.memory.buffer,base+t*4,nt),index=n<=65535?Uint16Array.from(ids):ids.slice();return {position:copy(0,v*3,n*3),normal:copy(vertices*3,v*3,n*3),uv:copy(vertices*6,v*2,n*2),color:copy(vertices*8,v*3,n*3),index};
  });
 }finally{neighbourWasmStats.memoryBytes=k.memory.buffer.byteLength;if(handle)k.geometry_free(handle);k.free_input(p,input.length);}
}
