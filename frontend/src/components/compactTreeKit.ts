import * as THREE from 'three';
import { fetchStatic } from '../staticCdn';
import type { Built, Variant } from './treeGeometry';

interface Part { attributes: Record<string, {offset:number;count:number;size:number}>; index:{offset:number;count:number} }
interface CompactMeta { version:number; species:string[]; parts:Part[]; variants:{v:Variant;twig:boolean;parts:number[]}[] }
const names = ['bark','leaves','farBark','farLeaves','farthestLeaves'] as const;

/** Already clustered and simplified at build time. No runtime decimation, texture
 * baking, or enormous original leaf expansion on the browser's loading path. */
export async function loadCompactTrees() {
  const [meta,bin] = await Promise.all([
    fetchStatic('/3d/trees-compact.json').then(r=>{if(!r.ok)throw Error('compact trees metadata');return r.json() as Promise<CompactMeta>;}),
    fetchStatic('/3d/trees-compact.bin').then(r=>{if(!r.ok)throw Error('compact trees geometry');return r.arrayBuffer();}),
  ]);
  if(meta.version!==1)throw Error('compact trees version');
  const parts = meta.parts.map(p=>{
    const g=new THREE.BufferGeometry();
    for(const [name,a]of Object.entries(p.attributes))g.setAttribute(name,new THREE.BufferAttribute(new Float32Array(bin,a.offset,a.count),a.size));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin,p.index.offset,p.index.count),1));g.computeBoundingSphere();return g;
  });
  const variants=new Map<string,Built[]>();
  for(const item of meta.variants){const built={v:item.v,twig:item.twig,...Object.fromEntries(names.map((name,i)=>[name,parts[item.parts[i]]]))} as Built;
    variants.set(item.v.species,[...(variants.get(item.v.species)??[]),built]);}
  return {species:meta.species,variants};
}
