import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { BoundedCache } from '../src/vendor/tidewater/engine/gpu/BoundedCache.js';
import { preprocess, reachableIdentifiers, stripUnusedFunctions } from '../src/vendor/tidewater/engine/gpu/ShaderText.js';

const source = readFileSync(new URL('../src/vendor/tidewater/engine/gpu/ShaderAnalysis.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function')
  .replace("new URL('./ShaderTextWorker.js', import.meta.url)", "'shader-worker'");
function fixture() {
  const workers = [], timers = new Map(); let nextTimer = 0;
  class Worker {
    constructor() { this.jobs = []; workers.push(this); }
    postMessage(job) { if (this.failPost) throw Error('clone failed'); this.jobs.push(job); }
    terminate() { this.terminated = true; }
    complete() {
      for (const { id, op, code, defines } of this.jobs.splice(0)) {
        const full = preprocess(code, defines);
        const value = op === 'reach' ? { usedV: reachableIdentifiers(full, 'vs'), usedF: /@fragment\s+fn\s+fs\b/.test(full) ? reachableIdentifiers(full, 'fs') : null } : stripUnusedFunctions(full);
        this.onmessage({ data: { id, value } });
      }
    }
  }
  const context = vm.createContext({ Worker, BoundedCache, Map, Promise, Error, JSON,
    setTimeout(f) { timers.set(++nextTimer, f); return nextTimer; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(source + ';globalThis.analyze = shaderAnalysis;', context);
  return { analyze: context.analyze, workers, timers };
}
const code = '#if COLOUR\nfn tint() -> f32 { return 0.75; }\n#else\nfn tint() -> f32 { return 0.25; }\n#endif\n@vertex fn vs() -> @builtin(position) vec4f { return vec4f(tint()); }';

test('concurrent identical finish jobs run once and preserve exact WGSL bytes', async () => {
  const f = fixture(), requests = Array.from({ length: 100 }, () => f.analyze('finish', code, { COLOUR: 1 }));
  assert.equal(f.workers[0].jobs.length, 1);
  assert.ok(requests.every(p => p === requests[0]));
  f.workers[0].complete();
  const expected = stripUnusedFunctions(preprocess(code, { COLOUR: 1 }));
  assert.deepEqual(await Promise.all(requests), Array(100).fill(expected));
  assert.equal(await f.analyze('finish', code, { COLOUR: 1 }), expected);
  assert.equal(f.workers[0].jobs.length, 0);
});

test('different defines, shader sources and analysis operations stay independent', async () => {
  const f = fixture(), a = f.analyze('finish', code, { COLOUR: 1 }), b = f.analyze('finish', code, { COLOUR: 0 }), c = f.analyze('reach', code, { COLOUR: 1 });
  assert.equal(f.workers[0].jobs.length, 3); f.workers[0].complete();
  assert.notEqual(await a, await b);
  assert.ok((await c).usedV.has('tint'));
  const next = f.analyze('finish', code + '\nfn unused() {}', { COLOUR: 1 });
  assert.equal(f.workers[0].jobs.length, 1); f.workers[0].complete();
  assert.equal(await next, await a);
});

test('worker failure rejects every shared waiter and permits a clean retry', async () => {
  const f = fixture(), jobs = Array.from({ length: 20 }, () => f.analyze('finish', code, {}));
  const outcomes = Promise.allSettled(jobs), old = f.workers[0];
  old.onerror({ message: 'worker stopped' });
  assert.ok((await outcomes).every(x => x.status === 'rejected'));
  const retry = f.analyze('finish', code, {}); assert.equal(f.workers.length, 2);
  old.complete(); f.workers[1].complete();
  assert.equal(await retry, stripUnusedFunctions(preprocess(code, {})));
});

test('a synchronous postMessage failure is retryable and leaves no pending job', async () => {
  const f = fixture(), initial = f.analyze('finish', code, {}); f.workers[0].complete(); await initial;
  f.workers[0].failPost = true;
  await assert.rejects(f.analyze('finish', 'bad', {}), /clone failed/);
  f.workers[0].failPost = false;
  const retry = f.analyze('finish', 'bad', {}); f.workers[0].complete(); await retry;
  assert.equal(f.timers.size, 1);
});

test('completed text has a bounded cache and recreates evicted entries', async () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) { const p = f.analyze('finish', code + '\n//' + i, {}); f.workers[0].complete(); await p; }
  const retry = f.analyze('finish', code + '\n//0', {});
  assert.equal(f.workers[0].jobs.length, 1); f.workers[0].complete(); await retry;
  for (const timer of f.timers.values()) timer();
  assert.equal(f.workers[0].terminated, true);
  const cached = await f.analyze('finish', code + '\n//0', {});
  assert.equal(f.workers.length, 1); assert.equal(typeof cached, 'string');
});
