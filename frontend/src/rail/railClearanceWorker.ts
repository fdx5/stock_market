import {cutBuilding} from './railClearance';
import * as THREE from 'three';
self.onmessage=e=>{
  const {id,input,matrix,clearances}=e.data;
  try{
    const result=cutBuilding(input,matrix,clearances);let bounds;
    if(result){
      const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(result.attributes.position.array,3));
      g.computeBoundingBox();g.computeBoundingSphere();const b=g.boundingBox!,s=g.boundingSphere!;
      bounds={box:[b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z],sphere:[s.center.x,s.center.y,s.center.z,s.radius]};g.dispose();
    }
    self.postMessage({id,result,bounds},result?{transfer:[result.index.buffer,...Object.values(result.attributes).map(a=>a.array.buffer)]}:undefined);
  }
  catch(error){self.postMessage({id,error:String(error)});}
};
