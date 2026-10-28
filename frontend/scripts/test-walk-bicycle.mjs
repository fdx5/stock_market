import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function load(path, deps = {}) {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../src/walkmode/${path}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = vm.createContext({ exports: {}, require: key => deps[key] ?? (() => { throw Error(`Unexpected dependency ${key}`); })() });
  vm.runInContext(output, context); return context.exports;
}
const { BicycleMotion, BICYCLE_MAX_SPEED } = load('game/bicycleMotion');
const { Bicycles } = load('game/Bicycles', { three: THREE, 'three/examples/jsm/utils/BufferGeometryUtils.js': { mergeGeometries } });
const { bicycleGates } = load('game/bicycleGates');
const { WalkGame } = load('game/WalkGame', new Proxy({ three: THREE }, { get: (deps, key) => deps[key] ?? {} }));
const pedal = { throttle: 1, brake: 0, steer: 0 }, coast = { throttle: 0, brake: 0, steer: 0 };
const clear = () => true;

test('third-person avatar survives repeated riding/walking camera changes beside a wall', () => {
  const game = Object.create(WalkGame.prototype);
  Object.assign(game, { camera: new THREE.PerspectiveCamera(62, 1.6, .1, 2600), pos: new THREE.Vector2(), z: 0, yaw: 0, pitch: -.12,
    view: 'third', avatar: { root: new THREE.Group() }, bicycles: { active: null }, camEye: new THREE.Vector3(), camInit: false,
    world: { buildingAt: ([, y]) => y < -.5 ? 20 : 0, surfaceAt: () => 0 } });
  for (let i = 0; i < 24; i++) {
    game.bicycles.active = i % 2 ? null : {};
    game.placeCamera(1/60, i === 0); game.camera.updateMatrixWorld();
    assert.equal(game.avatar.root.visible, true);
    assert.equal(game.world.buildingAt([game.camera.position.x, -game.camera.position.z]), 0);
    const torso = new THREE.Vector3(0, 1.05, 0).project(game.camera);
    assert.ok(Math.abs(torso.x) < 1 && Math.abs(torso.y) < 1 && torso.z < 1);
  }
  game.view = 'first'; game.placeCamera(1/60, true); assert.equal(game.avatar.root.visible, false);
  game.view = 'third'; game.placeCamera(1/60, true); assert.equal(game.avatar.root.visible, true);
});

test('a narrow corner finds an overhead third-person camera without hiding the rider', () => {
  const game = Object.create(WalkGame.prototype);
  Object.assign(game, { camera: new THREE.PerspectiveCamera(62, 1.6, .1, 2600), pos: new THREE.Vector2(), z: 0, yaw: 0, pitch: -.12,
    view: 'third', avatar: { root: new THREE.Group() }, bicycles: { active: {} }, camEye: new THREE.Vector3(), camInit: false,
    world: { buildingAt: ([x, y]) => Math.abs(x) > .6 || Math.abs(y) > .6 ? 20 : 0, surfaceAt: () => 0 } });
  game.placeCamera(1/60, true);
  assert.equal(game.avatar.root.visible, true); assert.ok(game.camera.position.y > 4);
  assert.ok(Math.abs(game.camera.position.x) < .6 && Math.abs(game.camera.position.z) < .6);
});

