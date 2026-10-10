import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
function load(source,extra={}){const scope={module:{exports:{}},exports:{},THREE,onSceneMemoryRelease:()=>{},...extra};vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;}
const {SurveyModelCache}=load(read('surveyModelCache.ts'));
const analysis=load(read('photoAnalysis.ts')),survey=load(read('vworld3d.ts'),{...analysis,SurveyModelCache});

test('source geometry shares the registered road/building frame after a kilometre of travel, with all source vertices retained',async()=>{
 const lat=37.66,lon=127.02,R=6378137,kx=111320*Math.cos(lat*Math.PI/180),expected=[[0,0,5],[500,1000,50],[510,1010,50]];
 const points=expected.map(([x,y,z])=>{const la=(lat+y/110540)*Math.PI/180,lo=(lon+x/kx)*Math.PI/180,r=R+z;return[r*Math.cos(la)*Math.cos(lo),-r*Math.cos(la)*Math.sin(lo),r*Math.sin(la)];});
 const box=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))).concat([0,1,2].map(i=>Math.max(...points.map(p=>p[i])))),center=[0,1,2].map(i=>(box[i]+box[i+3])/2),chunks=[];
 const write=(kind,v)=>{const b=new ArrayBuffer(kind==='u8'?1:kind==='u16'?2:kind==='f64'?8:4),d=new DataView(b);d[{u8:'setUint8',u16:'setUint16',u32:'setUint32',f32:'setFloat32',f64:'setFloat64'}[kind]](0,v,true);chunks.push(new Uint8Array(b));};
 const str=s=>{write('u8',s.length);chunks.push(new TextEncoder().encode(s));};
 write('u8',0);write('u32',0);str('fixture');box.forEach(v=>write('f64',v));write('f32',0);write('u8',1);write('u32',3);
 for(const p of points){p.forEach((v,i)=>write('f32',v-center[i]));[0,0,1,0,0].forEach(v=>write('f32',v));}
 write('u32',3);[0,1,2].forEach(v=>write('u16',v));write('u32',0);write('u8',0);str('');
 const bytes=new Uint8Array(chunks.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of chunks){bytes.set(p,offset);offset+=p.length;}
 const module=load(read('vworld3d.ts')+'\nexport {model as decodeShape};',{...analysis,SurveyModelCache,TextDecoder,sharedVworldBytes:async()=>bytes.buffer.slice(0)});
 const result=await module.decodeShape('synthetic',{key:'frame-fixture',x:0,y:0,data:'fixture.xdo'},lat,lon,0);
 assert.equal(result.geometry.attributes.position.count,3);assert.deepEqual(Array.from(result.geometry.index.array),[0,2,1]);
 for(let i=0;i<3;i++){const p=result.geometry.attributes.position;assert.ok(Math.abs(p.getX(i)-expected[i][0])<.002);assert.ok(Math.abs(p.getY(i)-expected[i][1])<.002);assert.ok(Math.abs(p.getZ(i)-(expected[i][2]-5))<.002);}
 result.geometry.dispose();
});
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
test('a tall elevator machinery room above an older apartment roof has no windowed walls, while the full body and geometry remain',()=>{
 const parts=[box(64,16,45,0,0,0),box(8,7,10.5,0,0,45)],g=mergeGeometries(parts);assert.equal(analysis.mainRoofOf(g),45);
 const shape=survey.surveyedShape({geometry:g},2),position=shape.walls.attributes.position;
 for(let i=0;i<position.count;i++)assert.ok(position.getZ(i)<=46.00001,'no window-bearing wall may extend into the machinery room');
 assert.ok(area(shape.cores)>200);assert.ok(area(shape.walls)>5500);
 assert.ok(Math.abs(['walls','roofs','cores','ends','bands','painted'].reduce((n,k)=>n+area(shape[k]),0)-area(g))<.01);
 for(const k of ['walls','roofs','cores','ends','bands','painted'])shape[k]?.dispose();parts.forEach(p=>p.dispose());g.dispose();
});
test('missing upper roof evidence leaves tower windows intact instead of blanking the body',()=>{
 const wall=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-20,0,7,20,0,7,20,0,80,-20,0,7,20,0,80,-20,0,80],3));
 assert.equal(analysis.mainRoofOf(wall),Infinity);const shape=survey.surveyedShape({geometry:wall},0);assert.ok(shape.walls);assert.equal(shape.cores,null);assert.equal(shape.bands,null);wall.dispose();shape.walls.dispose();
});
test('roof selection is identical for indexed and expanded survey triangles',()=>{
 const g=model(),flat=g.toNonIndexed();assert.equal(analysis.mainRoofOf(g),analysis.mainRoofOf(flat));g.dispose();flat.dispose();
});
