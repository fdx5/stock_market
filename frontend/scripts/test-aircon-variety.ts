import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {standAircon} from '../src/walkmode/interior/models';
import {wallAircon,ceilingCassette,variantOf} from '../src/walkmode/interior/variants';
import type {Palette} from '../src/walkmode/interior/materials';
const mats=new Map<string,THREE.MeshPhysicalMaterial>();
const P=new Proxy({}, {get:(_,key)=>{const n=String(key);if(!mats.has(n))mats.set(n,new THREE.MeshPhysicalMaterial());return mats.get(n);}}) as Palette;
for(const [kind,make] of [[0,standAircon],[1,wallAircon],[2,ceilingCassette]] as const){
 const signatures=new Set<string>();
 for(let v=0;v<4;v++){
  const kit=make(P,v),box=new THREE.Box3(),hash=createHash('sha256');
  for(const p of kit){p.g.computeBoundingBox();box.union(p.g.boundingBox!);hash.update(Buffer.from(p.g.getAttribute('position').array.buffer));assert.ok([...p.g.getAttribute('position').array].every(Number.isFinite));p.g.dispose();}
  signatures.add(hash.digest('hex'));
  if(kind===0)assert.ok(box.min.x>=-.181&&box.max.x<=.181&&box.min.z>=-.001&&box.max.z<=.371&&box.min.y>=-.001&&box.max.y<=1.84,JSON.stringify(box));
  if(kind===1)assert.ok(box.min.x>=-.491&&box.max.x<=.491&&box.max.y<=2.32&&box.min.z>=-.001&&box.max.z<=.251,JSON.stringify(box));
  if(kind===2)assert.ok(box.min.y>=-.065&&box.max.y<=.001&&box.max.x-box.min.x<=1.051&&box.max.z-box.min.z<=.951,JSON.stringify(box));
 }
 assert.equal(signatures.size,4,'each mounting family must have four different actual shapes');
}
const choices=new Set<string>();
for(let i=0;i<64;i++){const seed=`source|101|3|modern_white|0|f${i}`;const kind=[2,1,0][variantOf(seed,'aircon',3)],v=variantOf(seed,'aircon-design',4);choices.add(`${kind}:${v}`);assert.equal(v,variantOf(seed,'aircon-design',4));}
assert.ok(choices.size>=9,'configuration seeds must cover multiple actual models and mounting families');
mats.forEach(m=>m.dispose());console.log('12 different aircon models: physical envelopes, finite geometry and seeded variety passed; combinations',choices.size);
