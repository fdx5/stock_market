/// <reference lib="webworker" />
import {buildRoadBvhJs} from './roadBvh';
import {buildRoadBvhWasm} from './roadBvhWasm';
self.onmessage=async(e:MessageEvent<{positions:Float32Array;offset:number;engine?:'js'|'wasm'}>)=>{
 try{const at=performance.now(),p=e.data.positions,count=p.length/9,bounds=new Float32Array(count*4);
  for(let i=0;i<count;i++){const k=i*9;bounds[i*4]=Math.min(p[k],p[k+3],p[k+6]);bounds[i*4+1]=Math.min(-p[k+2],-p[k+5],-p[k+8]);bounds[i*4+2]=Math.max(p[k],p[k+3],p[k+6]);bounds[i*4+3]=Math.max(-p[k+2],-p[k+5],-p[k+8]);}
  const kernelAt=performance.now(),part=e.data.engine==='js'?buildRoadBvhJs(bounds):await buildRoadBvhWasm(bounds);
  part.offset=e.data.offset;
  self.postMessage({part,workerMs:performance.now()-at,kernelMs:performance.now()-kernelAt},[part.nodes.buffer,part.ids.buffer]);
 }catch(error){self.postMessage({error:String(error)});}
};
