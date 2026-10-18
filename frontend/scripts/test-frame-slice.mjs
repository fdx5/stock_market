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
 return {slice:scope.module.exports.frameSlice,map:scope.module.exports.mapInSlices,filter:scope.module.exports.filterInSlices,start:scope.module.exports.sceneFrameStarted,frames,tasks,setNow:v=>now=v,spend:v=>now+=v,
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

test('continuous urgent road work cannot starve the buildings ahead of a busy drone',async()=>{
 const s=scheduler(),ordinary=[],roads=[];
 for(let i=0;i<4;i++)s.slice(6).then(()=>ordinary.push(i));
 const road=()=>s.slice(9,true).then(()=>{roads.push(1);if(roads.length<50)road();});road();
 for(let at=0;at<=500;at+=17){s.frame(at,20);await s.task();}
 assert.deepEqual(ordinary,[0,1,2,3],'ordinary continuations retain their 100ms starvation bound');
 assert.ok(roads.length>=8,'roads retain their faster priority admissions');
});

test('urgent road work still passes ordinary backlog when frame time is available',async()=>{
 const s=scheduler(),order=[];
 s.slice(6).then(()=>order.push('tile'));s.slice(9,true).then(()=>order.push('paint'));
 s.frame(0,2);await s.task();assert.deepEqual(order,['paint']);
 await s.task();assert.deepEqual(order,['paint','tile']);
});

test('busy-frame road continuations progress once per display frame without sharing an over-budget tick',async()=>{
 const s=scheduler(),roads=[];
 const road=()=>s.slice(12,true).then(()=>{roads.push(1);if(roads.length<20)road();});road();
 for(let at=0;at<=102;at+=17){s.frame(at,20);await s.task();assert.equal(s.tasks.length,0);}
 assert.equal(roads.length,7);
});

test('display delivery delay does not consume the actual view work budget',async()=>{
 const s=scheduler(),order=[];s.slice(9).then(()=>order.push(0));
 s.setNow(10);s.start(0);s.frame(0,15);await s.task();
 assert.deepEqual(order,[0]);
});

test('higher-budget work passes an ineligible head without starving it',async()=>{
 const s=scheduler(),order=[];
 s.slice(6).then(()=>order.push(0));s.slice(9).then(()=>order.push(1));
 s.frame(0,7);await s.task();assert.deepEqual(order,[1]);
 s.slice(9).then(()=>order.push(2));s.frame(100,7);await s.task();
 assert.deepEqual(order,[1,0]);await s.task();assert.deepEqual(order,[1,0,2]);
});

test('multiple views on one tick retain cumulative rendering cost',async()=>{
 const s=scheduler(),order=[];s.slice(9).then(()=>order.push(0));
 s.setNow(4);s.start(0);s.setNow(10);s.start(0);s.frame(0,15);await s.task();
 assert.deepEqual(order,[]);
});

test('asset maps and junction filters yield during construction while preserving callback order and object identities',async()=>{
 for(const operation of ['map','filter']){
  const s=scheduler(),items=Array.from({length:20},(_,i)=>({i})),called=[];
  let done=false,value;
  const p=s[operation](items,(item,index)=>{called.push(index);s.spend(1);return operation==='map'?item:index%3===0;}).then(v=>{done=true;value=v;});
  assert.equal(done,false);assert.equal(called.length,2,'the batch gives drawing a turn after two milliseconds');
  let at=0,turns=0;
  while(!done&&turns++<100){if(s.tasks.length)await s.task();else if(s.frames.length){at+=16.7;s.frame(at,2);}else await Promise.resolve();}
  await p;assert.deepEqual(called,items.map((_,i)=>i));
  assert.deepEqual(Array.from(value),operation==='map'?items:items.filter((_,i)=>i%3===0));
 }
});
