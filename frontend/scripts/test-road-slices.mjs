import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
// The road builders cut into frame slices (sceneStreet.ts: buildTraffic's node and junction cells,
// buildRoadMarkings' box test, the sliced arrays and normals) against the same builders as they were
// before sliced loading (bc732af), on generated networks: the same arms, junctions and paint, to the bit.
globalThis.document ??= {hidden: true};
globalThis.requestAnimationFrame ??= f => setTimeout(() => f(performance.now()), 0);
const dir = new URL('../src/components/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const bundle = async contents => {
  // (asset URLs and wasm by name only: none is loaded by these builders)
  const assets = {name: 'assets', setup(b) {
    b.onResolve({filter: /\?(url|worker)$|\.wasm$/}, a => ({path: a.path, namespace: 'asset'}));
    b.onLoad({filter: /.*/, namespace: 'asset'}, a => ({contents: `export default ${JSON.stringify(a.path)};`, loader: 'js'}));
  }};
  const out = await build({stdin: {contents, resolveDir: dir, loader: 'ts', sourcefile: 'sceneStreet.ts'}, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [assets], loader: {'.png': 'empty', '.jpg': 'empty', '.glb': 'empty', '.bin': 'empty', '.json': 'json'}, define: {'import.meta.env': '{"DEV":false,"PROD":true}'}});
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const fs = await import('node:fs');
const now = await bundle(fs.readFileSync(dir + 'sceneStreet.ts', 'utf8'));
const old = await bundle(execFileSync('git', ['show', 'bc732af:frontend/src/components/sceneStreet.ts'], {cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26}));
const slicedMod = await bundle(`export * from './slicedGeometry';`);
const THREE = await import('three');
// (frameSlice's message channel keeps node running: done when the tests are)
after(() => setImmediate(() => process.exit()));

/** A jittered street grid with diagonals, stubs and a few bridges; widths 4-32 m. */
const network = seed => {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, roads = [];
  const N = 9, S = 90;
  const pt = (i, j) => [i * S + (rnd() - .5) * 14, j * S + (rnd() - .5) * 14];
  const grid = [];
  for (let i = 0; i <= N; i++) { grid.push([]); for (let j = 0; j <= N; j++) grid[i].push(pt(i, j)); }
  const road = (line, extra = {}) => roads.push({line, width: [4, 6, 8, 12, 20, 32][Math.floor(rnd() * 6)], lanes: [1, 2, 2, 4, 6][Math.floor(rnd() * 5)], oneway: rnd() < .1, ...extra});
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    if (i < N && rnd() < .85) { const a = grid[i][j], b = grid[i + 1][j]; road([a, [(a[0] + b[0]) / 2 + (rnd() - .5) * 6, (a[1] + b[1]) / 2 + (rnd() - .5) * 6], b]); }
    if (j < N && rnd() < .85) road([grid[i][j], grid[i][j + 1]]);
    if (i < N && j < N && rnd() < .12) road([grid[i][j], grid[i + 1][j + 1]], rnd() < .3 ? {structure: 'bridge'} : {});
    if (rnd() < .1) { const a = grid[i][j]; road([[a[0] + 30, a[1] + 2], [a[0] + 30 + (rnd() - .5) * 20, a[1] + 40]]); }
  }
  return roads;
};
const crossingsOf = (roads, seed) => {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, out = [], pts = [];
  for (const r of roads) if (rnd() < .3) { const [a, b] = r.line, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, h = r.width / 2 + 2;
    out.push({line: [[m[0] - dy / l * h, m[1] + dx / l * h], [m[0] + dy / l * h, m[1] - dx / l * h]], layer: 0});
    if (rnd() < .5) pts.push({at: m, marked: rnd() < .7}); }
  return {crossings: out, points: pts};
};
const armsOf = async (mod, roads, seed, crossings, points) => {
  let arms = null;
  const signals = roads.filter((_, i) => i % 7 === 0).map(r => ({at: r.line[0], layer: 0}));
  await Promise.race([mod.buildTraffic(roads, seed, true, undefined, crossings, a => { arms = a; }, signals, points).catch(() => null), new Promise(r => { const t = setInterval(() => { if (arms) { clearInterval(t); r(); } }, 5); })]);
  return arms;
};
const describe = (arms) => ({
  roads: arms.roads.map(r => JSON.stringify(r.line)),
  inside: arms.roads.map((_, i) => arms.inside(i)),
  layout: arms.roads.flatMap((_, i) => [true, false].map(e => JSON.stringify(arms.at(i, e)))),
  crossings: JSON.stringify(arms.crossings),
});

test('the traffic network in slices: the same junction arms, stubs and crossings', async () => {
  for (const seed of [3, 11, 29, 47]) {
    const roads = network(seed), {crossings, points} = crossingsOf(roads, seed + 5);
    const a = await armsOf(now, roads, seed, crossings, points), b = await armsOf(old, roads, seed, crossings, points);
    assert.ok(a && b, 'arms reported');
    const d = describe(a);
    // (a network with junction arms, stubs inside junctions and crossings to compare)
    assert.ok(d.layout.filter(x => x !== 'null').length > 40 && d.inside.some(Boolean) && a.crossings.length > crossings.length, 'a real network');
    assert.deepEqual(d, describe(b));
  }
});

test('the road paint in slices: the same vertices and normals, to the bit', async () => {
  for (const seed of [5, 17]) {
    const roads = network(seed), {crossings, points} = crossingsOf(roads, seed + 3);
    const arms = await armsOf(old, roads, seed, crossings, points);
    const [a, b] = await Promise.all([now, old].map(m => m.buildRoadMarkings(arms.roads, undefined, arms.at, arms.inside, arms.crossings)));
    assert.equal(a.group.children.length, b.group.children.length);
    a.group.children.forEach((m, k) => {
      const o = b.group.children[k];
      for (const name of ['position', 'normal', 'roadLevel', 'roadProfile']) {
        const x = m.geometry.getAttribute(name).array, y = o.geometry.getAttribute(name).array;
        assert.equal(x.length, y.length, name);
        assert.ok(Buffer.compare(Buffer.from(x.buffer, x.byteOffset, x.byteLength), Buffer.from(y.buffer, y.byteOffset, y.byteLength)) === 0, name + ' differs');
      }
    });
  }
});

test('sliced flat normals are three\'s computeVertexNormals, to the bit', async () => {
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const P = new Float32Array(3 * 3 * 4000).map(() => (rnd() - .5) * 400);
  for (let i = 0; i < 90; i++) P[i] = 0; // degenerate triangles too
  const g1 = new THREE.BufferGeometry(), g2 = new THREE.BufferGeometry();
  g1.setAttribute('position', new THREE.BufferAttribute(P, 3)); g2.setAttribute('position', new THREE.BufferAttribute(P.slice(), 3));
  g1.computeVertexNormals(); await slicedMod.flatNormalsSliced(g2);
  const x = g1.getAttribute('normal').array, y = g2.getAttribute('normal').array;
  assert.ok(Buffer.compare(Buffer.from(x.buffer), Buffer.from(y.buffer)) === 0);
  const nums = Array.from({length: 200000}, () => (rnd() - .5) * 1e5);
  const f = await slicedMod.float32Sliced(nums);
  assert.ok(Buffer.compare(Buffer.from(f.buffer), Buffer.from(new Float32Array(nums).buffer)) === 0);
});
