import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync}from'node:fs';
import {build}from'esbuild';
import * as THREE from'three';
import {fileURLToPath}from'node:url';
import path from'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(path.join(root,'tmp'),{recursive:true});
const file=path.join(root,'tmp','rolling-tests.mjs');
await build({stdin:{contents:"export {modelWheelRig,rollingWheelGeometry,wheelRotation,fallbackWheelRig} from './src/components/rollingWheels';export {collisionFreeTravel,vehicleOverlap} from './src/components/trafficCollision';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',external:['three'],outfile:file});
const {modelWheelRig,rollingWheelGeometry,wheelRotation,collisionFreeTravel,vehicleOverlap}=await import(new URL('../tmp/rolling-tests.mjs',import.meta.url));
const body=(x,y,hx=1,hy=0,length=4,width=2)=>({x,y,hx,hy,length,width});
test('swept movement stops before contact even when a priority rule permits travel',()=>{
 const self=body(0,0),other=body(6,0),pose=d=>body(d,0);
 const distance=collisionFreeTravel(5,pose,[self,other],self);
 assert.ok(distance>1.9&&distance<2);assert.equal(vehicleOverlap(...[distance,0,1,0,4,2],other),false);
 assert.equal(collisionFreeTravel(1,pose,[self],self),1);
});
test('a thin crossing body cannot be crossed between large movement endpoints',()=>{
 const self=body(0,0,1,0,.5,.5),other=body(5,0,0,1,2,.2);
 const distance=collisionFreeTravel(8,d=>body(d,0,1,0,.5,.5),[other],self);
 assert.ok(distance>4.5&&distance<4.7);
 assert.equal(vehicleOverlap(distance,0,1,0,.5,.5,other),false);
});
test('curved swept poses check actual changing vehicle orientation',()=>{
 const self=body(0,0,1,0,2,.8),pose=d=>body(4*Math.sin(d/4),4*(1-Math.cos(d/4)),Math.cos(d/4),Math.sin(d/4),2,.8);
 const target=pose(4),other=body(target.x,target.y,0,1,2,1);
 const distance=collisionFreeTravel(8,pose,[other],self);
 assert.ok(distance>0&&distance<4);const p=pose(distance);
 assert.equal(vehicleOverlap(p.x,p.y,p.hx,p.hy,p.length,p.width,other),false);
});
test('wheel angle follows distance/radius, stops at zero distance and reverses',()=>{
 assert.equal(wheelRotation(0,.33),0);assert.ok(Math.abs(wheelRotation(2*Math.PI*.33,.33))<1e-10);
 assert.ok(Math.abs(wheelRotation(.33,.33)-1)<1e-10);assert.equal(wheelRotation(-.33,.33),-1);
});
const meta=JSON.parse(readFileSync(path.join(root,'public/3d/cars.json'))),bin=readFileSync(path.join(root,'public/3d/cars.bin'));
for(const kind of ['sedan','suv','van','cargo','boxtruck','bus','container'])test(`actual ${kind} model keeps its body and extracts axle-aligned rolling wheels`,()=>{
 const m=meta.kinds[kind],g=new THREE.BufferGeometry(),slice=(offset,bytes)=>bin.buffer.slice(bin.byteOffset+offset,bin.byteOffset+offset+bytes);
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(slice(m.pos,m.verts*12)),3));
 const uv16=new Uint16Array(slice(m.uv,m.verts*4)),uv=Float32Array.from(uv16,n=>n/65535);g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 g.setIndex(new THREE.BufferAttribute(new Uint16Array(slice(m.idx,m.index*2)),1));g.computeBoundingSphere();
 const rig=modelWheelRig(g);assert.equal(rig.full,true);assert.ok(rig.wheels.length>=4&&rig.wheels.length<=16,rig.wheels.length);
 assert.equal(modelWheelRig(g),rig);assert.equal(rig.body.attributes.position,g.attributes.position);
 assert.ok(rig.body.index.count<g.index.count);assert.ok(rig.body.index.count>g.index.count*.1);
 for(const w of rig.wheels){assert.ok(w.radius>.2&&w.radius<.8);assert.ok(w.width>.1&&w.width<.65);assert.ok(Math.abs(w.y-w.radius)<.04);}
 for(const i of rig.body.index.array)assert.ok(![3,9].includes(Math.floor(g.attributes.uv.getX(i)*16)));
});
test('all near wheels share two bounded geometries with visible three-dimensional spokes',()=>{
 for(const rimOnly of [false,true]){const g=rollingWheelGeometry(rimOnly);assert.equal(rollingWheelGeometry(rimOnly),g);g.computeBoundingBox();assert.ok(g.boundingBox.max.x-g.boundingBox.min.x>.1);assert.ok(g.attributes.position.count/3<700);assert.ok(g.attributes.color.count>0);}
});
