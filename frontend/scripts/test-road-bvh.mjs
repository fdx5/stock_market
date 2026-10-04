import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
const load=name=>{const scope={module:{exports:{}},exports:{},THREE};vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;};
const {roadBvhIndex,buildRoadBvhJs}=load('roadBvh.ts'),{raiseRoadPaint,roadSurfaceHeight}=load('roadDrape.ts');
const bytes=readFileSync(new URL('../src/wasm/road-bvh/road_bvh.wasm',import.meta.url));
test('checked-in WASM binary matches the compiled Rust source manifest',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../src/wasm/road-bvh/build.json',import.meta.url),'utf8'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(manifest.wasmSha256,hash(bytes));assert.equal(manifest.sourceSha256,hash(readFileSync(new URL('../wasm/road-bvh/src/lib.rs',import.meta.url),'utf8').replace(/\r\n/g,'\n')));
});
async function wasm(bounds){const {instance}=await WebAssembly.instantiate(bytes,{}),k=instance.exports,p=k.alloc_words(bounds.length);new Float32Array(k.memory.buffer,p,bounds.length).set(bounds);const t=k.bvh_build(p,bounds.length/4);if(!t){k.free_words(p,bounds.length);return null;}const part={nodes:new Uint32Array(k.memory.buffer,k.bvh_nodes(t),k.bvh_node_count(t)*8).slice(),ids:new Uint32Array(k.memory.buffer,k.bvh_ids(t),bounds.length/4).slice(),offset:0};k.bvh_free(t);k.free_words(p,bounds.length);return part;}
function geometry(p){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));return g;}
const index=parts=>roadBvhIndex({parts,triangles:parts.reduce((n,p)=>n+p.ids.length,0)});
let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
test('Rust BVH rejects malformed/non-finite bounds and handles a single leaf',async()=>{
 assert.equal(await wasm(Float32Array.from([NaN,0,1,1])),null);
 assert.equal(await wasm(Float32Array.from([2,0,1,1])),null);
 const b=await wasm(Float32Array.from([0,0,1,1]));assert.deepEqual(Array.from(index([b]).query(.5,.5,.5,.5)),[0]);
});
test('parallel forest parts preserve original triangle ids without missing intersecting bounds',async()=>{
 const bounds=Float32Array.from({length:1200},(_,i)=>i%4<2?random()*200-100:0);
 for(let i=0;i<bounds.length;i+=4){bounds[i+2]=bounds[i]+random()*8;bounds[i+3]=bounds[i+1]+random()*8;}
 const a=await wasm(bounds.slice(0,600)),b=await wasm(bounds.slice(600));b.offset=150;
 const tree=index([a,b]);
 assert.equal(new Set([...a.ids,...b.ids.map(id=>id+b.offset)]).size,300);
 for(let i=0;i<1000;i++){const x=random()*200-100,y=random()*200-100,w=random()*8,h=random()*8,got=new Set(tree.query(x,y,x+w,y+h));
  for(let j=0;j<300;j++){const k=j*4;if(bounds[k]<=x+w&&bounds[k+1]<=y+h&&bounds[k+2]>=x&&bounds[k+3]>=y)assert.ok(got.has(j*3));}
 }
});
test('height and paint correction match the grid narrow phase on inclines, overlaps and seams',async()=>{
 const p=[],bounds=[];
 for(let x=0;x<16;x++)for(let y=0;y<8;y++)for(const t of [[[x,y],[x+1,y],[x,y+1]],[[x+1,y],[x+1,y+1],[x,y+1]]]){
  const h=t.map(([a,b])=>a*.1+b*.03);for(let i=0;i<3;i++)p.push(t[i][0],h[i],-t[i][1]);bounds.push(Math.min(...t.map(q=>q[0])),Math.min(...t.map(q=>q[1])),Math.max(...t.map(q=>q[0])),Math.max(...t.map(q=>q[1])));
 }
 const g=geometry(p),tree=index([await wasm(Float32Array.from(bounds))]),old=roadSurfaceHeight(g),next=roadSurfaceHeight(g,tree);
 for(let x=0;x<=16;x+=.25)for(let y=0;y<=8;y+=.25)assert.equal(next(x,y),old(x,y));
 const original=geometry([.1,0,-.1,10.1,0,-.1,.1,0,-5.9]),other=original.clone();
 await raiseRoadPaint(original,g,async()=>true);await raiseRoadPaint(other,g,async()=>true,.015,tree);
 assert.deepEqual(other.attributes.position.array,original.attributes.position.array);
 g.dispose();original.dispose();other.dispose();
});
test('JS benchmark BVH and Rust BVH both cover identical bounds',async()=>{
 const b=Float32Array.from({length:400},(_,i)=>i%4<2?random()*10:0);for(let i=0;i<400;i+=4){b[i+2]=b[i]+1;b[i+3]=b[i+1]+1;}
 for(const part of [buildRoadBvhJs(b),await wasm(b)]){const tree=index([part]);for(let i=0;i<100;i++)assert.ok(tree.query(b[i*4],b[i*4+1],b[i*4+2],b[i*4+3]).includes(i*3));}
});
