import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/droneMarket.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports});
const {dronePrice,droneComplexMatch,droneMarketQuote}=module.exports;
const now=new Date('2026-10-09T12:00:00+09:00');
const type={key:85,area:84.9,pyeong:25.7,price_source:'sale',change_pct:12.3,history:[],deals:[
  [20261001,215678,12,0],[20260201,214322,8,0],[20260801,70000,1,1],
  [20250901,100000,4,0],[20261101,250000,9,0],
]};

test('drone price truncates below ten million won and uses the requested Korean notation',()=>{
  for(const [value,expected] of [[215999,'21억 5천'],[113999,'11억 3천'],[210999,'21억'],[19999,'1억 9천'],[9999,'9천만'],[999,'1천만 미만'],[0,'—'],[NaN,'—']])assert.equal(dronePrice(value),expected);
});

test('the average uses the same area and only valid brokered trades within the past year',()=>{
  const quote=droneMarketQuote(type,now);
  assert.equal(quote.average,215000);assert.equal(quote.samples,2);assert.equal(quote.direct,false);
  assert.equal(quote.from,'2026.02.01');assert.equal(quote.to,'2026.10.01');
});

test('trend colors follow the API one-year movement and stay neutral without comparison data',()=>{
  for(const [change,tone] of [[12.3,'up'],[-8.1,'down'],[0,'flat'],[null,'unknown'],[NaN,'unknown']]){
    assert.equal(droneMarketQuote({...type,change_pct:change},now).tone,tone);
  }
});

test('a direct-only sample is identified and stale or invalid prices are not presented as current averages',()=>{
  const direct=droneMarketQuote({...type,deals:[[20261001,70000,1,1]]},now);
  assert.equal(direct.average,70000);assert.equal(direct.direct,true);
  assert.equal(droneMarketQuote({...type,deals:[[20250901,90000,1,0]]},now),null);
  assert.equal(droneMarketQuote({...type,deals:[[20260230,90000,1,0],[20261001,-1,1,0],[20261001,Infinity,1,0]]},now),null);
});

test('the market resolves a unique exact-parcel candidate and rejects ambiguous buildings on a shared lot',()=>{
  const items=[{id:'one',name:'래미안길음센터피스'},{id:'two',name:'길음뉴타운'}];
  assert.equal(droneComplexMatch('래미안 길음 센터피스 아파트',items).id,'one');
  assert.equal(droneComplexMatch('건물',items),null);assert.equal(droneComplexMatch('건물',[]),null);
  assert.equal(droneComplexMatch('공식 대장 명칭',[items[0]]).id,'one');
});
