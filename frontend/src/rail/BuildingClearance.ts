import * as THREE from 'three';
import type {Clearance,CutGeometry} from './railClearance';
import {ClearanceIndex} from './clearanceIndex';
import {SceneWorkerPool} from '../components/sceneWorkerPool';
import {frameSlice} from '../components/frameSlice';

type Record={source:THREE.BufferGeometry;cut:THREE.BufferGeometry|null;key:string;version:string;bounds:THREE.Box3;boundsKey:string;retryAt:number};
type Job={mesh:THREE.Mesh;record:Record;key:string;version:string;matrix:string;nearby:Clearance[];distance:number};
export class BuildingClearance {
  readonly stats={checked:0,corrected:0,pending:0,error:'',lastMs:0};
  private pool=new SceneWorkerPool<{input:CutGeometry;matrix:number[];clearances:Clearance[]},{id:number;result:CutGeometry|null;bounds?:{box:number[];sphere:number[]};error?:string}>(()=>new Worker(new URL('./railClearanceWorker.ts',import.meta.url),{type:'module'}),1,30000);
  private stop=new AbortController();
  private records=new Map<THREE.Mesh,Record>();
  private active:Job|null=null;private dead=false;
  private waiting:Job[]=[];private queued=new Set<THREE.Mesh>();
  private index=new ClearanceIndex([]);private key='';
  constructor(private changed:()=>void){}
  private version(g:THREE.BufferGeometry){return [g.index?.version,...Object.values(g.attributes).map(a=>'version' in a?a.version:a.data.version)].join(':');}
  update(roots:THREE.Object3D[],clearances:Clearance[],key:string,eye:THREE.Vector3){
    if(this.dead)return;
    if(key!==this.key){this.key=key;this.index=new ClearanceIndex(clearances);this.waiting=[];this.queued.clear();}
    const seen=new Set<THREE.Mesh>();
    const visit=(o:THREE.Object3D,building=false)=>{
      building ||= !!o.userData.railBuilding;
      const mesh=o as THREE.Mesh;
      if(building&&mesh.isMesh&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&mesh.geometry.getAttribute('position')&&!mesh.geometry.morphAttributes.position?.length){
        seen.add(mesh);let r=this.records.get(mesh);
        if(!r||mesh.geometry!==r.source&&mesh.geometry!==r.cut){r?.cut?.dispose();r={source:mesh.geometry,cut:null,key:'',version:'',bounds:new THREE.Box3(),boundsKey:'',retryAt:0};this.records.set(mesh,r);}
        const version=this.version(r.source);
        if((r.key!==this.key||r.version!==version)&&!this.queued.has(mesh)&&this.active?.mesh!==mesh&&performance.now()>=r.retryAt){
          mesh.updateWorldMatrix(true,false);const matrix=mesh.matrixWorld.elements.join(',');
          const position=r.source.getAttribute('position');
          const boundsKey=String('version' in position?position.version:position.data.version)+':'+matrix;
          if(r.boundsKey!==boundsKey){
            // New surveyed geometry already carries worker-computed bounds. Only
            // changed positions require another scan; a world transform does not.
            if(!r.source.boundingBox||r.boundsKey&&!r.boundsKey.startsWith(boundsKey.split(':')[0]+':'))r.source.computeBoundingBox();
            r.bounds.copy(r.source.boundingBox!).applyMatrix4(mesh.matrixWorld);r.boundsKey=boundsKey;
          }
          const nearby=this.index.query(r.bounds);
          if(!nearby.length){
            // Negative results must also be remembered. Previously every unrelated
            // building rescanned every track, every 750ms, allocating a vector per test.
            if(r.cut){mesh.geometry=r.source;r.cut.dispose();r.cut=null;this.changed();}
            r.key=this.key;r.version=version;
          }else{
            const distance=r.bounds.distanceToPoint(eye);
            if(distance<2200){this.waiting.push({mesh,record:r,key:this.key,version,matrix,nearby,distance});this.queued.add(mesh);}
          }
        }
      }
      for(const c of o.children)visit(c,building);
    };
    roots.forEach(o=>visit(o));
    for(const[mesh,r]of this.records)if(!seen.has(mesh)){if(mesh.geometry===r.cut)mesh.geometry=r.source;r.cut?.dispose();this.records.delete(mesh);}
    this.waiting.sort((a,b)=>a.distance-b.distance);
    this.stats.corrected=[...this.records.values()].filter(r=>r.cut).length;this.stats.pending=this.waiting.length+(this.active?1:0);void this.pump();
  }
  private async pump(){
    if(this.dead||this.active)return;
    let job=this.waiting.shift();if(job)this.queued.delete(job.mesh);
    while(job&&(!job.mesh.parent||job.key!==this.key||this.records.get(job.mesh)!==job.record)){job=this.waiting.shift();if(job)this.queued.delete(job.mesh);}if(!job)return;
    this.active=job;
    const {mesh,record,key}=job,g=record.source,at=performance.now();
    try{
      const attributes:CutGeometry['attributes']={};
      for(const[k,a]of Object.entries(g.attributes)){
        const array=new Float32Array(a.count*a.itemSize);
        // Typed bulk copies in bounded chunks instead of millions of getComponent
        // calls in one render tick. Normalised/interleaved inputs keep their semantics.
        for(let start=0;start<a.count;){
          if(this.dead||!mesh.parent||key!==this.key)return;
          const end=Math.min(a.count,start+8192);
          if(a instanceof THREE.BufferAttribute&&!a.normalized)array.set(a.array.subarray(start*a.itemSize,end*a.itemSize),start*a.itemSize);
          else for(let i=start;i<end;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.getComponent(i,j);
          start=end;await frameSlice(4);
        }
        attributes[k]={array,size:a.itemSize};
      }
      const index=new Uint32Array(g.index?.count??g.getAttribute('position').count);
      for(let start=0;start<index.length;start+=32768){
        if(this.dead||!mesh.parent||key!==this.key)return;
        const end=Math.min(index.length,start+32768);
        if(g.index)index.set(g.index.array.subarray(start,end),start);else for(let i=start;i<end;i++)index[i]=i;
        await frameSlice(4);
      }
      const input:CutGeometry={attributes,index,groups:g.groups.map(x=>({start:x.start,count:x.count,materialIndex:x.materialIndex??0}))};
      const result=await this.pool.run({input,matrix:Array.from(mesh.matrixWorld.elements),clearances:job.nearby},this.stop.signal,[input.index.buffer,...Object.values(attributes).map(a=>a.array.buffer)]);
      if(!result||result.error){record.retryAt=performance.now()+5000;this.stats.error=result?.error??'Rail clearance worker unavailable';return;}
      if(this.dead||!mesh.parent||key!==this.key||this.records.get(mesh)!==record||job.version!==this.version(g)||job.matrix!==mesh.matrixWorld.elements.join(','))return;
      const a=result.result;record.cut?.dispose();record.cut=null;
      if(a){const cut=new THREE.BufferGeometry();for(const[k,v]of Object.entries(a.attributes))cut.setAttribute(k,new THREE.BufferAttribute(v.array,v.size));cut.setIndex(new THREE.BufferAttribute(a.index,1));for(const group of a.groups)cut.addGroup(group.start,group.count,group.materialIndex);const b=result.bounds!;cut.boundingBox=new THREE.Box3(new THREE.Vector3(...b.box.slice(0,3)),new THREE.Vector3(...b.box.slice(3,6)));cut.boundingSphere=new THREE.Sphere(new THREE.Vector3(...b.sphere.slice(0,3)),b.sphere[3]);record.cut=cut;mesh.geometry=cut;}
      else mesh.geometry=g;
      record.key=key;record.version=job.version;this.stats.checked++;this.stats.lastMs=performance.now()-at;this.changed();
    }catch{record.retryAt=performance.now()+5000;this.stats.error='Rail clearance preparation failed';}
    finally{this.active=null;void this.pump();}
  }
  dispose(){this.dead=true;this.stop.abort();this.pool.dispose();for(const[mesh,r]of this.records){if(mesh.geometry===r.cut)mesh.geometry=r.source;r.cut?.dispose();}this.records.clear();this.waiting=[];this.queued.clear();this.active=null;}
}
