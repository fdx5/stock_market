import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/surveyPartMerge.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {mergeSurveyParts}=scope.module.exports;
const part=(id,material,uv=true)=>({material,position:new Float32Array([id,0,0,id+1,0,0,id,0,1]),normal:new Float32Array([0,1,0,0,1,0,0,1,0]),color:new Float32Array(9).fill(id/20),uv:uv?new Float32Array([0,0,1,0,0,1]):null,facade:new Float32Array(12).fill(id),index:new Uint32Array([0,1,2]),paintSpans:new Uint32Array([material,id,0,3,1]),box:[id,0,0,id+1,0,1],sphere:[id+.5,0,.5,1]});
test('consolidation preserves every triangle, normal, colour, facade parameter and late roof source',()=>{
 const input=Array.from({length:60},(_,i)=>part(i,i%4)),copy=structuredClone(input),joined=mergeSurveyParts(input);
 assert.equal(joined.length,4);assert.deepEqual(input,copy,'live geometry was not detached or changed');
 for(const p of joined){
  const original=input.filter(a=>a.material===p.material);let vertices=0,indices=0,spans=0;
  for(const a of original){
   for(const [key,size] of [['position',3],['normal',3],['color',3],['facade',4],['uv',2]])assert.deepEqual(Array.from(p[key].subarray(vertices*size,vertices*size+a[key].length)),Array.from(a[key]));
   assert.deepEqual(Array.from(p.index.subarray(indices,indices+3)),Array.from(a.index,k=>k+vertices));
   assert.deepEqual(Array.from(p.paintSpans.subarray(spans,spans+5)),[a.material,a.paintSpans[1],vertices,3,1]);
   vertices+=3;indices+=3;spans+=5;
  }
  for(let k=0;k<p.position.length;k+=3)assert.ok(Math.hypot(p.position[k]-p.sphere[0],p.position[k+1]-p.sphere[1],p.position[k+2]-p.sphere[2])<=p.sphere[3]+1e-8);
 }
 // A subsequent batch includes the whole previous GPU-ready tile exactly once.
 const again=mergeSurveyParts([...joined,part(61,1)]);assert.equal(again.length,4);assert.equal(again.reduce((n,p)=>n+p.index.length,0),183);
});
test('different attribute layouts stay in separate compatible meshes',()=>{
 const a=part(0,1),b=part(1,1,false),c=part(2,1);c.facade=null;
 const out=mergeSurveyParts([a,b,c]);assert.equal(out.length,3);assert.equal(out[0],a);assert.equal(out[1],b);assert.equal(out[2],c);
});
