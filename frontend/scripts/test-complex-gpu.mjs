// Buffer regression checks without a browser/GPU. Run: node scripts/test-complex-gpu.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute } from 'three';
import { GPU } from '../src/vendor/tidewater/engine/gpu/GPU.js';
import { MeshRenderer } from '../src/vendor/tidewater/engine/render/MeshRenderer.js';
import { stripUnusedFunctions } from '../src/vendor/tidewater/engine/gpu/Shader.js';
import { BoundedCache } from '../src/vendor/tidewater/engine/gpu/BoundedCache.js';

test('cache eviction respects memory budgets and retains recently reused pipelines', () => {
  const c = new BoundedCache(2, 40);
  c.set('first', 'aaaa'); c.set('second', 'bb');
  assert.equal(c.get('first'), 'aaaa');
  c.set('third', 'cccc');
  assert.ok(c.has('first')); assert.ok(!c.has('second'));
  assert.ok(c.bytes <= 40);
  c.set('oversized', 'x'.repeat(100));
  assert.ok(!c.has('oversized')); assert.equal(c.size, 2);
  c.delete('first'); c.clear();
  assert.equal(c.bytes, 0); assert.equal(c.size, 0);
});

test('retiring a material releases only its pipeline bindings', () => {
  const r = new MeshRenderer();
  r.pipelines.set('7.color', {old: true}); r.pipelines.set('7.depth', {old: true});
  r.pipelines.set('70.color', {live: true});
  r.forgetMaterial({id: 7});
  assert.deepEqual([...r.pipelines.keys()], ['70.color']);
});

test('shader pruning retains transitive resources, aliases and annotated entry points', () => {
  const code = `enable f16;
    diagnostic(off, derivative_uniformity);
    struct Params { value: vec4f, }
    alias Color = vec4f;
    @group(1) @binding(0) var<uniform> live: Params;
    @group(1) @binding(1) var unused: texture_2d<f32>;
    const factor = 2.0;
    fn read() -> Color { return live.value * factor; }
    fn dead() -> vec4f { return textureLoad(unused, vec2i(0), 0); }
    @vertex fn vs() -> @builtin(position) vec4f { return read(); }
    @fragment fn fs() -> @location(0) vec4f { return read(); }`;
  const lean = stripUnusedFunctions(code);
  for (const name of ['Params', 'Color', 'live', 'factor', 'read', 'vs', 'fs']) assert.match(lean, new RegExp(`\\b${name}\\b`));
  assert.doesNotMatch(lean, /\b(dead|unused)\b/);
  assert.match(lean, /enable f16/);
  assert.match(lean, /diagnostic\(off, derivative_uniformity\)/);
  assert.equal(stripUnusedFunctions(code), lean);
});

test('depth pruning removes fragment-only declarations without editing the vertex program', () => {
  const vertex = '@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0.0); }';
  const lean = stripUnusedFunctions(`struct Surface { color: vec4f, } fn surface() -> Surface { return Surface(vec4f(1.0)); } ${vertex}`);
  assert.ok(lean.includes(vertex));
  assert.doesNotMatch(lean, /\b(Surface|surface)\b/);
});

function mockGPU() {
  const writes = [], buffers = [];
  globalThis.GPUBufferUsage = { VERTEX: 1, COPY_DST: 2 };
  GPU.device = { createBuffer({ size }) {
    const b = { data: new ArrayBuffer(size), destroyed: 0, destroy() { this.destroyed++; } };
    buffers.push(b);
    return b;
  } };
  GPU.queue = { writeBuffer(buffer, offset, data, start = 0, size = data.byteLength - start) {
    assert.equal(buffer.destroyed, 0);
    new Uint8Array(buffer.data).set(new Uint8Array(data, start, size), offset);
    writes.push({ offset, start, size });
  } };
  return { writes, buffers };
}

test('partial instance uploads preserve unchanged values and consume pending ranges', () => {
  const { writes } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new InstancedBufferAttribute(Float32Array.from({ length: 64 }, (_, i) => i), 16);
  attr.addUpdateRange(16, 16); // first upload must still initialize all instances
  const b = r._attributeBuffer(g, attr);
  assert.equal(writes[0].size, 256);
  assert.equal(attr.updateRanges.length, 0);
  r._attributeBuffer(g, attr);
  assert.equal(writes.length, 1);
  attr.array.fill(42, 16, 32);
  attr.addUpdateRange(16, 16); attr.needsUpdate = true;
  r._attributeBuffer(g, attr);
  assert.deepEqual(writes[1], { offset: 64, start: 64, size: 64 });
  assert.deepEqual(new Float32Array(b.data), attr.array);
  assert.equal(attr.updateRanges.length, 0);
  // A replacement array of the same size/version cannot reuse old GPU contents.
  attr.array = new Float32Array(64).fill(7);
  r._attributeBuffer(g, attr);
  assert.equal(writes[2].size, 256);
  assert.deepEqual(new Float32Array(b.data), attr.array);
  r.dispose();
});

test('a growing instance buffer gets a full upload even with a dirty range', () => {
  const { writes } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new InstancedBufferAttribute(new Float32Array(16).fill(1), 16);
  const old = r._attributeBuffer(g, attr);
  attr.array = new Float32Array(64).fill(3);
  attr.addUpdateRange(48, 16); attr.needsUpdate = true;
  const current = r._attributeBuffer(g, attr);
  assert.equal(old.destroyed, 1);
  assert.equal(writes.at(-1).size, 256);
  assert.deepEqual(new Float32Array(current.data), attr.array);
  r.dispose();
});

test('switching meshes frees old instance buffers while retaining shared geometry', () => {
  const { buffers } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const position = new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3);
  g.setAttribute('position', position);
  const a = { geometry:g, isInstancedMesh:true, instanceMatrix:new InstancedBufferAttribute(new Float32Array(16),16) };
  const b = { ...a, instanceMatrix:new InstancedBufferAttribute(new Float32Array(32),16) };
  const vertices = r._attributeBuffer(g,position);
  const old = r._attributeBuffer(g,a.instanceMatrix);
  const current = r._attributeBuffer(g,b.instanceMatrix);
  r.retainGeometry([b]);
  assert.equal(old.destroyed,1);
  assert.equal(vertices.destroyed,0);
  assert.equal(current.destroyed,0);
  assert.equal(r.geometries.get(g).buffers.size,2);
  r.retainGeometry([]);
  assert.equal(r.geometries.size,0);
  assert.equal(g._listeners.dispose.length,0);
  assert.equal(g.attributes.position,position); // reusable CPU asset survives
  r.dispose(); g.dispose();
  assert.ok(buffers.every(b=>b.destroyed===1));
});

test('renderer disposal detaches geometry listeners and is safe to repeat', () => {
  const { buffers } = mockGPU();
  const r = new MeshRenderer(), g = new BufferGeometry();
  const attr = new Float32BufferAttribute([1,2,3],3);
  r._attributeBuffer(g,attr);
  r.dispose(); r.dispose(); g.dispose();
  assert.equal(r.geometries.size,0);
  assert.equal(g._listeners.dispose.length,0);
  assert.ok(buffers.every(b=>b.destroyed===1));
});
