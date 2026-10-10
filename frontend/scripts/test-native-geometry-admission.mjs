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
  let clock=0;
  class Mesh{
    constructor(geometry,material){this.geometry=geometry;this.material=material;this.matrix={copy(){}};}
  }
  const sync=vm.runInNewContext('({'+source.slice(begin,end)+'}).sync',{
    Mesh,performance:{now:()=>clock},sourceMaterialsMatch:()=>true,sameMatrix:()=>true,
    boundTextures:()=>new Set(),updateForestLod:()=>{},
  });
  const material={userData:{}},nativeMaterial={source:material};
  const objects=Array.from({length:count},()=>({isMesh:true,material,geometry:{},matrixWorld:{},count:1,castShadow:false,userData:{}}));
  const retained=[];
  const adapter={shown:true,frameNo:1,meshes:new Map(),materials:new Map([[material,nativeMaterial]]),textures:new Map(),
    renderer:{retainGeometry(meshes){retained.push([...meshes].map(m=>m.geometry));},pipelines:new Map()},
    scene:{add(){},remove(){}},imagesReady:()=>true,material(){clock+=materialCost;return nativeMaterial;}};
  const root={updateMatrixWorld(){},traverseVisible(f){objects.forEach(f);}};
  return {objects,adapter,retained,run(){clock=0;sync.call(adapter,root,null);adapter.frameNo++;}};
}

test('shared materials cannot admit an entire tile in one visible frame and none starve',()=>{
  const f=fixture();f.run();assert.equal(f.adapter.meshes.size,4);assert.equal(f.adapter.pending,true);
  for(let i=0;i<4;i++)f.run();
  assert.equal(f.adapter.meshes.size,17);assert.equal(f.adapter.pending,false);
  assert.ok(f.objects.every(o=>f.adapter.meshes.get(o).geometry===o.geometry));
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
