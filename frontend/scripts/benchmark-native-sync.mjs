// CPU-only production-sync comparison; no APIs, files or persistent databases are mutated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import * as THREE from 'three';
import { Mesh } from '../src/vendor/tidewater/engine/scene/Mesh.js';

const file = 'frontend/src/components/tidewater/ComplexRenderer.js';
const old = execFileSync('git', ['show', '3e71dc0:' + file], { encoding: 'utf8' });
const next = readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js', import.meta.url), 'utf8');
function method(source) {
  const start = source.indexOf('  sync(source, camera) {');
  const end = source.indexOf('  /** The materials of a model taken off the scene:', start);
  return vm.runInNewContext('({' + source.slice(start, end) + '}).sync', {
    Mesh, performance, Set, Map, Array,
    sameMatrix(a, b) { for (let i = 0; i < 16; i++) if (a.elements[i] !== b.elements[i]) return false; return true; },
    sourceMaterialsMatch: (a, b) => a.source === b,
    updateForestLod() {}, boundTextures: () => new Set(), READY_COLOUR_PASSES: [], READY_CASTER_PASSES: [],
  });
}
const methods = { before: method(old), after: method(next) };
function fixture(count) {
  const scene = new THREE.Scene(); scene.matrixAutoUpdate = false;
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const native = { source: material, dispose() {}, uniformBlock: {} };
  const objects = Array.from({ length: count }, (_, i) => {
    const o = new THREE.Mesh(geometry, material); o.matrixAutoUpdate = false;
    o.matrix.makeTranslation(i % 150 * 12, 0, Math.floor(i / 150) * 12); scene.add(o); return o;
  });
  scene.updateMatrixWorld();
  const meshes = new Map(objects.map(o => { const mesh = new Mesh(geometry, native); mesh.matrix.copy(o.matrixWorld); mesh.worldTransformVersion = 0; mesh.count = 1; return [o, mesh]; }));
  const adapter = { shown: true, frameNo: 1, meshes, materials: new Map([[material, native]]), textures: new Map(),
    scene: { add() {}, remove() {} }, renderer: { retainGeometry() {}, geometryReady: () => true }, imagesReady: () => true, material: () => native };
  return { adapter, objects, scene };
}
// Check exact surviving objects and matrices under visibility, removal and motion.
const correctness = Object.fromEntries(Object.keys(methods).map(k => [k, fixture(240)]));
for (let frame = 0; frame < 40; frame++) {
  for (const [kind, f] of Object.entries(correctness)) {
    for (let i = 0; i < f.objects.length; i++) {
      const o = f.objects[i]; o.visible = (i + frame) % 11 !== 0;
      o.matrix.elements[12] = i + frame / 7; o.matrixWorldNeedsUpdate = true;
    }
    methods[kind].call(f.adapter, f.scene, null); f.adapter.frameNo++;
  }
  const state = kind => { const f = correctness[kind]; return f.objects.map(o => { const m = f.adapter.meshes.get(o); return m ? [...m.matrix.elements] : null; }); };
  assert.deepEqual(state('after'), state('before'), `same admitted geometry and transforms, frame ${frame}`);
}
const rows = [];
for (const count of [3000, 12000]) {
  const cases = { before: fixture(count), after: fixture(count) }, times = { before: [], after: [] };
  const run = kind => { const f = cases[kind]; const at = performance.now(); methods[kind].call(f.adapter, f.scene, null); f.adapter.frameNo++; return performance.now() - at; };
  for (let i = 0; i < 100; i++) for (const kind of ['before', 'after']) run(kind);
  // Alternate order to reduce JIT, CPU clock and background-process bias.
  for (let i = 0; i < 600; i++) for (const kind of i % 2 ? ['after', 'before'] : ['before', 'after']) times[kind].push(run(kind));
  const stats = data => { data.sort((a, b) => a - b); return { medianMs: data[Math.floor(data.length / 2)], p95Ms: data[Math.floor(data.length * .95)] }; };
  const before = stats(times.before), after = stats(times.after);
  rows.push({ objects: count, frames: 600, before, after, medianReductionPercent: 100 * (1 - after.medianMs / before.medianMs) });
}
const out = new URL('../../tmp/codex-render-evidence/', import.meta.url); mkdirSync(out, { recursive: true });
writeFileSync(new URL('sync-benchmark.json', out), JSON.stringify({ correctnessFrames: 40, rows }, null, 2));
console.log(JSON.stringify({ correctnessFrames: 40, rows }, null, 2));
