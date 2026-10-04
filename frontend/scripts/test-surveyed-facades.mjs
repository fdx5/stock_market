import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
function load(source,extra={}){const scope={module:{exports:{}},exports:{},THREE,...extra};vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;}
const analysis=load(read('photoAnalysis.ts')),survey=load(read('vworld3d.ts'),analysis);
function box(w,d,h,x,y,z){return new THREE.BoxGeometry(w,d,h).translate(x,y,z+h/2);}
function model(){const parts=[box(96,52,7,0,0,0),box(32,14,71,-23,0,7),box(32,14,71,23,0,7),box(6,6,6,-23,0,78),box(6,6,6,23,0,78)];const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());return g;}
function area(g){if(!g)return 0;const p=g.attributes.position,idx=g.index;let total=0;for(let i=0;i<(idx?.count??p.count);i+=3){const ids=idx?[idx.getX(i),idx.getX(i+1),idx.getX(i+2)]:[i,i+1,i+2],a=new THREE.Vector3().fromBufferAttribute(p,ids[0]),b=new THREE.Vector3().fromBufferAttribute(p,ids[1]),c=new THREE.Vector3().fromBufferAttribute(p,ids[2]);total+=b.sub(a).cross(c.sub(a)).length()/2;}return total;}
test('a wide seven-metre podium never turns two 84m apartment towers into blank cores',()=>{
 const g=model();assert.equal(analysis.mainRoofOf(g),78);
 const ph={geometry:g},shape=survey.surveyedShape(ph,0,new Map(),1,undefined,true);
 assert.equal(shape.roofZ,78);assert.ok(area(shape.walls)>12000);assert.ok(area(shape.cores)<500);
 assert.ok(Math.abs(['walls','roofs','cores','ends','bands','painted'].reduce((n,k)=>n+area(shape[k]),0)-area(g))<.01,'classification must retain the complete surveyed model');
 for(const k of ['walls','roofs','cores','ends','bands','painted'])shape[k]?.dispose();g.dispose();
});
test('a normal tower still keeps its small stair and lift rooms plain',()=>{
 const parts=[box(30,15,78,0,0,0),box(6,6,6,0,0,78)],g=mergeGeometries(parts);assert.equal(analysis.mainRoofOf(g),78);
 const shape=survey.surveyedShape({geometry:g},0);assert.ok(area(shape.cores)>100&&area(shape.cores)<500);assert.ok(area(shape.walls)>4500);
 for(const k of ['walls','roofs','cores','ends','bands','painted'])shape[k]?.dispose();parts.forEach(p=>p.dispose());g.dispose();
});
test('missing upper roof evidence leaves tower windows intact instead of blanking the body',()=>{
 const wall=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-20,0,7,20,0,7,20,0,80,-20,0,7,20,0,80,-20,0,80],3));
 assert.equal(analysis.mainRoofOf(wall),Infinity);const shape=survey.surveyedShape({geometry:wall},0);assert.ok(shape.walls);assert.equal(shape.cores,null);assert.equal(shape.bands,null);wall.dispose();shape.walls.dispose();
});
test('roof selection is identical for indexed and expanded survey triangles',()=>{
 const g=model(),flat=g.toNonIndexed();assert.equal(analysis.mainRoofOf(g),analysis.mainRoofOf(flat));g.dispose();flat.dispose();
});
