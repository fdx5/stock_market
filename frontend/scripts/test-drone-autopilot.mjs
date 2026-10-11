import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as THREE from 'three';

const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/droneFlight.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:()=>THREE});
const {DroneFlight,AUTO_MIN_AGL,AUTO_MAX_AGL,AUTO_SPEED,MAX_SPEED}=module.exports;
const flat={groundAt:()=>0,roofAt:()=>0,clearAhead:(_x,_y,_dx,_dy,max)=>max};
const run=(flight,world,seconds,onStep=()=>{})=>{for(let i=0;i<seconds*60;i++){flight.step(1/60,world);onStep(flight,i)}};

test('engaging from a hover cruises at the default 100km/h',()=>{
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);
  assert.equal(AUTO_SPEED*3.6,100);assert.equal(f.autoCruiseSpeed,AUTO_SPEED);
  run(f,flat,20);assert.ok(Math.abs(f.kmh-100)<.01,f.kmh);
});

test('engaging while moving captures and maintains the exact horizontal speed, including low speeds',()=>{
  for(const kmh of [1,30,70,100,145.5,200]){
    const f=new DroneFlight();const yaw=.63;f.place(0,0,0,175,yaw);
    f.vel.set(-Math.sin(yaw)*kmh/3.6,12,-Math.cos(yaw)*kmh/3.6);
    f.setAutopilot(true);assert.ok(Math.abs(f.autoCruiseSpeed*3.6-kmh)<1e-9);
    run(f,flat,30,f=>{assert.ok(Math.abs(f.kmh-kmh)<.01,`${kmh}: ${f.kmh}`);assert.ok(f.agl>=100&&f.agl<=250)});
    f.look(-.6/.0042,0);run(f,flat,15);
    assert.ok(Math.abs(f.kmh-kmh)<.05,`after turning ${kmh}: ${f.kmh}`);
    assert.ok(Math.abs(f.autoCruiseSpeed*3.6-kmh)<1e-9);
  }
});

test('temporary loading holds preserve the captured speed and resume it when loading completes',()=>{
  const f=new DroneFlight();f.place(0,0,0,175,0);f.vel.z=-157/3.6;f.setAutopilot(true);
  run(f,{...flat,clearAhead:()=>0},8);assert.ok(f.kmh<.01);assert.ok(Math.abs(f.autoCruiseSpeed*3.6-157)<1e-9);
  run(f,flat,15);assert.ok(Math.abs(f.kmh-157)<.01,f.kmh);
  f.setAutopilot(false);f.vel.z=-40/3.6;f.setAutopilot(true);run(f,flat,5);
  assert.ok(Math.abs(f.kmh-40)<.01,'re-engagement captures the new speed');
});

test('engagement accepts a held throttle; releasing then pressing again returns to manual',()=>{
  for(const input of ['keyboard','touch']){
    const f=new DroneFlight();f.place(0,0,0,175,0);f.vel.z=-135/3.6;
    if(input==='keyboard')f.keys.add('KeyW');else f.sticks.right=[0,1];
    f.setAutopilot(true);run(f,flat,5);assert.equal(f.autopilot,true,input);assert.ok(Math.abs(f.kmh-135)<.01);
    if(input==='keyboard')f.keys.delete('KeyW');else f.sticks.right=[0,0];
    f.step(1/60,flat);assert.equal(f.autopilot,true);
    if(input==='keyboard')f.keys.add('KeyW');else f.sticks.right=[0,1];
    f.step(1/60,flat);assert.equal(f.autopilot,false,input);
  }
});

test('autopilot cruises continuously, changes height gently and stays inside 100–250m AGL',()=>{
  const f=new DroneFlight();f.place(0,0,0,175,0);f.toggleAutopilot();let low=Infinity,high=-Infinity;
  run(f,flat,100,f=>{low=Math.min(low,f.agl);high=Math.max(high,f.agl);assert.ok(f.agl>=AUTO_MIN_AGL && f.agl<=AUTO_MAX_AGL);assert.ok(f.kmh<=AUTO_SPEED*3.6+2)});
  assert.ok(f.pos.z < -1500);assert.ok(high-low>60);assert.equal(f.autopilot,true);
  f.look(-Math.PI/2/.0042,0);const before=f.pos.x;
  run(f,flat,10);assert.ok(f.pos.x<before-100,'cruise follows the new looking direction');
  assert.equal(f.autopilot,true);
});

