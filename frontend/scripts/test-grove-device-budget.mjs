import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
function load(file,extra={}){
 const source=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'');
 const scope={module:{exports:{}},exports:{},THREE,...extra};
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;
}
const {PARK_TREE_STYLES}=load('landscapeDiversity.ts'),{treeFoliageTone}=load('foliageTone.ts');
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const grove=bounded=>load('sceneGroves.ts',{PARK_TREE_STYLES,treeFoliageTone,rng,performance,hybridSceneEnabled:()=>false,prepareInstanceKernel:async()=>undefined,frameSlice:async()=>{},sceneDeviceBudget:()=>({constrained:bounded})});

test('cancelled forest construction frees every temporary WASM batch',async()=>{
 let tick=0,batches=[];
 class Batch{constructor(){batches.push(this);}dispose(){this.closed=true;}}
 const api=load('sceneGroves.ts',{PARK_TREE_STYLES,treeFoliageTone,rng,performance:{now:()=>tick+=4},hybridSceneEnabled:()=>true,prepareInstanceKernel:async()=>({}),InstanceBatch:Batch,frameSlice:async()=>{},sceneDeviceBudget:()=>({constrained:true})});
 await assert.rejects(api.groveForest([{pattern:0,points:[[10,20],[300,20]]}],{at:()=>4},91,null,true,1,async()=>{if(batches.length>=2)throw Error('cancelled');}),/cancelled/);
 assert.ok(batches.length>0);assert.ok(batches.every(b=>b.closed));
});
test('all five reduced models retain closed leaves, a trunk and three branches',()=>{
 const {treeMeshModel}=grove(true);
 for(let species=0;species<5;species++)for(const leaves of [192,96,48]){
  const g=treeMeshModel(species,1,leaves),m=g.userData.treeModel;
  assert.equal(g.index.count/3,leaves*4+32);
  assert.equal(m.leafVertices,leaves*12);assert.ok(m.exposedTrunk>2);
  assert.ok(g.boundingSphere.radius>5);assert.ok(Number.isFinite(g.boundingSphere.radius));
  g.dispose();
 }
});
test('bounded forests keep every root and tree height while reducing distant triangles and sharing geometry',async()=>{
 const patches=[{pattern:0,points:[[10,20],[300,20],[650,20],[800,90],[720,-90]]}],terrain={at:()=>4},texture=new THREE.Texture();
 const full=await grove(false).groveForest(patches,terrain,91,texture,true,1,async()=>{});
 const api=grove(true),small=await api.groveForest(patches,terrain,91,texture,true,1,async()=>{});
 const second=await api.groveForest(patches,terrain,91,texture,true,1,async()=>{});
 const a=full.group.userData.forestBudget,b=small.group.userData.forestBudget;
 assert.deepEqual(JSON.stringify(a.roots),JSON.stringify(b.roots));assert.equal(a.clusterCanopies,b.clusterCanopies);
 assert.equal(a.minTreeHeight,b.minTreeHeight);assert.equal(a.maxTreeHeight,b.maxTreeHeight);
 assert.ok(b.triangles<a.triangles*.5);assert.equal(b.triangles,800+416+224*3);
 assert.equal(small.group.children[0].geometry,second.group.children[0].geometry);
 full.dispose();small.dispose();second.dispose();texture.dispose();
});
