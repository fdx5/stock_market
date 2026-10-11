import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production sync method without a GPU or application API.
const source=readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js',import.meta.url),'utf8');
const begin=source.indexOf('  sync(source, camera) {');
const end=source.indexOf('  /** The materials of a model taken off the scene:',begin);
assert.ok(begin>=0&&end>begin);
function fixture(count=17,materialCost=0){
  let clock=0,nextClock=0;
  class Mesh{
    constructor(geometry,material){this.geometry=geometry;this.material=material;this.matrix={copy(){}};}
  }
  const sync=vm.runInNewContext('({'+source.slice(begin,end)+'}).sync',{
    Mesh,performance:{now:()=>clock},sourceMaterialsMatch:()=>true,sameMatrix:()=>true,
    boundTextures:()=>new Set(),updateForestLod:()=>{},READY_COLOUR_PASSES:[],READY_CASTER_PASSES:[],
  });
  const material={userData:{}},nativeMaterial={source:material};
  const objects=Array.from({length:count},()=>({isMesh:true,material,geometry:{},matrixWorld:{},count:1,castShadow:false,userData:{}}));
  const retained=[];
  const adapter={shown:true,frameNo:1,meshes:new Map(),materials:new Map([[material,nativeMaterial]]),textures:new Map(),
    renderer:{retainGeometry(meshes){retained.push([...meshes].map(m=>m.geometry));},pipelines:new Map()},
    scene:{add(){},remove(){}},imagesReady:()=>true,material(){clock+=materialCost;return nativeMaterial;}};
  const root={updateMatrixWorld(){},traverseVisible(f){objects.forEach(f);}};
  return {objects,adapter,retained,run(stepMs=100){clock=nextClock;nextClock+=stepMs;sync.call(adapter,root,null);adapter.frameNo++;}};
}

test('shared materials cannot admit an entire tile in one visible frame and none starve',()=>{
  const f=fixture();f.run();assert.equal(f.adapter.meshes.size,4);assert.equal(f.adapter.pending,true);
  for(let i=0;i<4;i++)f.run();
  assert.equal(f.adapter.meshes.size,17);assert.equal(f.adapter.pending,false);
  assert.ok(f.objects.every(o=>f.adapter.meshes.get(o).geometry===o.geometry));
  assert.equal(f.retained.length,0,'additions cannot retire a previously live geometry');
});

test('removing a scene object still reconciles its CPU/GPU ownership immediately',()=>{
 const f=fixture(4);f.run();const removed=f.objects.pop().geometry;f.run();
 assert.equal(f.adapter.meshes.size,3);assert.equal(f.retained.length,1);assert.ok(!f.retained[0].includes(removed));
});
test('retiring an unused material releases it without clearing live photographed building pipelines',()=>{
 const f=fixture(1),retired={id:99,dispose(){this.disposed=true;},uniformBlock:{}};
 const source={userData:{}},live={compiled:true};f.adapter.materials.set(source,retired);
 f.adapter.unusedAt=new Map([[source,-25000]]);f.adapter.renderer.pipelines.set('live-photo',live);
 const forgotten=[];f.adapter.renderer.forgetMaterial=m=>forgotten.push(m);f.run();
 assert.deepEqual(forgotten,[retired]);assert.equal(retired.disposed,true);assert.equal(f.adapter.materials.has(source),false);
 assert.equal(f.adapter.renderer.pipelines.get('live-photo'),live);
});

test('geometry replacements keep their visible predecessors while bounded uploads finish',()=>{
  const f=fixture();for(let i=0;i<5;i++)f.run();
  const originals=f.objects.map(o=>o.geometry);f.objects.forEach(o=>{o.geometry={};});
  f.run();
  assert.equal(f.objects.filter(o=>f.adapter.meshes.get(o).geometry===o.geometry).length,4);
  assert.equal(f.adapter.meshes.get(f.objects[4]).geometry,originals[4]);
  assert.ok(f.retained.at(-1).includes(originals[4]));
  for(let i=0;i<4;i++)f.run();
  assert.equal(f.adapter.pending,false);assert.ok(f.objects.every(o=>f.adapter.meshes.get(o).geometry===o.geometry));
});