test('below the band, autopilot climbs before advancing; above it, it descends before advancing',()=>{
  for(const initial of [2,1200]){
    const f=new DroneFlight();f.place(0,0,0,initial,0);f.setAutopilot(true);
    let entered=false;
    run(f,flat,70,f=>{if(!entered && (f.agl<AUTO_MIN_AGL || f.agl>AUTO_MAX_AGL))assert.ok(Math.abs(f.pos.z)<1);else entered=true});
    assert.ok(entered);assert.ok(f.agl>=AUTO_MIN_AGL && f.agl<=AUTO_MAX_AGL);assert.ok(f.pos.z<-100);
  }
});

test('autopilot follows rising ground and climbs over a passable roof without collisions',()=>{
  const world={...flat,groundAt:(_x,y)=>Math.max(0,Math.min(130,y*.15)),roofAt:(_x,y)=>Math.max(0,Math.min(130,y*.15))+(y>350&&y<430?195:0)};
  const f=new DroneFlight();f.place(0,0,0,150,0);f.setAutopilot(true);let climbed=false;
  run(f,world,55,f=>{assert.ok(f.agl>=100 && f.agl<=250);assert.equal(f.bumped,0);if(-f.pos.z>350&&-f.pos.z<430){climbed=true;assert.ok(f.clearance>=20)}});
  assert.ok(climbed);assert.ok(-f.pos.z>450);
});

test('an impassable tower causes a hover before it and a new heading resumes the cruise',()=>{
  const world={...flat,roofAt:(x,y)=>Math.abs(x)<50&&y>=230&&y<=330?1100:0};
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);
  run(f,world,35,f=>{assert.equal(f.bumped,0);assert.ok(-f.pos.z<230);assert.ok(f.agl<=250)});
  assert.equal(f.autopilotStatus,'obstacle');assert.ok(f.kmh<1);
  f.look(-Math.PI/2/.0042,0);run(f,world,8);assert.ok(f.pos.x<-80);assert.equal(f.autopilot,true);
});

test('maximum-speed cruise still brakes before an impassable tower and resumes its saved speed',()=>{
  const world={...flat,roofAt:(x,y)=>Math.abs(x)<50&&y>=230&&y<=330?1100:0};
  const f=new DroneFlight();f.place(0,0,0,175,0);f.vel.z=-MAX_SPEED;f.setAutopilot(true);
  run(f,world,30,f=>{assert.equal(f.bumped,0);assert.ok(-f.pos.z<230);assert.ok(f.agl>=100&&f.agl<=250)});
  assert.equal(f.autopilotStatus,'obstacle');assert.ok(f.kmh<1);assert.equal(f.autoCruiseSpeed,MAX_SPEED);
  f.look(-Math.PI/2/.0042,0);run(f,world,15);assert.ok(Math.abs(f.kmh-200)<.01,f.kmh);
});

test('unloaded terrain holds the autopilot stationary; loading lets it resume',()=>{
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);
  run(f,{...flat,clearAhead:()=>0},20);assert.ok(Math.abs(f.pos.z)<.1);assert.equal(f.limit,0);
  run(f,flat,10);assert.ok(f.pos.z<-100);
});

test('manual movement and altitude inputs cancel autopilot; yaw remains available',()=>{
  for(const key of ['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','BtnUp','BtnDown']){
    const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);f.keys.add(key);f.step(1/60,flat);assert.equal(f.autopilot,false,key);
  }
  for(const [side,axes] of [['right',[.5,0]],['left',[0,.5]]]){
    const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);f.sticks[side]=axes;f.step(1/60,flat);assert.equal(f.autopilot,false);
  }
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutopilot(true);f.keys.add('KeyE');run(f,flat,1);assert.equal(f.autopilot,true);assert.notEqual(f.yaw,0);
  f.wheelClimb(100);assert.equal(f.autopilot,false);
  f.toggleAutopilot();assert.equal(f.autopilot,true);f.toggleAutopilot();assert.equal(f.autopilot,false);
});

