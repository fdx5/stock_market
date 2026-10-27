import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = await mkdtemp(path.join(tmpdir(), 'etf-market-'));
const out = path.join(dir, 'model.mjs');
await build({ absWorkingDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), entryPoints: ['src/neo/etf/model.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node' });
const { readEtfChoices, etfUrl, selectEtfs, popularEtfs, summarizeEtfs, position52, volumeRatio } = await import(pathToFileURL(out));
const fund = (code, extra = {}) => ({ code, name: code, benchmark: 'S&P 500', category: '지수', region: 'US', turnover: 100,
  volume: 10, change_pct: 1, close: 110, week52_low: 100, week52_high: 200, average_volume: 5,
  returns: { d20: null, d60: null, d120: null, ytd: null }, ...extra });
const items = [fund('A', { turnover: 300, returns: { d20: -5 }, change_pct: -1 }),
  fund('B', { turnover: 200, returns: { d20: 0 }, name: 'ProShares UltraPro QQQ', category: '레버리지' }),
  fund('C', { turnover: 0, volume: 0, change_pct: 0 }), fund('D', { turnover: 100, returns: { d20: 8 }, change_pct: 3 }),
  fund('E', { turnover: NaN, volume: NaN, change_pct: NaN })];
const defaults = readEtfChoices('');
assert.equal(defaults.view, 'table');
assert.deepEqual(selectEtfs(items, { ...defaults, sort: 'd20', direction: 'asc' }).map(e => e.code), ['A', 'B', 'D', 'C', 'E']);
assert.deepEqual(selectEtfs(items, { ...defaults, sort: 'd20' }).map(e => e.code), ['D', 'B', 'A', 'C', 'E']);
assert.deepEqual(selectEtfs(items, { ...defaults, q: 's&p', screen: 'plain', category: '지수' }).map(e => e.code), ['A', 'D', 'C', 'E']);
assert.deepEqual(selectEtfs(items, { ...defaults, screen: 'rising' }).map(e => e.code), ['B', 'D']);
assert.deepEqual(popularEtfs(items).map(e => e.code), ['A', 'B', 'D']);
assert.equal(items[0].code, 'A', 'filtering and rankings must not reorder the source');
assert.equal(volumeRatio(fund('X', { average_volume: 0 })), null);
assert.equal(position52(fund('X', { week52_high: 100 })), null);
assert.equal(position52(fund('X', { close: 300 })), 100);
const choices = readEtfChoices('?q=반도체&category=섹터&sort=name&dir=desc&view=card&screen=plain&compare=SPY,QQQ,SPY,IWM,GLD,TLT,<script>');
assert.deepEqual(choices.compare, ['SPY', 'QQQ', 'IWM', 'GLD']);
assert.deepEqual(readEtfChoices(etfUrl('US', choices).split('?')[1]), choices);
assert.equal(etfUrl('KR', defaults), '/etf/kr');
assert.equal(readEtfChoices('?sort=invalid&view=invalid&screen=invalid').sort, 'turnover');
const summary = summarizeEtfs(items);
assert.equal(summary.total, 600);
assert.deepEqual([summary.up, summary.down, summary.flat], [2, 1, 1]);
assert.ok(Math.abs(summary.categories.reduce((sum, c) => sum + c.share, 0) - 100) < 1e-9);
console.log('PASS ETF filters, missing-data sorting, activity rankings, summary coverage and shareable URL choices');
