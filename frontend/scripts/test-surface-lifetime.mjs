import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/components/paintClient.ts',import.meta.url),'utf8');
const normalize=source.slice(source.indexOf('async function fromReply('),source.indexOf('let rasterPool:'));
const code=ts.transpileModule(normalize+'\nexports.normalize=fromReply;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('late optional pixels preserve an original upload already in progress',()=>{
  const renderer=readFileSync(new URL('../src/components/tidewater/ComplexRenderer.js',import.meta.url),'utf8');
  const method=renderer.slice(renderer.indexOf('  packedPixels(source) {'),renderer.indexOf('  texture(source) {'));
  const scope={};vm.runInContext('result=({'+method+'})',vm.createContext(scope));
  const normal={userData:{surfacePixels:{}}},rough={userData:{}};
  const staging={y:128,tex:{}};scope.result.stagings=new Map([[normal,staging]]);
  assert.equal(scope.result.packedPixels({normalMap:normal,roughnessMap:rough}),null);
  assert.equal(scope.result.stagings.get(normal),staging);assert.equal(staging.y,128);
  assert.equal(normal.userData.surfacePixels,undefined);assert.equal(normal.userData.surfacePixelsProcessed,true);
});
function fixture(){
  let resolve;const pending=new Promise(r=>{resolve=r;});
  class FakeTexture {
    constructor(image){this.image=image;this.userData={};this.listeners=[];this.repeat={set(){}};this.offset={set(){}};}
    addEventListener(name,f){this.listeners.push(f);}
    dispose(){this.listeners.forEach(f=>f());}
  }
  const exports={},scope={exports,THREE:{Texture:FakeTexture},WeakRef,epoch:0,preparedReplies:new WeakSet()};
  vm.runInContext(code,vm.createContext(scope));
  const bitmap=()=>({width:4,height:4,close(){this.width=this.height=0;}});
  const params={wrapS:1000,wrapT:1000,flipY:false,anisotropy:8,colorSpace:'',repeat:[1,1],offset:[0,0],surfaceKey:'facade-1'};
  const reply={bitmaps:{normalMap:bitmap(),rmMap:bitmap()},params:{normalMap:params,rmMap:params}};
  return {scope,resolve,normalize:()=>exports.normalize(reply,pending),pixels:{width:4,height:4,data:new Uint8Array(64)}};
}
test('paint replies complete without waiting for optional surface pixels',async()=>{
  const f=fixture(),maps=await f.normalize();assert.ok(maps.normalMap);assert.equal(maps.normalMap.userData.surfacePixels,undefined);
  f.resolve(f.pixels);await tick();assert.equal(maps.normalMap.userData.surfacePixels,f.pixels);
  maps.normalMap.dispose();assert.equal(maps.normalMap.userData.surfacePixels,undefined);
});
test('late packed data cannot refill disposed textures',async()=>{
  const f=fixture(),maps=await f.normalize();maps.normalMap.dispose();maps.rmMap.dispose();
  f.resolve(f.pixels);await tick();assert.equal(maps.normalMap.userData.surfacePixels,undefined);
});
test('a processed GPU source ignores unused late packed data',async()=>{
  const f=fixture(),maps=await f.normalize();maps.normalMap.userData.surfacePixelsProcessed=true;
  f.resolve(f.pixels);await tick();assert.equal(maps.normalMap.userData.surfacePixels,undefined);
});
test('memory release invalidates optional work from the previous epoch',async()=>{
  const f=fixture(),maps=await f.normalize();f.scope.epoch++;
  f.resolve(f.pixels);await tick();assert.equal(maps.normalMap.userData.surfacePixels,undefined);
});
test('a disposed roughness source cannot attach packed bytes to a surviving normal map',async()=>{
  const f=fixture(),maps=await f.normalize();maps.rmMap.dispose();
  f.resolve(f.pixels);await tick();assert.equal(maps.normalMap.userData.surfacePixels,undefined);
});
