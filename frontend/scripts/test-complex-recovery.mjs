import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync, buildSync } from 'esbuild';
import { SharedTextures, sharedTexturesFor } from '../src/components/tidewater/sharedTextures.js';

test('identical immutable pixels share one allocation until the last view releases them', () => {
  const pool = new SharedTextures(), rail = {}, modal = {};
  let allocations = 0, destroys = 0;
  const create = () => { allocations++; return { destroy() { destroys++; } }; };
  const first = pool.acquire('verified-asset/color', rail, create);
  assert.equal(pool.acquire('verified-asset/color', modal, create), first);
  assert.equal(pool.acquire('verified-asset/color', modal, create), first);
  assert.equal(allocations, 1);
  pool.releaseOwner(rail);
  assert.equal(destroys, 0);
  assert.equal(pool.peek('verified-asset/color'), first);
  pool.releaseOwner(modal);
  assert.equal(destroys, 1);
  assert.equal(pool.entries.size, 0);
  assert.equal(pool.byTexture.size, 0);
});

test('a replaced device never reuses another device\'s GPU textures', () => {
  const oldDevice = {}, replacement = {};
  assert.equal(sharedTexturesFor(oldDevice), sharedTexturesFor(oldDevice));
  assert.notEqual(sharedTexturesFor(oldDevice), sharedTexturesFor(replacement));
});

const { code } = transformSync(readFileSync(new URL('../src/staticCdn.ts', import.meta.url), 'utf8'), {
  loader: 'ts', format: 'esm', define: {
    'import.meta.env.DEV': 'false', 'import.meta.env.VITE_STATIC_CDN': '"https://assets.invalid"',
  },
});
const { fetchCriticalStatic } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('a CDN stalled before headers cannot hold the first GPU frame hostage', async () => {
  const original = globalThis.fetch;
  let remoteSignal;
  globalThis.fetch = async (url, { signal }) => {
    if (url.startsWith('https:')) {
      remoteSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    }
    return new Response('original bytes');
  };
  try {
    const response = await fetchCriticalStatic('/3d/detail.json');
    assert.equal(await response.text(), 'original bytes');
    assert.equal(remoteSignal.aborted, true);
  } finally { globalThis.fetch = original; }
});

test('a stalled CDN body also falls back without losing or altering the origin bytes', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, { signal }) => url.startsWith('https:') ? {
    ok: true, status: 200, headers: new Headers(),
    blob: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })),
  } : new Response(new Uint8Array([0, 13, 255, 64]));
  try {
    assert.deepEqual([...new Uint8Array(await (await fetchCriticalStatic('/3d/detail.webp')).arrayBuffer())], [0, 13, 255, 64]);
  } finally { globalThis.fetch = original; }
});

test('a fast CDN cancels the redundant origin request', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => { urls.push(url); return new Response('same asset'); };
  try {
    assert.equal(await (await fetchCriticalStatic('/3d/detail.json')).text(), 'same asset');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(urls, ['https://assets.invalid/3d/detail.json']);
  } finally { globalThis.fetch = original; }
});

test('worker bridge and sidewalk layouts retain every original sample and height', async () => {
  let reply;
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage(message, transfers) { reply = structuredClone(message, { transfer: transfers }); } };
  try {
    const bundle = buildSync({
      stdin: { contents: `import './sceneWorker'; export {findBridges} from './sceneBridges'; export {sidewalkRuns,ringIndex,carriageway} from './sceneSidewalk'; export {cutPaths,sidewalkPaths} from './sceneWalkers'; export {gridAt} from './waterCore'; export {FLAT} from './sceneTerrain'; export {makeGroundGeometry} from './groundGeometry';`,
        resolveDir: new URL('../src/components', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
      bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' },loader:{'.wasm':'binary'},
    }).outputFiles[0].text;
    const original = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));
    const roads = [{ line: [[-100, 0], [100, 0]], width: 14, lanes: 4 }, { line: [[80, -80], [80, 80]], width: 12, lanes: 2 }];
    const parcels = [{ kind: '\ucc9c', ring: [[-60,-100],[60,-100],[60,100],[-60,100]] }];
    const grid = { h: Float32Array.from({ length: 81 }, (_, i) => i / 10), n: 9, R: 200, cell: 50 };
    const expectedBridges = original.findBridges(roads, parcels, [false], { ...original.FLAT, at: original.gridAt(grid) });
    assert.ok(expectedBridges.length > 0);
    await self.onmessage({ data: { id: 1, op: 'bridges', args: { roads, parcels, covered: [false], grid } } });
    assert.deepEqual(reply.result, expectedBridges);
    const footprints = [[[5,10],[25,10],[25,30],[5,30]]];
    const expectedWalks = original.sidewalkRuns(roads, footprints);
    await self.onmessage({ data: { id: 2, op: 'sidewalks', args: { roads, footprints } } });
    assert.deepEqual(reply.result, expectedWalks);
    const paths = original.sidewalkPaths(expectedWalks), inside = original.ringIndex(footprints), onRoad = original.carriageway(roads,0.8), T = 90;
    const expectedPaths = original.cutPaths(paths,(x,y)=>Math.abs(x)>T || Math.abs(y)>T || inside(x,y) || onRoad(x,y));
    assert.ok(expectedPaths.length);
    await self.onmessage({data:{id:4,op:'walkPaths',args:structuredClone({paths,roads,footprints,T})}});
    assert.deepEqual(reply.result,expectedPaths);
    const ground=await original.makeGroundGeometry(30,200,{...original.FLAT,at:original.gridAt(grid)},320,async()=>true);
    await self.onmessage({data:{id:3,op:'terrainGround',args:{T:30,G:200,segs:320,grid}}});
    for (const name of ['position','normal','uv']) assert.deepEqual(reply.result[name],ground.attributes[name].array);
    assert.deepEqual(reply.result.index,ground.index.array);
    assert.deepEqual(reply.result.grid,ground.userData.grid);
    assert.deepEqual(reply.result.sphere.center,ground.boundingSphere.center.toArray());
    assert.equal(reply.result.sphere.radius,ground.boundingSphere.radius);
  } finally { globalThis.self = previousSelf; }
});
