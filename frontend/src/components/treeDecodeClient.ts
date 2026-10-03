import { frameSlice } from './frameSlice';
import { decodeTreeVariants, type Meta, type TwigAtlas, type Built } from './treeGeometry';
import { unpackTrees, type TreeWire } from './treeGeometryWire';

/** The exact existing tree geometry, decoded away from the page's frame queue. */
export async function decodeTreeKit(meta:Meta,bin:ArrayBuffer,twigAtlas:TwigAtlas):Promise<Map<string,Built[]>> {
  if(typeof Worker!=='undefined')try{
    const wire=await new Promise<TreeWire>((resolve,reject)=>{
      const w=new Worker(new URL('./treeDecodeWorker.ts',import.meta.url),{type:'module'});
      const timer=setTimeout(()=>{w.terminate();reject(Error('tree decode timeout'));},10000);
      const done=()=>{clearTimeout(timer);w.terminate();};
      w.onmessage=(e:MessageEvent<{wire?:TreeWire;error?:string}>)=>{done();e.data.wire?resolve(e.data.wire):reject(Error(e.data.error??'tree decode failed'));};
      w.onerror=()=>{done();reject(Error('tree decode worker unavailable'));};
      // Keep the source for the original sliced fallback if a worker fails.
      w.postMessage({meta,bin,twigAtlas});
    });
    return unpackTrees(wire);
  }catch { /* Preserve the original geometry path on unsupported browsers. */ }
  return decodeTreeVariants(meta,bin,twigAtlas,()=>frameSlice());
}
