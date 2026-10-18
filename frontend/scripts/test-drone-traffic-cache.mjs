import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const helper={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficLaneCurve.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,helper);
const load=source=>{const scope={module:{exports:{}},exports:{},THREE,...helper.module.exports,CAR_SPECS:{},DIMS:{},loadCarModels:()=>new Promise(()=>{}),carModelMaterial:()=>new THREE.MeshStandardMaterial()};vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;};
const {DroneTraffic:Current,signalState}=load(readFileSync(new URL('../src/components/droneTraffic.ts',import.meta.url),'utf8'));
// A continuous road grade. The previous fixture jumped down three metres at every tile seam.
const packed=(ox,oy)=>Float32Array.from(Array.from({length:12},(_,i)=>[3,16,ox,oy+i*4,ox*.01,ox+45,oy+i*4,(ox+45)*.01,ox+90,oy+i*4,(ox+90)*.01]).flat());
test('lane choices and complete traffic frames are deterministic across tile changes',()=>{
 const one=new Current(341),two=new Current(341);one.farStagger=false;two.farStagger=false;
 for(const t of [one,two]){t.addTile('a',packed(0,0));t.addTile('b',packed(90,0));t.addTile('c',packed(180,0));t.addTile('d',packed(1200,-40));}
 const camera=new THREE.Vector3();
 for(let frame=0;frame<900;frame++){
  if(frame===300)for(const t of [one,two])t.addTile('e',packed(270,0));
  if(frame===500)for(const t of [one,two])t.removeTile('b');
  if(frame===600)for(const t of [one,two])t.addTile('b',packed(90,0));
  camera.set(frame<400?0:1400,160,frame<700?0:-20);one.update(.06,camera);two.update(.06,camera);
  assert.equal(two.far.count,one.far.count);assert.equal(Buffer.compare(Buffer.from(two.far.instanceMatrix.array.buffer),Buffer.from(one.far.instanceMatrix.array.buffer)),0);assert.equal(Buffer.compare(Buffer.from(two.far.instanceColor.array.buffer),Buffer.from(one.far.instanceColor.array.buffer)),0);
 }
 assert.ok(one.far.count>0);one.dispose();two.dispose();
});

const one=(a,b)=>Float32Array.from([2,16,...a,...b]);
test('short surveyed connectors remain in the real traffic network without spawning cars',()=>{
 const t=new Current(7);t.addTile('short',one([0,0,0],[3,0,0]));
 const lane=t.lanes.get('short')[0];assert.ok(lane);assert.equal(lane.cars.length,0);assert.equal(lane.len,3);t.dispose();
});
test('Float32 duplicate pavement intersections do not erase the heading at a bridge bank',()=>{
 const t=new Current(7);t.addTile('from',one([900,0,0],[1000,0,0]));
 t.addTile('to',Float32Array.from([4,16,1000,0,0,1000,0,0,1000.00001,0,0,1100,0,0]));
 const from=t.lanes.get('from')[0],to=t.lanes.get('to')[0];assert.equal(to.p.length,6);
 assert.equal(t.next(1000,0,1,0,from),to);t.dispose();
});
test('a confirmed bank allows a three-to-one lane merge; an adjacent or stacked road does not',()=>{
 for(const [known,z,connected] of [[false,0,false],[true,0,true],[true,7,false]]){
  const t=new Current(7),bank=known?Float32Array.from([0,0]):undefined;
  t.addTile('from',one([-100,-5.4,0],[0,-5.4,0]),undefined,bank);t.addTile('to',one([0,0,z],[100,0,z]),undefined,bank);
  const from=t.lanes.get('from')[0],to=t.lanes.get('to')[0];assert.equal(t.next(0,-5.4,1,0,from),connected?to:null);t.dispose();
 }
});
const isolated=()=>{
 const t=new Current(7);t.addTile('from',one([-100,0,0],[0,0,0]));t.addTile('to',one([0,3.5,0],[100,3.5,0]));
 const from=t.lanes.get('from')[0],to=t.lanes.get('to')[0],car=from.cars[0];
 for(const l of [from,to])l.cars.length=0;
 t.cars=[car];from.cars.push(car);car.s=70;car.v=car.vmax=10;
 return {t,from,to,car};
};
test('a real simulated lane merge has no lateral teleport or 90 degree heading change',()=>{
 const {t,car,to}=isolated(),camera=new THREE.Vector3(0,150,0);let previous=null,maxAngle=0,merging=false;
 for(let i=0;i<90;i++){
  t.update(.1,camera);const m=t.far.instanceMatrix.array,x=m[12],y=-m[14],angle=Math.atan2(-m[10],m[8]);
  if(previous)assert.ok(Math.hypot(x-previous.x,y-previous.y)<1.05,'one advance per frame');
  maxAngle=Math.max(maxAngle,Math.abs(angle));merging ||= !!car.via;previous={x,y};
 }
 assert.ok(merging);assert.equal(car.lane,to);assert.ok(maxAngle<15*Math.PI/180);t.dispose();
});
test('rendered cars on a fragmented lane merge never launch above or fall below the road',()=>{
 const t=new Current(7),packed=(p)=>Float32Array.from([p.length,16,...p.flat()]);
 t.addTile('from',packed([[-100,0,0],[-.00001,0,0],[0,0,.01]]));t.addTile('to',packed([[0,3.5,.01],[.00001,3.5,0],[100,3.5,0]]));
 const from=t.lanes.get('from')[0],to=t.lanes.get('to')[0],car=from.cars[0];from.cars.length=0;to.cars.length=0;t.cars=[car];from.cars.push(car);car.s=98;car.v=car.vmax=10;
 let merging=false,arrived=false;
 for(let i=0;i<600;i++){t.update(.016,new THREE.Vector3(0,150,0));assert.equal(t.far.count,1);const m=t.far.instanceMatrix.array;assert.ok(m[13]>=-.00001&&m[13]<=.01001,`rendered height ${m[13]}`);assert.ok(Array.from(m.subarray(0,16)).every(Number.isFinite));merging ||= !!car.via;arrived ||= car.lane===to&&!car.via;}
 assert.ok(merging);assert.ok(arrived);t.dispose();
});
test('a blocked target lane waits before merging instead of teleporting onto its first car',()=>{
 const {t,from,to,car}=isolated(),block={...car,lane:to,s:10,v:0,vmax:0,planned:undefined};
 t.cars.push(block);to.cars.push(block);
 for(let i=0;i<100;i++)t.update(.1,new THREE.Vector3(0,150,0));
 assert.equal(car.lane,from);assert.equal(car.v,0);assert.ok(car.s<from.len-20);t.dispose();
});

