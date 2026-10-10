import type * as THREE from 'three';
import {hybridSceneEnabled} from './hybridScene';
const previous=new WeakMap<THREE.BufferAttribute,Float32Array>();
/** Identical Float32 packing to InstancedMesh.setMatrixAt, using one native
 * bulk copy for the hot vehicle/wheel/sleeper paths. Uploads stay explicit. */
export function setInstanceMatrix(mesh:THREE.InstancedMesh,index:number,matrix:THREE.Matrix4){
 mesh.instanceMatrix.array.set(matrix.elements,index*16);
}
/** Compare the final packed pose, including hide/show writes that cancel out.
 * Active prefix only; newly exposed slots are compared too. First upload stays full. */
export function flushInstanceAttribute(a:THREE.BufferAttribute,count=a.count){
 if(!hybridSceneEnabled()||!(a.array instanceof Float32Array)){a.needsUpdate=true;return;}
 const data=a.array,n=Math.min(data.length,Math.max(0,count)*a.itemSize);let old=previous.get(a);
 if(!old||old.length!==data.length){old=data.slice();previous.set(a,old);a.clearUpdateRanges();a.needsUpdate=true;return;}
 let lo=n,hi=0;for(let i=0;i<n;i++)if(!Object.is(data[i],old[i])){lo=Math.min(lo,i);hi=i+1;}
 if(hi===0)return;
 // Merge with unconsumed writes: a hidden mesh may not have uploaded yet.
 for(const r of a.updateRanges){lo=Math.min(lo,r.start);hi=Math.max(hi,r.start+r.count);}
 a.clearUpdateRanges();a.addUpdateRange(lo,hi-lo);old.set(data.subarray(lo,hi),lo);a.needsUpdate=true;
}
