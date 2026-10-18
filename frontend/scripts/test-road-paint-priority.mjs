import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync, build} from 'esbuild';
import * as THREE from 'three';
import {execFileSync} from 'node:child_process';

function geometryHelpers() {
  const waits=[];
  const scope={module:{exports:{}},exports:{},require:name=>name==='three'?THREE:{frameSlice:async(budget,urgent)=>waits.push({budget,urgent})},performance:{now:()=>1}};
  const source=readFileSync(new URL('../src/components/slicedGeometry.ts',import.meta.url),'utf8');
  vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);
  return {...scope.module.exports,waits};
}

test('road array conversion retains priority after every yield and preserves float32 values',async()=>{
  for(const urgent of [false,true]){
    const f=geometryHelpers(),values=Array.from({length:200000},(_,i)=>Math.sin(i)*1e4);
    const result=await f.float32Sliced(values,-1,urgent);
    assert.equal(Buffer.compare(Buffer.from(result.buffer),Buffer.from(new Float32Array(values).buffer)),0);
    assert.ok(f.waits.length>=3);
    assert.ok(f.waits.every(w=>w.budget===(urgent?12:9)&&w.urgent===urgent));
  }
});

test('both face-normal passes retain priority and exactly match Three.js, including degenerate faces',async()=>{
  for(const urgent of [false,true]){
    const f=geometryHelpers(),positions=Float32Array.from({length:9216*8},(_,i)=>i<18?0:Math.sin(i)*100);
    const actual=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3));
    const expected=actual.clone();expected.computeVertexNormals();
    await f.flatNormalsSliced(actual,-1,urgent);
    assert.equal(Buffer.compare(Buffer.from(actual.getAttribute('normal').array.buffer),Buffer.from(expected.getAttribute('normal').array.buffer)),0);
    assert.ok(f.waits.length>=16);
    assert.ok(f.waits.every(w=>w.budget===(urgent?12:9)&&w.urgent===urgent));
    actual.dispose();expected.dispose();
  }
});

test('the actual paint builder never demotes its geometry continuations',async()=>{
  const waits=[];
  globalThis.__roadPaintWaits=waits;
  const assets={name:'test-assets',setup(b){
    b.onResolve({filter:/\?(url|worker)$|\.wasm$/},a=>({path:a.path,namespace:'asset'}));
    b.onLoad({filter:/.*/,namespace:'asset'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));
    b.onResolve({filter:/^\.\/frameSlice$/},()=>({path:'scheduler',namespace:'test-scheduler'}));
    b.onLoad({filter:/.*/,namespace:'test-scheduler'},()=>({contents:`export const frameSlice=async(b=9,u=false)=>{globalThis.__roadPaintWaits.push(u)};export const mapInSlices=async(a,f)=>a.map(f);export const filterInSlices=async(a,f)=>a.filter(f);export const sliceDeadline=()=>Infinity;`}));
  }};
  const out=await build({stdin:{contents:"export {buildRoadSurface,buildRoadMarkings} from './sceneStreet';",resolveDir:new URL('../src/components/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[assets],define:{'import.meta.env':'{"DEV":false,"PROD":true}'}});
  const mod=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  // Only the asphalt's procedural texture needs browser painting; its worker is
  // unavailable here. Markings exercise the complete geometry path directly.
  const roads=[];
  for(let i=0;i<90;i++)roads.push({line:[[0,i*24],[300,i*24],[600,i*24]],width:20,lanes:6});
  const marks=await mod.buildRoadMarkings(roads);
  assert.ok(marks.group.children.reduce((n,m)=>n+m.geometry.getAttribute('position').count,0)>100000);
  assert.ok(waits.length>2);
  assert.ok(waits.every(Boolean),'paint must retain priority in the array and normal helpers too');
  marks.dispose();delete globalThis.__roadPaintWaits;
});

test('interval lookup and height reuse preserve every paint attribute against the deployed builder',async()=>{
  const dir=new URL('../src/components/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
  const moduleOf=async source=>{
    const plugin={name:'test-assets',setup(b){
      b.onResolve({filter:/\?(url|worker)$|\.wasm$/},a=>({path:a.path,namespace:'asset'}));
      b.onLoad({filter:/.*/,namespace:'asset'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));
      b.onResolve({filter:/^\.\/frameSlice$/},()=>({path:'scheduler',namespace:'test-scheduler'}));
      b.onLoad({filter:/.*/,namespace:'test-scheduler'},()=>({contents:'export const frameSlice=async()=>{};export const mapInSlices=async(a,f)=>a.map(f);export const filterInSlices=async(a,f)=>a.filter(f);'}));
    }};
    const out=await build({stdin:{contents:source,resolveDir:dir,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[plugin],define:{'import.meta.env':'{"DEV":false,"PROD":true}'}});
    return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  };
  const actual=await moduleOf(readFileSync(dir+'/sceneStreet.ts','utf8'));
  const previous=await moduleOf(execFileSync('git',['show','8addbcc1:frontend/src/components/sceneStreet.ts'],{cwd:dir,encoding:'utf8',maxBuffer:1<<24}));
  const roads=[];
  for(let k=0;k<10;k++)roads.push({line:Array.from({length:80},(_,i)=>[i*13,Math.sin(i*.2+k)*17+k*65]),width:8+k*2,lanes:2+k%5,oneway:k%3===0,...(k===2?{structure:'bridge',layer:1}:{})});
  roads.push({line:[[0,0],[0,0],[50,0]],width:8,lanes:2});
  const terrain={at:(x,y)=>Math.sin(x*.004)*3+Math.cos(y*.01)*2,base:()=>0,relief:0,elevation:null,source:'fixture'};
  const arms=(i,start)=>i%3?null:{crossA:10,crossB:13,stopA:14,stopB:14.35,zebra:true,stop:true};
  const crossings=[{line:[[420,-100],[420,800]],layer:0},
    ...Array.from({length:250},(_,i)=>({line:[[3000+i*4,3000],[3000+i*4,3040]],layer:i%2}))];
  const [a,b]=await Promise.all([actual,previous].map(m=>m.buildRoadMarkings(roads,terrain,arms,()=>false,crossings)));
  assert.equal(a.group.children.length,b.group.children.length);
  for(let i=0;i<a.group.children.length;i++)for(const [name,attribute] of Object.entries(a.group.children[i].geometry.attributes)){
    const x=attribute.array,y=b.group.children[i].geometry.getAttribute(name).array;
    assert.equal(x.length,y.length,name);
    assert.equal(Buffer.compare(Buffer.from(x.buffer,x.byteOffset,x.byteLength),Buffer.from(y.buffer,y.byteOffset,y.byteLength)),0,name);
  }
  assert.deepEqual(a.group.userData.roadMarkings,b.group.userData.roadMarkings);
  a.dispose();b.dispose();
});
