import * as THREE from 'three';
import {sceneWork} from './sceneWorkerClient';
import {excludeSurface} from './surfaceExclusion';

/** Initial streets and streamed tiles use the same exact footprint subtraction. */
export async function cutSceneSurface(geometry:THREE.BufferGeometry,rings:[number,number][][],pace:()=>Promise<boolean>,roads=false,zUp=false){
 const result=await sceneWork('surfaceCut',{attributes:Object.entries(geometry.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array as Float32Array})),index:geometry.index?.array as Uint16Array|Uint32Array??null,rings,roads,zUp})?.catch(()=>null);
 if(!await pace())return;
 if(result){geometry.setIndex(result.index?new THREE.BufferAttribute(result.index,1):null);for(const a of result.attributes)geometry.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.size));geometry.computeBoundingSphere();}
 else await excludeSurface(geometry,rings,pace,zUp);
}
