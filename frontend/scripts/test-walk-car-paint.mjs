import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
const source=ts.transpileModule(fs.readFileSync(new URL('../src/walkmode/ground/carPaint.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const ctx=vm.createContext({exports:{},require:()=>THREE});vm.runInContext(source,ctx);
const {parkedCarPaint}=ctx.exports;
test('shaded neutral car roofs do not collapse an entire neighbourhood to black',()=>{
  const counts=new Map();let light=0,black=0;
  for(let i=0;i<1000;i++){const c=parkedCarPaint(.06,.065,.07,127.06+(i%40)*.00005,37.49+Math.floor(i/40)*.00005),hex=c.getHexString();counts.set(hex,(counts.get(hex)??0)+1);if(c.r+c.g+c.b>1.2)light++;if(hex==='252b33')black++;}
  assert.ok(counts.size>=7);assert.ok(Math.max(...counts.values())<550);assert.ok(light>600);assert.ok(black>40&&black<180);
});
test('uncertain colours stay stable across reloads and aerial shadow brightness',()=>{
  for(let i=0;i<100;i++){const lon=127+i*.0001,lat=37.5;assert.equal(parkedCarPaint(.05,.05,.05,lon,lat).getHexString(),parkedCarPaint(.2,.2,.2,lon,lat).getHexString());}
});
test('clear white, silver and chromatic observations retain their colour family',()=>{
  assert.equal(parkedCarPaint(.85,.84,.84,127,37).getHexString(),'f2f2f0');assert.equal(parkedCarPaint(.52,.53,.54,127,37).getHexString(),'b8bcc0');
  const red=parkedCarPaint(.7,.12,.13,127,37);assert.ok(red.r>red.g*5&&red.r>red.b*5);
  const blue=parkedCarPaint(.12,.16,.4,127,37);assert.ok(blue.b>blue.r*4);
});
