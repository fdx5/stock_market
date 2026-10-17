import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../node_modules/.cache/test-frame-pace.mjs',import.meta.url));
buildSync({entryPoints:[fileURLToPath(new URL('../src/components/framePace.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const {createFramePace}=await import(pathToFileURL(out).href);
// Display refreshes at `hz`; a drawn frame of `cost` ms makes the next refresh after it finishes.
function run(hz,cost,secs=4,switchTo=null){
  const p=createFramePace(),iv=1000/hz;let t=0,busy=-1,drawn=[],refresh=iv;
  for(let k=0;t<secs*1000;k++){
    if(switchTo&&t>secs*500)refresh=1000/switchTo;
    t+=refresh;if(t<busy)continue;
    if(p.draw(t)){drawn.push(t);busy=t+cost;}
  }
  const late=drawn.filter(x=>x>1000),gaps=late.slice(1).map((x,i)=>x-late[i]);
  return {fps:late.length/(secs-1),maxGap:Math.max(...gaps),minGap:Math.min(...gaps)};
}
test('120 Hz is drawn at 60, evenly',()=>{const r=run(120,4);assert.ok(Math.abs(r.fps-60)<1,JSON.stringify(r));assert.ok(r.maxGap<17&&r.minGap>16,JSON.stringify(r));});
test('144 Hz at 72, 240 Hz at 60',()=>{assert.ok(Math.abs(run(144,4).fps-72)<1);assert.ok(Math.abs(run(240,3).fps-60)<1);});
test('60 Hz and 90 Hz are drawn at every refresh',()=>{assert.ok(Math.abs(run(60,4).fps-60)<1);assert.ok(Math.abs(run(90,4).fps-90)<1.5);});
test('a heavy frame on 120 Hz still gives the next refresh after it',()=>{const r=run(120,12);assert.ok(r.fps>59,JSON.stringify(r));});
test('a phone dropping from 120 Hz to 60 Hz is drawn at every refresh again',()=>{const r=run(120,4,8,60);assert.ok(r.fps>55,JSON.stringify(r));});
