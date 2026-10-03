import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { Group } from 'three';

const source = readFileSync(new URL('../src/components/ComplexHologram.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    let plantsRevision = 0;');
const end = source.indexOf('    afterShown(() => {', start);
assert.ok(start > 0 && end > start);
const { code } = transformSync(source.slice(start, end) + '\nreturn {showPlants, close:()=>{alive=false;disposables.forEach(x=>x.dispose());}};', { loader: 'tsx' });
function fixture() {
  const pending = [], warm = [], decor = new Group(), stage = { hq: true, addWarm: (root, mesh) => warm.push(() => root.add(mesh)) };
  const api = new Function('THREE', 'buildPlants', 'timed', 'seed', 'terrain', 'stage', 'decor', 'disposables', 'hostRef', 'alive', code)(
    { Group }, (...args) => new Promise(resolve => pending.push({ resolve, args })), (_, fn) => fn(), 42, {}, stage, decor, [], { current: { dataset: {} } }, true);
  return { ...api, pending, warm, decor, stage };
}
const plants = () => ({ mesh: new Group(), disposed: 0, updates: 0, dispose() { this.disposed++; }, update() { this.updates++; }, focus() {} });
test('initial planting starts without water or crowd dependencies and preserves quality inputs', async () => {
  const f = fixture(), plan = { trees: [[1, 2]], shrubs: [], flowers: [], street: [] }, initial = f.showPlants(plan, 'initial'), p = plants();
  assert.equal(f.pending.length, 1); assert.equal(f.pending[0].args[0], plan); assert.equal(f.pending[0].args[1], 42); assert.equal(f.pending[0].args[3], true);
  f.pending[0].resolve(p); await initial; assert.equal(p.updates, 1); assert.equal(f.decor.children.length, 1);
});
test('late initial completion cannot replace the accurate final planting', async () => {
  const f = fixture(), initial = f.showPlants({}, 'initial'), complete = f.showPlants({}, 'complete'), old = plants(), final = plants();
  f.pending[1].resolve(final); await complete; f.pending[0].resolve(old); await initial;
  assert.equal(old.disposed, 1); assert.equal(final.disposed, 0); assert.equal(f.stage.plantsFocus, final.focus); assert.equal(f.decor.children.length, 1);
});
test('replacement releases the old forest and late compilation cannot reattach it to the scene', async () => {
  const f = fixture(), old = plants(), first = f.showPlants({}, 'initial'); f.pending[0].resolve(old); await first;
  const oldRoot = f.decor.children[0], final = plants(), next = f.showPlants({}, 'complete'); f.pending[1].resolve(final); await next;
  f.warm.forEach(fn => fn()); assert.equal(oldRoot.parent, null); assert.equal(old.disposed, 1); assert.equal(f.decor.children.length, 1);
  f.close(); f.close(); assert.equal(final.disposed, 1); assert.equal(f.stage.plantsFocus, undefined);
});
test('a model closed during plant preparation disposes the result without attachment', async () => {
  const f = fixture(), pending = f.showPlants({}, 'initial'), p = plants(); f.close(); f.pending[0].resolve(p); await pending;
  assert.equal(p.disposed, 1); assert.equal(f.decor.children.length, 0);
});
