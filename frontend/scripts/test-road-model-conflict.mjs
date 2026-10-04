import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
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
