import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';

const root=new URL('../public/',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL('.'+path,root)));
const binary=path=>{const b=readFileSync(new URL('.'+path,root));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const bytes=a=>a?Buffer.from(a.buffer,a.byteOffset,a.byteLength):null;
function load(source,extra={}) {
 const scope={module:{exports:{}},exports:{},THREE,require:name=>{assert.equal(name,'three');return THREE;},...extra};
 const code=transformSync(source,{loader:'ts',format:'cjs'}).code;
 vm.runInNewContext(code,scope);return scope.module.exports;
}
const original=execFileSync('git',['show','2612324:frontend/src/components/sceneTrees.ts'],{encoding:'utf8'}).replace(/^import .*\n/gm,'');
let pauses=0;
const reference=load(original,{frameSlice:async()=>{pauses++;},onSceneMemoryRelease(){},bitmapTexture:async()=>new THREE.Texture(),fetchStatic:async path=>({ok:true,json:async()=>json(path),arrayBuffer:async()=>binary(path)})});
const candidate=load(readFileSync(new URL('../src/components/treeGeometry.ts',import.meta.url),'utf8'));
const wire=load(readFileSync(new URL('../src/components/treeGeometryWire.ts',import.meta.url),'utf8'));

test('all 66 tree variants and distance levels retain original geometry, bounds and aliases after transfer',async()=>{
 const expected=(await reference.loadTreeKit()).variants;
 const decoded=await candidate.decodeTreeVariants(json('/3d/trees.json'),binary('/3d/trees.bin'),json('/3d/twigs.json'),async()=>{},false);
 const packed=wire.packTrees(decoded),transferred=structuredClone(packed.wire,{transfer:packed.transfer});
 const actual=wire.unpackTrees(transferred);
 assert.equal(pauses,198);assert.deepEqual([...actual.keys()],[...expected.keys()]);
 let count=0;
 const parts=['bark','leaves','farBark','farLeaves','farthestLeaves'];
 for(const [species,list] of expected)for(let i=0;i<list.length;i++){
  count++;const a=actual.get(species)[i],e=list[i];assert.equal(a.twig,e.twig);
  for(const part of parts){
   const ag=a[part],eg=e[part];assert.deepEqual(Object.keys(ag.attributes),Object.keys(eg.attributes));
   for(const name of Object.keys(eg.attributes)){
    const aa=ag.attributes[name],ea=eg.attributes[name];assert.equal(aa.itemSize,ea.itemSize);assert.equal(aa.normalized,ea.normalized);assert.equal(aa.array.constructor.name,ea.array.constructor.name);assert.deepEqual(bytes(aa.array),bytes(ea.array));
   }
   assert.deepEqual(bytes(ag.index?.array),bytes(eg.index?.array));assert.deepEqual(ag.boundingSphere,eg.boundingSphere);
   for(const peer of parts)assert.equal(ag===a[peer],eg===e[peer]);
  }
 }
 assert.equal(count,66);
});

test('larger twig groups reduce tree cards without removing trunks, species or flower heads',async()=>{
 const expected=(await reference.loadTreeKit()).variants;
 const actual=await candidate.decodeTreeVariants(json('/3d/trees.json'),binary('/3d/trees.bin'),json('/3d/twigs.json'),async()=>{});
 let before=0,after=0,grouped=0;
 for(const [species,list] of expected)for(let i=0;i<list.length;i++){
  const e=list[i],a=actual.get(species)[i];
  assert.deepEqual(bytes(a.bark.attributes.position?.array),bytes(e.bark.attributes.position?.array));
  if(e.v.leaves.count>400 && ['ginkgo','zelkova','cherry','plane','fringe','pine','conifer'].includes(species)){
   grouped++;before+=e.leaves.index.count;after+=a.leaves.index.count;
   assert.equal(a.leaves.index.count,Math.ceil(e.v.leaves.count*.45)*6);
   assert.ok(Number.isFinite(a.leaves.boundingSphere.radius));
   assert.ok(a.leaves.boundingSphere.radius<=e.leaves.boundingSphere.radius*1.25,`${species} ${a.leaves.boundingSphere.radius}/${e.leaves.boundingSphere.radius}`);
  }else assert.deepEqual(bytes(a.leaves.attributes.position.array),bytes(e.leaves.attributes.position.array));
 }
 assert.ok(grouped>0);assert.ok(after<before*.46);
 console.log(JSON.stringify({groupedVariants:grouped,beforeIndices:before,afterIndices:after,reduction:1-after/before}));
});
