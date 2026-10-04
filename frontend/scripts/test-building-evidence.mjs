import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const source=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
const load=(s,extra={})=>{const scope={module:{exports:{}},exports:{},...extra};vm.runInNewContext(transformSync(s.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;};
const {hasAboveGroundEvidence}=load(source('buildingEvidence.ts'));
const {physicalBuildingFootprints}=load(source('vworldBuildings.ts'),{hasAboveGroundEvidence});
const fixtures=[
 {grnd_flr:'0',ugrnd_flr:'0',height:'0',usability:'',bld_nm:''},
 {grnd_flr:' 0.0 ',ugrnd_flr:'2',height:'0'},
 {grnd_flr:'0',height:'9'},
 {grnd_flr:'2',height:'0'},
 {height:'0'},
];
const features=fixtures.map((properties,i)=>({properties,geometry:{type:'Polygon',coordinates:[[[i*20,0],[i*20+5,0],[i*20+5,5],[i*20,5],[i*20,0]]]}}));
test('zero storeys never invent 6.5m buildings; measured height and missing storeys remain distinct',()=>{assert.deepEqual(fixtures.map(hasAboveGroundEvidence),[false,false,true,true,true]);for(const grnd_flr of ['',null,undefined])assert.equal(hasAboveGroundEvidence({grnd_flr,height:0}),true);});
test('road protection includes only footprints allowed to become above-ground buildings',()=>{const rings=physicalBuildingFootprints(features,p=>p);assert.equal(rings.length,3);assert.ok(rings.every(r=>r[0][0]>=40));});
test('actual ring worker applies the same zero-storey rule before any height fallback',()=>{
 let result;const self={postMessage(r){result=r;}};
 const kx=111320,ky=110540;
 const fs=features.map(f=>({...f,geometry:{...f.geometry,coordinates:f.geometry.coordinates.map(r=>r.map(([x,y])=>[(x+100)/kx,y/ky]))}}));
 const {ringWorkerMain}=load(source('ringBuildings.ts')+'\nexport {ringWorkerMain};',{self,performance:{now:()=>0},importScripts(){self.ringCb({response:{result:{featureCollection:{features:fs}}}});},postMessage(r){result=r;}});
 ringWorkerMain();self.onmessage({data:{lat:0,lon:0,urls:['fixture'],near:new Float32Array(),roads:new Float32Array(),grid:null,seed:1,inner:0,outer:600,floorM:{}}});
 assert.equal(result.buildings,3);assert.equal(result.footprints.length,3);assert.ok(result.footprints.every(r=>r[0][0]>=139.99));
});
