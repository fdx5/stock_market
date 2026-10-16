import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const src=readFileSync(new URL('../src/components/roadLinkFallback.ts',import.meta.url),'utf8').replace(/^export /gm,'');
const ctx={};vm.runInNewContext(transformSync(src+'\nthis.f=linkFallbackRoads;',{loader:'ts'}).code,ctx);
const f=(...a)=>JSON.parse(JSON.stringify(ctx.f(...a)));
const box=[-500,-500,500,500];
test('a link the centre lines cover adds nothing',()=>{
  const roads=[{line:[[-400,0],[400,0]],width:20,lanes:4}];
  assert.equal(f(roads,[{id:'a',kind:0,rank:'일반국도',line:[[-400,6],[400,6]]}],box).length,0);
});
test('a new bridge missing from the centre lines is drawn one way per link, by its class',()=>{
  const out=f([],[{id:'a',kind:1,rank:'고속국도',line:[[0,-400],[0,400]]},{id:'b',kind:1,rank:'고속국도',line:[[14,400],[14,-400]]}],box);
  assert.equal(out.length,2);assert.ok(out.every(r=>r.oneway&&r.lanes===3&&r.width===11.5));
});
test('an undivided road (two opposite links on one line) becomes one two-way road',()=>{
  const out=f([],[{id:'a',kind:0,rank:'지방도',line:[[0,-400],[0,400]]},{id:'b',kind:0,rank:'지방도',line:[[0,400],[0,-400]]}],box);
  assert.equal(out.length,1);assert.equal(out[0].oneway,false);assert.equal(out[0].lanes,2);
});
test('tunnels stay hidden, while a surveyed 24 m gap is filled instead of severing the road',()=>{
  assert.equal(f([],[{id:'t',kind:-1,rank:'일반국도',line:[[0,-400],[0,400]]}],box).length,0);
  const roads=[{line:[[0,-400],[0,-12]],width:10,lanes:2},{line:[[0,12],[0,400]],width:10,lanes:2}];
  const out=f(roads,[{id:'a',kind:0,rank:'일반국도',line:[[0,-400],[0,400]]}],box);
  assert.equal(out.length,1);assert.ok(out[0].line[0][1]<=-10&&out[0].line.at(-1)[1]>=10);
});
test('a gap of 60 m in the centre lines is filled, overlapping both ends',()=>{
  const roads=[{line:[[0,-400],[0,-30]],width:10,lanes:2},{line:[[0,30],[0,400]],width:10,lanes:2}];
  const out=f(roads,[{id:'a',kind:0,rank:'일반국도',line:[[0,-400],[0,400]]}],box);
  assert.equal(out.length,1);const ys=out[0].line.map(p=>p[1]);assert.ok(Math.min(...ys)<=-25&&Math.max(...ys)>=25,JSON.stringify(ys));
});
