import * as THREE from 'three';
import type {BuildingAppearance} from './buildingAppearance';

type Range={owner:string;first:number;count:number};
export type NearBuildingTarget={x:number;y:number;height:number;ground:number;outline:[number,number][];appearance:BuildingAppearance;hide:()=>void;restore:()=>void};
export type NearBuildingSource={objects:THREE.Object3D[];targets:NearBuildingTarget[];roadGuard?:{key:string;roads:[number,number][][];buildings:[number,number][][]}};
export type NearBuildingEntry={owner:string;height:number;ground:number;outline:[number,number][];appearance:BuildingAppearance};

/** Preserve ownership through a merged draw. A measured replacement must remove
 * all of its coarse walls/roof/trim, while keeping adjacent owners untouched. */
export function mergedBuildingOwners(mesh:THREE.Mesh,parts:THREE.BufferGeometry[]){
  if(!mesh.geometry.index)mesh.geometry.setIndex(Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i));
  let first=0;const ranges:Range[]=[];
  for(const g of parts){const count=g.index?.count??g.attributes.position.count;
    if(g.userData.owner)ranges.push({owner:g.userData.owner,first,count});first+=count;}
  mesh.userData.buildingRanges=ranges;
}

/** Initial buildings enter the same bounded detail workers as streamed tiles.
 * Closures own only ranges in existing shared geometry, never duplicated models.
 * GPU-ready replacement calls hide; leaving the flight restores the overview. */
export function nearBuildingSource(entries:NearBuildingEntry[],objects:THREE.Object3D[]):NearBuildingSource{
  const owners=new Map<string,{geo?:THREE.BufferGeometry;first:number;count:number;mesh?:THREE.InstancedMesh}[]>();
  for(const obj of objects){const mesh=obj as THREE.Mesh;
    for(const r of mesh.userData.buildingRanges??[]){let rows=owners.get(r.owner);if(!rows)owners.set(r.owner,rows=[]);rows.push({geo:mesh.geometry,first:r.first,count:r.count});}
    (mesh.userData.buildingInstances as string[]|undefined)?.forEach((owner,first)=>{let rows=owners.get(owner);if(!rows)owners.set(owner,rows=[]);rows.push({mesh:mesh as THREE.InstancedMesh,first,count:1});});
  }
  const targets:NearBuildingTarget[]=[];
  for(const entry of entries){const rows=owners.get(entry.owner);if(!rows?.length)continue;
    const saved:{row:typeof rows[number];index?:Uint32Array;matrix?:THREE.Matrix4}[]=[];
    const outline=entry.outline,x=outline.reduce((s,p)=>s+p[0],0)/outline.length,y=outline.reduce((s,p)=>s+p[1],0)/outline.length;
    targets.push({...entry,x,y,hide(){
      if(saved.length)return;
      for(const row of rows){if(row.geo?.index){const a=row.geo.index.array; saved.push({row,index:new Uint32Array(a.slice(row.first,row.first+row.count))});a.fill(0,row.first,row.first+row.count);row.geo.index.needsUpdate=true;}
        else if(row.mesh){const matrix=new THREE.Matrix4();row.mesh.getMatrixAt(row.first,matrix);saved.push({row,matrix});row.mesh.setMatrixAt(row.first,new THREE.Matrix4().makeScale(0,0,0));row.mesh.instanceMatrix.needsUpdate=true;}}
    },restore(){for(const {row,index,matrix} of saved){if(index&&row.geo?.index){row.geo.index.array.set(index,row.first);row.geo.index.needsUpdate=true;}else if(matrix&&row.mesh){row.mesh.setMatrixAt(row.first,matrix);row.mesh.instanceMatrix.needsUpdate=true;}}saved.length=0;}});
  }
  return{objects,targets};
}
