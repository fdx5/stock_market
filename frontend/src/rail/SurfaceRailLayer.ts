import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {BUDGET,RAIL_ROOT,STRIDE,neededCorridors,makeRun,samplePath,coachPose,trainAt,hashPhase,type RailManifest,type RailLine,type RailCorridor,type RailPath,type RailRun,type RailFacility} from './railCore';
import {trainKit} from './trainKit';
import {BuildingClearance} from './BuildingClearance';
import {stationKit} from './stationKit';
import type {Clearance} from './railClearance';
import {setInstanceMatrix} from '../components/instanceDirty';

type Geometry={bed:Float32Array;steel:Float32Array;ties:Float32Array;piers:Float32Array;wire:Float32Array;poles:Float32Array};
type Entry={source:RailCorridor;path:RailPath;line:RailLine;run:RailRun;group:THREE.Group;dispose:()=>void;built:{x:number;y:number};groundKey:string;ties:THREE.InstancedMesh;tieData:Float32Array};
interface Options { origin:{lon:number;lat:number}; heightAt:(x:number,y:number)=>number; buildings?:()=>THREE.Object3D[]; radius?:number; onChange?:()=>void }

/** Bounded static assets, two concurrent reads, one geometry worker, shared instanced
 * train models. No application API/DB, IndexedDB or live Overpass calls at runtime. */
