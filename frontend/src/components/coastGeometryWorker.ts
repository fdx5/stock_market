/// <reference lib="webworker" />
import * as THREE from 'three';
import {seaOutsideBox} from './coastGeometry';
export type CoastGeometryJob = {kind:'cut';attributes:Record<string,{array:Float32Array;size:number;normalized:boolean}>;index:Uint32Array;box:[number,number,number,number];matrix:number[];inside:boolean} | {kind:'normals';position:Float32Array;index:Uint32Array};
export type CoastGeometryResult = {id:number;attributes:Record<string,{array:Float32Array;size:number;normalized:boolean}>;index:Uint32Array;sphere:{x:number;y:number;z:number;radius:number};error?:boolean};
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=(e:MessageEvent<CoastGeometryJob&{id:number}>)=>{
  let source:THREE.BufferGeometry|null=null,result:THREE.BufferGeometry|null=null;
  try{
    const j=e.data;source=new THREE.BufferGeometry();source.setIndex(new THREE.BufferAttribute(j.index,1));
    if(j.kind==='cut'){
      for(const[k,a]of Object.entries(j.attributes))source.setAttribute(k,new THREE.BufferAttribute(a.array,a.size,a.normalized));
      result=seaOutsideBox(source,j.box,new THREE.Matrix4().fromArray(j.matrix),j.inside);
    }else{
      source.setAttribute('position',new THREE.BufferAttribute(j.position,3));source.computeVertexNormals();source.computeBoundingSphere();result=source;
    }
    const attributes:CoastGeometryResult['attributes']={},transfer:ArrayBuffer[]=[];
    for(const[k,a]of Object.entries(result.attributes)){const array=a.array as Float32Array;attributes[k]={array,size:a.itemSize,normalized:a.normalized};transfer.push(array.buffer as ArrayBuffer);}
    const index=result.index!.array as Uint32Array,b=result.boundingSphere??new THREE.Sphere();transfer.push(index.buffer as ArrayBuffer);
    scope.postMessage({id:j.id,attributes,index,sphere:{x:b.center.x,y:b.center.y,z:b.center.z,radius:b.radius}} satisfies CoastGeometryResult,[...new Set(transfer)]);
  }catch{scope.postMessage({id:e.data.id,error:true});}
  finally{if(result!==source)result?.dispose();source?.dispose();}
};
