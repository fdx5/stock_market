import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {transformSync} from 'esbuild';
function paging(){
  const source=readFileSync(new URL('../src/components/vworldBuildings.ts',import.meta.url),'utf8');
  const tree=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=['unique','pagedFeatures'];
  const declarations=names.map(name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name)).getText(tree));
  const module={exports:{}};
  vm.runInNewContext(transformSync(declarations.join('\n')+'\nexport {unique,pagedFeatures};',{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,Promise});
  return module.exports.pagedFeatures;
}
const feature=n=>({geometry:{coordinates:[n]},properties:{}});
const full=Array.from({length:1000},(_,i)=>feature(i));
test('short layers make only one request',async()=>{
  const requests=[];
  const result=await paging()(async n=>{requests.push(n);return [feature(1),feature(2)]});
  assert.deepEqual(requests,[1]);assert.equal(result.length,2);
});
test('dense layers retain every unique record',async()=>{
  const result=await paging()(async n=>n===1?full:n===2?full.map(f=>feature(f.geometry.coordinates[0]+1000)):n===3?[feature(2000)]:[]);
  assert.equal(result.length,2001);assert.equal(result.at(-1).geometry.coordinates[0],2000);
});
test('repetition stops and required failed pages remain failures',async()=>{
  assert.equal((await paging()(async()=>full)).length,1000);
  await assert.rejects(paging()(async n=>{if(n===2)throw Error('required page failed');return full}),/required page failed/);
});
test('proven final short pages ignore failed speculative later pages',async()=>{
  const result=await paging()(async n=>{if(n===1)return full;if(n===2)return [feature(1000)];throw Error('past end')});
  assert.equal(result.length,1001);
});
test('coverage past the 24-page cap is explicit failure',async()=>{
  await assert.rejects(paging()(async n=>full.map(f=>feature(n*1000+f.geometry.coordinates[0]))),/exceeded 24 pages/);
});