test('one costly admission progresses without admitting its siblings in the same frame',()=>{
  const f=fixture(3,4);f.run();assert.equal(f.adapter.meshes.size,1);
  f.run();assert.equal(f.adapter.meshes.size,2);f.run();assert.equal(f.adapter.meshes.size,3);
  assert.equal(f.adapter.pending,false);
});

test('large full-detail uploads are spread across frames while every source array and predecessor is retained',()=>{
 const f=fixture(5);f.objects.forEach(o=>{o.geometry={attributes:{position:{array:new Float32Array(300000)},facade:{array:new Float32Array(200000)}},index:{array:new Uint32Array(80000)}};});
 f.run();assert.equal(f.adapter.meshes.size,1,'one model larger than the byte budget still progresses');
 for(let i=1;i<5;i++){f.run();assert.equal(f.adapter.meshes.size,i+1);}
 assert.equal(f.adapter.pending,false);
 const previous=f.objects.map(o=>o.geometry);f.objects.forEach(o=>{o.geometry={attributes:{position:{array:new Float32Array(600000)}}};});
 f.run();assert.equal(f.adapter.meshes.get(f.objects[1]).geometry,previous[1]);
 for(let i=1;i<5;i++)f.run();assert.ok(f.objects.every(o=>f.adapter.meshes.get(o).geometry===o.geometry));
});
test('off-screen static buffers prepare within the existing admission cap while dynamic instances use the draw pass',()=>{
 const f=fixture(13),uploaded=new Map(),r=f.adapter.renderer;
 r.geometryReady=(o,_mat,staticOnly)=>uploaded.get(o.geometry)===(o.geometry.revision??0)&&(staticOnly||!o.animated);
 r._frameBuffers=(o,g)=>uploaded.set(g,g.revision??0);
 f.objects[0].animated=true;
 f.run();assert.equal(uploaded.size,4);assert.equal(f.adapter.pending,true);
 for(let i=0;i<3;i++)f.run();assert.equal(uploaded.size,13);assert.equal(f.adapter.pending,false);
 f.objects.slice(1).forEach(o=>o.geometry.revision=1);
 f.run();assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===1).length,4);
 for(let i=0;i<2;i++)f.run();assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===1).length,12);assert.equal(f.adapter.pending,false);
});

test('unchanged off-screen scenery checks are staggered while new and deferred uploads make immediate progress',()=>{
 const f=fixture(9),uploaded=new Map(),r=f.adapter.renderer;let checks=0;
 r.geometryReady=(o)=>{checks++;return uploaded.get(o.geometry)===(o.geometry.revision??0);};
 r._frameBuffers=(_o,g)=>uploaded.set(g,g.revision??0);
 f.run(16);assert.equal(checks,4);f.run(16);assert.equal(checks,8);f.run(16);assert.equal(checks,9);
 f.run(16);assert.equal(checks,9,'already prepared models do not rescan every display frame');
 f.objects.forEach(o=>o.geometry.revision=1);
 f.run(16);assert.equal(checks,9);f.run(16);assert.equal(checks,13);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===1).length,4);
 f.run(16);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===1).length,8);
 f.run(16);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===1).length,9);
 // A newly appended batch can dirty more meshes than this frame admits. All
 // deferred dirty meshes retry on the next frame, rather than another 80 ms.
 const g=f.objects.map(o=>f.adapter.meshes.get(o));g.forEach(m=>m.buffersCheckedAt=-Infinity);f.objects.forEach(o=>o.geometry.revision=2);
 f.run(16);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===2).length,4);
 f.run(16);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===2).length,8);
 f.run(16);assert.equal(f.objects.filter(o=>uploaded.get(o.geometry)===2).length,9);
});
