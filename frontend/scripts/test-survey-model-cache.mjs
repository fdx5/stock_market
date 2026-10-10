import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import * as THREE from 'three';
const b=buildSync({entryPoints:[new URL('../src/components/surveyModelCache.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const {SurveyModelCache}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const model=()=>({key:'public-shape',geometry:new THREE.BoxGeometry(10,12,40),texture:null,cx:12,cy:20,ground:3,hull:[[7,14],[17,14],[17,26],[7,26]],src:{x:1,y:2,img:'unused.jpg'}});
test('decoded reuse preserves every source triangle while caller mutation, disposal and transfer cannot alter later jobs',()=>{
 const c=new SurveyModelCache(),m=model(),position=Array.from(m.geometry.attributes.position.array),index=Array.from(m.geometry.index.array);
 c.put('origin-a',m);m.geometry.translate(200,0,0);m.hull[0][0]=400;m.geometry.dispose();
 const first=c.get('origin-a');assert.deepEqual(Array.from(first.geometry.attributes.position.array),position);assert.deepEqual(Array.from(first.geometry.index.array),index);
 first.geometry.translate(100,0,0);first.hull[0][0]=300;structuredClone(first.geometry.attributes.position.array,{transfer:[first.geometry.attributes.position.array.buffer]});first.geometry.dispose();
 const again=c.get('origin-a');assert.deepEqual(Array.from(again.geometry.attributes.position.array),position);assert.equal(again.hull[0][0],7);assert.equal(c.get('origin-b'),null);
 assert.equal(c.stats().hits,2);again.geometry.dispose();c.clear();assert.equal(c.stats().bytes,0);assert.equal(c.stats().entries,0);
});
test('decoded shape memory and entry limits evict least-used CPU copies; expiry fetches again and photographs stay outside',()=>{
 let now=0;const c=new SurveyModelCache(6000,2,10,()=>now),m=model();
 c.put('a',m);c.put('b',m);const hit=c.get('a');hit.geometry.dispose();c.put('c',m);
 assert.equal(c.get('b'),null);assert.equal(c.stats().entries,2);assert.ok(c.stats().bytes<=6000);
 now=11;assert.equal(c.get('a'),null);assert.equal(c.get('c'),null);assert.equal(c.stats().bytes,0);
 m.texture=new THREE.Texture();c.put('photo',m);assert.equal(c.get('photo'),null);m.texture.dispose();m.texture=null;
 const small=new SurveyModelCache(100,2);small.put('large',m);assert.equal(small.stats().entries,0);m.geometry.dispose();
});
