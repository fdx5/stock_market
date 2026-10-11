import * as THREE from 'three';
import type {SurveyPart} from './droneSurveyWorker';

/** Append measured geometry without cloning/reuploading the preceding batches.
 * Capacity grows geometrically, with at most 4 MiB per ordinary chunk. A single
 * larger source model is retained intact in its own exact-sized chunk. */
const CHUNK_BYTES=4*1024*1024;
export type SurveyGeometryEntry={geo:THREE.BufferGeometry;spans:Uint32Array;material:number;vertices:number;indices:number;vertexCapacity:number;indexCapacity:number};
export class SurveyGeometryStore{
 readonly entries:SurveyGeometryEntry[]=[];
 private active=new Map<string,SurveyGeometryEntry>();
 private disposed=false;
 append(parts:readonly SurveyPart[]){
  if(this.disposed)throw new Error('Survey geometry store is disposed');
  const active=new Map(this.active),length=this.entries.length,newEntries:SurveyGeometryEntry[]=[],touched=new Set<SurveyGeometryEntry>();
  const saved=new Map<SurveyGeometryEntry,{vertices:number;indices:number;spans:Uint32Array;box:THREE.Box3;sphere:THREE.Sphere}>();
  const paints:{geo:THREE.BufferGeometry;spans:Uint32Array}[]=[];
  for(const p of parts){
   const key=p.material+':'+!!p.uv+':'+!!p.facade,nv=p.position.length/3,ni=p.index.length;
   const floats=9+(p.uv?2:0)+(p.facade?4:0);
   let e=this.active.get(key);
   if(e&&(e.vertices+nv)*floats*4+(e.indices+ni)*4>CHUNK_BYTES)e=undefined;
   if(!e){e={geo:new THREE.BufferGeometry(),spans:new Uint32Array(),material:p.material,vertices:0,indices:0,vertexCapacity:0,indexCapacity:0};e.geo.userData.surveyMaterial=p.material;this.entries.push(e);newEntries.push(e);this.active.set(key,e);}
   else if(!saved.has(e))saved.set(e,{vertices:e.vertices,indices:e.indices,spans:e.spans,box:e.geo.boundingBox!.clone(),sphere:e.geo.boundingSphere!.clone()});
   const v=e.vertices,i=e.indices,totalV=v+nv,totalI=i+ni;
   if(totalV>e.vertexCapacity||totalI>e.indexCapacity){
    // Reserve 25%, rather than doubling every CPU/GPU attribute. Dense moving
    // scenes retain many chunks; unused capacity must not crowd out the actual
    // ahead models or cause GC/driver stalls. Every source vertex stays intact.
    const scale=Math.min(1.25,CHUNK_BYTES/Math.max(1,totalV*floats*4+totalI*4));
    const vc=Math.max(totalV,Math.floor(totalV*scale)),ic=Math.max(totalI,Math.floor(totalI*scale));
    for(const [name,size,src] of [['position',3,p.position],['normal',3,p.normal],['color',3,p.color],['uv',2,p.uv],['facade',4,p.facade]] as const){
     if(!src)continue;const previous=e.geo.getAttribute(name),array=new Float32Array(vc*size);
     if(previous)array.set((previous.array as Float32Array).subarray(0,v*size));
     e.geo.setAttribute(name,new THREE.BufferAttribute(array,size));
    }
    const index=new Uint32Array(ic);if(e.geo.index)index.set((e.geo.index.array as Uint32Array).subarray(0,i));
    e.geo.setIndex(new THREE.BufferAttribute(index,1));e.vertexCapacity=vc;e.indexCapacity=ic;
   }
   for(const [name,size,src] of [['position',3,p.position],['normal',3,p.normal],['color',3,p.color],['uv',2,p.uv],['facade',4,p.facade]] as const){
    if(!src)continue;const a=e.geo.getAttribute(name) as THREE.BufferAttribute;(a.array as Float32Array).set(src,v*size);a.addUpdateRange(v*size,src.length);a.needsUpdate=true;
   }
   const index=e.geo.index!;for(let k=0;k<ni;k++)index.array[i+k]=p.index[k]+v;index.addUpdateRange(i,ni);index.needsUpdate=true;
   const added=p.paintSpans.slice();for(let k=2;k<added.length;k+=5)added[k]+=v;
   const spans=new Uint32Array(e.spans.length+added.length);spans.set(e.spans);spans.set(added,e.spans.length);e.spans=spans;
   e.vertices=totalV;e.indices=totalI;e.geo.setDrawRange(0,totalI);
   const box=new THREE.Box3(new THREE.Vector3(...p.box.slice(0,3) as [number,number,number]),new THREE.Vector3(...p.box.slice(3) as [number,number,number]));
   if(e.geo.boundingBox)e.geo.boundingBox.union(box);else e.geo.boundingBox=box;
   e.geo.boundingSphere=e.geo.boundingBox.getBoundingSphere(new THREE.Sphere());touched.add(e);paints.push({geo:e.geo,spans:added});
  }
  let settled=false;
  return{newEntries,touched:[...touched],paints,commit:()=>{settled=true;},rollback:()=>{
   if(settled||this.disposed)return;settled=true;
   for(const [e,s]of saved){e.vertices=s.vertices;e.indices=s.indices;e.spans=s.spans;e.geo.setDrawRange(0,s.indices);e.geo.boundingBox=s.box;e.geo.boundingSphere=s.sphere;}
   for(const e of newEntries)e.geo.dispose();this.entries.length=length;this.active=active;
  }};
 }
 dispose(){if(this.disposed)return;this.disposed=true;for(const e of this.entries)e.geo.dispose();this.entries.length=0;this.active.clear();}
}
