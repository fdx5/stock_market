import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const helper={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficLaneCurve.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,helper);
const load=source=>{const scope={module:{exports:{}},exports:{},THREE,...helper.module.exports,CAR_SPECS:{},DIMS:{},loadCarModels:()=>new Promise(()=>{}),carModelMaterial:()=>new THREE.MeshStandardMaterial()};vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports.DroneTraffic;};
const Current=load(readFileSync(new URL('../src/components/droneTraffic.ts',import.meta.url),'utf8'));
const Previous=load(execFileSync('git',['show','0e05c14:frontend/src/components/droneTraffic.ts'],{encoding:'utf8'}));
// A continuous road grade. The previous fixture jumped down three metres at every tile seam.
const packed=(ox,oy)=>Float32Array.from(Array.from({length:12},(_,i)=>[3,16,ox,oy+i*4,ox*.01,ox+45,oy+i*4,(ox+45)*.01,ox+90,oy+i*4,(ox+90)*.01]).flat());
test('lane choices and complete traffic frames remain deterministic across tile changes',()=>{
 const old=new Previous(341),next=new Current(341);
 for(const t of [old,next]){t.addTile('a',packed(0,0));t.addTile('b',packed(90,0));t.addTile('c',packed(180,0));t.addTile('d',packed(1200,-40));}
 const camera=new THREE.Vector3();
 for(let frame=0;frame<900;frame++){
  if(frame===300)for(const t of [old,next])t.addTile('e',packed(270,0));
  if(frame===500)for(const t of [old,next])t.removeTile('b');
  if(frame===600)for(const t of [old,next])t.addTile('b',packed(90,0));
  camera.set(frame<400?0:1400,160,frame<700?0:-20);old.update(.06,camera);next.update(.06,camera);
  assert.equal(next.far.count,old.far.count);assert.equal(Buffer.compare(Buffer.from(next.far.instanceMatrix.array.buffer),Buffer.from(old.far.instanceMatrix.array.buffer)),0);assert.equal(Buffer.compare(Buffer.from(next.far.instanceColor.array.buffer),Buffer.from(old.far.instanceColor.array.buffer)),0);
 }
 old.dispose();next.dispose();
});

const one=(a,b)=>Float32Array.from([2,16,...a,...b]);
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
