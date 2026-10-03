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
 const get=cache({indexedDB:{open:()=>({})}});let requests=0;
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
 const get=cache(),ctl=new AbortController();let resolve;const load=()=>new Promise(r=>resolve=r);
 const a=get(url(3),load,ctl.signal),b=get(url(3),load);await tick();ctl.abort();await assert.rejects(a,{name:'AbortError'});
 resolve(new Uint8Array([9]).buffer);assert.deepEqual([...new Uint8Array(await b)],[9]);
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
