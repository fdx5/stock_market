import * as THREE from 'three';
import {sceneWork} from './sceneWorkerClient';
import {excludeSurface} from './surfaceExclusion';
import {seaOutsideBox} from './coastGeometry';

/** Initial streets and streamed tiles use the same exact footprint subtraction. */
export async function cutSceneSurface(geometry:THREE.BufferGeometry,rings:[number,number][][],pace:()=>Promise<boolean>,roads=false,zUp=false){
 const result=await sceneWork('surfaceCut',{attributes:Object.entries(geometry.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array as Float32Array})),index:geometry.index?.array as Uint16Array|Uint32Array??null,rings,roads,zUp})?.catch(()=>null);
 if(!await pace())return;
 if(result){geometry.setIndex(result.index?new THREE.BufferAttribute(result.index,1):null);for(const a of result.attributes)geometry.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.size));geometry.computeBoundingSphere();}
 else await excludeSurface(geometry,rings,pace,zUp);
}
/** The departure streets hand over to streamed tiles at the same square as
 * their ground, rather than leaving a road-width strip over a second DEM. */
export async function clipSceneStreetBox(geometry:THREE.BufferGeometry,box:[number,number,number,number],pace:()=>Promise<boolean>){
 const wasIndexed=!!geometry.index;
 const index=geometry.index?.array as Uint16Array|Uint32Array??Uint32Array.from({length:geometry.getAttribute('position').count},(_,i)=>i);
 const result=await sceneWork('surfaceBox',{attributes:Object.entries(geometry.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array as Float32Array})),index,box})?.catch(()=>null);
 if(!await pace())return;
 if(result){geometry.setIndex(new THREE.BufferAttribute(result.index!,1));for(const a of result.attributes)geometry.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.size));}
 else {const source=geometry.clone();source.setIndex(new THREE.BufferAttribute(index,1));const clipped=seaOutsideBox(source,box,new THREE.Matrix4(),true,true);geometry.setIndex(clipped.index);for(const [name,a]of Object.entries(clipped.attributes))geometry.setAttribute(name,a);source.dispose();clipped.dispose();}
 // Asphalt/paint kernels address consecutive triangles and the optional WASM
 // BVH accepts that representation. Keep it after clipping, without duplicating
 // the identity-index buffers returned for an originally non-indexed surface.
 if(!wasIndexed&&geometry.index){const ix=geometry.index,p=geometry.getAttribute('position');
  if(ix.count===p.count&&ix.array.every((id,i)=>id===i))geometry.setIndex(null);
  else{const flat=geometry.toNonIndexed();for(const [name,a]of Object.entries(flat.attributes))geometry.setAttribute(name,a);geometry.setIndex(null);flat.dispose();}
 }
 geometry.computeBoundingSphere();
}
