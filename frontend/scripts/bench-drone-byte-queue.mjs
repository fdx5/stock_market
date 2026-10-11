// Controlled obsolete-download queue comparison; no browser, network or DB APIs.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import assert from 'node:assert/strict';

const previous=execFileSync('git',['show','68d9159:frontend/src/components/vworldBytes.ts'],{encoding:'utf8'});
const current=readFileSync(new URL('../src/components/vworldBytes.ts',import.meta.url),'utf8');
function loader(source){
 const scope={module:{exports:{}},URL,Date,DOMException,AbortController,setTimeout,clearTimeout};
 // IndexedDB is intentionally unavailable in both isolated VM contexts.
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);
 return scope.module.exports.sharedVworldBytes;
}
async function sample(source){
 const get=loader(source),owners=Array.from({length:6},()=>new AbortController());let active=0,cancelled=0;
 const abandoned=owners.map((owner,i)=>get(`https://example.invalid/obsolete-${i}`,signal=>new Promise((resolve,reject)=>{
   active++;const timer=setTimeout(()=>{active--;resolve(new ArrayBuffer(1));},250);
   signal.addEventListener('abort',()=>{clearTimeout(timer);active--;cancelled++;reject(new DOMException('cancelled','AbortError'));},{once:true});
 }),owner.signal).catch(e=>{assert.equal(e.name,'AbortError');}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(active,6);
 const start=performance.now();owners.forEach(owner=>owner.abort());
 let admitted=0;
 await get('https://example.invalid/current-view',async()=>{admitted=performance.now()-start;return new ArrayBuffer(1);});
 await Promise.all(abandoned);
 return {admissionMs:+admitted.toFixed(3),cancelled};
}
const before=[],after=[];
for(let i=0;i<3;i++){before.push(await sample(previous));after.push(await sample(current));}
assert.ok(after.every(r=>r.cancelled===6&&r.admissionMs<50));
assert.ok(before.every(r=>r.cancelled===0&&r.admissionMs>150));
console.log(JSON.stringify({fixture:'six obsolete 250ms downloads; immediately request a new visible file',before,after,
 scope:'Queue admission only; not a real-world first-frame or nationwide FPS measurement.'},null,2));
