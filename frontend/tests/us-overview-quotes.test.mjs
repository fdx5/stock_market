import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
const source = readFileSync(new URL('../src/desk2/discover/usOverviewQuotes.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { usOverviewQuotes, usSessionItems } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const ticker = [{ symbol: '^GSPC', price: 6000, change_pct: -2, quote_time: 100, points: [5900, 6000] },
  { symbol: 'ES=F', price: 6100, change_pct: 1, quote_time: 200, points: [6000, 6100] }];
test('pre/post leads with explicit futures and preserves cash prices, moves and times', () => {
  for (const session of ['pre', 'post']) {
    const rows = usOverviewQuotes(ticker, session);
    assert.deepEqual(rows.map(q => q.symbol), ['ES=F', 'NQ=F', '^GSPC', '^NDX']);
    assert.equal(rows[0].price, 6100); assert.equal(rows[0].change, 1);
    assert.match(rows[0].name, /선물/); assert.match(rows[2].basis, /정규장/);
    assert.equal(rows[2].price, 6000); assert.equal(rows[2].change, -2);
    assert.equal(Date.parse(rows[0].time), 200000); assert.equal(Date.parse(rows[2].time), 100000);
  }
});
test('regular leads with cash and missing futures never reuse cash as a synthetic price', () => {
  assert.equal(usOverviewQuotes(ticker, 'regular')[0].symbol, '^GSPC');
  assert.equal(usOverviewQuotes(ticker, 'pre')[1].price, undefined);
});
test('pre-market aggregates exclude old regular and after-hours rows', () => {
  const rows = [{ code: 'A', session: 'pre' }, { code: 'B', session: 'regular' }, { code: 'C', session: 'post' }];
  assert.deepEqual(usSessionItems(rows, 'pre').map(q => q.code), ['A']);
  assert.deepEqual(usSessionItems(rows, 'post').map(q => q.code), ['C']);
  assert.equal(usSessionItems(rows, 'regular'), rows);
});
