import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
const start=source.indexOf('\t_finishPipeline( '),body=source.slice(start,source.indexOf('\n\t// ------------------------------------------------------------------------------ draw lists',start));
function fixture(){
 let modules=0,pipelines=0,id=0;const ids=new WeakMap(),drawLayout={},sharedPipelines=new Map();
 const GPU={device:{createPipelineLayout:d=>d},renderPipeline(desc){pipelines++;assert.ok(desc.vertex.module);if(desc.fragment)assert.equal(desc.fragment.module,desc.vertex.module);return{pipeline:{desc}};}};
 const r=vm.runInNewContext('({'+body+'})',{GPU,createShaderModule(){modules++;return{};},stripUnusedFunctions:c=>c,blendState:()=>undefined,GPUColorWrite:{ALL:15},sharedPipelines,layoutId:o=>{if(!ids.has(o))ids.set(o,++id);return ids.get(o);}});
 r._ensureDrawBuffer=()=>r.drawLayout=drawLayout;
 const group0={layout:{}},layout={},material={name:'tile A',side:'front',blending:'none',colorWrite:true,depthTest:true,depthWrite:true,topology:'triangle-list'};
 const compiled=tag=>({code:'same prepared WGSL',group0,bindings:{layout,tag}}),pass={kind:'color',colorFormats:['rgba16float'],depthFormat:'depth32float',depthCompare:'greater-equal'},vl={buffers:[]};
 return{r,material,compiled,pass,vl,counts:()=>({modules,pipelines})};
}
test('live compiled programs bypass shader-module creation even after the module text cache evicts them',()=>{
 const {r,material,compiled,pass,vl,counts}=fixture();
 const a=r._finishPipeline(material,vl,pass,compiled('A'),true,true);
 const b=r._finishPipeline({...material,name:'tile B'},vl,pass,compiled('B'),true,true);
 assert.equal(a.handle,b.handle);assert.notEqual(a.bindings,b.bindings);assert.equal(b.bindings.tag,'B');
 assert.deepEqual(counts(),{modules:1,pipelines:1});
});
test('incompatible render state and failed handles still build the correct fresh shader pipeline',()=>{
 const {r,material,compiled,pass,vl,counts}=fixture();
 const a=r._finishPipeline(material,vl,pass,compiled('A'),true,true);
 const b=r._finishPipeline(material,vl,{...pass,colorFormats:['rgba32float']},compiled('B'),true,true);assert.notEqual(a.handle,b.handle);
 a.handle.failed=true;const c=r._finishPipeline(material,vl,pass,compiled('C'),true,true);assert.notEqual(a.handle,c.handle);assert.deepEqual(counts(),{modules:3,pipelines:3});
});
