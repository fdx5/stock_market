import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';

globalThis.self??={}; // module-worker execution, without a display/RAF queue
const dir=new URL('../src/components/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const plugin={name:'test-assets',setup(b){b.onResolve({filter:/\?(url|worker)$|\.wasm$/},a=>({path:a.path,namespace:'asset'}));b.onLoad({filter:/.*/,namespace:'asset'},a=>({contents:`export default ${JSON.stringify(a.path)}`}));}};
const output=await build({stdin:{contents:"export {initialRoadGeometry} from './initialRoadGeometry';",resolveDir:dir,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[plugin],logLevel:'silent',define:{'import.meta.env':'{"DEV":false,"PROD":true}'}});
const {initialRoadGeometry}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));

test('the full departure area gets finite, footprint-safe lane geometry without traffic/network/RAF',async()=>{
 const n=19,R=180,cell=20,h=new Float32Array(n*n),ground=new Float32Array(n*n*3),xs=new Float64Array(n),ys=new Float64Array(n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=-R+i*cell,y=R-j*cell,k=j*n+i;xs[i]=x;ys[j]=y;ground.set([x,y,3+x*.02],k*3);h[(n-j-1)*n+i]=3+x*.02;}
 const footprint=[[50,-4],[90,-4],[90,4],[50,4],[50,-4]];
 const job={roads:[{line:[[-160,0],[160,0]],width:14,lanes:4},{line:[[0,-160],[0,160]],width:8,lanes:2}],terrain:{h,n,R,cell},ground,xs,ys,footprints:[footprint],half:170};
 const before=ground.slice(),result=await initialRoadGeometry(structuredClone(job));
 assert.deepEqual(ground,before,'the live page ground is never detached or overwritten by worker execution');
 assert.ok(result.paint.length===2);assert.equal(result.paint[0].color,0xf0b40a);assert.equal(result.paint[1].color,0xf2f2ee);
 for(const mesh of result.paint){
  const p=mesh.attributes.find(a=>a.name==='position').array;
  assert.ok(p.length>0&&Array.from(p).every(Number.isFinite));
  for(let i=0;i<p.length;i+=9){const x=(p[i]+p[i+3]+p[i+6])/3,y=-(p[i+2]+p[i+5]+p[i+8])/3;
   assert.ok(!(x>50+1e-5&&x<90-1e-5&&y>-4+1e-5&&y<4-1e-5),'no road/paint triangle inside the registered building');
   for(let v=0;v<3;v++){assert.ok(Math.abs(p[i+v*3])<=170.001);assert.ok(Math.abs(p[i+v*3+2])<=170.001);}
  }
 }
 assert.ok(result.paint.every(m=>m.attributes.some(a=>a.name==='normal'&&Array.from(a.array).every(Number.isFinite))));
});

function clientFixture(){
 const workers=[],timers=[];class Worker{constructor(){workers.push(this);}postMessage(job,transfer){this.job=job;this.transfer=transfer;}terminate(){this.ended=true;}}
 const source=readFileSync(dir+'/initialRoadClient.ts','utf8');
 const tree=source.slice(source.indexOf('export function prepareInitialRoads'),source.indexOf('export async function initialRoadLayer'));
 const scope={module:{exports:{}},Worker,URL,Error,Promise,setTimeout:f=>(timers.push(f),timers.length),clearTimeout(){}};
 vm.runInNewContext(transformSync(tree,{loader:'ts',format:'cjs'}).code.replace('import_meta.url','"http://test/initialRoadClient.ts"'),scope);
 return{prepare:scope.module.exports.prepareInitialRoads,workers,timers};
}
test('worker success and cancellation terminate the worker without transferring live source buffers',async()=>{
 const f=clientFixture(),stop=new AbortController(),job={ground:new Float32Array([1,2,3])},p=f.prepare(job,stop.signal);
 assert.equal(f.workers[0].transfer,undefined);const result={paint:[]};f.workers[0].onmessage({data:{result}});assert.equal(await p,result);assert.equal(f.workers[0].ended,true);
 const second=new AbortController(),pending=f.prepare(job,second.signal);second.abort();await assert.rejects(pending,/cancelled/);assert.equal(f.workers[1].ended,true);assert.deepEqual(Array.from(job.ground),[1,2,3]);
});
test('a missing worker response has a deadline and frees its worker',async()=>{
 const f=clientFixture(),p=f.prepare({},new AbortController().signal);f.timers[0]();await assert.rejects(p,/timed out/);assert.equal(f.workers[0].ended,true);
});

test('underground roads never acquire first-visible surface paint',async()=>{
 const result=await initialRoadGeometry({roads:[{line:[[-40,0],[40,0]],width:12,lanes:4,structure:'tunnel'},
  {line:[[0,-40],[0,40]],width:10,lanes:2,layer:-1}],ground:new Float32Array(12),xs:new Float64Array([-100,100]),ys:new Float64Array([100,-100]),footprints:[],half:100});
 assert.deepEqual(result.paint,[]);
});
