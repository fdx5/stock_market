import * as THREE from 'three';
import {drapeRoadSurface,raiseRoadPaint}from'./roadDrape';

/** Same exact ground/road partition, without the foreground frame scheduler
 * repeatedly postponing a long geometric calculation. The live geometry remains
 * intact until the complete worker result and the owner's validity check. */
export async function drapeRoadOffThread(road:THREE.BufferGeometry,ground:THREE.BufferGeometry,pace:()=>Promise<boolean>,lift=.015,asphalt?:THREE.BufferGeometry){
 const grid=ground.userData.grid;if(!grid)return;
 if(typeof Worker!=='undefined')try{
  const result=await new Promise<Record<string,Float32Array>>((resolve,reject)=>{
   const worker=new Worker(new URL('./roadDrapeWorker.ts',import.meta.url),{type:'module'});
   const timer=setTimeout(()=>{worker.terminate();reject(Error('road drape worker timeout'));},10000);
   worker.onmessage=e=>{clearTimeout(timer);worker.terminate();e.data.result?resolve(e.data.result):reject(Error(e.data.error));};
   worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('road drape worker unavailable'));};
   worker.postMessage({road:road.getAttribute('position').array,ground:ground.getAttribute('position').array,xs:grid.xs,ys:grid.ys,lift,asphalt:asphalt?.getAttribute('position').array});
  });
  if(!await pace())return;
  for(const[name,size]of [['position',3],['normal',3],['uv',2]]as const)road.setAttribute(name,new THREE.BufferAttribute(result[name],size));
  road.computeBoundingSphere();return;
 }catch{/* The verified sliced path remains available if a worker fails. */}
 await drapeRoadSurface(road,ground,pace,lift);
 if(asphalt)await raiseRoadPaint(road,asphalt,pace);
}
