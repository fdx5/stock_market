import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('empty or malformed visitor responses never turn nullable counts into undefined', async () => {
  const rt = globalThis.__visitorTest = { state: null, effect: null };
  const ticks = [];
  globalThis.window = { setInterval(fn) { ticks.push(fn); return 1; }, clearInterval() {} };
  let response = {};
  globalThis.fetch = async () => ({ json: async () => response });
  const built = await build({ entryPoints: [fileURLToPath(new URL('../src/useVisitorCount.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'memory-only-hooks', setup(b) {
    b.onResolve({ filter: /^(react|\.\/session)$/ }, args => ({ path: args.path, namespace: 'memory' }));
    b.onLoad({ filter: /.*/, namespace: 'memory' }, ({ path }) => ({ contents: path === 'react' ? `export const useEffect=fn=>{globalThis.__visitorTest.effect=fn;}; export const useState=value=>{const rt=globalThis.__visitorTest;rt.state=value;return [value,next=>{rt.state=typeof next==='function'?next(rt.state):next;}];};` : `export const getSessionId=()=>'memory-only';` }));
  } }] });
  const { useVisitorCount } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  useVisitorCount(); const cleanup = rt.effect(); await flush();
  assert.deepEqual(rt.state, { current: null, total: null });
  response = { count: 3, total: 40 }; ticks[0](); await flush();
  assert.deepEqual(rt.state, { current: 3, total: 40 });
  for (const bad of [null, {}, { count: -1, total: '40' }, { count: Infinity }, []]) {
    response = bad; ticks[0](); await flush();
    assert.deepEqual(rt.state, { current: 3, total: 40 });
  }
  cleanup();
});
