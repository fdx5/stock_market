import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
async function module(name) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/markets/${name}`, import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const math = await module('researchModel.ts');
const ui = await module('researchFormat.ts');
const catalog = await module('catalog.ts');

test('dividend amounts retain their own currency and fractional precision without conversion', () => {
  assert.equal(ui.dividendAmount(183, 'KRW'), '183원 (KRW)');
  assert.equal(ui.dividendAmount(1.823, 'USD'), '1.823달러 (USD)');
  assert.equal(ui.dividendAmount('1,500', 'KRW'), '1,500원 (KRW)');
  assert.equal(ui.dividendAmount(183, undefined), '183 (통화 미확인)');
  assert.equal(ui.dividendAmount(null, 'USD'), '—');
});

test('the catalog has all 36 unique executable service paths and six menu groups', () => {
  assert.equal(catalog.SERVICES.length, 36); assert.equal(new Set(catalog.SERVICES.map(s => s.path)).size, 36); assert.equal(catalog.SERVICE_GROUPS.length, 6);
  assert.ok(catalog.SERVICES.every(s => s.isNew && s.question && s.criteria));
});
test('public context links carry stock and market but reject arbitrary identifiers', () => {
  assert.match(catalog.serviceLink('/stock-context', {code:'005930', market:'kospi'}), /code=005930/);
  assert.equal(catalog.serviceLink('/stock-context', {code:'<script>', market:'bad'}), '/stock-context');
});
test('relative performance aligns dates and uses a growth ratio', () => {
  const rows = math.alignReturns([{date:'1',close:100},{date:'2',close:150},{date:'3',close:200}], [{date:'1',close:100},{date:'3',close:150}]);
  assert.equal(rows.length,2); assert.ok(Math.abs(rows[1].relative - 33.333333333) < 1e-6);
});
test('currency return compounds and never fills absent dates', () => {
  const rows = math.combineCurrency([{date:'1',close:100},{date:'2',close:105},{date:'3',close:110}], [{date:'1',close:1000},{date:'3',close:1100}]);
  assert.equal(rows.length,2); assert.ok(Math.abs(rows[1].total-21)<1e-8);
  assert.deepEqual(math.combineCurrency([{date:'1',close:100}],[]),[]);
});
test('relative volume requires 20 preceding full observations with no missing volume', () => {
  const rows = Array.from({length:21}, (_,i)=>({date:String(i),close:100,high:110,low:90,volume:i===20?200:100}));
  assert.equal(math.liquidityMetrics(rows)[20].relative_volume,2);
  rows[4].volume=null;
  assert.equal(math.liquidityMetrics(rows)[20].relative_volume,null);
});
test('bond yield solves cash flows and price falls when required yield rises', () => {
  const yieldPct=math.bondYield(100,4,5,100);
  assert.ok(Math.abs(yieldPct-4)<1e-6); assert.ok(math.bondPrice(100,4,5,5)<100);
  assert.equal(math.bondYield(100,4,5,-10),null); assert.equal(math.bondPrice(100,4,0,5),null);
  assert.equal(math.bondPrice(100,4,1.1,5),null);
});
test('ETF overlap combines duplicates and rejects impossible weights', () => {
  const result=math.overlap([{code:'A',weight:30},{code:'A',weight:10},{code:'B',weight:60}],[{code:'A',weight:50},{code:'C',weight:50}]);
  assert.equal(result.total,40); assert.equal(result.rows.find(r=>r.code==='A').combined,45);
  assert.equal(math.overlap([{code:'A',weight:70},{code:'B',weight:50}],[]),null);
});
test('a thin orderbook exposes unfilled budget and never fabricates liquidity', () => {
  const result=math.orderCost([{ask_price:100,ask_size:1},{ask_price:110,ask_size:1}],300);
  assert.equal(result.spent,210); assert.equal(result.unfilled,90); assert.equal(result.average,105); assert.ok(Math.abs(result.impact-5)<1e-8);
  assert.equal(math.orderCost([],0),null);
});
test('CSV import parses quotes, multiline fields, BOM and rejects unsafe headers', () => {
  assert.deepEqual(ui.parseCsv('\ufeffcode,name\r\n005930,"a,b"\r\n'), [{code:'005930',name:'a,b'}]);
  assert.equal(ui.parseCsv('code,name\n1,"one\ntwo"')[0].name,'one\ntwo');
  assert.throws(()=>ui.parseCsv('__proto__,name\nx,y')); assert.throws(()=>ui.parseCsv('a,a\n1,2'));
  assert.throws(()=>ui.parseCsv('code,name\n1,"unfinished'));
});
test('numeric cells do not treat the table row as a decimal precision argument', () => {
  assert.equal(ui.n(12.345,{}),'12.35'); assert.equal(ui.n(null),'—'); assert.equal(ui.safeHref('javascript:alert(1)'),undefined);
});
