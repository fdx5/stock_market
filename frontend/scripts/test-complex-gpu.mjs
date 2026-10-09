// Buffer regression checks without a browser/GPU. Run: node scripts/test-complex-gpu.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, Scene, Mesh, MeshBasicMaterial, PerspectiveCamera, Sphere, Vector3 } from 'three';
import { GPU } from '../src/vendor/tidewater/engine/gpu/GPU.js';
import { MeshRenderer } from '../src/vendor/tidewater/engine/render/MeshRenderer.js';
import { stripUnusedFunctions } from '../src/vendor/tidewater/engine/gpu/Shader.js';
import { BoundedCache } from '../src/vendor/tidewater/engine/gpu/BoundedCache.js';
import { UniformBlock } from '../src/vendor/tidewater/engine/gpu/Uniforms.js';
import { execFileSync } from 'node:child_process';

test('dirty draw uploads match all legacy GPU bytes through motion, velocity resets, parameters and buffer growth',()=>{
 const saved={frame:GPU.frame,device:GPU.device,queue:GPU.queue,onSubmit:GPU.onSubmit};
 const {writes}=mockGPU();const submits=[];GPU.onSubmit=fn=>submits.push(fn);
 const previous=execFileSync('git',['show','8311d04:frontend/src/vendor/tidewater/engine/render/MeshRenderer.js'],{encoding:'utf8'});
 const stride=256;
 const oldSlot=Function('GPU','DRAW_STRIDE','return function '+previous.match(/_slot\( obj \) \{[\s\S]*?\n\t\}/)[0])(GPU,stride);
 const oldBegin=Function('GPU','DRAW_STRIDE','return function '+previous.match(/_beginFrame\(\) \{[\s\S]*?\n\t\}/)[0])(GPU,stride);
 const old=new MeshRenderer(),next=new MeshRenderer();
 const objects=()=>Array.from({length:50},(_,id)=>({id,worldTransformVersion:0,matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,id,0,0,1]}}));
 const before=objects(),after=objects();let oldBytes=0,newBytes=0;
 for(const r of [old,next]){r.bundles=true;r.capacity=128;r._ensureDrawBuffer=function(){if(this.drawData?.byteLength>=this.capacity*stride)return;this.drawBuffer=GPU.device.createBuffer({size:this.capacity*stride});this.drawData=new Float32Array(this.capacity*stride/4);};}
 old._slot=oldSlot;old._beginFrame=oldBegin;next.dirtyDrawUploads=true;
 try{
  for(let frame=1;frame<=330;frame++){
   GPU.frame=frame;
   for(const list of [before,after]){
    const o=list[5];if(frame%11===0){o.matrixWorld.elements[12]+=.01;o.worldTransformVersion++;}
    o.resetVelocity=frame%29===0;o.staticVelocity=frame%40<10;
    if(frame%7===0)o.drawParams=frame%21===0?[.25,undefined,null]:[frame,1,2,3,4,5,6];
    if(frame%13===0)o.drawParams=undefined;
   }
   if(frame===150)for(const r of [old,next])r.capacity*=2;
   for(const [r,list]of [[old,before],[next,after]]){
    const start=writes.length;r._beginFrame();
    for(const o of list)if(!(o.id===0&&frame>20&&frame<300))r._slot(o);
    submits.shift()();const bytes=writes.slice(start).reduce((n,w)=>n+w.size,0);if(r===old)oldBytes+=bytes;else newBytes+=bytes;
   }
   assert.equal(Buffer.compare(Buffer.from(next.drawBuffer.data),Buffer.from(old.drawBuffer.data)),0,`GPU uniform bytes at frame ${frame}`);
  }
  assert.ok(newBytes<oldBytes*.15,`uploaded ${newBytes}/${oldBytes} bytes`);
 }finally{Object.assign(GPU,saved);}
});

