import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { EventDispatcher } from 'three';
async function source(name) {
  const { code } = transformSync(readFileSync(new URL(`../src/components/${name}.ts`, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { SceneResources } = await source('sceneResources');
const { onSceneMemoryRelease, retainSceneMemory } = await source('sceneMemory');
class Resource extends EventDispatcher {
  disposed = 0;
  dispose() { this.disposed++; this.dispatchEvent({ type: 'dispose' }); }
}
test('closing a sheet retains shared resources for the rail until its final lease closes', () => {
  let freed = 0;
  onSceneMemoryRelease(() => freed++);
  const rail = retainSceneMemory(), sheet = retainSceneMemory();
  sheet(); sheet(); assert.equal(freed, 0);
  rail(); rail(); assert.equal(freed, 1);
  const reopened = retainSceneMemory(); reopened(); assert.equal(freed, 2);
});
test('replaced geometry is released once and late async results cannot refill a closed owner', () => {
  const owner = new SceneResources(), old = owner.keep(new Resource()), live = owner.keep(new Resource());
  owner.keep(live); old.dispose();
  owner.forEach(r => r.dispose()); owner.forEach(r => r.dispose());
  assert.equal(old.disposed, 1); assert.equal(live.disposed, 1);
  const late = owner.keep(new Resource()); assert.equal(late.disposed, 1);
  assert.equal(live._listeners.dispose.length, 0);
});
