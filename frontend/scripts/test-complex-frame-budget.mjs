import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { Matrix4, Vector3, Quaternion, Euler } from 'three';
import { retireUnusedMaterials } from '../src/components/tidewater/materialLifetime.js';
test('a partial replacement retains the old GPU material until every mesh has moved', () => {
  const old = {}, replacement = {}, retired = [old], released = [];
  const meshes = [{material:replacement},{material:[old,replacement]}];
  retireUnusedMaterials(retired,meshes,x=>released.push(x));
  assert.deepEqual(retired,[old]);assert.deepEqual(released,[]);
  meshes[1].material=[replacement];retireUnusedMaterials(retired,meshes,x=>released.push(x));
  assert.deepEqual(retired,[]);assert.deepEqual(released,[old]);
});

const load = async name => {
  const { code } = transformSync(readFileSync(new URL('../src/components/' + name + '.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const { vehicleOverlap, VehicleTrajectoryCache } = await load('trafficCollision');
const { walkerJoint } = await load('walkerJoint');
test('an expired shader worker cannot terminate or reject a replacement worker', async () => {
  const workers=[],timers=[];
  class WorkerStub {
    constructor() {workers.push(this);}
    postMessage(job) {this.job=job;}
    terminate() {this.closed=true;}
    answer(value) {this.onmessage({data:{id:this.job.id,value}});}
  }
  const source=readFileSync(new URL('../src/vendor/tidewater/engine/gpu/ShaderAnalysis.js',import.meta.url),'utf8')
    .replace('export function','function').replace('import.meta.url','"http://test.invalid/ShaderAnalysis.js"');
  const context=vm.createContext({Worker:WorkerStub,URL,Map,Error,
    setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){}});
  vm.runInContext(source+';globalThis.analyze=shaderAnalysis',context);
  const first=context.analyze('reach','first',{});workers[0].answer('ok');assert.equal(await first,'ok');
  timers[0]();assert.equal(workers[0].closed,true);
  const second=context.analyze('reach','second',{});
  workers[0].onerror({message:'late old worker error'});
  timers[0]();assert.equal(workers[1].closed,undefined);
  workers[1].answer('new result');assert.equal(await second,'new result');
  const third=context.analyze('finish','third',{});
  timers[1]();assert.equal(workers[1].closed,undefined);
  workers[1].answer('finished');assert.equal(await third,'finished');
});
test('joint transforms preserve uploaded float32 poses, including aliased scratch output', () => {
  let seed = 279;
  const rnd = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32;
  const from = new Matrix4(), old = new Matrix4(), next = new Matrix4();
  const trans = new Matrix4(), rot = new Matrix4();
  for (let i=0;i<10000;i++) {
    from.compose(new Vector3(rnd()*2000-1000,rnd()*300,rnd()*2000-1000),
      new Quaternion().setFromEuler(new Euler(rnd()*6,rnd()*6,rnd()*6)),
      new Vector3(.3+rnd()*2,.3+rnd()*2,.3+rnd()*2));
    const x=rnd()-.5,y=rnd()*2-1,z=rnd()-.5,angle=rnd()*6-3;
    old.multiplyMatrices(from,trans.makeTranslation(x,y,z)).multiply(rot.makeRotationX(angle));
    walkerJoint(next,from,x,y,z,angle);
    assert.deepEqual(new Float32Array(next.elements),new Float32Array(old.elements));
    next.copy(from);walkerJoint(next,next,x,y,z,angle);
    assert.deepEqual(new Float32Array(next.elements),new Float32Array(old.elements));
  }
});
test('allocation-free collisions retain all four original separating-axis results', () => {
  let seed = 17;
  const rnd = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32;
  function original(ax, ay, ahx, ahy, al, aw, b) {
    const dx = b.x - ax, dy = b.y - ay;
    for (const [ux, uy] of [[ahx, ahy], [ahy, -ahx], [b.hx, b.hy], [b.hy, -b.hx]]) {
      const ra = al / 2 * Math.abs(ahx * ux + ahy * uy) + aw / 2 * Math.abs(ahy * ux - ahx * uy);
      const rb = b.length / 2 * Math.abs(b.hx * ux + b.hy * uy) + b.width / 2 * Math.abs(b.hy * ux - b.hx * uy);
      if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
    }
    return true;
  }
  for (let i = 0; i < 100000; i++) {
    const a = rnd() * 7, b = rnd() * 7;
    const body = { x: rnd() * 20 - 10, y: rnd() * 20 - 10, hx: Math.cos(b), hy: Math.sin(b), length: rnd() * 15, width: rnd() * 5 };
    const args = [rnd() * 20 - 10, rnd() * 20 - 10, Math.cos(a), Math.sin(a), rnd() * 15, rnd() * 5, body];
    assert.equal(vehicleOverlap(...args), original(...args));
  }
});
test('trajectory cache retains exact poses and invalidates every travel-state change', () => {
  const cache = new VehicleTrajectoryCache(), pose = {}, car = { conn: {}, road: 1, forward: true, lane: 0, s: 4, u: 2, inConn: false };
  let calls = 0;
  const compute = (c, d) => { calls++; Object.assign(pose, { x: c.s + d + Math.PI, y: c.u - d, hx: Math.sin(d), hy: Math.cos(d) }); };
  cache.read(car, 3, pose, compute);
  const expected = { ...pose };
  Object.assign(pose, { x: 99, y: 99, hx: 99, hy: 99 });
  cache.read(car, 3, pose, compute);
  assert.deepEqual(pose, expected); assert.equal(calls, 1);
  for (const [key, value] of Object.entries({ conn: {}, road: 2, forward: false, lane: 1, s: 5, u: 3, inConn: true })) {
    car[key] = value; const before = calls; cache.read(car, 3, pose, compute); assert.equal(calls, before + 1);
  }
});
function scheduler() {
  const frames = [], tasks = []; let now = 0;
  const context = { module: { exports: {} }, document: { hidden: false }, performance: { now: () => now }, requestAnimationFrame: f => frames.push(f), scheduler: { postTask: f => { tasks.push(f); return Promise.resolve(); } }, queueMicrotask };
  vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/frameSlice.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return { context, frames, tasks, slice: context.module.exports.frameSlice, async frame(cost = 0) {
    now += 16.7; const at = now; const f = frames.shift(); now += cost; f(at);
    tasks.shift()(); await Promise.resolve(); await Promise.resolve();
  } };
}
test('concurrent builders get at most one admission per visible frame', async () => {
  const s = scheduler(), completed = [];
  for (let i = 0; i < 4; i++) s.slice().then(() => completed.push(i));
  assert.equal(s.frames.length, 1);
  for (let i = 0; i < 4; i++) { await s.frame(); assert.deepEqual(completed, Array.from({ length: i + 1 }, (_, n) => n)); }
});
test('busy visible frames do not force work; admission resumes when there is room', async () => {
  const s = scheduler(); let completed = false;
  s.slice().then(() => completed = true);
  await s.frame(12); await s.frame(20); assert.equal(completed, false);
  await s.frame(2); assert.equal(completed, true);
});
test('hidden documents drain without waiting for a suspended animation clock', async () => {
  const s = scheduler(); s.context.document.hidden = true; let completed = 0;
  s.slice().then(() => completed++); s.slice().then(() => completed++);
  for (let i = 0; i < 2; i++) { s.tasks.shift()(); await Promise.resolve(); await Promise.resolve(); }
  assert.equal(completed, 2); assert.equal(s.frames.length, 0);
});
