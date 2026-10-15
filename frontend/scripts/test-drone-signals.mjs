import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
const text=readFileSync(new URL('../src/components/droneTraffic.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('t.ts',text,ts.ScriptTarget.Latest,true);
const pick=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='signalState'||ts.isVariableStatement(n)&&n.getText(ast).includes('CYCLE =')).map(n=>n.getText(ast).replace(/^export /,'')).join('\n');
const ctx={};vm.runInNewContext(transformSync(pick+'\nthis.s=signalState;',{loader:'ts'}).code,ctx);
test('the two phases of a junction are never green at the same time, and each gets green',()=>{
  for(const j of [0,1,12345,99999999]){let g0=0,g1=0;
    for(let t=0;t<200;t+=0.25){const a=ctx.s(t,j,0),b=ctx.s(t,j,1);assert.ok(!(a!=='red'&&b!=='red'),`both open at ${t}`);if(a==='green')g0++;if(b==='green')g1++;}
    assert.ok(g0>0&&g1>0);}
});
test('every junction cycles amber between green and red',()=>{
  let prev=ctx.s(0,7,0),seen=new Set();for(let t=0;t<130;t+=0.5){const c=ctx.s(t,7,0);if(prev==='green'&&c!=='green')assert.equal(c,'amber');seen.add(c);prev=c;}
  assert.equal(seen.size,3);
});
