import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('GPU total includes untimed copies and skipped passes decay to zero',async()=>{
 let timestamps=new BigInt64Array([0n,2_000_000n,7_000_000n,8_000_000n]);
 let queries=0;
 const GPU={hasTimestamp:true,device:{createQuerySet({count}){queries=count;return{destroy(){}};},createBuffer(){return{destroy(){},mapAsync:()=>Promise.resolve(),getMappedRange:()=>timestamps.buffer,unmap(){}};}}};
 const source=readFileSync(new URL('../src/components/tidewater/GpuTimer.js',import.meta.url),'utf8').replace(/^import .*$/m,'').replace('export class GpuTimer','globalThis.GpuTimer = class GpuTimer');
 const scope={GPU,GPUBufferUsage:{QUERY_RESOLVE:1,COPY_SRC:2,MAP_READ:4,COPY_DST:8},GPUMapMode:{READ:1},BigInt64Array};vm.runInNewContext(source,scope);
 const timer=new scope.GpuTimer({interval:1}),encoder={resolveQuerySet(){},copyBufferToBuffer(){}};
 timer.begin();timer.pass('shadow');timer.pass('finish');await timer.end(encoder)();
 assert.equal(timer.last.total,8);assert.equal(timer.last.passes,3);assert.equal(timer.last.other,5);
 timestamps=new BigInt64Array([0n,1_000_000n]);timer.begin();timer.pass('finish');await timer.end(encoder)();assert.equal(timer.last.total,1);assert.equal(timer.ms.shadow,1);
 assert.ok(queries>=28);timer.begin();for(let i=0;i<13;i++)timer.pass('pass'+i);assert.ok(timer.pass('finish'),'cache stores must not consume the final display timestamp');
});

test('diagnostic sampling avoids readbacks on intervening frames and visits every shadow phase',async()=>{
 let resolves=0,maps=0;
 const timestamps=new BigInt64Array([0n,1_000_000n]);
 const GPU={hasTimestamp:true,device:{createQuerySet(){return{destroy(){}};},createBuffer(){return{destroy(){},mapAsync(){maps++;return Promise.resolve();},getMappedRange:()=>timestamps.buffer,unmap(){}};}}};
 const source=readFileSync(new URL('../src/components/tidewater/GpuTimer.js',import.meta.url),'utf8').replace(/^import .*$/m,'').replace('export class GpuTimer','globalThis.GpuTimer = class GpuTimer');
 const scope={GPU,GPUBufferUsage:{QUERY_RESOLVE:1,COPY_SRC:2,MAP_READ:4,COPY_DST:8},GPUMapMode:{READ:1},BigInt64Array};vm.runInNewContext(source,scope);
 const timer=new scope.GpuTimer(),encoder={resolveQuerySet(){resolves++;},copyBufferToBuffer(){}},phases=new Set();
 for(let i=0;i<84;i++){
  timer.begin();const pass=timer.pass('finish'),done=timer.end(encoder);
  if(i%7===0){assert.ok(pass);assert.ok(done);phases.add(i%12);await done();}
  else {assert.equal(pass,undefined);assert.equal(done,null);}
 }
 assert.equal(resolves,12);assert.equal(maps,12);assert.equal(timer.samples,12);assert.equal(phases.size,12);
});
