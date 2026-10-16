import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js',import.meta.url),'utf8');
const begin=source.indexOf('  objectsReady(root) {'),end=source.indexOf('  sync(source, camera) {',begin);
assert.ok(begin>=0&&end>begin);
const objectsReady=vm.runInNewContext('({'+source.slice(begin,end)+'}).objectsReady',{
  sourceMaterialsMatch:(a,b)=>a===b,READY_CASTER_PASSES:[],READY_COLOUR_PASSES:[],
});
const root=objects=>({traverseVisible:f=>objects.forEach(f)});
const obj=()=>({isMesh:true,isInstancedMesh:true,count:0,geometry:{},material:{}});
const fixture=()=>({meshes:new Map(),renderer:{geometryReady:()=>true,materialReady:()=>true}});

test('empty traffic variants do not block the first simulation update; active instances wait for upload',()=>{
 const adapter=fixture(),empty=obj(),live={...obj(),count:4};
 adapter.meshes.set(live,{geometry:live.geometry,material:live.material});
 assert.equal(objectsReady.call(adapter,root([live,empty])),true);
 empty.count=1;
 assert.equal(objectsReady.call(adapter,root([live,empty])),false);
 adapter.meshes.set(empty,{geometry:empty.geometry,material:empty.material});
 assert.equal(objectsReady.call(adapter,root([live,empty])),true);
 adapter.renderer.geometryReady=()=>false;
 assert.equal(objectsReady.call(adapter,root([live,empty])),false);
});

test('active geometry, material, failed-renderer and count-changing hooks keep their readiness checks',()=>{
 const adapter=fixture(),live={...obj(),count:1};
 adapter.meshes.set(live,{geometry:{},material:live.material});
 assert.equal(objectsReady.call(adapter,root([live])),false);
 adapter.meshes.set(live,{geometry:live.geometry,material:{}});
 assert.equal(objectsReady.call(adapter,root([live])),false);
 adapter.meshes.set(live,{geometry:live.geometry,material:live.material});
 adapter.renderer.materialReady=()=>false;
 assert.equal(objectsReady.call(adapter,root([live])),false);
 adapter.renderer.materialReady=()=>true;adapter.failed=true;
 assert.equal(objectsReady.call(adapter,root([obj()])),false);
 adapter.failed=false;
 assert.equal(objectsReady.call(adapter,root([{...obj(),onBeforeRender(){}}])),false);
});
