import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function load(name) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/markets/${name}.ts`, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const model = await load('discoveryModel');
const insights = await load('insightModel');
const row = (overrides = {}) => ({ id: 'kospi:005930', market: 'kospi', currency: 'KRW', code: '005930', name: '삼성전자', sector: '반도체', close: 90, change: 1, cap: 100, volume: 10, amount: 900, per: 10, roe: 15, high: 100, low: 60, highGap: -10, w1: 2, m1: 4, m3: 8, ytd: 12, ...overrides });
const filters = (overrides = {}) => ({ market: 'kospi', q: '', sector: '', preset: 'all', sort: 'change', minChange: null, maxPer: null, ...overrides });

test('US index weight never becomes dollar market cap; missing values remain missing', () => {
  const boards = { nasdaq: { items: [{ code: 'AAA', name: 'AAA', sector: 'Tech', close: 100, change_pct: NaN, marcap: 6, market_cap: null, volume: null, per: -1, week52_high: 200, returns: { m1: null } }] } };
  const [value] = model.discoveryRows(boards);
  assert.equal(value.cap, null); assert.equal(value.change, null); assert.equal(value.per, null); assert.equal(value.amount, null); assert.equal(value.m1, null); assert.equal(value.highGap, -50);
});
test('a PER ceiling excludes missing/nonpositive PER and respects market boundaries', () => {
  const rows = [row(), row({ id: '2', per: null }), row({ id: '3', per: 20 }), row({ id: '4', market: 'nasdaq', per: 5 })];
  assert.deepEqual(model.screenRows(rows, filters({ maxPer: 15 })).map(r => r.id), ['kospi:005930']);
});
test('high proximity uses 0 to 5% below the high and excludes missing/above-high data', () => {
  const rows = [row({ id: 'at', highGap: 0 }), row({ id: 'edge', highGap: -5 }), row({ id: 'outside', highGap: -5.01 }), row({ id: 'missing', highGap: null }), row({ id: 'above', highGap: 1 })];
  assert.deepEqual(model.screenRows(rows, filters({ preset: 'near-high', sort: 'high' })).map(r => r.id), ['at', 'edge']);
});
test('missing metrics sort last even in ascending order', () => {
  const rows = [row({ id: 'none', change: null }), row({ id: 'negative', change: -4 }), row({ id: 'positive', change: 7 })];
  assert.deepEqual(model.screenRows(rows, filters({ sort: 'change-asc' })).map(r => r.id), ['negative', 'positive', 'none']);
});
test('sector weighting uses only valid cap/move pairs and reports incomplete coverage', () => {
  const sectors = model.sectorStrength([row({ cap: 300, change: 2 }), row({ cap: 100, change: -2 }), row({ cap: null, change: 20 }), row({ cap: 100, change: null })], 'kospi');
  assert.equal(sectors[0].move, 1); assert.equal(sectors[0].count, 4); assert.equal(sectors[0].known, 3); assert.equal(sectors[0].weightedCount, 2);
});
test('the inside-market experiment uses one complete-case universe and discloses missing rows', () => {
  const result = insights.marketInside([row({ cap: 500, change: 10 }), row({ cap: 250, change: 0 }), row({ cap: 150, change: 0 }), row({ cap: 100, change: -10 }), row({ cap: null, change: -99 })]);
  assert.equal(result.count, 4); assert.equal(result.total, 5); assert.equal(result.weighted, 4); assert.equal(result.equal, 0); assert.equal(result.withoutTop3, -10); assert.equal(result.topShare, 90); assert.equal(result.contribution, 5); assert.equal(result.divergence, true); assert.equal(result.signFlip, true);
});
test('excluding top three cannot fabricate a remainder when only three rows exist', () => {
  assert.equal(insights.marketInside([row(), row(), row()]).withoutTop3, null);
});
test('loss recovery is asymmetric, finite, and rejects a total loss', () => {
  assert.equal(insights.recoveryScenario(50).recovery, 100); assert.equal(insights.recoveryScenario(0).recovery, 0);
  assert.ok(Math.abs(insights.recoveryScenario(30).recovery - 42.857142857) < 1e-6);
  for (const loss of [-1, 100, 101, NaN, Infinity]) assert.equal(insights.recoveryScenario(loss), null);
  assert.equal(insights.targetDistance(80, 100), 25); assert.equal(insights.targetDistance(0, 100), null);
});
test('tradeoff deltas reject cross-sector or cross-market comparisons and retain missing values', () => {
  const base = row(); const candidate = row({ id: 'kospi:000660', per: 15, roe: null });
  const deltas = insights.peerTradeoffs(base, candidate);
  assert.equal(deltas[0].delta, 5); assert.equal(deltas[1].delta, null);
  assert.deepEqual(insights.peerTradeoffs(base, { ...candidate, market: 'nasdaq' }), []);
  assert.deepEqual(insights.peerTradeoffs(base, { ...candidate, sector: '금융' }), []);
});
test('shared URLs validate numeric bounds, market names, duplicate codes and four-stock maximum', () => {
  const result = model.readFilters(new URLSearchParams('market=bad&min=Infinity&per=-1&sort=bad'));
  assert.equal(result.market, 'kospi'); assert.equal(result.minChange, null); assert.equal(result.maxPer, null); assert.equal(result.sort, 'change');
  assert.deepEqual(model.compareIds(new URLSearchParams('codes=kospi:005930,kospi:005930,nasdaq:AAPL,bad,kosdaq:123456,nasdaq:MSFT,nasdaq:NVDA')), ['kospi:005930', 'nasdaq:AAPL', 'kosdaq:123456', 'nasdaq:MSFT']);
  assert.deepEqual(model.compareIds(new URLSearchParams('codes=')), []);
});
test('CSV preserves code text, quotes labels, and neutralizes formula cells', () => {
  const csv = model.rowsCsv([row({ name: '=HYPERLINK("x")' })]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"005930"')); assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(model.rowsCsv([row({ change: -2 })]).includes('"-2"'));
});
