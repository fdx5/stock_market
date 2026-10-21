import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
const source=readFileSync(new URL('../src/desk2/discover/marketOverviewModel.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const {overviewDistribution,MOVE_BINS}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const item=(code,change_pct,close=100)=>({code,name:code,change_pct,close});

test('every boundary is assigned to exactly one return range, including zero',()=>{
  const values=[-30,-3,-2,-1,-.01,0,.01,.99,1,2.99,3,30];
  for(const value of values)assert.equal(MOVE_BINS.filter(bin=>bin.test(value)).length,1);
  const d=overviewDistribution(values.map((value,i)=>item(String(i),value)));
  assert.deepEqual(d.bins.map(bin=>bin.length),[2,2,1,1,2,2,2]);
  assert.equal(d.total,d.bins.flat().length);
  assert.equal(d.up+d.flat+d.down,d.total);
  assert.equal(d.upShare,6/12*100);
});
test('missing quotes never count as unchanged or dilute the denominator; overlapping symbols count once',()=>{
  const d=overviewDistribution([item('A',2),item('A',2),item('B',-1),item('C',NaN),item('D',Infinity),item('E',1,0),item('F',1,NaN),item('G',0)]);
  assert.equal(d.received,7);assert.equal(d.total,3);
  assert.equal(d.up,1);assert.equal(d.down,1);assert.equal(d.flat,1);
  assert.ok(Math.abs(d.upShare-100/3)<1e-9);
});
test('explore links are ordered by absolute move with deterministic symbol ties',()=>{
  const d=overviewDistribution([item('ZZZ',-3),item('AAA',-4),item('BBB',-4),item('CCC',-8)]);
  assert.deepEqual(d.bins[0].map(i=>i.code),['CCC','AAA','BBB','ZZZ']);
});
test('a loading or wholly unavailable universe has no invented advancing percentage',()=>{
  assert.equal(overviewDistribution([]).upShare,null);
  const d=overviewDistribution([item('A',null,0),item('B',NaN)]);
  assert.equal(d.upShare,null);assert.equal(d.bins.flat().length,0);
});
