import * as THREE from 'three';
import {excludeSurface} from './surfaceExclusion';
import {packRings,type PackedRings} from './nearBuildingTargets';
type Ring=[number,number][];

export type StreetArrays={position:Float32Array;normal:Float32Array;index:Uint32Array;level?:Float32Array;color?:Float32Array};
export type TileStreetsArgs={surface:StreetArrays|null;marks:StreetArrays|null;marksFar:StreetArrays|null;walks:StreetArrays|null;buildings:Ring[]};
/** ground: the ground asphalt's triangles, packed (thousands of little arrays were a long clone on the page) */
export type TileStreetsResult={surface:StreetArrays|null;marks:StreetArrays|null;marksFar:StreetArrays|null;walks:StreetArrays|null;ground:PackedRings};

/** A streamed tile's street surfaces with its buildings' footprints taken out — the asphalt, both
 * lane paints, and the sidewalks also off the asphalt laid on the ground — and that ground asphalt's
 * triangles (the guard for the measured buildings that replace the coarse ones later). One job: in
 * the scene worker it is the whole of it (tileStreetSurfaces.ts), on the page in slices. */
export async function cutTileStreets(a:TileStreetsArgs,pace:()=>Promise<boolean>):Promise<TileStreetsResult|null>{
 const cut=async(s:StreetArrays|null,rings:Ring[]):Promise<StreetArrays|null>=>{
  if(!s)return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(s.position,3));g.setAttribute('normal',new THREE.BufferAttribute(s.normal,3));
  if(s.color)g.setAttribute('color',new THREE.BufferAttribute(s.color,3));
  if(s.level)g.setAttribute('roadLevel',new THREE.BufferAttribute(s.level,1));
  g.setIndex(new THREE.BufferAttribute(s.index,1));
  await excludeSurface(g,rings,pace,true);
  const position=g.getAttribute('position').array as Float32Array,out:StreetArrays={position,normal:g.getAttribute('normal').array as Float32Array,
   index:g.index?new Uint32Array(g.index.array):Uint32Array.from({length:position.length/3},(_,i)=>i)};
  if(s.color)out.color=g.getAttribute('color').array as Float32Array;
  if(s.level)out.level=g.getAttribute('roadLevel').array as Float32Array;
  g.dispose();
  return out;
 };
 const surface=await cut(a.surface,a.buildings);
 if(!await pace())return null;
 const ground:Ring[]=[],p=surface?.position,idx=surface?.index,levels=surface?.level;
 if(p&&idx)for(let k=0;k<idx.length;k+=3){
  if(k%1536===0&&!await pace())return null;
  if(levels?.[idx[k]])continue;
  ground.push([0,1,2].map(i=>[p[idx[k+i]*3],p[idx[k+i]*3+1]] as [number,number]));
 }
 const marks=await cut(a.marks,a.buildings),marksFar=await cut(a.marksFar,a.buildings);
 const walks=await cut(a.walks,[...a.buildings,...ground]);
 if(!await pace())return null;
 return {surface,marks,marksFar,walks,ground:packRings(ground)};
}

/** Each array's own buffer, to hand over rather than copy (each once: a shared buffer is copied). */
export function streetTransfer(sets:(StreetArrays|null)[]):Transferable[]{
 const seen=new Set<ArrayBufferLike>(),out:Transferable[]=[];
 for(const s of sets)if(s)for(const v of [s.position,s.normal,s.index,s.level,s.color])if(v&&v.byteOffset===0&&v.byteLength===v.buffer.byteLength&&!seen.has(v.buffer)&&Object.prototype.toString.call(v.buffer)==='[object ArrayBuffer]'){seen.add(v.buffer);out.push(v.buffer);}
 return out;
}