test('managed static bounds are reused and invalidate for transforms, edited spheres and replaced geometry',()=>{
 const saved=GPU.frame,r=new MeshRenderer(),scene=new Scene(),camera=new PerspectiveCamera(60,1,.1,100);
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3));geometry.boundingSphere=new Sphere(new Vector3(),2);
 const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.position.z=-10;mesh.worldTransformVersion=0;scene.add(mesh);scene.updateMatrixWorld();
 try{
  GPU.frame=1;r.collect(scene,{camera});let copies=0;const cache=mesh.__worldSphere,apply=cache.sphere.applyMatrix4.bind(cache.sphere);cache.sphere.applyMatrix4=m=>{copies++;return apply(m);};
  for(let i=0;i<30;i++){GPU.frame++;assert.equal(r.collect(scene,{camera}).opaque.length,1);}
  assert.equal(copies,0);
  mesh.position.x=100;mesh.worldTransformVersion++;GPU.frame++;assert.equal(r.collect(scene,{camera}).opaque.length,0);assert.equal(copies,1);
  geometry.boundingSphere.radius=200;GPU.frame++;assert.equal(r.collect(scene,{camera}).opaque.length,1);assert.equal(copies,2);
  geometry.boundingSphere.center.x=12;GPU.frame++;r.collect(scene,{camera});assert.equal(copies,3);
  geometry.boundingSphere=new Sphere(new Vector3(),1);GPU.frame++;assert.equal(r.collect(scene,{camera}).opaque.length,0);assert.equal(copies,4);
  mesh.worldTransformVersion=undefined;mesh.position.x=0;GPU.frame++;assert.equal(r.collect(scene,{camera}).opaque.length,1);assert.equal(copies,5);
 }finally{GPU.frame=saved;geometry.dispose();mesh.material.dispose();}
});

test('stable bundle chunks preserve draw commands and avoid rebuilding an entire culled run',()=>{
 const savedDevice=GPU.device,savedFrame=GPU.frame;
 const pipeline={},group={},group0={},buffer={},geometry={attributes:{position:{count:3}},instanceCount:1};
 let encoded=0;
 const recorder=()=>({draws:[],offset:0,setPipeline(){},setBindGroup(i,g,offset){if(i===2)this.offset=offset[0];},setVertexBuffer(){},draw(count,instances,start){encoded++;this.draws.push([this.offset,count,instances,start]);},finish(){return {draws:this.draws};}});
 GPU.device={createRenderBundleEncoder:recorder};
 try{
  const run=(chunked,size=32)=>{
   GPU.frame=100;const r=new MeshRenderer();r.bundles=true;r.bundleChunking=chunked;r.bundleChunkSize=size;r.drawBindGroup={};
   r._pipeline=()=>({handle:{pipeline},bindings:{getBindGroup:()=>group}});r._slot=o=>o.id;
   const items=Array.from({length:180},(_,id)=>{const o={id,__bsI:1,__bsS:0,__bsC:3,__bundleShapeAt:0};return {object:o,geometry,material:{id:1},start:0,count:3};});
   const warm=()=>{for(const it of items)it.object.__frameRow={frame:GPU.frame,material:it.material,geo:geometry,owner:r,vbs:[buffer],vl:{},index:null};};
   const render=list=>{warm();const rp=recorder();rp.executeBundles=bs=>{for(const b of bs)rp.draws.push(...b.draws);};r.drawItems(rp,list,{group0,passKey:'color',colorFormats:['rgba16float'],depthFormat:'depth32float'},'opaque');return rp.draws;};
   const initial=render(items);GPU.frame++;encoded=0;
   const culled=render(items.filter(it=>it.object.id!==5));const built=encoded;
   GPU.frame++;encoded=0;assert.deepEqual(render(items.filter(it=>it.object.id!==5)),culled);assert.equal(encoded,0);
   return {initial,culled,built};
  };
  const old=run(false),next=run(true);assert.deepEqual(next.initial,old.initial);assert.deepEqual(next.culled,old.culled);
  assert.equal(old.built,179);assert.ok(next.built<=64,`rebuilt ${next.built} draws after one cull`);
  const atomic=run(true,1);assert.deepEqual(atomic.initial,old.initial);assert.deepEqual(atomic.culled,old.culled);assert.equal(atomic.built,0);
 }finally{GPU.device=savedDevice;GPU.frame=savedFrame;}
});

test('empty native instance batches skip culling while populated, compiling and callback-driven meshes stay visible',()=>{
 const r=new MeshRenderer(),object={visible:true,isMesh:true,isInstancedMesh:true,count:0,worldTransformVersion:0,layers:{mask:1},children:[],geometry:{attributes:{},drawRange:{start:0,count:3}},material:{id:7,visible:true},matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-10,1]}};
 const scene={visible:true,children:[object],updateMatrixWorld(){}};
 assert.equal(r.collect(scene,{cull:false}).opaque.length,0);
 object.count=1;assert.equal(r.collect(scene,{cull:false}).opaque.length,1);
 object.count=0;r.precompiling=true;assert.equal(r.collect(scene,{cull:false}).opaque.length,1);
 r.precompiling=false;object.onBeforeRender=()=>{object.count=1;};assert.equal(r.collect(scene,{cull:false}).opaque.length,1);assert.equal(object.count,1);
});

