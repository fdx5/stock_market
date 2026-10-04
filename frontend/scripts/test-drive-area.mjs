import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
const scope = { module: { exports: {} }, Date, Promise };
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/driveAreaPlan.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, scope);
const { driveAreaPlan, driveSurroundings, DriveAreaCache } = scope.module.exports;
const turn = () => new Promise(r => setImmediate(r));

test('all four directions are requested before a heading is known; nearby movement reuses the same anchor', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(driveSurroundings(0, 0))), [[480, 0], [-480, 0], [0, 480], [0, -480]]);
  assert.deepEqual(driveSurroundings(30, 80), driveSurroundings(0, 0));
});
test('fast travel starts preparation early without putting the next centre outside scene overlap', () => {
  const fast = driveAreaPlan({ x: 30, y: 0, hx: 1, hy: 0, speed: 50 });
  assert.equal(fast.due, true); assert.equal(fast.lead, 600);
  const reverse = driveAreaPlan({ x: 0, y: 0, hx: 1, hy: 0, speed: -6 });
  assert.equal(reverse.hx, -1);
});
test('two loads run together, turns promote queued regions, and return trips reuse completed data', async () => {
  const cache = new DriveAreaCache(), started = [], finish = new Map();
  const load = key => () => new Promise(done => { started.push(key); finish.set(key, done); });
  const east = cache.request('east', load('east')), west = cache.request('west', load('west'));
  const north = cache.request('north', load('north')), south = cache.request('south', load('south'));
  assert.deepEqual(started, ['east', 'west']);
  assert.equal(cache.request('south', load('duplicate'), true), south);
  finish.get('east')({ id: 'east' }); await turn();
  assert.deepEqual(started, ['east', 'west', 'south']);
  finish.get('west')({ id: 'west' }); await turn();
  finish.get('north')({ id: 'north' }); finish.get('south')({ id: 'south' });
  await Promise.all([east, west, north, south]);
  assert.equal((await cache.request('east', load('duplicate'))).id, 'east');
  assert.equal(started.length, 4);
});
test('failed regions back off, preventing a request storm every animation tick', async () => {
  const cache = new DriveAreaCache(); let count = 0;
  const load = async () => { count++; throw Error('offline'); };
  assert.equal(await cache.request('offline', load), null);
  assert.equal(await cache.request('offline', load), null);
  assert.equal(count, 1);
});
