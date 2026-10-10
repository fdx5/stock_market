import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync,transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const workerCode=buildSync({entryPoints:[new URL('../src/components/roadModelCheckWorker.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
function worker(){
 let answer;const self={postMessage:r=>{answer=r;}};vm.runInNewContext(workerCode,{self,performance,module:{exports:{}},exports:{}});
 return request=>{self.onmessage({data:{...request,id:1}});return answer;};
}
const roads=[[[0,0],[4,0],[4,4],[0,4]]],position=new Float32Array([1,1,0,2,1,0,1,2,0]);
const job={context:'near',position,index:null,dx:0,dy:0};
test('a model fully inside its registered footprint stays eligible across overlapping mapped road polygons',()=>{
 const run=worker();assert.equal(run({...job,roads,buildings:roads}).blocked,false);
 assert.equal(run({...job,roads,buildings:[]}).blocked,true);
});
test('centimetre differences at a registered apartment slab do not reject the entire model; annexes beyond 75cm still block the road',()=>{
 const run=worker(),registered=[[[0,0],[30,0],[30,15],[0,15]]],road=[[[29,-2],[34,-2],[34,17],[29,17]]];
 const pos=x=>new Float32Array([x,4,0,x,8,40,28,4,40]);
 assert.equal(run({...job,position:pos(30.3),roads:road,buildings:registered}).blocked,false);
 assert.equal(run({...job,position:pos(30.8),roads:road,buildings:registered}).blocked,true);
 assert.equal(run({...job,position:pos(33),roads:road,buildings:registered}).blocked,true);
});
test('alternating near and ring guards reuse exact footprint contexts without accepting a blocked model',()=>{
 const run=worker();assert.equal(run({...job,roads,buildings:[]}).blocked,true);
 assert.equal(run({...job,context:'ring',roads:[],buildings:[]}).blocked,false);
 assert.equal(run(job).blocked,true);assert.equal(run({...job,context:'ring'}).blocked,false);
});
test('a replaced or evicted worker context requests data rather than passing the road guard',()=>{
 const run=worker();assert.equal(run(job).needContext,true);
 for(const context of ['near','ring','third'])run({...job,context,roads,buildings:[]});
 assert.equal(run(job).needContext,true);assert.equal(run({...job,roads,buildings:[]}).blocked,true);
});
function client(){
 const requests=[],fixture={run:worker()};
 class Pool{async run(j){requests.push(j);return fixture.run(j);}dispose(){}}
 const source=readFileSync(new URL('../src/components/roadModelChecks.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'');
 const scope={SceneWorkerPool:Pool,URL,Worker:class{},module:{exports:{}},exports:{}};
 vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,scope);
 const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(position,3));
 return {check:new scope.module.exports.RoadModelChecks(),geo,requests,fixture};
}
test('client sends large footprints once and re-sends them after worker replacement with the same exact result',async()=>{
 const f=client(),s=new AbortController().signal;
 assert.equal(await f.check.test('near',f.geo,0,0,roads,[],s),true);
 assert.equal(await f.check.test('near',f.geo,0,0,roads,[],s),true);assert.equal(f.requests[1].roads,undefined);
 f.fixture.run=worker();assert.equal(await f.check.test('near',f.geo,0,0,roads,[],s),true);
 assert.equal(f.requests.length,4);assert.equal(f.requests[2].roads,undefined);assert.equal(f.requests[3].roads,roads);
});