test('per-object bundle references invalidate every GPU input and draw range',()=>{
 const savedDevice=GPU.device,savedFrame=GPU.frame;let builds=0;
 GPU.device={createRenderBundleEncoder(){builds++;return {setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},draw(){},drawIndexed(){},finish(){return {};}};}};
 try{
  GPU.frame=100;const r=new MeshRenderer();r.bundles=true;r.bundleChunking=true;r.bundleChunkSize=1;r.drawBindGroup={};
  let pipeline={},group={},vbs=[{}],index=null,offset=0;
  const geo={attributes:{position:{count:6}},instanceCount:1},o={id:0},material={},it={object:o,geometry:geo,material,start:0,count:6},pass={group0:{},passKey:'color',colorFormats:['rgba16float']};
  r._pipeline=()=>({handle:{pipeline},bindings:{getBindGroup:()=>group}});r._slot=()=>offset;
  const draw=()=>{o.__frameRow={frame:GPU.frame,material,geo,owner:r,vbs,vl:{},index};o.__bsI=geo.instanceCount;o.__bsS=it.start;o.__bsC=it.count;o.__bundleShapeAt=0;r.drawItems({executeBundles(){},setBindGroup(){}},[it],pass,'opaque');GPU.frame++;};
  draw();assert.equal(builds,1);draw();assert.equal(builds,1);
  for(const change of [()=>pass.group0={},()=>r.drawBindGroup={},()=>pipeline={},()=>group={},()=>offset++,()=>geo.instanceCount++,()=>it.start++,()=>it.count--,()=>vbs[0]={},()=>vbs.push({}),()=>geo.attributes.position.count++,()=>{index={buffer:{},format:'uint16'};geo.index={count:6};},()=>index.buffer={},()=>index.format='uint32',()=>geo.index.count++]){
   const before=builds;change();draw();assert.equal(builds,before+1);draw();assert.equal(builds,before+1);
  }
 }finally{GPU.device=savedDevice;GPU.frame=savedFrame;}
});

test('material replacement waits for both colour and shadow pipelines without synchronous compilation',()=>{
 const r=new MeshRenderer(),passes=[],handles=[{pipeline:{}},{pipeline:null}],object={geometry:{}},material={};
 r._cachedLayout=(o,g,m)=>{assert.equal(o,object);assert.equal(m,material);return {};};
 r._pipeline=(m,vl,p)=>{passes.push(p);return {handle:handles[p.kind==='color'?0:1]};};
 const descriptors=[{kind:'color',colorFormats:['rgba16float'],depthFormat:'depth32float'},{kind:'depth',depthFormat:'depth32float',depthCompare:'less-equal',depthBias:2,depthBiasSlopeScale:1.5}];
 assert.equal(r.materialReady(object,material,descriptors),false);
 assert.equal(passes[0].passKey,'color.0.rgba16float.depth32float.greater-equal..');
 handles[1].pipeline={};assert.equal(r.materialReady(object,material,descriptors),true);
 handles[1].failed=true;assert.throws(()=>r.materialReady(object,material,descriptors),/Replacement pipeline failed/);
});

test('stable material epochs pack once across passes and invalidate before the next view frame', () => {
  const savedDevice=GPU.device,savedQueue=GPU.queue;
  let writes=0,packs=0;
  GPU.device={createBuffer:()=>({destroy(){}})};
  GPU.queue={writeBuffer:()=>writes++};
  globalThis.GPUBufferUsage ??= {UNIFORM:1,STORAGE:2,COPY_DST:4};
  try {
    const block=new UniformBlock('Test',{wet:['f32',0]});
    const pack=block._pack.bind(block);block._pack=()=>{packs++;pack()};
    block.uploadEpoch=1;block.upload(10);block.upload(11);block.upload(12);
    assert.equal(packs,1);assert.equal(writes,1);
    block.set('wet',.75);block.uploadEpoch=2;block.upload(12);
    assert.equal(packs,2);assert.equal(writes,2);assert.equal(block.f32[0],.75);
    block.uploadEpoch=undefined;block.set('wet',.5);block.upload(13);block.upload(14);
    assert.equal(packs,4);assert.equal(writes,3);assert.equal(block.f32[0],.5);
  } finally {GPU.device=savedDevice;GPU.queue=savedQueue;}
});

