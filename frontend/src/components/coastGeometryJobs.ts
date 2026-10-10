import * as THREE from 'three';
import {SceneWorkerPool} from './sceneWorkerPool';
import type {CoastGeometryJob,CoastGeometryResult} from './coastGeometryWorker';
/** Exact coastline clipping and ground normal reconstruction off the render thread. */
export class CoastGeometryJobs{
  private pool=new SceneWorkerPool<CoastGeometryJob,CoastGeometryResult>(()=>new Worker(new URL('./coastGeometryWorker.ts',import.meta.url),{type:'module'}),1,30000);
  async cut(source:THREE.BufferGeometry,box:[number,number,number,number],matrix:THREE.Matrix4,inside:boolean,signal:AbortSignal){
    if(signal.aborted||!source.index)return null;
    const attributes:Extract<CoastGeometryJob,{kind:'cut'}>['attributes']={};
    for(const[k,a]of Object.entries(source.attributes)){
      if(!(a instanceof THREE.BufferAttribute)||!(a.array instanceof Float32Array))return null;
      attributes[k]={array:a.array,size:a.itemSize,normalized:a.normalized};
    }
    // Live geometry stays owned by the scene; structured cloning copies only its
    // packed arrays, avoiding hundreds of thousands of temporary vertex objects.
    const res=await this.pool.run({kind:'cut',attributes,index:source.index.array as Uint32Array,box,matrix:Array.from(matrix.elements),inside},signal);
    return this.geometry(res);
  }
  async normals(position:Float32Array,index:Uint32Array,signal:AbortSignal){
    const res=await this.pool.run({kind:'normals',position,index},signal,[position.buffer,index.buffer]);
    return this.geometry(res);
  }
  private geometry(res:CoastGeometryResult|null){
    if(!res||res.error)return null;
    const g=new THREE.BufferGeometry();for(const[k,a]of Object.entries(res.attributes))g.setAttribute(k,new THREE.BufferAttribute(a.array,a.size,a.normalized));g.setIndex(new THREE.BufferAttribute(res.index,1));
    g.boundingSphere=new THREE.Sphere(new THREE.Vector3(res.sphere.x,res.sphere.y,res.sphere.z),res.sphere.radius);return g;
  }
  dispose(){this.pool.dispose();}
}
