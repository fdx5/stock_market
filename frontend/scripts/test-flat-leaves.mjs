import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
import {compactFlatLeaves} from '../src/vendor/tidewater/engine/render/FlatLeaves.js';
function load(file,extra={}){
 const source=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'');
 const scope={module:{exports:{}},exports:{},THREE,...extra};vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;
}
const {PARK_TREE_STYLES}=load('landscapeDiversity.ts'),rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const {treeMeshModel}=load('sceneGroves.ts',{PARK_TREE_STYLES,rng});
function leaves(species,count=192){
 const model=treeMeshModel(species),g=new THREE.BufferGeometry(),n=model.userData.treeModel.leafVertices;
 for(const [name,a]of Object.entries(model.attributes))g.setAttribute(name,new THREE.Float32BufferAttribute(a.array.slice(0,n*a.itemSize),a.itemSize));
 const ids=[];for(let spray=0;spray<48;spray+=192/count)for(let j=0;j<48;j++)ids.push(model.index.array[spray*48+j]);g.setIndex(ids);model.dispose();return g;
}
const bits=a=>new Uint32Array(a.buffer,a.byteOffset,a.length);
test('all five tree species retain every triangle, winding, UV, tint and exact per-face normal at every existing LOD',()=>{
 for(let species=0;species<5;species++)for(const count of [192,96,48]){
  const g=leaves(species,count),before=g.index.array.slice(),flat=compactFlatLeaves(g);assert.ok(flat);assert.equal(flat.indices.length,g.index.count);assert.equal(flat.attributes.position.count,count*4);
  for(let face=0;face<g.index.count;face+=3){
   const old=Array.from(g.index.array.subarray(face,face+3)),now=Array.from(flat.indices.subarray(face,face+3));
   let rotation=-1;
   for(let r=0;r<3;r++)if(['position','uv','color'].every(name=>{const a=g.attributes[name],b=flat.attributes[name],s=a.itemSize;return [0,1,2].every(k=>Array.from(bits(a.array).subarray(old[(r+k)%3]*s,(old[(r+k)%3]+1)*s)).every((v,j)=>v===bits(b.array)[now[k]*s+j]));})){rotation=r;break;}
   assert.notEqual(rotation,-1,'only a cyclic rotation is allowed, with all non-normal attributes bit-identical');
   const expected=bits(g.attributes.normal.array),actual=bits(flat.attributes.normal.array);
   for(let a=0;a<3;a++)assert.equal(actual[now[0]*3+a],expected[old[0]*3+a],'the provoking vertex supplies the original face normal');
  }
  assert.deepEqual(g.index.array,before);g.dispose();
 }
});
test('smooth normals, custom attributes and incomplete leaves retain the original vertex path',()=>{
 const g=leaves(0);g.attributes.normal.setX(1,g.attributes.normal.getX(1)+.1);assert.equal(compactFlatLeaves(g),null);
 const custom=leaves(1);custom.setAttribute('custom',new THREE.Float32BufferAttribute(new Float32Array(custom.attributes.position.count),1));assert.equal(compactFlatLeaves(custom),null);
 const partial=leaves(2);partial.setIndex(Array.from(partial.index.array.subarray(0,9)));assert.equal(compactFlatLeaves(partial),null);
});
test('flat leaf GPU buffers refresh changed sources and instance attributes and are freed with their original geometry',()=>{
 const s=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8'),between=(a,b)=>s.slice(s.indexOf('\t'+a+'( '),s.indexOf(b,s.indexOf('\t'+a+'( ')));
 const methods=vm.runInNewContext('({'+between('_flatLeafBuffers','\n\t// ------------------------------------------------------------------------------ pipelines')+','+between('retainGeometry','\n\treleaseGeometry')+','+between('releaseGeometry','\n\tdispose')+'})',{
  compactFlatLeaves,Uint16Array,GPUBufferUsage:{INDEX:1,COPY_DST:2},GPU:{device:{createBuffer(){return{destroyed:false,destroy(){this.destroyed=true;}};}}},align4:n=>Math.ceil(n/4)*4,writePadded:(b,a)=>b.data=Array.from(a),
 });
 const g=leaves(0),state={buffers:new Map()},r={...methods,geometries:new Map([[g,state]]),_geometryGPU:()=>state,_layout(o,g){return{buffers:[...Object.values(g.attributes),o.instanceMatrix,o.instanceColor].map(attr=>({attr})),worldInstances:o.worldInstances};},_attributeBuffer(g,a){let b=state.buffers.get(a);if(!b){b={buffer:{destroyed:false,destroy(){this.destroyed=true;}}};state.buffers.set(a,b);}b.version=a.version;return b.buffer;}};
 const o={geometry:g,isInstancedMesh:true,instanceMatrix:new THREE.InstancedBufferAttribute(new Float32Array(16),16),instanceColor:new THREE.InstancedBufferAttribute(new Float32Array(3),3)},m={vertex:'',attributes:{},topology:'triangle-list'};
 const a=r._flatLeafBuffers(o,g,m),old=a.index.buffer;assert.equal(r._flatLeafBuffers(o,g,m),a);r.retainGeometry([o]);assert.equal(old.destroyed,false);assert.ok(a.vbs.every(b=>!b.destroyed));
 o.instanceMatrix.needsUpdate=true;assert.equal(r._flatLeafBuffers(o,g,m),a);assert.equal(state.buffers.get(o.instanceMatrix).version,1);
 o.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(3),3);assert.notEqual(r._flatLeafBuffers(o,g,m),a);
 g.attributes.uv.needsUpdate=true;const b=r._flatLeafBuffers(o,g,m);assert.equal(old.destroyed,true);r.releaseGeometry(g);assert.ok(b.vbs.every(v=>v.destroyed));assert.equal(b.index.buffer.destroyed,true);
});
