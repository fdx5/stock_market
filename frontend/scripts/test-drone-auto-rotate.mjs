import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/droneFlight.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:()=>THREE});
const {DroneFlight}=module.exports;
const flat={groundAt:()=>10,roofAt:()=>10,clearAhead:()=>Infinity};
const fresh=()=>{const f=new DroneFlight();f.place(320,-210,10,120,.47);f.tilt=-.34;return f;};

test('a panorama turns continuously through multiple full revolutions while preserving position and tilt',()=>{
 for(const hz of [30,60,120]){
  const f=fresh(),at=f.pos.toArray(),yaw=f.yaw;f.setAutoRotate(true);
  for(let i=0;i<hz*270;i++)f.step(1/hz,flat);
  assert.deepEqual(f.pos.toArray(),at);assert.equal(f.tilt,-.34);assert.equal(f.kmh,0);
  assert.ok(Math.abs(f.yaw-yaw+6*Math.PI)<1e-9);assert.equal(f.autoRotate,true);
 }
});
test('engagement stops residual motion and cruise; stopping keeps the final heading and re-engagement starts there',()=>{
 const f=fresh();f.vel.set(14,3,-21);f.setAutopilot(true);const at=f.pos.toArray();f.toggleAutoRotate();
 assert.equal(f.autopilot,false);f.step(.1,flat);assert.deepEqual(f.pos.toArray(),at);
 const yaw=f.yaw;f.toggleAutoRotate();for(let i=0;i<20;i++)f.step(1/60,flat);
 assert.equal(f.yaw,yaw);f.setAutoRotate(true);f.step(1/60,flat);assert.ok(f.yaw<yaw);
 f.setAutopilot(true);assert.equal(f.autoRotate,false);assert.equal(f.autopilot,true);
});
test('keyboard, altitude buttons, sticks, wheel, drag and relocation take over immediately',()=>{
 for(const key of ['KeyW','KeyA','KeyQ','BtnUp','BtnDown']){
  const f=fresh();f.setAutoRotate(true);f.keys.add(key);f.step(1/60,flat);assert.equal(f.autoRotate,false,key);
 }
 for(const [side,value] of [['left',[.3,0]],['right',[0,.4]]]){
  const f=fresh();f.setAutoRotate(true);f.sticks[side]=value;f.step(1/60,flat);assert.equal(f.autoRotate,false);
 }
 for(const input of [f=>f.wheelClimb(-100),f=>f.look(1,0),f=>f.place(0,0,10,120,0)]){
  const f=fresh();f.setAutoRotate(true);input(f);assert.equal(f.autoRotate,false);
 }
});
test('a late ground or roof update preserves existing height safety during stationary rotation',()=>{
 const f=fresh();f.setAutoRotate(true);f.step(1/60,{...flat,roofAt:()=>150});
 assert.equal(f.pos.y,152);assert.equal(f.clearance,2);assert.equal(f.pos.x,320);assert.equal(f.pos.z,210);
});
