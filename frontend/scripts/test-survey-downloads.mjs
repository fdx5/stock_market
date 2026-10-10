import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/surveyDownloads.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {downloadSurveyModels}=scope.module.exports;
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('healthy models start while a neighbouring source list is still stalled, with four downloads and nearest-first pending admission',async()=>{
 let late;const unresolved=new Promise(r=>late=r),started=[],release=new Map();
 const done=downloadSurveyModels([Promise.resolve([7,6,5,4,3,2,1]),unresolved],{key:String,rank:n=>n,load:n=>{started.push(n);return new Promise(r=>release.set(n,r));}});
 await flush();assert.deepEqual(started,[1,2,3,4]);
 release.get(1)(1);await flush();assert.deepEqual(started,[1,2,3,4,5]);
 late([2,0,8]);await flush();release.get(2)(2);await flush();assert.equal(started.at(-1),0,'the newly discovered nearer model takes the next free slot');
 for(const n of [3,4,5,0])release.get(n)(n);await flush();
 for(const n of [6,7,8])release.get(n)(n);const out=await done;
 assert.deepEqual(Array.from(out).sort((a,b)=>a-b),[0,1,2,3,4,5,6,7,8]);assert.equal(started.length,9,'duplicate source model is downloaded once');
});

test('a deadline keeps healthy completed models and reports every queued remainder without starting more downloads',async()=>{
 const ctl=new AbortController(),pending=[],started=[],release=new Map();
 const done=downloadSurveyModels([Promise.resolve([0,1,2,3,4,5])],{signal:ctl.signal,key:String,rank:n=>n,onPending:n=>pending.push(n),load:n=>{started.push(n);return new Promise(r=>release.set(n,r));}});
 await flush();release.get(0)(0);await flush();ctl.abort();for(const n of [1,2,3,4])release.get(n)(null);
 assert.deepEqual(Array.from(await done),[0]);assert.deepEqual(started,[0,1,2,3,4]);assert.deepEqual(pending,[5]);
});

test('failed model results cannot prevent queued healthy sources completing, and an already cancelled batch starts none',async()=>{
 let running=0,max=0;const lists=[Promise.resolve(Array.from({length:24},(_,i)=>i))];
 const out=await downloadSurveyModels(lists,{key:String,rank:n=>n,load:async n=>{max=Math.max(max,++running);await Promise.resolve();running--;return n%3?{n}:null;}});
 assert.equal(max,4);assert.equal(out.length,16);
 const ctl=new AbortController();ctl.abort();const pending=[];
 const aborted=await downloadSurveyModels([Promise.resolve([1,2])],{signal:ctl.signal,key:String,rank:n=>n,onPending:n=>pending.push(n),load:async()=>{throw Error('cancelled batch must not start');}});
 assert.equal(aborted.length,0);assert.deepEqual(pending,[1,2]);
});
