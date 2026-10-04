import type * as THREE from 'three';
import {sceneDeviceBudget} from './sceneDeviceBudget';
import {onSceneMemoryRelease} from './sceneMemory';
import type {RoadBvhData} from './roadBvh';

const live=new Set<()=>void>();
onSceneMemoryRelease(()=>{for(const stop of [...live])stop();});
export function roadBvhEnabled(){return typeof location!=='undefined'&&new URLSearchParams(location.search).get('bvh')!=='grid';}
/** Independent WASM instances in bounded workers. No SharedArrayBuffer/COOP or
 * renderer changes; original GPU attributes are never detached or reordered. */
export async function buildRoadBvh(geometry:THREE.BufferGeometry,options:{workers?:number;engine?:'js'|'wasm';signal?:AbortSignal}={}):Promise<RoadBvhData|null>{
 const p=geometry.getAttribute('position'),array=p?.array;
 if(!(array instanceof Float32Array)||p.itemSize!==3||geometry.index||p.count%3||array.length<9||array.length/9>2e6||typeof Worker==='undefined'||options.signal?.aborted)return null;
 const triangles=array.length/9,constrained=sceneDeviceBudget().constrained;
 if(constrained&&triangles>250000)return null;
 const requested=options.workers??(!constrained&&typeof location!=='undefined'&&new URLSearchParams(location.search).get('bvh')==='wasm2'?2:1);
 if(!Number.isFinite(requested))return null;
 const workers=Math.max(1,Math.min(Math.floor(requested),constrained?1:2,Math.max(1,Math.floor(triangles/16000))));
 const at=performance.now(),abort=new AbortController();
 const cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});
 try{const result=await Promise.all(Array.from({length:workers},(_,i)=>new Promise<{part:RoadBvhData['parts'][number];workerMs:number}>((resolve,reject)=>{
  const start=Math.floor(triangles*i/workers),end=Math.floor(triangles*(i+1)/workers);
  const worker=new Worker(new URL('./roadBvhWorker.ts',import.meta.url),{type:'module'});
  let settled=false,timer:ReturnType<typeof setTimeout>;
  const finish=(error?:Error,value?:{part:RoadBvhData['parts'][number];workerMs:number})=>{
   if(settled)return;settled=true;clearTimeout(timer);worker.terminate();live.delete(stop);abort.signal.removeEventListener('abort',stop);error?reject(error):resolve(value!);
  };
  const stop=()=>finish(Error('BVH cancelled'));live.add(stop);abort.signal.addEventListener('abort',stop,{once:true});
  // A stalled optional kernel must not add ten seconds to visible road loading.
  timer=setTimeout(()=>finish(Error('BVH worker timeout')),1000);
  worker.onmessage=e=>e.data.error?finish(Error(e.data.error)):finish(undefined,e.data);
  worker.onerror=()=>finish(Error('BVH worker unavailable'));
  const positions=array.slice(start*9,end*9);worker.postMessage({positions,offset:start,engine:options.engine},[positions.buffer]);
 })));return {parts:result.map(r=>r.part),triangles,buildMs:performance.now()-at,workerMs:Math.max(...result.map(r=>r.workerMs)),workers};
 }catch{abort.abort();return null;}finally{options.signal?.removeEventListener('abort',cancel);}
}
