import * as THREE from 'three';
import type {RoadTileResult} from './droneRoads';
import {cutSceneSurface} from './surfaceCutClient';
type Ring=[number,number][];

/** Fit all visible tile surfaces before admission. Retain the same exact ground
 * asphalt triangles as the guard for subsequent measured building replacements. */
export async function fitTileStreetSurfaces(roads:RoadTileResult,buildings:Ring[],pace:()=>Promise<boolean>){
 type Surface=NonNullable<RoadTileResult['surface']>&{color?:Float32Array};
 const cut=async(a:Surface|null,rings:Ring[])=>{
  if(!a)return;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(a.position,3));g.setAttribute('normal',new THREE.BufferAttribute(a.normal,3));
  if(a.color)g.setAttribute('color',new THREE.BufferAttribute(a.color,3));
  if(a.level)g.setAttribute('roadLevel',new THREE.BufferAttribute(a.level,1));
  g.setIndex(new THREE.BufferAttribute(a.index,1));
  await cutSceneSurface(g,rings,pace,true,true);
  a.position=g.getAttribute('position').array as Float32Array;a.normal=g.getAttribute('normal').array as Float32Array;
  a.index=g.index?new Uint32Array(g.index.array):Uint32Array.from({length:a.position.length/3},(_,i)=>i);
  if(a.color)a.color=g.getAttribute('color').array as Float32Array;
  if(a.level)a.level=g.getAttribute('roadLevel').array as Float32Array;
  g.dispose();
 };
 await cut(roads.surface,buildings);
 const ground:Ring[]=[],p=roads.surface?.position,idx=roads.surface?.index,levels=roads.surface?.level;
 if(p&&idx)for(let k=0;k<idx.length;k+=3){
  if(k%1536===0&&!await pace())return ground;
  if(levels?.[idx[k]])continue;
  ground.push([0,1,2].map(i=>[p[idx[k+i]*3],p[idx[k+i]*3+1]] as [number,number]));
 }
 await cut(roads.marks,buildings);await cut(roads.marksFar,buildings);
 await cut(roads.walks,[...buildings,...ground]);
 return ground;
}
