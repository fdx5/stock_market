import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const load=source=>{const scope={module:{exports:{}},exports:{},THREE,CAR_SPECS:{},DIMS:{},loadCarModels:()=>new Promise(()=>{}),carModelMaterial:()=>new THREE.MeshStandardMaterial()};vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports.DroneTraffic;};
const Previous=load(execFileSync('git',['show','8311d04:frontend/src/components/droneTraffic.ts'],{encoding:'utf8'}));
const Current=load(readFileSync(new URL('../src/components/droneTraffic.ts',import.meta.url),'utf8'));
// A continuous road grade. The previous fixture jumped down three metres at every tile seam.
const packed=(ox,oy)=>Float32Array.from(Array.from({length:12},(_,i)=>[3,16,ox,oy+i*4,ox*.01,ox+45,oy+i*4,(ox+45)*.01,ox+90,oy+i*4,(ox+90)*.01]).flat());
test('cached lane continuations preserve random choices and complete traffic frames across tile changes',()=>{
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
