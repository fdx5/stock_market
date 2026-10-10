import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transformSync} from 'esbuild';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as THREE from 'three';
const base=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'rail-clearance-'));
const bundle=await build({stdin:{contents:`export * from './src/rail/railClearance';`,resolveDir:base},bundle:true,write:false,platform:'node',format:'esm'});
const entry=join(dir,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});const {cutBuilding}=await import(pathToFileURL(entry));
const matrix=new THREE.Matrix4().elements;
const input=(points)=>({attributes:{position:{array:new Float32Array(points),size:3},normal:{array:Float32Array.from({length:points.length},(_,i)=>i%3===2?1:0),size:3},uv:{array:Float32Array.from({length:points.length/3*2},(_,i)=>i*.1),size:2}},index:new Uint32Array([0,1,2,0,2,3]),groups:[]});
const wall=input([-10,0,0,10,0,0,10,15,0,-10,15,0]);
const clearance={a:[0,0,-20],b:[0,0,20],half:1.8,bottom:-.3,top:5.6};
function covers(g,x,y){const p=g.attributes.position.array;for(let i=0;i<g.index.length;i+=3){const ids=Array.from(g.index.subarray(i,i+3)),a=ids.map(n=>[p[n*3],p[n*3+1]]);const [A,B,C]=a;const den=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);if(Math.abs(den)<1e-8)continue;const u=((x-A[0])*(C[1]-A[1])-(y-A[1])*(C[0]-A[0]))/den,v=((B[0]-A[0])*(y-A[1])-(B[1]-A[1])*(x-A[0]))/den;if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return true;}return false;}
test('a station facade has a real train passage while its upper floors and sides stay',()=>{const result=cutBuilding(wall,matrix,[clearance]);assert.ok(result);for(const x of [-1,0,1])assert.equal(covers(result,x,3),false);for(const [x,y]of [[-8,3],[8,3],[0,8],[0,14]])assert.equal(covers(result,x,y),true);});
test('building surfaces above or alongside the railway stay byte-for-byte untouched',()=>{const high=input([-10,10,-10,10,10,-10,10,10,10,-10,10,10]);assert.equal(cutBuilding(high,matrix,[clearance]),null);assert.equal(cutBuilding(wall,new THREE.Matrix4().makeTranslation(30,0,0).elements,[clearance]),null);});
test('source geometry is preserved for asynchronous surveyed replacements',()=>{const before=JSON.stringify(wall);cutBuilding(wall,matrix,[clearance]);assert.equal(JSON.stringify(wall),before);});
test('cut edges keep UV, normal and vertex counts consistent',()=>{const g=cutBuilding(wall,matrix,[clearance]);const n=g.attributes.position.array.length/3;for(const a of Object.values(g.attributes)){assert.equal(a.array.length/a.size,n);assert.ok(a.array.every(Number.isFinite));}assert.ok(g.index.every(i=>i<n));});
test('two directional tracks cut both passages without erasing the pier between them',()=>{const g=cutBuilding(wall,matrix,[-4,4].map(x=>({...clearance,a:[x,0,-20],b:[x,0,20],half:1.5})));for(const x of [-4,4])assert.equal(covers(g,x,3),false);assert.equal(covers(g,0,3),true);});
test('inclined clearance follows the track rather than removing upper floors uniformly',()=>{const g=cutBuilding(wall,matrix,[{...clearance,a:[0,-2,-20],b:[0,2,20]}]);assert.equal(covers(g,0,3),false);assert.equal(covers(g,0,9),true);});
test('material groups remain valid after a facade is split',()=>{const source={...wall,groups:[{start:0,count:3,materialIndex:2},{start:3,count:3,materialIndex:4}]},g=cutBuilding(source,matrix,[clearance]);assert.equal(g.groups.reduce((n,a)=>n+a.count,0),g.index.length);assert.deepEqual(g.groups.map(a=>a.materialIndex),[2,4]);});

test('worker bounds enclose the complete cut and equal native geometry bounds',async()=>{
  const code=await build({entryPoints:[join(base,'src/rail/railClearanceWorker.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
  let reply;const scope={self:{postMessage:value=>{reply=value;}}};vm.runInNewContext(code.outputFiles[0].text,scope);
  scope.self.onmessage({data:{id:7,input:wall,matrix,clearances:[clearance]}});
  assert.equal(reply.id,7);assert.equal(reply.error,undefined);assert.ok(reply.result);
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(reply.result.attributes.position.array,3));g.computeBoundingBox();g.computeBoundingSphere();
  assert.deepEqual(Array.from(reply.bounds.box),[...g.boundingBox.min.toArray(),...g.boundingBox.max.toArray()]);
  assert.deepEqual(Array.from(reply.bounds.sphere),[...g.boundingSphere.center.toArray(),g.boundingSphere.radius]);g.dispose();
});

test('track clearance cache changes with source revisions and releases removed paths',async()=>{
  const source=await readFile(join(base,'src/rail/SurfaceRailLayer.ts'),'utf8'),ast=ts.createSourceFile('rail.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='SurfaceRailLayer');
  const method=cls.members.find(n=>n.name?.getText(ast)==='clearancePrisms').getText(ast).replace(/^private /,'');
  const scope={STRIDE:6};vm.runInNewContext(transformSync('class Layer{'+method+'};globalThis.Layer=Layer;',{loader:'ts'}).code,scope);
  const layer=new scope.Layer();Object.assign(layer,{revision:1,prismRevision:-1,prisms:[],entries:new Map([['one',{path:{points:new Float32Array([0,0,10,0,0,0,20,0,10,0,0,0])},line:{width:3}}]])});
  const first=layer.clearancePrisms();assert.equal(first.length,1);assert.deepEqual(Array.from(first[0].a),[0,10,-0]);
  for(let i=0;i<1000;i++)assert.equal(layer.clearancePrisms(),first);
  layer.entries.set('one',{path:{points:new Float32Array([0,0,25,0,0,0,20,0,25,0,0,0])},line:{width:3}});layer.revision++;
  const raised=layer.clearancePrisms();assert.notEqual(raised,first);assert.equal(raised[0].a[1],25);
  layer.entries.clear();layer.revision++;assert.equal(layer.clearancePrisms().length,0);
});

test('bulk instance packing matches existing vehicle matrices byte-for-byte without extra upload revisions',async()=>{
  const code=await build({entryPoints:[join(base,'src/components/instanceDirty.ts')],bundle:true,write:false,platform:'node',format:'esm'});
  const {setInstanceMatrix}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
  const old=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),128),next=new THREE.InstancedMesh(old.geometry,old.material,128),m=new THREE.Matrix4();
  for(let i=0;i<128;i++){
    m.compose(new THREE.Vector3(i*.013,-i*.177,Math.sin(i)*123),new THREE.Quaternion().setFromEuler(new THREE.Euler(i*.07,-i*.093,i*.113)),new THREE.Vector3(i%5?1:0,.1+i*.003,i%3?-1:0));
    old.setMatrixAt(i,m);setInstanceMatrix(next,i,m);
  }
  assert.equal(Buffer.compare(Buffer.from(old.instanceMatrix.array.buffer),Buffer.from(next.instanceMatrix.array.buffer)),0);
  assert.equal(next.instanceMatrix.version,old.instanceMatrix.version);old.dispose();next.dispose();old.geometry.dispose();old.material.dispose();
});
