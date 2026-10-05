import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import {createHash}from'node:crypto';import vm from'node:vm';import {transformSync}from'esbuild';import * as THREE from'three';
function load(name,extra={}){const scope={module:{exports:{}},exports:{},THREE,Float32Array,Float64Array,Uint16Array,Uint32Array,AbortController,onSceneMemoryRelease:()=>{},hybridSceneEnabled:()=>true,...extra};vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;}
const {neighbourArrays}=load('neighbourGeometry.ts'),{neighbourWasmArrays}=load('neighbourWasm.ts'),{forestCells,updateForestLod}=load('spatialForest.ts'),{flushInstanceAttribute}=load('instanceDirty.ts');
const binary=readFileSync(new URL('../src/wasm/scene-geometry/scene_geometry.wasm',import.meta.url));
const {InstanceBatch}=load('instanceWasm.ts');

test('photo workers release pending analysis and late downloads cannot reopen them',async()=>{
 let release,download,workers=[];
 class FakeWorker{constructor(){workers.push(this);}postMessage(){}terminate(){this.closed=true;}}
 const {photoColours}=load('vworld3d.ts',{onSceneMemoryRelease:fn=>{release=fn;},URL:class{},Worker:FakeWorker,vworldToken:async()=>'',sharedVworldBytes:()=>new Promise(done=>{download=done;})});
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0],2));geometry.setIndex([0]);
 const ph=()=>({src:{img:'test',x:0,y:0},geometry});
 const first=photoColours('',ph());await new Promise(setImmediate);download(new ArrayBuffer(0));await new Promise(setImmediate);assert.equal(workers.length,1);release();assert.equal(await first,null);assert.ok(workers[0].closed);
 const late=photoColours('',ph());await new Promise(setImmediate);release();download(new ArrayBuffer(0));assert.equal(await late,null);assert.equal(workers.length,1);geometry.dispose();
});
test('last-view release terminates texture worker and closes orphan late bitmaps',async()=>{
 let release,worker;
 class FakeWorker{constructor(){worker=this;}postMessage(m){this.msg=m;}terminate(){this.closed=(this.closed??0)+1;}}
 const {paintedTexture}=load('paintedTexture.ts',{onSceneMemoryRelease:fn=>{release=fn;},URL:class{},Worker:FakeWorker,OffscreenCanvas:class{},document:{createElement:()=>({getContext:()=>({})})},paintAsphalt:()=>{}});
 const pending=paintedTexture('asphalt',16);release();const texture=await pending;assert.equal(worker.closed,1);texture.dispose();
 let closed=0;worker.onmessage({data:{id:worker.msg.id,bitmap:{close(){closed++;}}}});assert.equal(closed,1);
});
test('bulk WASM matrices match Three.js for slopes, hiding, non-uniform scale and reused batches',async()=>{
 const {instance}=await WebAssembly.instantiate(binary,{}),batch=new InstanceBatch(1200,instance.exports),js=new InstanceBatch(1200),target=new Float32Array(1200*16),control=new Float32Array(target.length);
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),qx=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),across=new THREE.Vector3(1,0,0);
 for(let frame=0;frame<3;frame++){
  for(let i=0;i<1200;i++){const args=[i,i*.31,-i*.017,frame-i*.11,i*.037,Math.sin(i+frame)*6, i%11===0?0:1.2,i%11===0?0:2.3,i%11===0?0:.7];batch.set(...args);js.set(...args);
   const [,x,y,z,yaw,pitch,sx,sy,sz]=args;q.setFromAxisAngle(up,yaw).multiply(qx.setFromAxisAngle(across,pitch));m.compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3(sx,sy,sz));control.set(m.elements,i*16);}
  batch.compose(target);for(let i=0;i<target.length;i++)assert.ok(Math.abs(target[i]-control[i])<=2e-6,`element ${i}: ${target[i]} vs ${control[i]}`);
  const fallback=new Float32Array(target.length);js.compose(fallback);for(let i=0;i<target.length;i++)assert.equal(fallback[i]===control[i],true);
 }
 const memory=instance.exports.memory.buffer.byteLength;for(let i=0;i<100;i++)batch.compose(target);assert.equal(instance.exports.memory.buffer.byteLength,memory);
 batch.dispose();batch.dispose();assert.throws(()=>batch.compose(target),/disposed/);js.dispose();
});
test('geometry WASM manifest matches source and binary',()=>{const m=JSON.parse(readFileSync(new URL('../src/wasm/scene-geometry/build.json',import.meta.url),'utf8')),hash=v=>createHash('sha256').update(v).digest('hex');assert.equal(hash(binary),m.wasmSha256);assert.equal(hash(readFileSync(new URL('../wasm/scene-geometry/src/lib.rs',import.meta.url),'utf8').replace(/\r\n/g,'\n')),m.sourceSha256);});
test('WASM batch retains roof holes, winding, colours, UVs and exact float geometry',async()=>{
 const rings=[[[0,0],[13,0],[13,9],[0,9]],[[2,2],[2,5],[4,5],[4,2]]];const jobs=Array.from({length:80},(_,i)=>({building:{rings:i%2?rings:rings.map(r=>[...r].reverse()),base:i%3?0:2,height:17+i,floors:i%7+1},ground:i*.123,floorM:2.9,color:[.1,.25,.75]}));
 const {instance}=await WebAssembly.instantiate(binary,{}),out=await neighbourWasmArrays(jobs,instance.exports);
 out.forEach((a,i)=>{const b=neighbourArrays(jobs[i]);for(const name of ['position','normal','uv','color','index'])assert.deepEqual(Array.from(a[name]),Array.from(b[name]));});
});
test('instance writes skip identical final poses and retain unconsumed dirty ranges',()=>{
 const a=new THREE.InstancedBufferAttribute(new Float32Array(160),16);flushInstanceAttribute(a,4);const v=a.version;a.clearUpdateRanges();flushInstanceAttribute(a,4);assert.equal(a.version,v);a.array[17]=1;flushInstanceAttribute(a,4);assert.deepEqual(a.updateRanges,[{start:17,count:1}]);a.array[55]=2;flushInstanceAttribute(a,4);assert.deepEqual(a.updateRanges,[{start:17,count:39}]);a.clearUpdateRanges();a.array[145]=3;flushInstanceAttribute(a,4);const v2=a.version;flushInstanceAttribute(a,10);assert.equal(a.version,v2+1);assert.deepEqual(a.updateRanges,[{start:145,count:1}]);
});
test('quadtree partition retains all transforms/colours and bounds every LOD',()=>{
 const geo=new THREE.BoxGeometry(3,15,3),levels=[geo,new THREE.BoxGeometry(5,16,5),new THREE.BoxGeometry(6,17,6)],source=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial(),500),m=new THREE.Matrix4();
 for(let i=0;i<500;i++){source.setMatrixAt(i,m.makeTranslation(i%25*25,0,Math.floor(i/25)*25));source.setColorAt(i,new THREE.Color(i/500,.5,1));}
 const cells=forestCells(source,120,128,levels);assert.equal(cells.reduce((s,c)=>s+c.count,0),500);assert.ok(cells.length>4);let at=[];
 for(const c of cells){for(let i=0;i<c.count;i++){c.getMatrixAt(i,m);at.push(m.elements[12]+':'+m.elements[14]);for(const g of levels){g.computeBoundingBox();const box=g.boundingBox.clone().applyMatrix4(m);for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])assert.ok(c.boundingSphere.containsPoint(new THREE.Vector3(x,y,z)));}}}
 assert.equal(new Set(at).size,500);const cam=new THREE.PerspectiveCamera();cam.position.set(2000,0,2000);cam.updateMatrixWorld();updateForestLod(cells[0],cam);assert.equal(cells[0].geometry,levels[2]);cam.position.copy(cells[0].boundingSphere.center);cam.updateMatrixWorld();updateForestLod(cells[0],cam);assert.equal(cells[0].geometry,levels[0]);
 cells.forEach(c=>c.dispose());source.dispose();levels.forEach(g=>g.dispose());source.material.dispose();
});
