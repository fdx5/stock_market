import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/components/roadGroundGrade.ts',import.meta.url),'utf8').replace(/^export /gm,'');
const {groundRoadGrade,groundRoadHeight}=new Function(transformSync(source,{loader:'ts'}).code+';return {groundRoadGrade,groundRoadHeight}')();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('a bank approach never averages terrain beyond its physical end into the road',()=>{
 const line=[[-50,2],[0,2]],g=(x,y)=>x<=0?12+.05*x+.2*y:0;
 for(const s of [0,4,25,46,50])near(groundRoadHeight(line,s,g),12.4+.05*(s-50));
 const reversed=[...line].reverse();
 for(const s of [0,4,25,46,50])near(groundRoadHeight(reversed,50-s,g),groundRoadHeight(line,s,g));
});

test('smoothing follows a curved carriageway instead of leaving its road corridor',()=>{
 const line=[[0,0],[20,0],[20,20]],g=(x,y)=>(Math.abs(y)<1e-7&&x>=0&&x<=20)||(Math.abs(x-20)<1e-7&&y>=0&&y<=20)?10:100;
 for(let s=0;s<=40;s+=2)near(groundRoadHeight(line,s,g),10);
});

test('straight-road interior smoothing preserves the existing nine ground samples and water floor',()=>{
 const line=[[0,0],[100,0]],g=x=>10+Math.sin(x/10),water=()=>12;
 const expected=Array.from({length:9},(_,i)=>g(34+i*4)).reduce((a,b)=>a+b)/9;
 near(groundRoadHeight(line,50,g),expected);
 near(groundRoadHeight(line,50,g,water),12.3);
});

test('worker serialization and a fresh factory preserve exactly the same bank heights',()=>{
 const worker=new Function('return ('+groundRoadGrade.toString()+')()')(),line=[[0,0],[10,0],[10,30]],g=(x,y)=>x*.1+y*.2;
 for(let s=0;s<=40;s++)near(worker(structuredClone(line),s,g),groundRoadHeight(line,s,g));
});
