import wasmUrl from '../wasm/road-bvh/road_bvh.wasm?url';
import type {RoadBvhPart} from './roadBvh';

type Kernel = {memory:WebAssembly.Memory;alloc_words:(n:number)=>number;free_words:(p:number,n:number)=>void;
 bvh_build:(p:number,n:number)=>number;bvh_nodes:(p:number)=>number;bvh_node_count:(p:number)=>number;bvh_ids:(p:number)=>number;bvh_free:(p:number)=>void};
let kernel:Promise<Kernel>|undefined;
export async function buildRoadBvhWasm(bounds:Float32Array):Promise<RoadBvhPart> {
 kernel??=fetch(wasmUrl).then(async r=>{
  if(!r.ok)throw Error('BVH kernel unavailable');
  const bytes=await r.arrayBuffer(),result=await WebAssembly.instantiate(bytes,{});
  return result.instance.exports as unknown as Kernel;
 });
 const k=await kernel,count=bounds.length/4;
 if(!Number.isInteger(count)||!count)throw Error('invalid BVH input');
 const ptr=k.alloc_words(bounds.length);let tree=0;
 try{
  new Float32Array(k.memory.buffer,ptr,bounds.length).set(bounds);
  tree=k.bvh_build(ptr,count);if(!tree)throw Error('invalid BVH bounds');
  return {nodes:new Uint32Array(k.memory.buffer,k.bvh_nodes(tree),k.bvh_node_count(tree)*8).slice(),
   ids:new Uint32Array(k.memory.buffer,k.bvh_ids(tree),count).slice(),offset:0};
 }finally{if(tree)k.bvh_free(tree);k.free_words(ptr,bounds.length);}
}
