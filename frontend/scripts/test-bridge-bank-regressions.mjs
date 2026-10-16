import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync,build} from 'esbuild';
const src=readFileSync(new URL('../src/components/bridgeDecks.ts',import.meta.url),'utf8').replace(/^export /gm,'');
const decks=new Function(transformSync(src,{loader:'ts'}).code+';return chainDeckRoads;')();
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/bridge-bank-regressions.json',import.meta.url),'utf8'));
const length=line=>line.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-line[i][0],p[1]-line[i][1]),0);
test('recorded Hangang bridge becomes one eight-lane two-way deck despite different bank estimates',()=>{
 const out=decks([],fixtures['18']).decks;
 assert.equal(out.length,1);assert.equal(out[0].twoWay,true);assert.equal(out[0].lanes,8);
 assert.ok(length(out[0].line)>=1000);
});
test('recorded Dongjak bridge keeps its two three-lane carriageways and their complete bank extensions',()=>{
 const chains=fixtures['17'],out=decks([],chains).decks;
 assert.equal(out.length,2);
 for(const c of chains){const d=out.find(d=>d.chain===c.ids[0]);assert.equal(d.twoWay,false);assert.equal(d.lanes,3);
  assert.ok(length(d.line)>1260,'bank extension was clipped to the river core');}
});
test('a bridge tapers to an unsplit surveyed bank road without attaching to a transverse crossing',()=>{
 const c={ids:['a'],line:[[0,0],[0,400]],core:[30,370],s:[0,400],z:[10,10],deck:{w:14,off:0,lanes:3,twoWay:false}};
 const out=decks([],[c],120,3,[{line:[[6,-100],[6,50]]},{line:[[-50,400],[50,400]]}]).decks[0];
 assert.deepEqual(out.line[0],[6,0]);assert.deepEqual(out.line.at(-1),[0,400]);
 assert.ok(out.line.some(p=>Math.abs(p[1]-90)<1e-6&&p[0]===0),'taper must restore the surveyed interior');
 for(let i=1;i<out.line.length;i++)assert.ok(Math.abs(out.line[i][0]-out.line[i-1][0])<=2.3);
});
test('stacked two-way bridges never merge, including a three-metre consistently separated profile',()=>{
 const a={ids:['a'],line:[[0,0],[0,400]],core:[0,400],s:[0,400],z:[10,10],deck:{w:30,off:0,lanes:6,twoWay:true}};
 for(const dz of [3,10])assert.equal(decks([],[a,{...a,ids:['b'],line:[[0,400],[0,0]],z:[10+dz,10+dz]}]).decks.length,2);
});
test('a bank in the middle of a ground road is a traffic junction, an interior overpass is not',async()=>{
 const b=await build({entryPoints:[new URL('../src/components/roadTrafficNetwork.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
 const {splitRoadJunctions}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const ground={line:[[0,-50],[0,50]],width:10,lanes:2,structure:'ground'};
 const bridge={line:[[0,0],[0,400]],profile_line:[[0,0],[0,400]],profile_s:[0,400],profile_z:[10,10],structure:'bridge',layer:1,width:14,lanes:3};
 assert.equal(splitRoadJunctions([ground,bridge]).length,3);
 assert.equal(splitRoadJunctions([{...ground,line:[[0,-3],[0,50]]},bridge]).length,3,'a three-metre bank connector must not be discarded by the ordinary junction spacing');
 const over={...bridge,profile_line:[[0,-400],[0,400]]};
 assert.equal(splitRoadJunctions([ground,over]).length,2);
});
