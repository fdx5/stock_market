/// <reference lib="webworker" />
import * as THREE from 'three';
import {drapeRoadSurface,raiseRoadPaint}from'./roadDrape';
import {roadBvhIndex,type RoadBvhData}from'./roadBvh';
self.onmessage=async(e:MessageEvent<{road:Float32Array;ground:Float32Array;xs:Float64Array;ys:Float64Array;lift:number;asphalt?:Float32Array;asphaltIndex?:RoadBvhData}>)=>{
 try{
  const source=new THREE.BufferGeometry(),ground=new THREE.BufferGeometry();
  source.setAttribute('position',new THREE.BufferAttribute(e.data.road,3));ground.setAttribute('position',new THREE.BufferAttribute(e.data.ground,3));
  ground.userData.grid={xs:e.data.xs,ys:e.data.ys};
  await drapeRoadSurface(source,ground,()=>Promise.resolve(true),e.data.lift);
  if(e.data.asphalt){const asphalt=new THREE.BufferGeometry();asphalt.setAttribute('position',new THREE.BufferAttribute(e.data.asphalt,3));await raiseRoadPaint(source,asphalt,()=>Promise.resolve(true),.015,e.data.asphaltIndex?roadBvhIndex(e.data.asphaltIndex):undefined);}
  const result=Object.fromEntries(['position','normal','uv'].map(name=>[name,source.getAttribute(name).array]));
  self.postMessage({result},Object.values(result).map(a=>a.buffer));
 }catch(error){self.postMessage({error:String(error)});}
};
