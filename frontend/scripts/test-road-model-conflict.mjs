import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync,buildSync} from 'esbuild';
import vm from 'node:vm';
const {code}=transformSync(readFileSync(new URL('../src/components/roadModelConflict.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {modelBlocksRoad}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const road=(x,y)=>x>4&&x<8&&Math.abs(y)<2;
const measured=(x,y)=>x<3;
test('a model matching a building cannot add a road-blocking annex outside its footprint',()=>{
 const vertices=new Float32Array([0,0,0,2,0,0,2,0,20,0,0,20, 5,-1,0,7,-1,0,7,1,0,5,1,0]);
 assert.equal(modelBlocksRoad(vertices,[0,1,2,0,2,3,4,5,6,4,6,7],0,0,road,measured),true);
 assert.equal(modelBlocksRoad(vertices,[0,1,2,0,2,3],0,0,road,measured),false);
});
test('a ground-level wall crossing a road is caught even when both endpoints are outside',()=>{
 assert.equal(modelBlocksRoad([0,0,0,12,0,0,12,0,10],null,0,0,road,measured),true);
});
test('survey offsets and elevated extensions cannot move a model into a carriageway',()=>{
 assert.equal(modelBlocksRoad([0,0,0,2,0,0,2,0,10],null,5,0,road,measured),true);
 const high=[0,0,0,2,0,0,2,0,10, 5,0,12,7,0,12,7,1,12];
 assert.equal(modelBlocksRoad(high,null,0,0,road,measured),true);
 assert.equal(modelBlocksRoad(high,[0,1,2,3,4,5],0,0,road,measured),true);
});
const worker=buildSync({stdin:{contents:"import './src/components/roadModelCheckWorker';export {ringIndex} from './src/components/footprintIndex';",resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')},bundle:true,write:false,platform:'node',format:'iife',globalName:'logic'}).outputFiles[0].text;
test('off-thread checks retain road/footprint decisions for indexed and nonindexed geometry and offsets',()=>{
 const replies=[],scope={self:{postMessage:v=>replies.push(v)},performance};vm.runInNewContext(worker,scope);
 const roads=[[[4,-2],[8,-2],[8,2],[4,2]]],buildings=[[[-10,-10],[3,-10],[3,10],[-10,10]]];
 let seed=13;const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let i=0;i<100;i++){
  const position=Float32Array.from({length:18},(_,k)=>k%3===2?rnd()*30:rnd()*16-5),index=i%2?new Uint32Array([0,1,2,3,4,5]):null,dx=rnd()*2-1,dy=rnd()*2-1;
  const expected=modelBlocksRoad(position,index,dx,dy,scope.logic.ringIndex(roads),scope.logic.ringIndex(buildings));
  scope.self.onmessage({data:{id:i,context:'same-scene',position,index,dx,dy,roads,buildings}});assert.equal(replies.at(-1).blocked,expected);assert.equal(replies.at(-1).id,i);
 }
});
test('switching model contexts refreshes the cached footprint index',()=>{
 const replies=[],scope={self:{postMessage:v=>replies.push(v)},performance};vm.runInNewContext(worker,scope);
 const input={position:new Float32Array([0,0,0,12,0,0,12,0,10]),index:null,dx:0,dy:0,buildings:[]};
 scope.self.onmessage({data:{...input,id:1,context:'first',roads:[]}});assert.equal(replies.at(-1).blocked,false);
 scope.self.onmessage({data:{...input,id:2,context:'second',roads:[[[4,-2],[8,-2],[8,2],[4,2]]]}});assert.equal(replies.at(-1).blocked,true);
});
