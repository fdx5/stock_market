/// <reference lib="webworker" />
import * as THREE from 'three';
import {drapeRoadSurface,raiseRoadPaint}from'./roadDrape';
import {roadBvhIndex,type RoadBvhData}from'./roadBvh';
self.onmessage=async(e:MessageEvent<{road:Float32Array;roadLevels?:Float32Array;roadProfiles?:Float32Array;asphaltProfiles?:Float32Array;asphaltLevels?:Float32Array;ground:Float32Array;xs:Float64Array;ys:Float64Array;lift:number;asphalt?:Float32Array;asphaltIndex?:RoadBvhData}>)=>{
 try{
  const source=new THREE.BufferGeometry(),ground=new THREE.BufferGeometry();
  source.setAttribute('position',new THREE.BufferAttribute(e.data.road,3));ground.setAttribute('position',new THREE.BufferAttribute(e.data.ground,3));
  if(e.data.roadLevels)source.setAttribute('roadLevel',new THREE.BufferAttribute(e.data.roadLevels,1));
  if(e.data.roadProfiles)source.setAttribute('roadProfile',new THREE.BufferAttribute(e.data.roadProfiles,1));
  ground.userData.grid={xs:e.data.xs,ys:e.data.ys};
  await drapeRoadSurface(source,ground,()=>Promise.resolve(true),e.data.lift);
  if(e.data.asphalt){const asphalt=new THREE.BufferGeometry();asphalt.setAttribute('position',new THREE.BufferAttribute(e.data.asphalt,3));if(e.data.asphaltLevels)asphalt.setAttribute('roadLevel',new THREE.BufferAttribute(e.data.asphaltLevels,1));if(e.data.asphaltProfiles)asphalt.setAttribute('roadProfile',new THREE.BufferAttribute(e.data.asphaltProfiles,1));await raiseRoadPaint(source,asphalt,()=>Promise.resolve(true),.015,e.data.asphaltIndex?roadBvhIndex(e.data.asphaltIndex):undefined);}
  const result=Object.fromEntries(['position','normal','uv'].map(name=>[name,source.getAttribute(name).array]));
  if(source.getAttribute('roadLevel'))result.roadLevel=source.getAttribute('roadLevel').array;
  if(source.getAttribute('roadProfile'))result.roadProfile=source.getAttribute('roadProfile').array;
  self.postMessage({result},Object.values(result).map(a=>a.buffer));
 }catch(error){self.postMessage({error:String(error)});}
};
