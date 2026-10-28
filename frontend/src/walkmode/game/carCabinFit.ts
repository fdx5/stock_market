import * as THREE from "three";
import type { CarProfile } from "./carProfiles";

export interface CabinFit { front:number; frontTop:number; top:number; belt:number; rear:number; width:number }
/** Use this mesh's actual windscreen to keep the driver and dashboard inside. */
export function fitCarCabin(profile:CarProfile,body:THREE.BufferGeometry,glass:THREE.BufferGeometry):CabinFit{
  body.computeBoundingBox();const bounds=body.boundingBox!,p=glass.getAttribute("position"),n=glass.getAttribute("normal"),uv=glass.getAttribute("uv"),idx=glass.getIndex()!,front=new THREE.Box3(),rear=new THREE.Box3(),point=new THREE.Vector3();
  for(let i=0;i<idx.count;i++){const a=idx.getX(i);if(Math.floor(uv.getX(a)*16)===13)rear.expandByPoint(point.fromBufferAttribute(p,a));}
  for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),part=Math.floor(uv.getX(a)*16);if(part!==12&&(part!==1||n.getZ(a)<.45))continue;
    for(let j=0;j<3;j++)front.expandByPoint(point.fromBufferAttribute(p,idx.getX(i+j)));
  }
  if(front.isEmpty()){front.min.set(-profile.spec.width*.37,bounds.max.y*.62,bounds.max.z*.45);front.max.set(profile.spec.width*.37,bounds.max.y-.08,bounds.max.z*.90);}
  const eye=profile.eye;eye[0]=Math.min(profile.spec.width*.215,front.max.x-.16);eye[1]=Math.max(front.min.y+.08,Math.min(bounds.max.y-.27,front.max.y-.24));eye[2]=front.min.z-Math.max(.30,.88-(front.max.z-front.min.z));profile.spec.eye=eye;
  if(/bus|버스/i.test(profile.spec.label))eye[1]=Math.min(eye[1],front.max.y-.40);
  return {front:front.max.z-.10,frontTop:front.min.z,top:Math.min(bounds.max.y-.025,front.max.y+.09),belt:front.min.y,rear:rear.isEmpty()?Math.max(bounds.min.z+.20,eye[2]-1.35):rear.max.z+.035,width:Math.min(profile.spec.width*.82,(front.max.x-front.min.x)*1.06)};
}
