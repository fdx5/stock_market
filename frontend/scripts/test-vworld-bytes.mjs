import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=transformSync(readFileSync(new URL('../src/components/vworldBytes.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
function cache(extra={}){const scope={module:{exports:{}},URL,Date,DOMException,AbortController,setTimeout,clearTimeout,...extra};vm.runInNewContext(source,scope);return scope.module.exports.sharedVworldBytes;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const url=n=>`https://xdworld.vworld.kr/XDServer/3DData?DataFile=${n}&Key=old`;

test('a stalled persistent store cannot stall the original network path',async()=>{
 const get=cache({indexedDB:{databases:()=>new Promise(()=>{}),open:()=>{throw Error('unexpected open');}}});let requests=0;
 const data=await get(url(0),async()=>{requests++;return new Uint8Array([8]).buffer;});
 assert.equal(requests,1);assert.deepEqual([...new Uint8Array(data)],[8]);
});

test('concurrent consumers and renewed tokens share one file download',async()=>{
 const get=cache();let requests=0,resolve;const load=()=>{requests++;return new Promise(r=>resolve=r);};
 const a=get(url(1),load),b=get(url(1).replace('old','new'),load);await tick();assert.equal(requests,1);
 resolve(new Uint8Array([1,2,3]).buffer);const [aa,bb]=await Promise.all([a,b]);assert.notEqual(aa,bb);assert.deepEqual([...new Uint8Array(aa)],[1,2,3]);
 structuredClone(aa,{transfer:[aa]});const cc=await get(url(1),load);assert.deepEqual([...new Uint8Array(cc)],[1,2,3]);assert.equal(requests,1);
});
test('failed requests can retry and do not poison the cache',async()=>{
 const get=cache();let requests=0;const load=async()=>{if(++requests===1)throw Error('offline');return new Uint8Array([7]).buffer;};
 await assert.rejects(get(url(2),load));await tick();assert.deepEqual([...new Uint8Array(await get(url(2),load))],[7]);assert.equal(requests,2);
});
test('cancelling a view does not cancel another owner of its shared download',async()=>{
 const get=cache(),ctl=new AbortController();let resolve,sharedSignal;const load=signal=>{sharedSignal=signal;return new Promise(r=>resolve=r);};
 const a=get(url(3),load,ctl.signal),b=get(url(3),load);await tick();ctl.abort();await assert.rejects(a,{name:'AbortError'});
 assert.equal(sharedSignal.aborted,false);
 resolve(new Uint8Array([9]).buffer);assert.deepEqual([...new Uint8Array(await b)],[9]);
});

test('closing the final owner cancels an active download and releases its slot for the new view',async()=>{
 const get=cache(),ctl=new AbortController();let sharedSignal;
 const abandoned=get(url('old'),signal=>{sharedSignal=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('closed','AbortError'))));},ctl.signal);
 const rejects=assert.rejects(abandoned,{name:'AbortError'});await tick();ctl.abort();await rejects;await tick();
 assert.equal(sharedSignal.aborted,true);
 let requests=0;const data=await get(url('old'),async()=>{requests++;return new Uint8Array([6]).buffer;});
 assert.equal(requests,1);assert.deepEqual([...new Uint8Array(data)],[6]);
});

test('cancelled queued files never download and cannot block a new visible file',async()=>{
 const get=cache(),release=[];const held=Array.from({length:6},(_,i)=>get(url(i),()=>new Promise(r=>release.push(r))));
 await tick();const ctl=new AbortController();let stale=0,visible=0;
 const abandoned=get(url('stale'),async()=>{stale++;return new ArrayBuffer(1);},ctl.signal);
 const rejects=assert.rejects(abandoned,{name:'AbortError'});await tick();ctl.abort();await rejects;
 const next=get(url('visible'),async()=>{visible++;return new Uint8Array([5]).buffer;});await tick();assert.equal(visible,0);
 release.shift()(new ArrayBuffer(1));assert.deepEqual([...new Uint8Array(await next)],[5]);assert.equal(stale,0);
 release.forEach(r=>r(new ArrayBuffer(1)));await Promise.all(held);
});

test('closing while a legacy lookup is stalled cannot start a late orphaned download',async()=>{
 const get=cache({indexedDB:{databases:()=>new Promise(()=>{})}}),ctl=new AbortController();let requests=0;
 const abandoned=get(url('lookup'),async()=>{requests++;return new ArrayBuffer(1);},ctl.signal);
 const rejects=assert.rejects(abandoned,{name:'AbortError'});ctl.abort();await rejects;
 await new Promise(r=>setTimeout(r,120));assert.equal(requests,0);
});

test('legacy cache reads preserve stored data and use only readonly transactions',async()=>{
 const saved={at:Date.now(),data:new Uint8Array([4,2]).buffer},modes=[];let opens=0,requests=0;
 const database={objectStoreNames:{contains:n=>n==='bytes'},close(){},transaction(store,mode){modes.push(mode);assert.equal(store,'bytes');return {objectStore(){return {get(){const r={};queueMicrotask(()=>{r.result=saved;r.onsuccess();});return r;}};}};}};
 const indexedDB={databases:async()=>[{name:'kospimap.vworld-bytes.v1'}],open(){opens++;const r={};queueMicrotask(()=>{r.result=database;r.onsuccess();});return r;}};
 const get=cache({indexedDB});const result=await get(url('legacy'),async()=>{requests++;return new ArrayBuffer(1);});
 assert.deepEqual([...new Uint8Array(result)],[4,2]);assert.equal(requests,0);assert.equal(opens,1);assert.deepEqual(modes,['readonly']);
 assert.deepEqual([...new Uint8Array(saved.data)],[4,2]);
});

test('a fresh browser does not create a persistent database',async()=>{
 const get=cache({indexedDB:{databases:async()=>[],open(){throw Error('must not create a database');}}});
 assert.deepEqual([...new Uint8Array(await get(url('fresh'),async()=>new Uint8Array([7]).buffer))],[7]);
});
test('downloads across simultaneous scene paths never exceed six active files',async()=>{
 const get=cache(),waiting=[];let active=0,max=0;
 const load=()=>new Promise(r=>{active++;max=Math.max(max,active);waiting.push(()=>{active--;r(new ArrayBuffer(1));});});
 const jobs=Array.from({length:18},(_,i)=>get(url(i),load));await tick();assert.equal(waiting.length,6);
 while(waiting.length){waiting.shift()();await tick();}
 await Promise.all(jobs);assert.equal(max,6);
});
test('the byte budget evicts old files instead of keeping unbounded CPU copies',async()=>{
 const get=cache();let requests=0;const load=async()=>{requests++;return new ArrayBuffer(20*1024*1024);};
 await get(url(1),load);await get(url(2),load);await get(url(1),load);assert.equal(requests,3);
});
