import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const code = buildSync({ stdin: {
  contents: `export { compactExtrude as original } from './fixtures/compact-extrude-original.ts';
    export { neighbourArrays, neighbourGeometry } from '../src/components/neighbourGeometry.ts';`,
  resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts',
}, bundle: true, write: false, platform: 'node', format: 'esm' }).outputFiles[0].text;
const { original, neighbourArrays, neighbourGeometry } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('transferred neighbours retain the original vertices, normals, UV, indices and colors', () => {
  const outlines = [
    [[[0, 0], [18, 0], [18, 14], [0, 14]]],
    [[[0, 0], [0, 14], [18, 14], [18, 0]]],
    [[[0, 0], [30, 0], [30, 20], [0, 20]], [[5, 5], [5, 10], [10, 10], [10, 5]]],
    [[[0, 0], [30, 0], [30, 10], [15, 10], [15, 25], [0, 25]]],
    [[[0, 0], [0, 0], [18, 0], [18, 14], [0, 14], [0, 0]]],
  ];
  let count = 0;
  for (const rings of outlines) for (const height of [1, 14, 120])
    for (const base of [0, 5]) for (const ground of [-12.375, 0, 89.25])
      for (const floors of [0, 1, 17]) for (const floorM of [2.7, 2.9, 3.5]) {
        const building = { rings, height, base, floors };
        const ref = original(building, ground, floorM);
        const arrays = neighbourArrays({ building, ground, floorM, color: [.137, .502, .973] });
        const moved = structuredClone(arrays, { transfer: Object.values(arrays).map(a => a.buffer) });
        assert.equal(arrays.position.byteLength, 0, 'source arrays must actually transfer');
        const actual = neighbourGeometry(moved);
        for (const name of ['position', 'normal', 'uv']) assert.deepEqual(actual.getAttribute(name).array, ref.getAttribute(name).array);
        assert.deepEqual(actual.index.array, ref.index.array);
        const color = actual.getAttribute('color').array;
        for (let i = 0; i < color.length; i++) assert.equal(color[i], Math.fround([.137, .502, .973][i % 3]));
        actual.dispose(); ref.dispose(); count++;
      }
  assert.equal(count, 810);
});
