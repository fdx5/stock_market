import * as THREE from 'three';
import type { Built } from './treeGeometry';

type Attribute = { array: THREE.BufferAttribute['array']; itemSize: number; normalized: boolean };
type Geometry = { attributes: Record<string, Attribute>; index: Attribute | null; sphere: number[] | null };
const parts = ['bark','leaves','farBark','farLeaves','farthestLeaves'] as const;
export type TreeWire = { geometries: Geometry[]; variants: [string, (Omit<Built, typeof parts[number]> & {parts:number[]})[]][] };

export function packTrees(variants:Map<string,Built[]>): {wire:TreeWire;transfer:ArrayBuffer[]} {
  const geometries:Geometry[]=[], ids=new Map<THREE.BufferGeometry,number>(), buffers=new Set<ArrayBuffer>();
  const attribute=(a:THREE.BufferAttribute):Attribute=>{buffers.add(a.array.buffer as ArrayBuffer);return {array:a.array,itemSize:a.itemSize,normalized:a.normalized};};
  const geometry=(g:THREE.BufferGeometry)=>{
    let id=ids.get(g);if(id!==undefined)return id;
    id=geometries.length;ids.set(g,id);
    const attributes:Record<string,Attribute>={};
    for(const [name,a] of Object.entries(g.attributes))attributes[name]=attribute(a as THREE.BufferAttribute);
    const s=g.boundingSphere;
    geometries.push({attributes,index:g.index?attribute(g.index):null,sphere:s?[s.center.x,s.center.y,s.center.z,s.radius]:null});
    return id;
  };
  const entries:TreeWire['variants']=[...variants].map(([name,list])=>[name,list.map(v=>({v:v.v,twig:v.twig,parts:parts.map(p=>geometry(v[p]))}))]);
  return {wire:{geometries,variants:entries},transfer:[...buffers]};
}

export function unpackTrees(wire:TreeWire):Map<string,Built[]> {
  const geometries=wire.geometries.map(data=>{
    const g=new THREE.BufferGeometry();
    for(const [name,a] of Object.entries(data.attributes))g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
    if(data.index)g.setIndex(new THREE.BufferAttribute(data.index.array,data.index.itemSize,data.index.normalized));
    if(data.sphere){const [x,y,z,r]=data.sphere;g.boundingSphere=new THREE.Sphere(new THREE.Vector3(x,y,z),r);}
    return g;
  });
  return new Map(wire.variants.map(([name,list])=>[name,list.map(v=>({v:v.v,twig:v.twig,...Object.fromEntries(parts.map((p,i)=>[p,geometries[v.parts[i]]]))})) as Built[]]));
}