test('holds a true 60 km/h limit without overspeed, even during a long acceleration', () => {
  const bike = new BicycleMotion();
  for (let i = 0; i < 1800; i++) { bike.step(1/60, pedal, clear); assert.ok(bike.speed <= 60/3.6); }
  assert.equal(bike.speed, BICYCLE_MAX_SPEED);
  assert.ok(bike.x > 450 && Math.abs(bike.y) < 1e-9);
});
test('movement and acceleration are consistent at 30, 60 and 144 fps', () => {
  const bikes = [30,60,144].map(fps => { const b = new BicycleMotion(); for (let i=0;i<fps*8;i++) b.step(1/fps,pedal,clear); return b; });
  assert.ok(Math.max(...bikes.map(b=>b.x))-Math.min(...bikes.map(b=>b.x))<0.04);
  for (const bike of bikes) assert.equal(bike.speed, BICYCLE_MAX_SPEED);
});
test('brakes take precedence over pedalling and stop without reversing', () => {
  const bike = new BicycleMotion(); bike.speed=BICYCLE_MAX_SPEED;
  for(let i=0;i<120;i++) bike.step(1/60,{...pedal,brake:1},clear);
  assert.equal(bike.speed,0); assert.ok(bike.x<17);
  for(let i=0;i<60;i++) bike.step(1/60,{throttle:0,brake:1,steer:0},clear);
  assert.equal(bike.speed,0);
});
test('released pedals coast, steering turns instead of strafing, and stop clears motion', () => {
  const bike = new BicycleMotion(); bike.speed=10;
  bike.step(.1,coast,clear); assert.ok(bike.speed<10&&bike.speed>9);
  bike.step(.1,{...coast,steer:1},clear); assert.ok(bike.heading<0&&bike.y<0);
  bike.stop(); assert.equal(bike.speed,0); assert.equal(bike.steer,0);
});
test('high-speed swept collision cannot jump a thin obstacle in a stalled frame', () => {
  const bike = new BicycleMotion(); bike.place(0,0,0); bike.speed=BICYCLE_MAX_SPEED;
  let previous=0, maximum=0;
  bike.step(.1,pedal,(x)=>{maximum=Math.max(maximum,x-previous); previous=x; return x<.61;});
  assert.ok(bike.x<.61); assert.equal(bike.speed,0); assert.ok(maximum<=.14);
});
test('invalid or suspended input never injects NaN, a teleport, or a runaway speed', () => {
  const bike = new BicycleMotion(); bike.step(NaN,pedal,clear); assert.equal(bike.x,0);
  bike.step(10,pedal,clear); assert.ok(bike.x<.04);
  bike.step(.1,{throttle:Infinity,brake:NaN,steer:NaN},clear);
  assert.ok(Number.isFinite(bike.heading)&&Number.isFinite(bike.speed));
  bike.place(5,7,1); assert.equal(bike.speed,0); assert.equal(bike.x,5);
});
const record = (id='동1',x=0) => ({id,name:'Test apartment',dong:'101동',x,y:0,z:0,heading:0});
test('a building supplies one bike across repeated exits, while different buildings keep theirs', () => {
  const fleet = new Bicycles(); const first = fleet.provide(record());
  assert.equal(fleet.provide(record('동1',4)),first); assert.equal(fleet.records.size,1); assert.equal(first.x,4);
  fleet.provide(record('동2',8)); assert.equal(fleet.records.size,2); fleet.dispose();
});
test('mount removes the parked instance, dismount restores it at the new location, nearest is range-limited', () => {
  const fleet = new Bicycles(); const bike=fleet.provide(record());
  fleet.sync(0,0); assert.equal(fleet.parked.count,1); assert.equal(fleet.nearest(4,0),null);
  fleet.ride(bike); fleet.sync(0,0); assert.equal(fleet.parked.count,0);
  bike.x=10; fleet.update(1,.1,10); fleet.ride(null); fleet.sync(10,0);
  assert.equal(fleet.parked.count,1); assert.equal(fleet.nearest(10,0),bike); fleet.dispose();
});
test('parked geometry is shared and visible-instance cost remains bounded', () => {
  const fleet = new Bicycles(); for(let i=0;i<200;i++) fleet.provide(record(String(i),i*.2));
  fleet.sync(0,0); assert.equal(fleet.parked.count,64);
  fleet.sync(1000,1000); assert.equal(fleet.parked.count,0);
  for(const geo of fleet.assets) { const p=geo.getAttribute('position'); for(const v of p.array) assert.ok(Number.isFinite(v)); }
  const owned=new Set(fleet.assets); let disposed=0; for(const geo of owned) geo.addEventListener('dispose',()=>disposed++);
  fleet.dispose(); assert.equal(disposed,owned.size); assert.equal(fleet.records.size,0);
});
test('gate stands use separated surveyed access roads; missing access data does not invent a gate', () => {
  const roads=[{id:'access',w:6,pts:new Float32Array([-100,0,0,100,0,0])}];
  const gates=bicycleGates([{x:-10,y:-10},{x:10,y:10}],roads);
  assert.equal(gates.length,2); assert.ok(Math.hypot(gates[0].x-gates[1].x,gates[0].y-gates[1].y)>=35);
  assert.equal(bicycleGates([],roads).length,0); assert.equal(bicycleGates([{x:0,y:0}],[]).length,0);
});
