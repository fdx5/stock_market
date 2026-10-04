import * as THREE from 'three';
import type {Terrain} from './sceneTerrain';
import {rng} from './complexScene';
import {frameSlice} from './frameSlice';

/** Six curved blades per tuft, merged once. No alpha overdraw, textures or shadow pass. */
export async function meadowGeometry(points:[number,number][],terrain:Terrain,seed:number){
 const random=rng(seed+719),positions:number[]=[],colours:number[]=[];
 let sliceAt=performance.now();
 for(let i=0;i<points.length;i++){
  if(i%80===0&&performance.now()-sliceAt>=3){await frameSlice(12);sliceAt=performance.now();}const[x,y]=points[i],floor=terrain.at(x,y)+.025;
  for(let b=0;b<6;b++){
   const a=random()*Math.PI*2,height=.18+random()*.23,width=.018+random()*.018,bend=.04+random()*.09;
   const dx=Math.cos(a),dz=Math.sin(a),bx=x+(random()-.5)*.25,bz=-y+(random()-.5)*.25;
   const verts=[[bx-dz*width,floor,bz+dx*width],[bx+dz*width,floor,bz-dx*width],[bx+dx*bend,floor+height,bz+dz*bend]];
   const shade=.8+random()*.3;
   for(let k=0;k<3;k++){positions.push(...verts[k]);colours.push(.12*shade,.3*shade+(k===2?.1:0),.085*shade);}
  }
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.computeVertexNormals();geo.computeBoundingSphere();return geo;
}
