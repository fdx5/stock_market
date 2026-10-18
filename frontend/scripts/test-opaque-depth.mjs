import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
import {compactDepthPositions,opaqueDepthEligible} from '../src/vendor/tidewater/engine/render/OpaqueDepth.js';
function load(file,extra={}){
 const source=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'');
 const scope={module:{exports:{}},exports:{},THREE,...extra};vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;
}
const {PARK_TREE_STYLES}=load('landscapeDiversity.ts');
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const {treeMeshModel}=load('sceneGroves.ts',{PARK_TREE_STYLES,rng});
const material={vertex:'',shadow:'',alphaTest:0,topology:'triangle-list'};
test('every corner of every original tree triangle survives exact shadow welding, in order',()=>{
 for(let species=0;species<5;species++)for(const leaves of [192,96,48]){
  const g=treeMeshModel(species,1,leaves),p=g.attributes.position,c=compactDepthPositions(g);
  assert.equal(c.indices.length,g.index.count);assert.ok(c.position.count<p.count*.4);
  for(let i=0;i<g.index.count;i++)for(let axis=0;axis<3;axis++)assert.equal(c.position.array[c.indices[i]*3+axis],p.array[g.index.array[i]*3+axis]);
  assert.equal(g.attributes.position,p);assert.equal(g.attributes.normal.count,p.count);
 }
});
test('shadow welding preserves partial draw ranges and never merges nearby, distinct positions',()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,0,1.000001,0,0,0,1,0],3)).setIndex([0,1,2,3,4,5]);
 g.setDrawRange(3,3);const c=compactDepthPositions(g);assert.equal(c.position.count,4);assert.deepEqual(Array.from(c.indices.slice(3)),[0,3,2]);assert.deepEqual(g.drawRange,{start:3,count:3});
});
test('alpha-tested, custom-shadow, deformed and clipped materials retain the full shader',()=>{
 assert.equal(opaqueDepthEligible(material,{kind:'depth'}),true);
 for(const m of [{...material,alphaTest:.1},{...material,vertex:'v.position.y += frame.time;'},{...material,shadow:'return false;'},{...material,topology:'line-list'}])assert.equal(opaqueDepthEligible(m,{kind:'depth'}),false);
 assert.equal(opaqueDepthEligible(material,{kind:'color'}),false);assert.equal(opaqueDepthEligible(material,{kind:'depth',defines:{REFRACTION_CLIP:1}}),false);
 assert.equal(opaqueDepthEligible({...material,defines:{REFRACTION_CLIP:1}},{kind:'depth'}),false);
});
test('the native world-instance shortcut requires an exactly identity world matrix',()=>{
 const source=readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('function identityMatrix('),source.indexOf('function sameMatrix('));
 const identity=vm.runInNewContext(code+'identityMatrix');assert.equal(identity(new THREE.Matrix4()),true);
 for(const m of [new THREE.Matrix4().makeTranslation(.00001,0,0),new THREE.Matrix4().makeScale(1,1,1.00001),new THREE.Matrix4().makeRotationY(.00001)])assert.equal(identity(m),false);
});
test('compact depth buffers follow source versions, moving instances and original geometry ownership',()=>{
 const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
 const between=(a,b)=>source.slice(source.indexOf('\t'+a+'( '),source.indexOf(b,source.indexOf('\t'+a+'( ')));
 const methods=vm.runInNewContext('({'+between('_depthBuffers','\n\t// Shared tetrahedral leaves')+','+between('retainGeometry','\n\treleaseGeometry')+','+between('releaseGeometry','\n\tdispose')+'})',{
  compactDepthPositions,opaqueDepthEligible,Uint16Array,GPUBufferUsage:{INDEX:1,COPY_DST:2},GPU:{device:{createBuffer(){return{destroyed:false,destroy(){this.destroyed=true;}};}}},align4:n=>Math.ceil(n/4)*4,writePadded:(b,a)=>b.data=Array.from(a),
 });
 const geo=treeMeshModel(0);geo.userData.compactDepth=true;const state={buffers:new Map()};const renderer={...methods,geometries:new Map([[geo,state]]),_geometryGPU:()=>state,
  _layout:(o,g)=>({buffers:[{attr:g.attributes.position},{attr:o.instanceMatrix}]}),_attributeBuffer(g,a){let b=state.buffers.get(a);if(!b){b={buffer:{destroyed:false,destroy(){this.destroyed=true;}}};state.buffers.set(a,b);}b.array=a.array;b.version=a.version;return b.buffer;}};
 const o={geometry:geo,instanceMatrix:new THREE.InstancedBufferAttribute(new Float32Array(16),16)},pass={kind:'depth'};
 const a=renderer._depthBuffers(o,geo,material,pass),index=a.index.buffer,position=a.vbs[0];assert.equal(renderer._depthBuffers(o,geo,material,pass),a);
 o.instanceMatrix.needsUpdate=true;assert.equal(renderer._depthBuffers(o,geo,material,pass),a);assert.equal(state.buffers.get(o.instanceMatrix).version,1);
 renderer.retainGeometry([o]);assert.equal(position.destroyed,false);assert.equal(index.destroyed,false);
 geo.attributes.position.needsUpdate=true;const b=renderer._depthBuffers(o,geo,material,pass);assert.notEqual(b,a);assert.equal(position.destroyed,true);assert.equal(index.destroyed,true);
 renderer.releaseGeometry(geo);assert.equal(b.vbs[0].destroyed,true);assert.equal(b.index.buffer.destroyed,true);assert.equal(renderer.geometries.size,0);
});
