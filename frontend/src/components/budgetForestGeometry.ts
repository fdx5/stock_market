import * as THREE from 'three';
import type {Built} from './treeGeometry';
export type BudgetPlant={key:string;matrix:number[];tint:number[];crownTint?:number[];x:number;z:number};
export type ForestPart={position:Float32Array;normal:Float32Array;color:Float32Array;uv:Float32Array;index:Uint32Array};
export type BudgetForest={crowns:ForestPart;flowers:ForestPart;bark:ForestPart};

/** One static geometry per shared material. Texture detail replaces both thousands
 * of tiny cards and hundreds of per-species/per-distance draw submissions. */
export async function assembleBudgetForest(variants:Map<string,Built[]>,plants:BudgetPlant[],center:number[],pause:()=>Promise<void>) {
 const buckets:{crowns:{g:THREE.BufferGeometry;p:BudgetPlant}[];flowers:{g:THREE.BufferGeometry;p:BudgetPlant}[];bark:{g:THREE.BufferGeometry;p:BudgetPlant}[]}={crowns:[],flowers:[],bark:[]};
 for(const p of plants){const[species,k]=p.key.split(':'),v=variants.get(species)![Number(k)];
  const near=Math.hypot(p.x-center[0],p.z-center[1])<110;
  const g=near?v.leaves:v.farthestLeaves;
  buckets[v.twig?'crowns':'flowers'].push({g,p});const trunk=near?v.bark:v.farBark;if(trunk.attributes.position)buckets.bark.push({g:trunk,p});
 }
 const result={} as BudgetForest;
 for(const name of ['crowns','flowers','bark'] as const){
  const parts=buckets[name];let vertices=0,indices=0;
  for(const {g}of parts){vertices+=g.attributes.position.count;indices+=g.index!.count;}
  const position=new Float32Array(vertices*3),normal=new Float32Array(vertices*3),color=new Float32Array(vertices*3),uv=new Float32Array(vertices*2),index=new Uint32Array(indices);
  let vertex=0,offset=0,n=0;const matrix=new THREE.Matrix4(),nm=new THREE.Matrix3(),point=new THREE.Vector3(),nn=new THREE.Vector3();
  for(const{g,p}of parts){
   if(n++%100===0)await pause();matrix.fromArray(p.matrix);nm.getNormalMatrix(matrix);
   const P=g.attributes.position,N=g.attributes.normal,C=g.attributes.color,U=g.attributes.uv;
   const tint=name==='crowns'&&p.crownTint?p.crownTint:p.tint;
   for(let i=0;i<P.count;i++){
    point.fromBufferAttribute(P,i).applyMatrix4(matrix);nn.fromBufferAttribute(N,i).applyMatrix3(nm).normalize();
    position.set([point.x,point.y,point.z],(vertex+i)*3);normal.set([nn.x,nn.y,nn.z],(vertex+i)*3);
    color.set([C.getX(i)*tint[0],C.getY(i)*tint[1],C.getZ(i)*tint[2]],(vertex+i)*3);uv.set([U.getX(i),U.getY(i)],(vertex+i)*2);
   }
   for(let i=0;i<g.index!.count;i++)index[offset+i]=vertex+g.index!.getX(i);
   vertex+=P.count;offset+=g.index!.count;
  }
  result[name]={position,normal,color,uv,index};
 }
 return result;
}

export function forestGeometry(part:ForestPart){
 const g=new THREE.BufferGeometry();for(const[name,size]of [['position',3],['normal',3],['color',3],['uv',2]] as const)g.setAttribute(name,new THREE.BufferAttribute(part[name],size));
 g.setIndex(new THREE.BufferAttribute(part.index,1));g.computeBoundingSphere();return g;
}