export class SurfaceRailLayer {
  readonly group=new THREE.Group();
  readonly stats={requests:0,bytes:0,cacheHits:0,corridors:0,trains:0,cars:0,workerMs:0,updateMs:0,error:'',estimatedElevations:true};
  private manifest:RailManifest|null=null;
  private worker:Worker|null=null;
  private stop=new AbortController();
  private entries=new Map<string,Entry>();
  private cache=new Map<string,RailCorridor>();
  private inflight=new Set<string>();
  private wanted=new Set<string>();
  private retryAt=new Map<string,number>();
  private labels=new Map<string,{sprite:THREE.Sprite;owners:Map<string,THREE.Vector3>}>();
  private jobs:{id:number;source:RailCorridor;eye:{x:number;y:number};at:number;groundKey?:string}[]=[];
  private running:typeof this.jobs[number]|null=null;
  private serial=0;private dead=false;private syncAt=-1;private detailAt=-1;
  private eye={x:0,y:0};
  private clearance:BuildingClearance|null=null;private revision=0;private clearanceAt=-1;
  private prismRevision=-1;private prisms:Clearance[]=[];
  private stations=new Map<string,{owners:Map<string,{facility:RailFacility;path:RailPath}>;model:ReturnType<typeof stationKit>|null}>();
  private kits=new Map<string,{kit:ReturnType<typeof trainKit>;cab:THREE.InstancedMesh;car:THREE.InstancedMesh;far:THREE.InstancedMesh}>();
  private dummy=new THREE.Object3D();private point={x:0,y:0,h:0,dx:1,dy:0,grade:0};
  private front={x:0,y:0,h:0,dx:1,dy:0,grade:0};private back={x:0,y:0,h:0,dx:1,dy:0,grade:0};
  private bedMat=new THREE.MeshStandardMaterial({color:0x68716f,roughness:1,side:THREE.DoubleSide});
  private railMat=new THREE.MeshStandardMaterial({color:0xa3afb5,metalness:.75,roughness:.35,side:THREE.DoubleSide});
  private tieMat=new THREE.MeshStandardMaterial({color:0x9eaaa2,roughness:.95});
  private pierMat=new THREE.MeshStandardMaterial({color:0xa5b0ad,roughness:.9});
  private tieGeo=new THREE.BoxGeometry(2.4,.15,.23);
  private pierGeo=new THREE.BoxGeometry(1.15,7.65,1.15);
  private poleGeo:THREE.BufferGeometry;
  constructor(private o:Options){
    const stem=new THREE.CylinderGeometry(.07,.1,5.7,6).toNonIndexed(),arm=new THREE.BoxGeometry(2.8,.06,.06).translate(-1.35,2.4,0).toNonIndexed();
    this.poleGeo=mergeGeometries([stem,arm])!;stem.dispose();arm.dispose();
    this.group.name='Surface rail · simulated traffic · estimated elevations';
    this.clearance=new BuildingClearance(()=>this.o.onChange?.());
    void this.init();
  }
  private async init(){
    try{
      const r=await fetch(`${RAIL_ROOT}/manifest.json`,{signal:this.stop.signal});if(!r.ok)throw new Error(`rail catalog ${r.status}`);
      this.manifest=await r.json();if(this.dead)return;
      if(this.manifest?.version!==1)throw new Error('Unsupported rail asset version');
      this.worker=new Worker(new URL('./railWorker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=e=>this.built(e.data);
      this.worker.onerror=()=>{this.stats.error='선로 처리 실패';this.jobs=[];this.running=null;this.worker?.terminate();this.worker=null;};
      this.syncAt=-1;this.o.onChange?.();
    }catch(e){if(!this.dead)this.stats.error=String(e);}
  }
  private async fetchCorridor(id:string){
    this.inflight.add(id);
    try{
      let c=this.cache.get(id);
      if(c){this.stats.cacheHits++;this.cache.delete(id);this.cache.set(id,c);}
      else{
        const r=await fetch(`${RAIL_ROOT}/corridors/${id}.json`,{signal:this.stop.signal});this.stats.requests++;
        if(!r.ok)throw new Error(`rail asset ${r.status}`);const raw=await r.text();this.stats.bytes+=new TextEncoder().encode(raw).length;c=JSON.parse(raw) as RailCorridor;
        if(this.dead)return;this.cache.set(id,c);
        while(this.cache.size>BUDGET.cache)this.cache.delete(this.cache.keys().next().value!);
      }
      if(this.dead||!this.wanted.has(id))return;
      this.jobs.push({id:++this.serial,source:c,eye:{...this.eye},at:performance.now()});this.pump();
    }catch(e){if(!this.dead){this.stats.error=String(e);this.retryAt.set(id,performance.now()+30000);}}
    finally{this.inflight.delete(id);}
  }
  private pump(){
    if(this.dead||this.running||!this.worker)return;
    let job=this.jobs.shift();while(job&&!this.wanted.has(job.source.id))job=this.jobs.shift();if(!job)return;
    const line=this.manifest!.lines.find(l=>l.id===job!.source.line);if(!line)return;
    const kx=111320*Math.cos(this.o.origin.lat*Math.PI/180);
    const ground=job.source.points.map(p=>this.o.heightAt((p[0]-this.o.origin.lon)*kx,(p[1]-this.o.origin.lat)*110540));
    // Geometry must cover the next rebuild interval AND the complete consist.
    // A visible rear coach cannot outrun the prepared bed at a streaming boundary.
    const radius=Math.max(this.o.radius??BUDGET.radius,BUDGET.farDistance+line.cars*(line.carLength+.6)/2+80)+500;
    const dense:number[]=[];
    for(let i=1;i<job.source.points.length;i++){const a=job.source.points[i-1],b=job.source.points[i],dx=(b[0]-a[0])*kx,dy=(b[1]-a[1])*110540,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/5));for(let k=0;k<n;k++){const t=k/n,x=(a[0]-this.o.origin.lon)*kx+dx*t,y=(a[1]-this.o.origin.lat)*110540+dy*t;dense.push(Math.hypot(x-job.eye.x,y-job.eye.y)<radius+20?this.o.heightAt(x,y):NaN);}}
    const end=job.source.points[job.source.points.length-1];dense.push(this.o.heightAt((end[0]-this.o.origin.lon)*kx,(end[1]-this.o.origin.lat)*110540));
    job.groundKey=this.groundKey(job.source,job.eye);const denseGround=new Float32Array(dense);
    this.running=job;this.worker.postMessage({id:job.id,corridor:job.source,origin:this.o.origin,ground,denseGround,line,eye:job.eye,radius},[denseGround.buffer]);
  }
  private built(data:{id:number;path:RailPath;geometry:Geometry;error?:string}){
    const job=this.running;if(!job||job.id!==data.id)return;this.running=null;
    if(data.error)this.stats.error=data.error;
    else if(!this.dead&&this.wanted.has(job.source.id)){
      const line=this.manifest!.lines.find(l=>l.id===job.source.line)!;
      const old=this.entries.get(data.path.id);old?.dispose();
      const entry=this.makeEntry(job.source,data.path,data.geometry,line,job.eye);
      entry.groundKey=job.groundKey??'';
      this.entries.set(entry.path.id,entry);this.group.add(entry.group);
      this.revision++;
      this.stats.workerMs=performance.now()-job.at;this.stats.corridors=this.entries.size;this.detailAt=-1;this.o.onChange?.();
    }
    this.pump();
  }
  private makeEntry(source:RailCorridor,path:RailPath,geo:Geometry,line:RailLine,built:{x:number;y:number}):Entry{
    const group=new THREE.Group(),geometries:THREE.BufferGeometry[]=[],instances:THREE.InstancedMesh[]=[];
    const mesh=(p:Float32Array,m:THREE.Material)=>{if(!p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.computeVertexNormals();geometries.push(g);group.add(new THREE.Mesh(g,m));};
    mesh(geo.bed,this.bedMat);mesh(geo.steel,this.railMat);mesh(geo.wire,this.railMat);
    const ties=new THREE.InstancedMesh(this.tieGeo,this.tieMat,geo.ties.length/4);ties.count=0;ties.frustumCulled=false;group.add(ties);instances.push(ties);
    const piers=new THREE.InstancedMesh(this.pierGeo,this.pierMat,geo.piers.length/3);
    for(let i=0;i<geo.piers.length;i+=3){const x=geo.piers[i],z=geo.piers[i+2],top=geo.piers[i+1]+3.65,bottom=this.o.heightAt(x,-z),height=Math.max(.2,top-bottom);this.dummy.position.set(x,(top+bottom)/2,z);this.dummy.rotation.set(0,0,0);this.dummy.scale.set(1,height/7.65,1);this.dummy.updateMatrix();piers.setMatrixAt(i/3,this.dummy.matrix);}this.dummy.scale.set(1,1,1);piers.computeBoundingSphere();group.add(piers);instances.push(piers);
    const poles=new THREE.InstancedMesh(this.poleGeo,this.railMat,geo.poles.length/4);
    for(let i=0;i<geo.poles.length;i+=4){this.dummy.position.set(geo.poles[i],geo.poles[i+1],geo.poles[i+2]);this.dummy.rotation.set(0,geo.poles[i+3],0);this.dummy.updateMatrix();poles.setMatrixAt(i/4,this.dummy.matrix);}poles.computeBoundingSphere();group.add(poles);instances.push(poles);
    const labelKeys:string[]=[];
    for(const facility of source.facilities??[]){let station=this.stations.get(facility.id);if(!station){station={owners:new Map(),model:null};this.stations.set(facility.id,station);}station.owners.set(path.id,{facility,path});this.placeStation(station);}
    for(const stop of path.stops){
      if(stop.name==='역')continue;
      const key=line.id+':'+stop.name,p=samplePath(path,stop.d),position=new THREE.Vector3(p.x,p.h+8,-p.y);labelKeys.push(key);
      let label=this.labels.get(key);
      if(!label){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.stationLabel(stop.name,line.colour),depthTest:true,transparent:true}));sprite.scale.set(12,3,1);label={sprite,owners:new Map()};this.labels.set(key,label);this.group.add(sprite);}
      label.owners.set(path.id,position);this.placeLabel(label);
    }
    return {source,path,line,run:makeRun(path,line),group,built,groundKey:'',ties,tieData:geo.ties,dispose:()=>{
      group.removeFromParent();geometries.forEach(g=>g.dispose());instances.forEach(i=>i.dispose());
      for(const f of source.facilities??[]){const station=this.stations.get(f.id);if(!station)continue;station.owners.delete(path.id);station.model?.dispose();station.model=null;if(!station.owners.size)this.stations.delete(f.id);else this.placeStation(station);}
      for(const key of labelKeys){const label=this.labels.get(key);if(!label)continue;label.owners.delete(path.id);
        if(!label.owners.size){label.sprite.removeFromParent();label.sprite.material.map?.dispose();label.sprite.material.dispose();this.labels.delete(key);}else this.placeLabel(label);
      }
    }};
  }
  private groundKey(source:RailCorridor,eye:{x:number;y:number}){
    const kx=111320*Math.cos(this.o.origin.lat*Math.PI/180);let h=2166136261;
    for(const p of source.points){const x=(p[0]-this.o.origin.lon)*kx,y=(p[1]-this.o.origin.lat)*110540;if(Math.hypot(x-eye.x,y-eye.y)>2600)continue;h=Math.imul(h^Math.round(this.o.heightAt(x,y)*10),16777619);}
    return String(h);
  }
  private placeStation(station:{owners:Map<string,{facility:RailFacility;path:RailPath}>;model:ReturnType<typeof stationKit>|null}){
    station.model?.dispose();const owner=station.owners.values().next().value;if(!owner)return;
    station.model=null;const kx=111320*Math.cos(this.o.origin.lat*Math.PI/180),points=owner.facility.points;
    const x=(points.reduce((s,p)=>s+p[0],0)/points.length-this.o.origin.lon)*kx,y=(points.reduce((s,p)=>s+p[1],0)/points.length-this.o.origin.lat)*110540;
    if(Math.hypot(x-this.eye.x,y-this.eye.y)>2400)return;
    station.model=stationKit(owner.facility,owner.path,this.o.origin,this.o.heightAt);this.group.add(station.model.group);
  }
  private placeLabel(label:{sprite:THREE.Sprite;owners:Map<string,THREE.Vector3>}){
    label.sprite.position.set(0,0,0);for(const p of label.owners.values())label.sprite.position.add(p);label.sprite.position.multiplyScalar(1/label.owners.size);
  }
  private stationLabel(name:string,colour:string){
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=96;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#f3f7f5';ctx.fillRect(0,0,384,96);ctx.fillStyle=colour;ctx.fillRect(0,78,384,18);ctx.fillStyle='#1a2931';ctx.font='bold 44px Malgun Gothic, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,192,42,354);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
  }
  private kit(line:RailLine){
    let k=this.kits.get(line.id);if(k)return k;
    const kit=trainKit(line),capacity=BUDGET.trains*line.cars;
    const meshes=Object.fromEntries(Object.entries(kit.geometries).map(([name,g])=>{
      const mesh=new THREE.InstancedMesh(g,kit.material,capacity);mesh.name=`train-${name}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(mesh);return[name,mesh];
    })) as unknown as {cab:THREE.InstancedMesh;car:THREE.InstancedMesh;far:THREE.InstancedMesh};
    k={kit,...meshes};this.kits.set(line.id,k);return k;
  }
  update(time:number,camera:THREE.Vector3){
    if(this.dead||document.hidden)return;
    const t0=performance.now();this.eye={x:camera.x,y:-camera.z};
    if(this.manifest&&time-this.syncAt>.6){
      this.syncAt=time;const radius=this.o.radius??BUDGET.radius,kx=111320*Math.cos(this.o.origin.lat*Math.PI/180);
      const longest=Math.max(...this.manifest.lines.map(l=>l.cars*(l.carLength+.6)/2));
      this.wanted=new Set(neededCorridors(this.manifest,this.o.origin.lon+camera.x/kx,this.o.origin.lat-camera.z/110540,Math.max(radius,BUDGET.farDistance+longest+80)));
      for(const[id,e]of this.entries)if(!this.wanted.has(id)){e.dispose();this.entries.delete(id);this.revision++;}
      for(const id of this.wanted){
        if(this.inflight.size>=BUDGET.parallel)break;
        const entry=this.entries.get(id),queued=this.jobs.some(j=>j.source.id===id)||this.running?.source.id===id;
        if(!this.inflight.has(id)&&!queued&&(this.retryAt.get(id)??0)<performance.now()&&(!entry||Math.hypot(this.eye.x-entry.built.x,this.eye.y-entry.built.y)>450||entry.groundKey!==this.groundKey(entry.source,entry.built)))void this.fetchCorridor(id);
      }
      const usedLines=new Set([...this.entries.values()].map(e=>e.line.id));
      for(const[id,k]of this.kits)if(!usedLines.has(id)){k.cab.removeFromParent();k.car.removeFromParent();k.far.removeFromParent();k.cab.dispose();k.car.dispose();k.far.dispose();k.kit.dispose();this.kits.delete(id);}
      this.stats.corridors=this.entries.size;
      for(const station of this.stations.values()){
        const owner=station.owners.values().next().value;if(!owner)continue;const p=samplePath(owner.path,owner.facility.d);
        const near=Math.hypot(p.x-this.eye.x,p.y-this.eye.y)<2200;
        if(near&&!station.model)this.placeStation(station);
        else if(!near&&station.model){station.model.dispose();station.model=null;}
      }
    }
    const detailed=time-this.detailAt>.4;if(detailed)this.detailAt=time;
    for(const k of this.kits.values())for(const name of ['cab','car','far'] as const)k[name].count=0;
    const candidates:{e:Entry;i:number;d:number;distance:number}[]=[];
    for(const e of this.entries.values()){
      if(detailed){
        const v=e.tieData;let count=0;
        for(let i=0;i<v.length;i+=4)if(Math.hypot(v[i]-camera.x,v[i+2]-camera.z)<BUDGET.detailDistance){
          this.dummy.position.set(v[i],v[i+1],v[i+2]);this.dummy.rotation.set(0,v[i+3],0);this.dummy.updateMatrix();setInstanceMatrix(e.ties,count++,this.dummy.matrix);
        }
        e.ties.count=count;e.ties.instanceMatrix.needsUpdate=true;
      }
      for(let i=0;i<e.run.count;i++){
        const d=trainAt(e.run,time+hashPhase(e.path.id),i).d;
        if(d<-e.run.trainLength/2||d>e.path.length+e.run.trainLength/2)continue;
        const p=samplePath(e.path,d,this.point),distance=Math.hypot(p.x-camera.x,p.y+camera.z,p.h-camera.y);
        if(distance<BUDGET.farDistance)candidates.push({e,i,d,distance});
      }
    }
    if(detailed)for(const label of this.labels.values())label.sprite.visible=label.sprite.position.distanceTo(camera)<900;
    candidates.sort((a,b)=>a.distance-b.distance);this.stats.trains=0;this.stats.cars=0;
    for(const {e,d,distance}of candidates.slice(0,BUDGET.trains)){
      const k=this.kit(e.line);this.stats.trains++;
      for(let i=0;i<e.line.cars;i++){
        const s=d+((e.line.cars-1)/2-i)*(e.line.carLength+.6);
        if(s<0||s>e.path.length)continue; // cars enter/leave a tunnel individually
        const cab=i===0||i===e.line.cars-1;
        const mesh=distance<BUDGET.detailDistance?(cab?k.cab:k.car):k.far;
        const pose=coachPose(e.path,s,e.line.carLength,cab&&i>0&&i===e.line.cars-1,e.line.mode==='monorail'?-.16:e.line.mode==='agt'?.055:.065);
        this.dummy.position.set(pose.x,pose.h,pose.z);this.dummy.rotation.set(pose.pitch,pose.heading,0,'YXZ');
        this.dummy.updateMatrix();setInstanceMatrix(mesh,mesh.count++,this.dummy.matrix);this.stats.cars++;
      }
    }
    for(const k of this.kits.values())for(const name of ['cab','car','far'] as const){k[name].visible=k[name].count>0;if(k[name].count)k[name].instanceMatrix.needsUpdate=true;}
    if(this.clearance&&time-this.clearanceAt>.75){
      this.clearanceAt=time;
      this.clearance.update([...(this.o.buildings?.()??[]),...[...this.stations.values()].flatMap(s=>s.model?[s.model.group]:[])],this.clearancePrisms(),String(this.revision),camera);
    }
    this.stats.updateMs=performance.now()-t0;
  }
  /** Track paths are immutable between entry revisions. Reuse their exact
   * clearance volumes instead of allocating them during every animation scan. */
  private clearancePrisms(){
    if(this.prismRevision===this.revision)return this.prisms;
    const clearances:Clearance[]=[];
    for(const e of this.entries.values()){const v=e.path.points;for(let i=STRIDE;i<v.length;i+=STRIDE){const a=[v[i-STRIDE],v[i-STRIDE+2],-v[i-STRIDE+1]],b=[v[i],v[i+2],-v[i+1]];clearances.push({a,b,half:e.line.width/2+.25,bottom:-.3,top:5.6});}}
    this.prismRevision=this.revision;return this.prisms=clearances;
  }
  /** Read-only diagnostics for the local review and numerical regression checks. */
  inspect(){return{...this.stats,stations:[...this.stations.values()].filter(s=>s.model?.group.children.length).length,clearance:this.clearance?.stats,cache:this.cache.size,inflight:this.inflight.size,queued:this.jobs.length,paths:[...this.entries.values()].map(e=>({id:e.path.id,line:e.line.name,lineId:e.line.id,mode:e.line.mode,cars:e.line.cars,vehicle:e.line.vehicle,length:e.path.length,stops:e.path.stops.length,trains:e.run.count}))};}
  dispose(){
    this.dead=true;this.stop.abort();this.worker?.terminate();this.clearance?.dispose();this.jobs=[];this.running=null;
    this.entries.forEach(e=>e.dispose());this.entries.clear();this.cache.clear();this.prisms=[];
    for(const k of this.kits.values()){k.cab.dispose();k.car.dispose();k.far.dispose();k.kit.dispose();}this.kits.clear();
    this.group.removeFromParent();for(const r of [this.bedMat,this.railMat,this.tieMat,this.pierMat,this.tieGeo,this.pierGeo,this.poleGeo])r.dispose();
  }
}
