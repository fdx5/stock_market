import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const code=transformSync(readFileSync(new URL('../src/components/surveySourceColour.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {paintSurveySourceColour}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('worker colour evidence is bit-identical to the former page-side wall/roof/end painting',()=>{
 const tints=new Float32Array([.72,.81,.9,.19,.24,.3]);
 for(const surface of [0,1,2]){
  const actual=new Float32Array(99),expected=new Float32Array(99),offset=surface===1?3:0,scale=surface===2?.86:1;
  for(let i=0;i<expected.length;i+=3)for(let k=0;k<3;k++)expected[i+k]=tints[offset+k]*scale;
  paintSurveySourceColour(actual,surface,tints);assert.deepEqual(actual,expected);
 }
});
test('near buildings and missing evidence retain their constructed appearance, including true black',()=>{
 const color=new Float32Array([.1,.2,.3,.4,.5,.6]),original=color.slice();
 paintSurveySourceColour(color,0,undefined);assert.deepEqual(color,original);
 paintSurveySourceColour(color,1,new Float32Array(6).fill(NaN));assert.deepEqual(color,original);
 paintSurveySourceColour(color,0,new Float32Array([0,0,0,1,1,1]));assert.deepEqual(color,new Float32Array(6));
});
