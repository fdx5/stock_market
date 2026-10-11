import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import * as THREE from 'three';
const source=new URL('../src/components/surveyGeometryStore.ts',import.meta.url);
const code=buildSync({entryPoints:[source.pathname.slice(1)],bundle:true,write:false,format:'esm',platform:'node',external:['three']}).outputFiles[0].text.replace("from \"three\"","from "+JSON.stringify(new URL('../node_modules/three/build/three.module.js',import.meta.url).href));
const {SurveyGeometryStore}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const part=(x=0,n=3,material=0)=>({material,position:new Float32Array(Array.from({length:n},(_,i)=>[x+i,0,i%2]).flat()),normal:new Float32Array(n*3).fill(.5),uv:new Float32Array(n*2).fill(.25),color:new Float32Array(n*3).fill(.75),facade:new Float32Array(n*4).fill(2),index:new Uint32Array(Array.from({length:n},(_,i)=>i)),paintSpans:new Uint32Array([0,1,0,n,0]),box:[x,0,0,x+n,0,1],sphere:[x+n/2,0,.5,n]});
test('appending retains every exact vertex, index, normal and facade with correct source spans',()=>{
 const s=new SurveyGeometryStore(),a=part(0),b=part(10);s.append([a]).commit();const e=s.entries[0],first=e.geo;
 const tx=s.append([b]);tx.commit();assert.equal(s.entries[0].geo,first);
 for(const key of ['position','normal','uv','color','facade'])assert.deepEqual(Array.from(e.geo.getAttribute(key).array.subarray(0,a[key].length+b[key].length)),[...a[key],...b[key]]);
 assert.deepEqual(Array.from(e.geo.index.array.subarray(0,6)),[0,1,2,3,4,5]);assert.deepEqual(Array.from(e.spans),[0,1,0,3,0,0,1,3,3,0]);assert.equal(e.geo.drawRange.count,6);
 assert.ok(e.geo.boundingBox.containsPoint(new THREE.Vector3(12,0,0)));
});
test('a fitting append keeps live GPU source arrays and marks only the added ranges',()=>{
 const s=new SurveyGeometryStore();s.append([part(0,12)]).commit();const e=s.entries[0],p=e.geo.attributes.position,i=e.geo.index;
 for(const a of Object.values(e.geo.attributes))a.clearUpdateRanges();i.clearUpdateRanges();s.append([part(20)]).commit();
 assert.equal(e.geo.attributes.position,p);assert.equal(e.geo.index,i);assert.deepEqual(p.updateRanges,[{start:36,count:9}]);assert.deepEqual(i.updateRanges,[{start:12,count:3}]);
});
test('rollback preserves preceding geometry and removes only uncommitted new chunks',()=>{
 const s=new SurveyGeometryStore();s.append([part()]).commit();const e=s.entries[0],spans=e.spans,box=e.geo.boundingBox.clone();const tx=s.append([part(30),part(40,3,1)]);
 tx.rollback();assert.equal(s.entries.length,1);assert.equal(e.vertices,3);assert.equal(e.indices,3);assert.equal(e.geo.drawRange.count,3);assert.equal(e.spans,spans);assert.ok(e.geo.boundingBox.equals(box));
 s.append([part(5)]).commit();assert.equal(s.entries.length,1);assert.equal(e.geo.index.array[3],3);
});
test('ordinary chunk capacity stays bounded and an oversized real model stays intact',()=>{
 const s=new SurveyGeometryStore(),large=part(0,100000);s.append([large]).commit();assert.equal(s.entries[0].vertices,100000);assert.equal(s.entries[0].vertexCapacity,100000);
 s.append([part(200000)]).commit();assert.equal(s.entries.length,2);assert.equal(s.entries[1].vertices,3);
 const small=s.entries[1];assert.ok(Object.values(small.geo.attributes).reduce((n,a)=>n+a.array.byteLength,small.geo.index.array.byteLength)<=4*1024*1024);
});
test('different materials/layouts remain separate and disposal releases all owned geometry',()=>{
 const s=new SurveyGeometryStore(),plain={...part(),uv:null,facade:null};s.append([part(),plain,part(5,3,1)]).commit();assert.equal(s.entries.length,3);
 let disposed=0;for(const e of s.entries)e.geo.addEventListener('dispose',()=>disposed++);s.dispose();assert.equal(disposed,3);assert.equal(s.entries.length,0);
});
test('an in-flight rollback after departure cannot revive or dispose the ended store twice',()=>{
 const s=new SurveyGeometryStore();s.append([part()]).commit();const tx=s.append([part(20),part(40,3,1)]);
 let disposed=0;for(const e of s.entries)e.geo.addEventListener('dispose',()=>disposed++);
 s.dispose();tx.rollback();s.dispose();assert.equal(s.entries.length,0);assert.equal(disposed,2);
 assert.throws(()=>s.append([part()]),/disposed/);
});
