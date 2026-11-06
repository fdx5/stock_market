import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: [new URL('../src/neo/nightQuoteRoutes.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], bundle: true, write: false, format: 'esm', platform: 'node' });
const { showNightQuote } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
test('all requested dashboards, maps, comparisons, ETF children and communities have the quote', () => {
  for (const path of ['/', '/desk', '/global', '/map', '/kosdaq-map', '/sp500-map', '/nasdaq100-map', '/stocks', '/markets', '/kospi-100', '/kosdaq-100', '/nasdaq-100', '/global-top100', '/fight', '/battle', '/index/kospi', '/index/kosdaq', '/stock-tradeoffs', '/recovery-lab', '/market-radar', '/stock-screener', '/stock-compare', '/sector-strength', '/global-peers', '/sector-replay', '/etf', '/etf/kr', '/etf/us', '/etf/compare/SPY/QQQ', '/ranking/us-etf', '/community/kr', '/community/global']) assert.equal(showNightQuote(path), true, path);
  assert.equal(showNightQuote('/stock/SPY', '?asset=ETF'), true);
});
test('unrequested community, admin and immersive routes remain outside the quote scope', () => {
  for (const path of ['/community/property', '/admin', '/drone-explore', '/stock/AAPL']) assert.equal(showNightQuote(path), false, path);
});
