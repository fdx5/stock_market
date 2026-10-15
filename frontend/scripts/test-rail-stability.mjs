import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
function load(name,extra={}){const scope={module:{exports:{}},exports:{},THREE,mergeGeometries,performance,AbortController,fetch:()=>new Promise(()=>{}),BuildingClearance:class{dispose(){}},...extra};vm.runInNewContext(transformSync(readFileSync(new URL('../src/rail/'+name,import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;}
const core=load('railCore.ts'),kit=load('stationKit.ts',core),{SurfaceRailLayer}=load('SurfaceRailLayer.ts',{...core,...kit});
const origin={lat:37,lon:127},kx=111320*Math.cos(37*Math.PI/180),facility={id:'platform',kind:'platform',points:[[-10,-3],[10,-3],[10,3],[-10,3]].map(([x,y])=>[127+x/kx,37+y/110540]),stationName:'검증역',height:null,shelter:true};
const line={id:'one',name:'one',colour:'#abcdef',mode:'emu',cars:2,carLength:20,width:3.4,gauge:1.435};
const path=(id='one',h=8)=>({id,line:'one',points:new Float32Array([-15,0,h,0,1,0,0,h,15,1,15,0,h,30,1]),length:30,stops:[]});
const geometry=()=>({bed:new Float32Array([-10,8,-2,10,8,-2,0,8,2]),steel:new Float32Array([-10,8.065,0,10,8.065,0,0,8.065,1]),wire:new Float32Array(),ties:new Float32Array(),piers:new Float32Array([0,4,0]),poles:new Float32Array([0,11,0,0])});
const layer=()=>new SurfaceRailLayer({origin,heightAt:()=>0});
test('rail refresh keeps the exact source meshes, materials and group while replacing measured geometry',()=>{
 const r=layer(),source={id:'one',facilities:[]},a=r.makeEntry(source,path(),geometry(),line,{x:0,y:0}),meshes=a.group.children.slice(),geos=a.geometries.slice();r.group.add(a.group);let disposed=0;geos.forEach(g=>g.addEventListener('dispose',()=>disposed++));
 for(let i=0;i<20;i++){const b=r.makeEntry(source,path('one',8+i*.1),geometry(),line,{x:i,y:0},i?a.current:a);a.current=b;assert.equal(b.group,a.group);assert.deepEqual(b.group.children,meshes);assert.ok(meshes.every(m=>m.parent===a.group));}
 assert.equal(disposed,geos.length);a.current.dispose();r.dispose();
});
test('growing and shrinking pier/pole batches retain the source instance object and release superseded geometry',()=>{
 const r=layer(),source={id:'one',facilities:[]},a=r.makeEntry(source,path(),geometry(),line,{x:0,y:0}),pier=a.group.getObjectByName('rail-piers'),pole=a.group.getObjectByName('rail-poles');
 const g=geometry();g.piers=new Float32Array([0,4,0,10,4,0,20,4,0]);g.poles=new Float32Array([0,11,0,0,20,11,0,0]);const b=r.makeEntry(source,path(),g,line,{x:0,y:0},a);
 assert.equal(b.group.getObjectByName('rail-piers'),pier);assert.equal(b.group.getObjectByName('rail-poles'),pole);assert.equal(pier.count,3);assert.ok(pier.instanceMatrix.count>=3);assert.equal(pole.count,2);assert.ok(pier.instanceMatrix.version>0);
 const c=r.makeEntry(source,path(),geometry(),line,{x:0,y:0},b);assert.equal(pier.count,1);assert.equal(pole.count,1);c.dispose();r.dispose();
});
test('station elevation changes retain every roof/platform mesh and material and dispose old CPU geometry exactly once',()=>{
 const a=kit.stationKit(facility,path(),origin,()=>0),meshes=a.group.children.slice(),mats=meshes.map(m=>m.material),geos=meshes.map(m=>m.geometry);let disposed=0;geos.forEach(g=>g.addEventListener('dispose',()=>disposed++));
 const b=kit.stationKit(facility,path('one',9),origin,()=>0,a);assert.equal(b,a);assert.deepEqual(b.group.children,meshes);assert.deepEqual(meshes.map(m=>m.material),mats);assert.ok(meshes.every((m,i)=>m.geometry!==geos[i]));assert.equal(disposed,geos.length);assert.ok(meshes[0].geometry.attributes.position.getY(0)>9.8);b.dispose();assert.equal(b.group.children.length,0);
});
test('a shared station survives a second direction arrival and first owner removal without recreating its GPU inputs',()=>{
 // (a new station's model is built by the layer's update, one a tick: built here as update would)
 const r=layer(),a=r.makeEntry({id:'one',facilities:[facility]},path('one'),geometry(),line,{x:0,y:0}),station=r.stations.get('platform'),_built=r.placeStation(station),model=station.model,meshes=model.group.children.slice(),geos=meshes.map(m=>m.geometry);
 const b=r.makeEntry({id:'two',facilities:[facility]},path('two'),geometry(),line,{x:0,y:0});assert.equal(station.model,model);assert.deepEqual(meshes.map(m=>m.geometry),geos);a.dispose();assert.equal(station.model,model);assert.equal(station.owners.size,1);assert.deepEqual(meshes.map(m=>m.geometry),geos);b.dispose();assert.equal(r.stations.size,0);r.dispose();
});
test('shared owner refresh is exact and distant path changes do not invalidate the station',()=>{
 const a=path(),b=path();b.points=new Float32Array([...a.points,1000,0,999,1000,1]);assert.equal(kit.stationSourceKey(facility,a,origin,()=>0),kit.stationSourceKey(facility,b,origin,()=>0));assert.notEqual(kit.stationSourceKey(facility,a,origin,()=>0),kit.stationSourceKey(facility,path('one',8.001),origin,()=>0));
});
