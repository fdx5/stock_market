import * as THREE from 'three';
const lodCenter=new THREE.Vector3(),lodEye=new THREE.Vector3();
/** Quadtree leaf batches retain every instance, colour and transform. Local
 * bounds are exact and ordinary per-pass frustum tests handle shadows/reflections. */
export function forestCells(source:THREE.InstancedMesh,maxWidth=120,maxCount=128,levels?:THREE.BufferGeometry[]){
 const matrix=new THREE.Matrix4(),rows=Array.from({length:source.count},(_,i)=>{source.getMatrixAt(i,matrix);return {i,x:matrix.elements[12],z:matrix.elements[14]};});
 const leaves:typeof rows[]=[];
 const split=(list:typeof rows,depth=0)=>{
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const r of list){x0=Math.min(x0,r.x);z0=Math.min(z0,r.z);x1=Math.max(x1,r.x);z1=Math.max(z1,r.z);}
  if(depth>=12||(list.length<=maxCount&&Math.max(x1-x0,z1-z0)<=maxWidth)){leaves.push(list);return;}
  const x=(x0+x1)/2,z=(z0+z1)/2,parts=Array.from({length:4},()=>[] as typeof rows);for(const r of list)parts[(r.x>x?1:0)+(r.z>z?2:0)].push(r);
  if(parts.some(p=>p.length===list.length)){leaves.push(list);return;}for(const p of parts)if(p.length)split(p,depth+1);
 };if(rows.length)split(rows);
 return leaves.map(list=>{
  const mesh=new THREE.InstancedMesh(source.geometry,source.material,list.length),color=new THREE.Color();
  list.forEach((r,i)=>{source.getMatrixAt(r.i,matrix);mesh.setMatrixAt(i,matrix);if(source.instanceColor){source.getColorAt(r.i,color);mesh.setColorAt(i,color);}});
  mesh.name=source.name;mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.computeBoundingBox();mesh.computeBoundingSphere();
  if(levels){const box=new THREE.Box3(),part=new THREE.Box3();for(const g of levels){if(!g.boundingBox)g.computeBoundingBox();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);box.union(part.copy(g.boundingBox!).applyMatrix4(matrix));}}mesh.boundingBox=box;mesh.boundingSphere=box.getBoundingSphere(new THREE.Sphere());mesh.userData.forestLod=levels;mesh.userData.forestLevel=levels.indexOf(mesh.geometry);}
  mesh.boundingSphere!.radius+=1e-4+mesh.boundingSphere!.radius*1e-6;return mesh;
 });
}
/** Distant woodland only. Keep original detail when close to a cell's surface;
 * 15% hysteresis prevents switches as the camera hovers around a boundary. */
export function updateForestLod(mesh:THREE.InstancedMesh,camera:THREE.Camera){
 const levels=mesh.userData.forestLod as THREE.BufferGeometry[]|undefined;if(!levels)return;
 const s=mesh.boundingSphere;if(!s)return;const center=lodCenter.copy(s.center).applyMatrix4(mesh.matrixWorld),eye=lodEye.setFromMatrixPosition(camera.matrixWorld);
 const distance=Math.max(0,eye.distanceTo(center)-s.radius*mesh.matrixWorld.getMaxScaleOnAxis()),old=mesh.userData.forestLevel??0;
 const thresholds=[300,650],target=distance>thresholds[1]?2:distance>thresholds[0]?1:0;
 let next=old;if(target>old&&distance>thresholds[Math.min(old,1)]*1.15)next=target;else if(target<old&&distance<thresholds[Math.min(target,1)]*.85)next=target;
 if(next!==old){mesh.geometry=levels[next];mesh.userData.forestLevel=next;}
}
