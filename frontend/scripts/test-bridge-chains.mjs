import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
// Pure parts of bridgeChains.ts (no network): link joining and the deck profile.
const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
const declarations=(name,names)=>{const text=read(name),ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);return ast.statements.filter(n=>names.some(name=>ts.isFunctionDeclaration(n)&&n.name?.text===name)).map(n=>n.getText(ast).replace(/^export /,'')).join('\n');};
const context={};
vm.runInNewContext(transformSync(declarations('bridgeChains.ts',['joinStructureLinks','deckProfile'])+'\nthis.kit={joinStructureLinks,deckProfile};',{loader:'ts'}).code,context);
const {joinStructureLinks,deckProfile}=context.kit;
const L=(id,...pts)=>({id,kind:1,line:pts});

test('a bridge split mid-river joins bank to bank, each direction on its own',()=>{
  const north=[L('a',[0,0],[0,400]),L('b',[0,400],[0,800]),L('c',[0,800],[0,1200])];
  const south=[L('d',[12,1200],[12,800]),L('e',[12,800],[12,0])];
  const chains=joinStructureLinks([...north,...south].reverse());
  const ids=chains.map(c=>c.map(l=>l.id).join(''));
  assert.equal(JSON.stringify([...ids].sort()),JSON.stringify(['abc','de']));
});
test('a two-way link reversing on the same line is not a continuation',()=>{
  const chains=joinStructureLinks([L('a',[0,0],[0,400]),L('b',[0,400],[0,0])]);
  assert.equal(chains.length,2);
});
test('a fork keeps only the mutual best continuation; the branch starts its own chain',()=>{
  const chains=joinStructureLinks([L('a',[0,0],[0,400]),L('straight',[0,400],[0,800]),L('ramp',[0,400],[200,700])]);
  assert.equal(JSON.stringify(chains.map(c=>c.map(l=>l.id).join('+')).sort()),JSON.stringify(['a+straight','ramp']));
});
test('the deck spans the water straight between the banks and never dips under ground',()=>{
  // bank 12 m, water 2.5 m, an island at 17 m, water, bank 10 m (5 m posts)
  const g=[...Array(20).fill(12),...Array(60).fill(2.5),...Array(30).fill(17),...Array(60).fill(2.5),...Array(20).fill(10)];
  const z=deckProfile(g,5);
  assert.equal(z[0],12);assert.equal(z.at(-1),10);
  z.forEach((h,i)=>assert.ok(h>=g[i]-1e-9,`under ground at ${i}`));
  // over the first water stretch: between bank and island heights, far above the water
  for(let i=25;i<75;i++)assert.ok(z[i]>11.9&&z[i]<17.1,`span ${i}: ${z[i]}`);
  // no step anywhere along it (5 m posts)
  for(let i=1;i<z.length;i++)assert.ok(Math.abs(z[i]-z[i-1])<0.5,`step at ${i}`);
});
test('a single DEM spike does not lift the deck',()=>{
  const g=Array(100).fill(3);g[0]=10;g[99]=10;g[50]=40;
  const z=deckProfile(g,5);
  assert.ok(Math.max(...z)<=10+1e-9);
});