test('native scratch lists remain separate within a frame and reuse items across frames', () => {
  const renderer = new MeshRenderer(); renderer.reuseDrawLists = true;
  const object = {visible:true,isMesh:true,layers:{mask:1},children:[],renderOrder:0,
    geometry:{attributes:{},drawRange:{start:0,count:3}},material:{id:7,visible:true},
    matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,1,2,3,1]}};
  const scene = {visible:true,children:[object],updateMatrixWorld(){}};
  const saved = GPU.frame;
  try {
    GPU.frame=100;
    const first=renderer.collect(scene,{cull:false}), item=first.opaque[0];
    const second=renderer.collect(scene,{cull:false});
    assert.notEqual(first.opaque,second.opaque);assert.notEqual(item,second.opaque[0]);
    GPU.frame++;object.renderOrder=5;object.geometry.drawRange.start=1;
    const next=renderer.collect(scene,{cull:false});
    assert.equal(next.opaque[0],item);assert.equal(item.renderOrder,5);assert.equal(item.start,1);
    renderer.retainGeometry([object]);assert.equal(renderer._collectPools.length,0);
    renderer.dispose();assert.equal(renderer._collectPools.length,0);
  } finally {GPU.frame=saved;}
});

test('first-frame readiness includes asynchronous shader preparation and driver compilation', async () => {
  let prepare, compile, syncCalls = 0;
  const saved = GPU.device;
  GPU.device = { createRenderPipelineAsync: () => new Promise(resolve => compile = resolve), createRenderPipeline: () => { syncCalls++; } };
  const h = GPU.deferredPipeline(new Promise(resolve => prepare = resolve), 'prepared');
  let ready = false; const done = GPU.pipelinesReady().then(() => ready = true);
  assert.equal(GPU.ready(h), null); assert.equal(syncCalls, 0);
  prepare(GPU.renderPipeline({ label: 'driver' }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ready, false);
  const pipeline = {}; compile(pipeline); await done;
  assert.equal(h.pipeline, pipeline); assert.equal(h.preparing, false); assert.equal(GPU._pending.size, 0);
  GPU.device = saved;
});

test('cache eviction respects memory budgets and retains recently reused pipelines', () => {
  const c = new BoundedCache(2, 40);
  c.set('first', 'aaaa'); c.set('second', 'bb');
  assert.equal(c.get('first'), 'aaaa');
  c.set('third', 'cccc');
  assert.ok(c.has('first')); assert.ok(!c.has('second'));
  assert.ok(c.bytes <= 40);
  c.set('oversized', 'x'.repeat(100));
  assert.ok(!c.has('oversized')); assert.equal(c.size, 2);
  c.delete('first'); c.clear();
  assert.equal(c.bytes, 0); assert.equal(c.size, 0);
});

test('retiring a material releases only its pipeline bindings', () => {
  const r = new MeshRenderer();
  r.pipelines.set('7.color', {old: true}); r.pipelines.set('7.depth', {old: true});
  r.pipelines.set('70.color', {live: true});
  r.forgetMaterial({id: 7});
  assert.deepEqual([...r.pipelines.keys()], ['70.color']);
});

test('shader pruning retains transitive resources, aliases and annotated entry points', () => {
  const code = `enable f16;
    diagnostic(off, derivative_uniformity);
    struct Params { value: vec4f, }
    alias Color = vec4f;
    @group(1) @binding(0) var<uniform> live: Params;
    @group(1) @binding(1) var unused: texture_2d<f32>;
    const factor = 2.0;
    fn read() -> Color { return live.value * factor; }
    fn dead() -> vec4f { return textureLoad(unused, vec2i(0), 0); }
    @vertex fn vs() -> @builtin(position) vec4f { return read(); }
    @fragment fn fs() -> @location(0) vec4f { return read(); }`;
  const lean = stripUnusedFunctions(code);
  for (const name of ['Params', 'Color', 'live', 'factor', 'read', 'vs', 'fs']) assert.match(lean, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(lean, /\b(dead|unused)\b/);
  assert.match(lean, /enable f16/);
  assert.match(lean, /diagnostic\(off, derivative_uniformity\)/);
  assert.equal(stripUnusedFunctions(code), lean);
});

test('depth pruning removes fragment-only declarations without editing the vertex program', () => {
  const vertex = '@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0.0); }';
  const lean = stripUnusedFunctions(`struct Surface { color: vec4f, } fn surface() -> Surface { return Surface(vec4f(1.0)); } ${vertex}`);
  assert.ok(lean.includes(vertex));
  assert.doesNotMatch(lean, /\b(Surface|surface)\b/);
});

function mockGPU() {
  const writes = [], buffers = [];
  globalThis.GPUBufferUsage = { VERTEX: 1, COPY_DST: 2 };
  GPU.device = { createBuffer({ size }) {
    const b = { data: new ArrayBuffer(size), destroyed: 0, destroy() { this.destroyed++; } };
    buffers.push(b);
    return b;
  } };
  GPU.queue = { writeBuffer(buffer, offset, data, start = 0, size = data.byteLength - start) {
    assert.equal(buffer.destroyed, 0);
    new Uint8Array(buffer.data).set(new Uint8Array(data, start, size), offset);
    writes.push({ offset, start, size });
  } };
  return { writes, buffers };
}

test('partial instance uploads preserve unchanged values and consume pending ranges', () => {
  const { writes } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new InstancedBufferAttribute(Float32Array.from({ length: 64 }, (_, i) => i), 16);
  attr.addUpdateRange(16, 16); // first upload must still initialize all instances
  const b = r._attributeBuffer(g, attr);
  assert.equal(writes[0].size, 256);
  assert.equal(attr.updateRanges.length, 0);
  r._attributeBuffer(g, attr);
  assert.equal(writes.length, 1);
  attr.array.fill(42, 16, 32);
  attr.addUpdateRange(16, 16); attr.needsUpdate = true;
  r._attributeBuffer(g, attr);
  assert.deepEqual(writes[1], { offset: 64, start: 64, size: 64 });
  assert.deepEqual(new Float32Array(b.data), attr.array);
  assert.equal(attr.updateRanges.length, 0);
  // A replacement array of the same size/version cannot reuse old GPU contents.
  attr.array = new Float32Array(64).fill(7);
  r._attributeBuffer(g, attr);
  assert.equal(writes[2].size, 256);
  assert.deepEqual(new Float32Array(b.data), attr.array);
  r.dispose();
});

test('a growing instance buffer gets a full upload even with a dirty range', () => {
  const { writes } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new InstancedBufferAttribute(new Float32Array(16).fill(1), 16);
  const old = r._attributeBuffer(g, attr);
  attr.array = new Float32Array(64).fill(3);
  attr.addUpdateRange(48, 16); attr.needsUpdate = true;
  const current = r._attributeBuffer(g, attr);
  assert.equal(old.destroyed, 1);
  assert.equal(writes.at(-1).size, 256);
  assert.deepEqual(new Float32Array(current.data), attr.array);
  r.dispose();
});

test('switching meshes frees old instance buffers while retaining shared geometry', () => {
  const { buffers } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const position = new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3);
  g.setAttribute('position', position);
  const a = { geometry:g, isInstancedMesh:true, instanceMatrix:new InstancedBufferAttribute(new Float32Array(16),16) };
  const b = { ...a, instanceMatrix:new InstancedBufferAttribute(new Float32Array(32),16) };
  const vertices = r._attributeBuffer(g,position);
  const old = r._attributeBuffer(g,a.instanceMatrix);
  const current = r._attributeBuffer(g,b.instanceMatrix);
  r.retainGeometry([b]);
  assert.equal(old.destroyed,1);
  assert.equal(vertices.destroyed,0);
  assert.equal(current.destroyed,0);
  assert.equal(r.geometries.get(g).buffers.size,2);
  r.retainGeometry([]);
  assert.equal(r.geometries.size,0);
  assert.equal(g._listeners.dispose.length,0);
  assert.equal(g.attributes.position,position); // reusable CPU asset survives
  r.dispose(); g.dispose();
  assert.ok(buffers.every(b=>b.destroyed===1));
});

test('renderer disposal detaches geometry listeners and is safe to repeat', () => {
  const { buffers } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new Float32BufferAttribute([1,2,3],3);
  r._attributeBuffer(g,attr);
  r.dispose(); r.dispose(); g.dispose();
  assert.equal(r.geometries.size,0);
  assert.equal(g._listeners.dispose.length,0);
  assert.ok(buffers.every(b=>b.destroyed===1));
});
