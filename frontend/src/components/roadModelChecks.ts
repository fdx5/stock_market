import type {BufferGeometry} from 'three';
import {SceneWorkerPool} from './sceneWorkerPool';
import type {RoadModelCheckJob,RoadModelCheckResult} from './roadModelCheckWorker';
/** Preserve exact annex/road checks without sampling millions of edges in a frame. */
export class RoadModelChecks{
  private pool=new SceneWorkerPool<RoadModelCheckJob,RoadModelCheckResult>(()=>new Worker(new URL('./roadModelCheckWorker.ts',import.meta.url),{type:'module'}),1,30000);
  async test(context:string,g:BufferGeometry,dx:number,dy:number,roads:RoadModelCheckJob['roads'],buildings:RoadModelCheckJob['buildings'],signal:AbortSignal){
    const position=g.getAttribute('position');if(!position)return true;
    const result=await this.pool.run({context,position:position.array,index:g.index?.array??null,dx,dy,roads,buildings},signal);
    // Unavailable checks keep the measured register geometry as the visible fallback.
    return result?.blocked??null;
  }
  dispose(){this.pool.dispose();}
}
