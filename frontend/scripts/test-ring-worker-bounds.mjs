import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const source=readFileSync(new URL('../src/components/ringBuildings.ts',import.meta.url),'utf8');
const start=source.indexOf('  function sphereOf('),end=source.indexOf('  const SINK',start);
const code=transformSync(source.slice(start,end),{loader:'ts'}).code;
const sphereOf=vm.runInNewContext('('+code.trim()+')');
test('worker culling bounds exactly match the former Three.js scan for every transferred vertex',()=>{
 for(const values of [[0,0,0],[.1,.2,-3,400,-200,67,-.2,18,160],Array.from({length:30000},(_,i)=>Math.sin(i*7)*3400)]){
  const position=new Float32Array(values),g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(position,3));g.computeBoundingSphere();
  const expected=[...g.boundingSphere.center.toArray(),g.boundingSphere.radius];assert.deepEqual(Array.from(sphereOf(position)),expected);
  for(let i=0;i<position.length;i+=3)assert.ok(g.boundingSphere.distanceToPoint(new THREE.Vector3(...position.subarray(i,i+3)))<1e-9);
 }
 assert.deepEqual(Array.from(sphereOf(new Float32Array())),[0,0,0,0]);
});