test('a user speed setting clamps to 200km/h, applies during cruise and survives holds and re-engagement',()=>{
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutoSpeed(500);f.setAutopilot(true);
  assert.equal(f.autoCruiseSpeed,MAX_SPEED);run(f,flat,20);assert.ok(Math.abs(f.kmh-200)<.01);
  f.setAutoSpeed(42);run(f,flat,20);assert.ok(Math.abs(f.kmh-42)<.01);
  run(f,{...flat,clearAhead:()=>0},8);f.setAutoSpeed(128);run(f,flat,20);assert.ok(Math.abs(f.kmh-128)<.01);
  f.setAutopilot(false);f.vel.z=-20/3.6;f.setAutopilot(true);assert.ok(Math.abs(f.autoCruiseSpeed*3.6-128)<1e-9);
  f.setAutoSpeed(NaN);f.setAutoSpeed(Infinity);assert.ok(Math.abs(f.autoCruiseSpeed*3.6-128)<1e-9);
  f.setAutoSpeed(-10);run(f,flat,20);assert.equal(f.autoCruiseSpeed,0);assert.ok(f.kmh<.01);
});

test('selected automatic heights include both 10m and 1000m and remain selected across engagement',()=>{
  assert.equal(AUTO_MIN_AGL,10);assert.equal(AUTO_MAX_AGL,1000);
  const f=new DroneFlight();f.place(0,0,0,500,0);f.setAutoAltitude(500);f.setAutopilot(true);
  for(const [request,expected] of [[-50,10],[2000,1000],[10,10],[1000,1000]]){
    f.setAutoAltitude(request);assert.equal(f.autoCruiseAgl,expected);
    run(f,flat,180,f=>{assert.ok(f.agl>=10&&f.agl<=1000);assert.equal(f.bumped,0)});
    assert.ok(Math.abs(f.agl-expected)<.01,`${expected}: ${f.agl}`);
  }
  f.setAutoAltitude(NaN);f.setAutoAltitude(Infinity);assert.equal(f.autoCruiseAgl,1000);
  f.setAutopilot(false);f.setAutopilot(true);assert.equal(f.autoCruiseAgl,1000);
});

test('automatic flight can clear a 600m obstacle that the old 250m band could not pass',()=>{
  const world={...flat,roofAt:(_x,y)=>y>=230&&y<=330?600:0};
  const f=new DroneFlight();f.place(0,0,0,175,0);f.setAutoSpeed(200);f.setAutopilot(true);let passed=false;
  run(f,world,150,f=>{assert.equal(f.bumped,0);assert.ok(f.agl>=10&&f.agl<=1000);if(-f.pos.z>=230&&-f.pos.z<=330){passed=true;assert.ok(f.clearance>=20)}});
  assert.ok(passed);assert.ok(-f.pos.z>330);
});

test('manual keyboard, touch, altitude buttons and wheel can climb beyond 1000m and descend again',()=>{
  for(const input of ['keyboard','touch','button','wheel']){
    const f=new DroneFlight();f.place(0,0,0,999,0);
    if(input==='keyboard')f.keys.add('Space');else if(input==='touch')f.sticks.left=[0,1];else if(input==='button')f.keys.add('BtnUp');
    run(f,flat,4,(f)=>{if(input==='wheel')f.wheelClimb(-100)});assert.ok(f.agl>1005,`${input}: ${f.agl}`);
    f.keys.clear();f.sticks.left=[0,0];f.wheelClimb(1000);const high=f.agl;f.keys.add('BtnDown');run(f,flat,5);assert.ok(f.agl<high);
  }
  const f=new DroneFlight();f.place(0,0,0,12000,0);const camera=new THREE.PerspectiveCamera();f.apply(camera);assert.ok(camera.far>f.agl);
});
