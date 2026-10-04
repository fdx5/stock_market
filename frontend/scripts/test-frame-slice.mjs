import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';

function scheduler(hidden=false){
 const frames=[],tasks=[];let now=0;
 class MessageChannel{
  constructor(){this.port1={onmessage:null,close(){}};this.port2={close(){},postMessage:()=>tasks.push(()=>this.port1.onmessage())};}
 }
 const scope={module:{exports:{}},exports:{},document:{hidden},performance:{now:()=>now},MessageChannel,requestAnimationFrame:f=>frames.push(f)};
 vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/frameSlice.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
 return {slice:scope.module.exports.frameSlice,frames,tasks,setNow:v=>now=v,spend:v=>now+=v,
  async task(){tasks.shift()();for(let i=0;i<5;i++)await Promise.resolve();},
  frame(at,cost=0){now=at+cost;frames.shift()(at);}};
}

test('short FIFO work shares spare frame time and stops admitting at its budget',async()=>{
 const s=scheduler(),order=[];
 for(let i=0;i<4;i++)s.slice(9).then(()=>{order.push(i);s.spend(3);});
 s.frame(0,2);
 await s.task();await s.task();await s.task();await s.task();
 assert.deepEqual(order,[0,1,2]);assert.equal(s.tasks.length,0);assert.equal(s.frames.length,1);
 s.frame(16.7,2);await s.task();assert.deepEqual(order,[0,1,2,3]);
 assert.equal(s.frames.length,0);
});

test('a continuously busy view admits only one overdue continuation per 100ms',async()=>{
 const s=scheduler(),order=[];
 for(let i=0;i<2;i++)s.slice(9).then(()=>order.push(i));
 s.frame(0,20);await s.task();assert.deepEqual(order,[]);
 s.frame(100,20);await s.task();assert.deepEqual(order,[0]);
 s.frame(150,20);await s.task();assert.deepEqual(order,[0]);
 s.frame(200,20);await s.task();assert.deepEqual(order,[0,1]);
});

test('hidden views finish FIFO work without animation frames',async()=>{
 const s=scheduler(true),order=[];
 for(let i=0;i<3;i++)s.slice().then(()=>order.push(i));
 await s.task();await s.task();await s.task();
 assert.deepEqual(order,[0,1,2]);assert.equal(s.frames.length,0);
});
