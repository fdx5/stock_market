import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {GpuFrameHealth} from '../src/components/tidewater/GpuFrameHealth.js';

function fixture() {
  let clock = 0, complete, reject, calls = 0;
  const device = new EventTarget();
  device.queue = {onSubmittedWorkDone() { calls++; return new Promise((yes, no) => {complete = yes; reject = no;}); }};
  const health = new GpuFrameHealth(device, () => clock);
  return {device, health, tick: t => {clock = t;}, complete: () => complete(), reject: () => reject(new Error('test')),
    calls: () => calls};
}

test('asynchronous validation errors invalidate a renderer that still returns from render', () => {
  const f = fixture();
  f.health.check();
  f.device.dispatchEvent(new Event('uncapturederror'));
  assert.throws(() => f.health.check(), /gpu-validation/);
  f.health.dispose();
});

test('queue progress is bounded to one probe and a stalled submitted frame triggers recovery', async () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) f.health.submitted();
  assert.equal(f.calls(), 1);
  f.tick(8001);
  assert.throws(() => f.health.check(), /gpu-submit-timeout/);
  f.health.dispose();
});

test('successful queue completions are checked once a second, never once per frame', async () => {
  const f = fixture();
  f.health.submitted(); f.complete(); await Promise.resolve();
  f.tick(999); f.health.submitted();
  assert.equal(f.calls(), 1);
  f.tick(1000); f.health.submitted();
  assert.equal(f.calls(), 2);
  f.complete(); await Promise.resolve();
  f.tick(10000); f.health.check();
  f.health.dispose();
});

test('rejected GPU work triggers recovery and disposed views ignore late work', async () => {
  const f = fixture(); f.health.submitted(); f.reject(); await Promise.resolve();
  assert.throws(() => f.health.check(), /gpu-submit-rejected/);
  f.health.dispose();
  const old = fixture(); old.health.submitted(); old.health.dispose();
  old.device.dispatchEvent(new Event('uncapturederror')); old.reject(); await Promise.resolve();
  assert.equal(old.health.failure, null);
});

test('disposed WebGL shader programs cannot strand the scene compilation gate', async () => {
  const code = await transform(readFileSync(new URL('../src/components/safeCompile.ts', import.meta.url), 'utf8'), {loader:'ts',format:'esm'});
  const {safeCompileAsync} = await import('data:text/javascript;base64,' + Buffer.from(code.code).toString('base64'));
  const material = {};
  const renderer = {compile: () => new Set([material]), extensions:{has:()=>true},
    properties:{get:()=>({currentProgram:{program:{},isReady(){throw new TypeError('disposed test program');}}})}};
  await Promise.race([safeCompileAsync(renderer, {}, {}), new Promise((_,reject)=>setTimeout(()=>reject(new Error('compile gate stranded')),1000))]);
});
