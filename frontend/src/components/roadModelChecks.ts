import type {BufferGeometry} from 'three';
import {SceneWorkerPool} from './sceneWorkerPool';
import type {RoadModelCheckJob,RoadModelCheckResult} from './roadModelCheckWorker';
/** Preserve exact annex/road checks without sampling millions of edges in a frame. */
export class RoadModelChecks{
  private pool=new SceneWorkerPool<RoadModelCheckJob,RoadModelCheckResult>(()=>new Worker(new URL('./roadModelCheckWorker.ts',import.meta.url),{type:'module'}),1,30000);
  private prepared=new Set<string>();
  async test(context:string,g:BufferGeometry,dx:number,dy:number,roads:RoadModelCheckJob['roads'],buildings:RoadModelCheckJob['buildings'],signal:AbortSignal){
    const position=g.getAttribute('position');if(!position)return true;
    const base={context,position:position.array,index:g.index?.array??null,dx,dy};
    let result=await this.pool.run(this.prepared.has(context)?base:{...base,roads,buildings},signal);
    // A worker replaced after timeout/error has lost its context. It requests a
    // fresh copy explicitly; an absent cache must never mean a passed road guard.
    if(result?.needContext)result=await this.pool.run({...base,roads,buildings},signal);
    if(result&&!result.needContext){this.prepared.add(context);if(this.prepared.size>2)this.prepared.delete(this.prepared.values().next().value!);}
    // Unavailable checks keep the measured register geometry as the visible fallback.
    return result&&!result.needContext?result.blocked:null;
  }
  dispose(){this.pool.dispose();}
}
