/// <reference lib="webworker" />
import {initialRoadGeometry,type InitialRoadJob} from './initialRoadGeometry';
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=async(e:MessageEvent<InitialRoadJob>)=>{
  try{
    const result=await initialRoadGeometry(e.data);
    const buffers=new Set<ArrayBuffer>();
    for(const mesh of result.paint)for(const a of mesh.attributes)buffers.add(a.array.buffer as ArrayBuffer);
    scope.postMessage({result},[...buffers]);
  }catch(error){scope.postMessage({error:error instanceof Error?error.message:'initial roads failed'});}
};
