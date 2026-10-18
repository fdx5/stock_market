import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';

const scope={module:{exports:{}},exports:{},coastField:()=>null};
const water=readFileSync(new URL('../src/components/waterCore.ts',import.meta.url),'utf8').replace(/^import [^\n]*\n/gm,'');
vm.runInNewContext(transformSync(water,{loader:'ts',format:'cjs'}).code,scope);
const {fieldFrom}=scope.module.exports;
test('water interpolation retains finite-node weighting, boundary clamping and missing-level fallback',()=>{
 const data={lvl:new Float32Array([2,4,6,8]),dist:new Float32Array([10,20,30,40]),wet:new Uint8Array(4),x0:0,y0:0,s:10,nx:2,ny:2};
 let fallbacks=0;const field=fieldFrom(data,()=>{fallbacks++;return 17;});
 assert.equal(field.level(5,5),5);assert.equal(field.level(0,0),2);assert.equal(field.level(-10,-10),2);assert.equal(field.shore(5,5),20);
 assert.equal(fallbacks,0,'terrain is not sampled when water nodes supply the level');
 data.lvl[0]=NaN;assert.equal(field.level(5,5),6);
 data.lvl.fill(NaN);assert.equal(field.level(5,5),17);assert.equal(fallbacks,1);
});
const boats=readFileSync(new URL('../src/components/sceneBoats.ts',import.meta.url),'utf8');
const ribbon=boats.slice(boats.indexOf('class Ribbon {'),boats.indexOf('/* ---------- Spray'));
const rs={THREE};vm.runInNewContext(transformSync(ribbon+'\nglobalThis.Ribbon=Ribbon;',{loader:'ts'}).code,rs);
test('wake ribbons retain all vertices, UVs, turning-width clamping and collapsed unused pairs',()=>{
 const r=new rs.Ribbon(5,new THREE.MeshBasicMaterial(),2);
 r.set([[10,20,1,0,0,3],[8,20,1,0,1,3]],age=>2+age,age=>age*.25);
 const g=r.mesh.geometry,p=g.attributes.position.array,uv=g.attributes.uv.array;
 assert.deepEqual(Array.from(p.slice(0,12)),[10,3,-22,10,3,-18,8,3,-23,8,3,-17]);
 assert.deepEqual(Array.from(uv.slice(0,8)),[0,0,1,0,0,.25,1,.25]);
 for(let i=2;i<5;i++){assert.deepEqual(Array.from(p.slice(i*6,i*6+6)),[8,3,-23,8,3,-17]);assert.deepEqual(Array.from(uv.slice(i*4,i*4+4)),[0,.25,1,.25]);}
 assert.equal(g.drawRange.count,6);assert.equal(r.mesh.visible,true);
 r.set([[0,0,1,0,0,2],[1,1,0,1,1,2]],()=>10,()=>0);
 const inner=.7*Math.SQRT2/(Math.PI/2);assert.ok(Math.abs(p[9]-1-inner)<1e-6,'inner edge stays within turning radius');
 r.set([],()=>0,()=>0);assert.ok(p.every(x=>x===0));assert.ok(uv.every(x=>x===0));assert.equal(r.mesh.visible,false);assert.equal(g.drawRange.count,0);
});
