import * as THREE from 'three';
import type {InitialRoadJob,InitialRoadResult,RoadArrays} from './initialRoadGeometry';

export function prepareInitialRoads(job:InitialRoadJob,signal:AbortSignal):Promise<InitialRoadResult>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error('initial roads cancelled'));return;}
    const worker=new Worker(new URL('./initialRoadWorker.ts',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error?:Error,result?:InitialRoadResult)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();
      error?reject(error):resolve(result!);
    };
    const cancel=()=>finish(Error('initial roads cancelled'));
    const timer=setTimeout(()=>finish(Error('initial roads timed out')),15000);
    signal.addEventListener('abort',cancel,{once:true});
    worker.onmessage=e=>e.data.result?finish(undefined,e.data.result):finish(Error(e.data.error));
    worker.onerror=()=>finish(Error('initial road worker unavailable'));
    // Clone departure data. The live ground/DEM buffers must never be detached.
    try{worker.postMessage(job);}catch{finish(Error('initial road data unavailable'));}
  });
}
export async function initialRoadLayer(result:InitialRoadResult){
  const geometry=(a:RoadArrays)=>{const g=new THREE.BufferGeometry();for(const x of a.attributes)g.setAttribute(x.name,new THREE.BufferAttribute(x.array,x.size));g.userData.roadProfiles=a.profiles;g.computeBoundingSphere();return g;};
  const paint=new THREE.Group();paint.name='initial road lane lines';
  result.paint.forEach(a=>{const material=new THREE.MeshStandardMaterial({color:a.color??0xf2f2ee,roughness:.62,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});const mesh=new THREE.Mesh(geometry(a),material);mesh.receiveShadow=true;paint.add(mesh);});
  const group=new THREE.Group();group.name='initial surveyed roads';group.add(paint);
  let dead=false;
  return {group,paint,dispose(){if(dead)return;dead=true;group.removeFromParent();group.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.geometry.dispose();(Array.isArray(m.material)?m.material:[m.material]).forEach(x=>x.dispose());}});}};
}
