import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production loader with controllable device/network lifetimes.
const source = readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('async function loadDetails()'), source.indexOf('onSceneMemoryRelease(() =>'));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ failUpload = false, waitSlice = false, failTexture = false } = {}) {
  const slice = deferred(), calls = [], bitmaps = [], textures = [];
  const scope = {
    detailEpoch: 0, details: null,
    fetchCriticalStatic: async path => {
      calls.push(['fetch', path]);
      return { ok: true, json: async () => ({ paint: { file: 'paint.webp', metres: 2, avgRough: .7 }, roof: { file: 'roof.webp', metres: 3, avgRough: .8 } }), blob: async () => ({ path }) };
    },
    createImageBitmap: async (blob, options) => {
      assert.equal(options.colorSpaceConversion, 'none');
      assert.equal(options.premultiplyAlpha, 'none');
      const bmp = { width: 512, height: 512, closed: 0, close() { this.closed++; } };
      bitmaps.push(bmp); return bmp;
    },
    frameSlice: async () => { calls.push(['slice']); if (waitSlice) await slice.promise; },
    Texture: class {
      constructor(options) { if (failTexture) throw Error('allocation failed'); this.options = options; this.destroyed = 0; textures.push(this); }
      getGPU() { return this; }
      destroy() { this.destroyed++; }
    },
    GPU: { queue: { copyExternalImageToTexture() { calls.push(['upload']); if (failUpload) throw Error('copy failed'); } }, submit() { calls.push(['submit']); } },
    generateMipmaps: () => { calls.push(['mips']); },
  };
  const context = vm.createContext(scope);
  vm.runInContext(loader + '\nglobalThis.load = loadDetails;', context);
  return { scope, slice, calls, bitmaps, textures, load: scope.load };
}

test('detail downloads decode concurrently; uploads wait for background admission', async () => {
  const f = fixture({ waitSlice: true }), done = f.load();
  await tick();
  assert.equal(f.bitmaps.length, 2);
  assert.equal(f.calls.filter(c => c[0] === 'fetch').length, 3);
  assert.equal(f.textures.length, 0);
  f.slice.resolve(); await done;
  assert.equal(f.bitmaps.length, 2);
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, 2);
  assert.equal(f.calls.filter(c => c[0] === 'slice').length, 2);
  assert.ok(f.bitmaps.every(b => b.closed === 1));
  assert.equal(f.scope.details.paint.metres, 2);
  assert.ok(f.textures.every(t => t.options.format === 'rgba8unorm' && t.options.mips));
});

test('a failed texture allocation closes every decoded bitmap', async () => {
  const f = fixture({ failTexture: true });
  await assert.rejects(f.load(), /allocation failed/);
  assert.equal(f.bitmaps.length, 2);
  assert.ok(f.bitmaps.every(b => b.closed === 1));
  assert.equal(f.textures.length, 0);
});

test('closing after decoding but before admission closes every bitmap without GPU allocation', async () => {
  const f = fixture({ waitSlice: true });
  const done = f.load(); await tick();
  assert.equal(f.bitmaps.length, 2);
  f.scope.detailEpoch++; f.slice.resolve(); await done;
  assert.ok(f.bitmaps.every(b => b.closed === 1));
  assert.equal(f.textures.length, 0);
  assert.equal(f.scope.details, null);
});

test('a failed upload closes bitmaps and destroys all partial textures', async () => {
  const f = fixture({ failUpload: true });
  await assert.rejects(f.load(), /copy failed/);
  assert.ok(f.bitmaps.every(b => b.closed === 1));
  assert.ok(f.textures.every(t => t.destroyed === 1));
  assert.equal(f.scope.details, null);
});
