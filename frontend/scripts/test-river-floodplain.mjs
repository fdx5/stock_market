import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// waterCore's water field on a synthetic river parcel: a 60 m channel at 2.5 m, a 150 m wide flat 둔치 at 5 m.
const dir=mkdtempSync(path.join(tmpdir(),'river-'));const out=path.join(dir,'waterCore.mjs');
buildSync({entryPoints:[new URL('../src/components/waterCore.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const {waterField,fieldFrom,levelWater,surfaceRings}=await import(pathToFileURL(out).href);
const pace=async()=>true;
const ring=[[-200,-300],[200,-300],[200,300],[-200,300]];
// (the 둔치 with the micro-relief the national DEM shows on the Han's parks: ~0.1 m over 5 m)
const noise=(x,y)=>{const n=Math.sin(Math.round(x)*12.9898+Math.round(y)*78.233)*43758.5453;return n-Math.floor(n);};
const ground=(x,y)=>y<-30&&y>-90?2.5:5.0+0.15*Math.sin(x/7)*Math.cos(y/9)+0.25*(noise(x,y)-.5);  // channel between y=-90 and y=-30; the rest of the parcel is 둔치
test('a wide 둔치 inside a river parcel stays land; the channel is water',async()=>{
  const data=await waterField([ring],ground,pace);
  const f=fieldFrom(data,ground);
  assert.ok(f.wet(0,-60),'channel');
  for(const y of [0,60,150,250])assert.ok(!f.wet(0,y),`둔치 at y=${y} marked wet`);
});
// (Seoul's tributaries — 중랑천, 탄천, 안양천 — fall 0.1–0.4 %; a steep mountain stream's far reaches
// can read as ground above the river: a known limit of the floor rule)
test('a stream falling 0.4 m over 100 m stays water along its whole bed',async()=>{
  const ring2=[[-200,-10],[200,-10],[200,10],[-200,10]];
  const bed=(x,y)=>Math.abs(y)<6?3+x*0.004:4.6+x*0.004;
  const data=await waterField([ring2],bed,pace);const f=fieldFrom(data,bed);
  for(let x=-180;x<=180;x+=20)assert.ok(f.wet(x,0),`bed at x=${x} dry`);
});
test('the level pool above a weir stays water beside the lower river below it',async()=>{
  const ring=[[-300,-40],[300,-40],[300,40],[-300,40]];
  const lvl=(x,y)=>Math.abs(y)>30?9:(x<0?5.5:2.5);  // weir at x=0: 3 m drop; banks at 9 m
  const data=await waterField([ring],lvl,async()=>true);const f=fieldFrom(data,lvl);
  for(let x=-280;x<=280;x+=40)assert.ok(f.wet(x,0),`river at x=${x} dry`);
});
test('a wide 둔치 far from the channel (7 m over it, 400 m across) is no water even with no channel in sight',async()=>{
  // the tile holds only the floodplain part of the river parcel: no lower water inside it
  const ring=[[-200,-200],[200,-200],[200,200],[-200,200]];
  // (the national DEM's micro-relief on the Han's 둔치, as sampled: ±0.1–0.3 m every few metres)
  const noise=(x,y)=>{const n=Math.sin(Math.round(x)*12.9898+Math.round(y)*78.233)*43758.5453;return n-Math.floor(n);};
  const flat=(x,y)=>7+0.2*Math.sin(x/9)*Math.cos(y/7)+0.25*(noise(x,y)-.5);
  const data=await waterField([ring],flat,async()=>true);const f=fieldFrom(data,flat);
  for(const [x,y] of [[0,0],[100,-50],[-150,120]])assert.ok(!f.wet(x,y),`둔치 at ${x},${y} wet`);
});
test('a level reed field 4.5 m over the river beside it (미사리) is no water, though the DEM shows it smooth',async()=>{
  const ring=[[-150,0],[150,0],[150,300],[-150,300]];
  const dem=(x,y)=>y<-60?0:4.5;  // the channel lies outside this parcel, 60 m off
  const data=await waterField([ring],dem,async()=>true);const f=fieldFrom(data,dem);
  for(const [x,y] of [[0,50],[100,200],[-120,280]])assert.ok(!f.wet(x,y),`reed field at ${x},${y} wet`);
});

for(const width of [4,12,28])test(`a ${width} m stream continues below a 44 m DEM bridge ridge`,async()=>{
  const ring=[[-180,-width/2],[180,-width/2],[180,width/2],[-180,width/2]];
  const dem=(x,y)=>3+x*.002+(Math.abs(x)<22&&Math.abs(y)<=width/2?6:0);
  const data=await waterField([ring],dem,pace),f=fieldFrom(data,dem);
  for(let x=-60;x<=60;x+=2){assert.ok(f.wet(x,0),`stream interrupted at ${x}`);assert.ok(Math.abs(f.level(x,0)-(3+x*.002))<.2,`DEM bridge ridge raised water at ${x}`);}
});
test('a narrow one-row sloping channel keeps its one-dimensional water plane',async()=>{
  const h=Float32Array.from({length:51},(_,i)=>3+i*.04),wet=new Uint8Array(51).fill(1);
  levelWater(h,wet,51,1,2);
  for(let i=5;i<46;i++)assert.equal(wet[i],1,`one-row stream interrupted at ${i}`);
});
test('stream reconnection cannot cross a mapped island or a gap between water polygons',async()=>{
  const a=[[-100,-6],[-4,-6],[-4,6],[-100,6]],b=[[4,-6],[100,-6],[100,6],[4,6]],dem=()=>3;
  const data=await waterField([a,b],dem,pace),f=fieldFrom(data,dem);
  assert.ok(f.wet(-30,0)&&f.wet(30,0));assert.ok(!f.wet(0,0));
  const ring=[[-100,-6],[100,-6],[100,6],[-100,6]],hole=[[-6,-6],[6,-6],[6,6],[-6,6]];
  const island=fieldFrom(await waterField([ring],dem,pace,[hole]),dem);
  assert.ok(!island.wet(0,0));
});
test('two streamed tiles reconnect the same bridge crossing their shared boundary',async()=>{
  const worldRing=[[-340,-6],[680,-6],[680,6],[-340,6]],fields=[];
  const dem=(x,y)=>3+x*.002+(Math.abs(x-170)<22?6:0);
  for(const cx of [0,340]){
    const local=[worldRing.map(([x,y])=>[x-cx,y])],rings=surfaceRings(local,[],[],250).rings;
    const at=(x,y)=>dem(x+cx,y),data=await waterField(rings,at,pace,[],[],[-250,-250,250,250]);
    fields.push(fieldFrom(data,at));
  }
  for(let x=146;x<=194;x+=2){
    assert.ok(fields[0].wet(x,0)&&fields[1].wet(x-340,0),`tile-boundary gap at ${x}`);
    assert.ok(Math.abs(fields[0].level(x,0)-fields[1].level(x-340,0))<.05,`tile water-level mismatch at ${x}`);
  }
});
