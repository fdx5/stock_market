import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Exercise the actual kit loader with independently delayed asset requests.
const street = readFileSync(new URL('../src/components/sceneStreet.ts', import.meta.url), 'utf8');
const loader = street.slice(street.indexOf('let kit: Promise<'), street.indexOf('/** Head and tail lamps'));
const { code } = transformSync(loader + '\nreturn {loadKit};', { loader: 'ts' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const texture = () => ({ disposed: 0, dispose() { this.disposed++; } });
function fixture() {
  const shapes = deferred(), image = deferred(), steel = deferred(); let release;
  const api = new Function('THREE', 'vehicleShapes', 'bitmapTexture', 'preparedSteel', 'onSceneMemoryRelease', code)(
    {}, () => shapes.promise, () => image.promise, () => steel.promise, fn => { release = fn; });
  return { ...api, shapes, image, steel, release: () => release() };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
test('a late prepared map cannot delay vehicles and its unused bitmap is released', async () => {
  const f = fixture(), pending = f.loadKit(); f.shapes.resolve({}); f.image.resolve(texture());
  const kit = await pending; assert.equal(kit.steel, null);
  const late = texture(); f.steel.resolve(late); await flush(); assert.equal(late.disposed, 1);
  f.release(); await flush(); assert.equal(kit.texture.disposed, 1);
});
test('an early prepared map lives until the final scene memory release', async () => {
  const f = fixture(), pending = f.loadKit(), steel = texture();
  f.steel.resolve(steel); await flush(); f.shapes.resolve({}); f.image.resolve(texture());
  assert.equal((await pending).steel, steel); assert.equal(steel.disposed, 0);
  f.release(); await flush(); assert.equal(steel.disposed, 1);
});
test('failed vehicle preparation releases an already decoded steel bitmap', async () => {
  const f = fixture(), pending = f.loadKit(), steel = texture();
  f.steel.resolve(steel); await flush(); f.shapes.reject(new Error('unavailable'));
  await assert.rejects(pending, /unavailable/); assert.equal(steel.disposed, 1);
});
test('closing during preparation releases the late kit without refilling the cache', async () => {
  const f = fixture(), pending = f.loadKit(), steel = texture();
  f.steel.resolve(steel); await flush(); f.release(); f.shapes.resolve({}); f.image.resolve(texture());
  const kit = await pending; await flush(); assert.equal(steel.disposed, 1); assert.equal(kit.texture.disposed, 1);
  assert.notEqual(f.loadKit(), pending);
});