test('distant tile changes reuse exact junction choices while nearby arrivals and removals invalidate them',()=>{
 const {t,from,to}=isolated();let reads=0;const get=t.starts.get.bind(t.starts);
 t.starts.get=key=>{reads++;return get(key);};
 const next=()=>t.next(0,0,100,0,from);
 assert.equal(next(),to);assert.equal(reads,169);reads=0;
 t.addTile('far',one([1500,0,0],[1600,0,0]));reads=0;
 assert.equal(next(),to);assert.equal(reads,0,'unrelated arrivals must not rescan a prepared junction');
 t.addTile('near',one([0,3.75,0],[100,3.75,0]));reads=0;next();assert.equal(reads,169);
 assert.equal(t.continuations.get(from).choices.length,2);
 t.removeTile('to');reads=0;assert.equal(next().tile,'near');assert.equal(reads,169);
 t.removeTile('far');assert.ok([...t.junctionRegions.values()].every(r=>r.lanes.size>0));
 t.dispose();assert.equal(t.junctionRegions.size,0);assert.equal(t.lanes.size,0);assert.equal(t.starts.size,0);assert.equal(t.cars.length,0);
});

test('junction invalidation crosses negative and positive 64 metre bucket boundaries',()=>{
 for(const x of [-65,-64,-1,0,63,64]){
  const t=new Current(7);t.addTile('from',one([x-100,0,0],[x,0,0]));const from=t.lanes.get('from')[0];
  assert.equal(t.next(x,0,100,0,from),null);
  t.addTile('near',one([x+3,0,0],[x+100,0,0]));assert.equal(t.next(x,0,100,0,from).tile,'near');
  t.removeTile('near');assert.equal(t.next(x,0,100,0,from),null);t.dispose();
 }
});

test('traffic uploads every live instance and colour without copying unused capacity or accumulating off-screen ranges',()=>{
 const {t}=isolated(),camera=new THREE.Vector3(0,150,0);
 for(let i=0;i<40;i++){
  t.update(.016,camera);const count=t.far.count;assert.equal(count,1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.far.instanceMatrix.updateRanges)),[{start:0,count:count*16}]);
  assert.deepEqual(JSON.parse(JSON.stringify(t.far.instanceColor.updateRanges)),[{start:0,count:count*3}]);
 }
 const version=t.far.instanceMatrix.version;t.update(.016,new THREE.Vector3(10000,150,0));
 assert.equal(t.far.count,0);assert.equal(t.far.instanceMatrix.version,version);assert.equal(t.far.instanceMatrix.updateRanges.length,0);
 t.update(.016,camera);assert.equal(t.far.count,1);assert.equal(t.far.instanceMatrix.updateRanges[0].count,16);t.dispose();
});

test('cars on two crossing roads take the crossing in turn and never overlap there',()=>{
 const t=new Current(11);t.farStagger=false;
 t.addTile('ew',one([-300,0,0],[300,0,0]));t.addTile('ns',one([0,-300,0],[0,300,0]));
 const camera=new THREE.Vector3(0,150,0);let crossed=0,minGap=Infinity;
 for(let i=0;i<1500;i++){
  t.update(.05,camera);
  const near=t.cars.filter(c=>{t.pose(c);return Math.hypot(c.x,c.y)<6;});
  for(const a of near)for(const b of near)if(a.lane!==b.lane)minGap=Math.min(minGap,Math.hypot(a.x-b.x,a.y-b.y));
  crossed+=near.length;
 }
 assert.ok(crossed>0,'traffic passes the crossing');assert.ok(minGap>2.5,`closest cars across the crossing ${minGap}`);t.dispose();
});
test('a red light on the next short piece of road stops the car before its line',()=>{
 const t=new Current(5);t.farStagger=false;
 t.addTile('a',one([-200,0,0],[-2,0,0]));
 // (the next piece is short and carries the stop line; phase 0 and 1 are red in turn)
 t.addTile('b',Float32Array.from([2,16,-2,0,0,40,0,0]),Float32Array.from([1,20,7,1]));
 const b=t.lanes.get('b')[0];b.cars.length=0;const a=t.lanes.get('a')[0];
 t.cars=t.cars.filter(c=>c.lane===a);let ran=0,passed=0;
 for(let i=0;i<2400;i++){
  const before=new Map(t.cars.map(c=>[c,[c.lane,c.s]]));t.update(.05,new THREE.Vector3(0,150,0));
  for(const c of t.cars){const [l,s]=before.get(c)??[];if(l===b&&c.lane===b&&s<20&&c.s>=20)passed++;if(l===b&&c.lane===b&&s<20&&c.s>=20&&signalState(t.clock,7,1)==='red'&&signalState(t.clock-3,7,1)==='red')ran++;}
 }
 assert.equal(ran,0);assert.ok(passed>0,'cars do pass on green');t.dispose();
});
