import * as THREE from 'three';
import type {Clearance,CutGeometry} from './railClearance';

type Record={source:THREE.BufferGeometry;cut:THREE.BufferGeometry|null;key:string;version:string};
export class BuildingClearance {
  readonly stats={checked:0,corrected:0,pending:0,error:'',lastMs:0};
  private worker=new Worker(new URL('./railClearanceWorker.ts',import.meta.url),{type:'module'});
  private records=new Map<THREE.Mesh,Record>();
  private active:{id:number;mesh:THREE.Mesh;record:Record;version:string;key:string;at:number}|null=null;
  private serial=0;private dead=false;
  private waiting:{mesh:THREE.Mesh;record:Record;key:string}[]=[];
  private clearances:Clearance[]=[];private key='';
  constructor(private changed:()=>void){
    this.worker.onmessage=e=>{
      const job=this.active;if(!job||job.id!==e.data.id)return;this.active=null;
      if(e.data.error)this.stats.error=e.data.error;
      else if(!this.dead&&job.mesh.parent&&job.key===this.key&&job.version===this.version(job.record.source)){
        const a=e.data.result as CutGeometry|null;
        job.record.cut?.dispose();job.record.cut=null;
        if(a){const g=new THREE.BufferGeometry();for(const[k,v]of Object.entries(a.attributes))g.setAttribute(k,new THREE.BufferAttribute(v.array,v.size));g.setIndex(new THREE.BufferAttribute(a.index,1));for(const group of a.groups)g.addGroup(group.start,group.count,group.materialIndex);g.computeBoundingSphere();job.record.cut=g;job.mesh.geometry=g;}
        else job.mesh.geometry=job.record.source;
        job.record.key=job.key;job.record.version=job.version;this.stats.checked++;this.stats.lastMs=performance.now()-job.at;this.changed();
      }this.pump();
    };
    this.worker.onerror=()=>{this.stats.error='건물 통과 공간 처리 실패';this.active=null;this.waiting=[];};
  }
  private version(g:THREE.BufferGeometry){return [g.index?.version,...Object.values(g.attributes).map(a=>'version' in a?a.version:a.data.version)].join(':');}
  update(roots:THREE.Object3D[],clearances:Clearance[],key:string,eye:THREE.Vector3){
    if(this.dead)return;
    if(key!==this.key){this.key=key;this.clearances=clearances;this.waiting=[];}
    const seen=new Set<THREE.Mesh>();
    const visit=(o:THREE.Object3D,building=false)=>{
      building ||= !!o.userData.railBuilding;
      const mesh=o as THREE.Mesh;
      if(building&&mesh.isMesh&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&mesh.geometry.getAttribute('position')&&!mesh.geometry.morphAttributes.position?.length){
        seen.add(mesh);let r=this.records.get(mesh);
        if(!r||mesh.geometry!==r.source&&mesh.geometry!==r.cut){r?.cut?.dispose();r={source:mesh.geometry,cut:null,key:'',version:''};this.records.set(mesh,r);}
        if((r.key!==this.key||r.version!==this.version(r.source))&&!this.waiting.some(j=>j.mesh===mesh)&&this.active?.mesh!==mesh){
          mesh.updateWorldMatrix(true,false);r.source.computeBoundingSphere();const sphere=r.source.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
          if(sphere.center.distanceTo(eye)-sphere.radius<2200&&this.clearances.some(c=>{const mid=new THREE.Vector3((c.a[0]+c.b[0])/2,(c.a[1]+c.b[1])/2+2,(c.a[2]+c.b[2])/2);return mid.distanceTo(sphere.center)<sphere.radius+Math.hypot(c.a[0]-c.b[0],c.a[2]-c.b[2])/2+7;}))this.waiting.push({mesh,record:r,key:this.key});
          else if(r.cut){mesh.geometry=r.source;r.cut.dispose();r.cut=null;r.key=this.key;r.version=this.version(r.source);}
        }
      }
      for(const c of o.children)visit(c,building);
    };
    roots.forEach(o=>visit(o));
    for(const[mesh,r]of this.records)if(!seen.has(mesh)){if(mesh.geometry===r.cut)mesh.geometry=r.source;r.cut?.dispose();this.records.delete(mesh);}
    this.stats.corrected=[...this.records.values()].filter(r=>r.cut).length;this.stats.pending=this.waiting.length+(this.active?1:0);this.pump();
  }
  private pump(){
    if(this.dead||this.active)return;let job=this.waiting.shift();while(job&&(!job.mesh.parent||job.key!==this.key))job=this.waiting.shift();if(!job)return;
    const {mesh,record,key}=job,g=record.source,attributes:CutGeometry['attributes']={};
    for(const[k,a]of Object.entries(g.attributes)){const array=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.getComponent(i,j);attributes[k]={array,size:a.itemSize};}
    const input:CutGeometry={attributes,index:g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:g.getAttribute('position').count},(_,i)=>i),groups:g.groups.map(x=>({start:x.start,count:x.count,materialIndex:x.materialIndex??0}))};
    const id=++this.serial,version=this.version(g);this.active={id,mesh,record,key,version,at:performance.now()};
    this.worker.postMessage({id,input,matrix:Array.from(mesh.matrixWorld.elements),clearances:this.clearances},[input.index.buffer,...Object.values(attributes).map(a=>a.array.buffer)]);
  }
  dispose(){this.dead=true;this.worker.terminate();for(const[mesh,r]of this.records){if(mesh.geometry===r.cut)mesh.geometry=r.source;r.cut?.dispose();}this.records.clear();this.waiting=[];this.active=null;}
}
