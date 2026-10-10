import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync,build} from 'esbuild';
import ts from 'typescript';
import vm from 'node:vm';
const load=async name=>{const {code}=transformSync(readFileSync(new URL('../src/components/'+name+'.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));};
const {SceneWorkerPool,sceneWorkerOnce}=await load('sceneWorkerPool');
class FakeWorker{
  jobs=[];closed=false;
  postMessage(job){this.jobs.push(job);if(this.throwPost)throw Error('clone failed');}
  terminate(){this.closed=true;}
  answer(value={}){this.onmessage?.({data:{id:this.jobs.at(-1).id,...value}});}
}
const factory=()=>{const workers=[];return {workers,create:()=>{const w=new FakeWorker();workers.push(w);return w;}};};
test('only one decode per worker; queued detail is admitted before colours',async()=>{
  const f=factory(),p=new SceneWorkerPool(f.create,1),s=new AbortController();
  const a=p.run({name:'first'},s.signal),b=p.run({name:'colour'},s.signal,[],1),c=p.run({name:'detail'},s.signal,[],0);
  assert.equal(f.workers[0].jobs.length,1);f.workers[0].answer();await a;
  assert.equal(f.workers[0].jobs[1].name,'detail');f.workers[0].answer();await c;
  assert.equal(f.workers[0].jobs[2].name,'colour');f.workers[0].answer();await b;
  assert.equal(p.pending,0);p.dispose();
});
test('dead worker releases its active slot and the next job uses a replacement',async()=>{
  const f=factory(),p=new SceneWorkerPool(f.create,1),s=new AbortController();
  const a=p.run({},s.signal),b=p.run({},s.signal);f.workers[0].onerror();assert.equal(await a,null);
  assert.equal(f.workers[0].closed,true);assert.equal(f.workers.length,2);f.workers[1].answer({ok:true});assert.equal((await b).ok,true);p.dispose();
});
test('aborting active/queued jobs and late messages cannot corrupt replacement capacity',async()=>{
  const f=factory(),p=new SceneWorkerPool(f.create,1),s=new AbortController(),live=new AbortController();
  const a=p.run({},s.signal),b=p.run({},s.signal),c=p.run({},live.signal);const old=f.workers[0];s.abort();
  assert.equal(await a,null);assert.equal(await b,null);old.answer({late:true});old.onerror();
  assert.equal(f.workers.at(-1).closed,false);f.workers.at(-1).answer({ok:true});assert.equal((await c).ok,true);assert.equal(p.pending,0);p.dispose();
});
test('unanswered jobs time out and later work can still complete',async()=>{
  const f=factory(),p=new SceneWorkerPool(f.create,1,20),s=new AbortController();
  assert.equal(await p.run({},s.signal),null);assert.equal(f.workers[0].closed,true);
  const b=p.run({},s.signal);f.workers[1].answer({ok:true});assert.equal((await b).ok,true);p.dispose();
});
test('constructor/clone failures and disposal settle all waiters without retained jobs',async()=>{
  const s=new AbortController(),p=new SceneWorkerPool(()=>{throw Error('disabled');},2);
  assert.equal(await p.run({},s.signal),null);assert.equal(p.pending,0);p.dispose();
  const f=factory(),q=new SceneWorkerPool(f.create,1),a=q.run({},s.signal),b=q.run({},s.signal);q.dispose();
  assert.equal(await a,null);assert.equal(await b,null);assert.equal(q.pending,0);assert.equal(f.workers[0].closed,true);
  assert.equal(await sceneWorkerOnce(()=>{throw Error('disabled');},{},s.signal),null);
});
test('one-shot worker has an abort/deadline and rejects already aborted input before allocating',async()=>{
  const f=factory(),s=new AbortController();const a=sceneWorkerOnce(f.create,{},s.signal,20);assert.equal(await a,null);assert.equal(f.workers[0].closed,true);
  s.abort();assert.equal(await sceneWorkerOnce(f.create,{},s.signal),null);assert.equal(f.workers.length,1);
});

function fn(file,name){const source=readFileSync(new URL('../src/components/'+file+'.ts',import.meta.url),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name)).getText(ast).replace(/^export /,'');}
const networkBundle=await build({stdin:{contents:"export {splitRoadJunctions} from './src/components/roadTrafficNetwork';export {roadLaneCount} from './src/components/roadLanes';export * from './src/components/roadLevels';export {junctionSignalPolicy} from './src/components/trafficJunction';",resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')},bundle:true,write:false,platform:'node',format:'esm'});
const net=await import('data:text/javascript;base64,'+Buffer.from(networkBundle.outputFiles[0].text).toString('base64'));
test('actual road arms are prepared even while vehicle downloads never resolve',async()=>{
  let arms,kitCalls=0,failure;
  const context={...net,performance,Math,Map,Set,Float32Array,console,FLAT:{at:()=>0},frameSlice:async()=>{},loadKit:()=>{kitCalls++;return new Promise(()=>{});}};
  vm.runInNewContext(transformSync(fn('complexScene','rng')+'\n'+fn('sceneStreet','stitchRoads')+'\n'+fn('sceneStreet','buildTraffic')+'\nglobalThis.build=buildTraffic;',{loader:'ts'}).code,context);
  context.build([{width:12,line:[[-100,0],[100,0]],layer:0},{width:8,line:[[0,-100],[0,0]],layer:0}],1,true,{at:()=>0},[],a=>arms=a).catch(e=>failure=e);
  for(let i=0;i<100&&!arms;i++)await Promise.resolve();
  assert.equal(failure,undefined);assert.ok(arms?.roads.length>=3);assert.equal(kitCalls,1);assert.ok(arms.roads.every(r=>r.cum.length===r.line.length));
});

test('loading completion bursts schedule one display frame and never draw synchronously',()=>{
  const source=readFileSync(new URL('../src/components/ComplexHologram.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('scene.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
  const visit=n=>{if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='stage.resume'&&ts.isArrowFunction(n.right))expression=n.right.getText(ast);ts.forEachChild(n,visit);};visit(ast);
  let draws=0,requests=0;
  const context={stage:{},disposed:false,document:{hidden:false},inView:true,pausedRef:{current:false},raf:0,last:0,sampleStart:0,sampleFrames:10,touched(){},performance:{now:()=>100},loop:()=>draws++,requestAnimationFrame:()=>++requests};
  vm.runInNewContext(transformSync('stage.resume='+expression,{loader:'ts'}).code,context);
  for(let i=0;i<100;i++)context.stage.resume();
  assert.equal(draws,0);assert.equal(requests,1);assert.equal(context.sampleFrames,0);
  context.raf=0;context.document.hidden=true;context.stage.resume();assert.equal(requests,1);
});
const clearanceBundle=await build({stdin:{contents:"export {BuildingClearance} from './src/rail/BuildingClearance';export {ClearanceIndex} from './src/rail/clearanceIndex';export * as THREE from 'three';",resolveDir:new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.url':'"http://test.invalid/source.js"'}});
const {BuildingClearance,ClearanceIndex,THREE}=await import('data:text/javascript;base64,'+Buffer.from(clearanceBundle.outputFiles[0].text).toString('base64'));
test('rail spatial candidates match exhaustive bounds over sloped/elevated/negative coordinates',()=>{
  let seed=3;const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  const rows=Array.from({length:2000},()=>{const a=[rnd()*10000-5000,rnd()*100,rnd()*10000-5000];return{a,b:[a[0]+rnd()*100-50,a[1]+rnd()*8-4,a[2]+rnd()*100-50],half:2+rnd()*5,bottom:-.3,top:5.6};});
  const index=new ClearanceIndex(rows);
  for(let i=0;i<100;i++){const x=rnd()*9000-4500,z=rnd()*9000-4500,box=new THREE.Box3(new THREE.Vector3(x,-50,z),new THREE.Vector3(x+340,200,z+340));
    const expected=rows.filter(c=>box.min.x<=Math.max(c.a[0],c.b[0])+c.half+.3&&box.max.x>=Math.min(c.a[0],c.b[0])-c.half-.3&&box.min.y<=Math.max(c.a[1],c.b[1])+c.top+.3&&box.max.y>=Math.min(c.a[1],c.b[1])+c.bottom-.3&&box.min.z<=Math.max(c.a[2],c.b[2])+c.half+.3&&box.max.z>=Math.min(c.a[2],c.b[2])-c.half-.3);
    assert.deepEqual(new Set(index.query(box)),new Set(expected));
  }
});
test('unrelated buildings cache a negative clearance result rather than rescan all tracks',()=>{
  const c=new BuildingClearance(()=>{}),root=new THREE.Group(),m=new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial());m.userData.railBuilding=true;m.position.x=300;root.add(m);
  const rows=[{a:[0,0,-10],b:[0,0,10],half:2,bottom:-.3,top:5.6}];c.update([root],rows,'first',new THREE.Vector3());
  let queried=0;const query=c.index.query.bind(c.index);c.index.query=b=>{queried++;return query(b);};
  for(let i=0;i<100;i++)c.update([root],rows,'first',new THREE.Vector3(20,0,0));
  assert.equal(queried,0);assert.equal(c.stats.pending,0);c.dispose();assert.equal(c.records.size,0);m.geometry.dispose();m.material.dispose();
});

function worldMethod(name){const source=readFileSync(new URL('../src/components/droneWorld.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('world.ts',source,ts.ScriptTarget.Latest,true);const c=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='DroneWorld');return c.members.find(n=>n.name?.getText(ast)===name).getText(ast).replace(/^private /,'');}
test('near view updates do not batch several frames of simulation at ordinary drone altitude',()=>{
  const source=readFileSync(new URL('../src/components/droneMode.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('mode.ts',source,ts.ScriptTarget.Latest,true);const c=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='DroneSession'),method=c.members.find(n=>n.name?.getText(ast)==='runViewTicks').getText(ast);
  const ctx={Math};vm.runInNewContext(transformSync('class W {'+method+'};globalThis.W=W;',{loader:'ts'}).code,ctx);
  const w=new ctx.W();Object.assign(w,{flight:{pos:{x:0,z:0},agl:90},world:{reach:1200},tickN:0,tickDue:new Map()});const values=[];
  for(let i=0;i<10;i++)w.runViewTicks([dt=>values.push(dt)],{x:0,z:0},720,.0167);
  assert.equal(values.length,10);assert.ok(values.every(dt=>dt===.0167));
});
test('tile failure cancels sibling jobs, releases an unclaimed ground bitmap and frees its loading slot',async()=>{
  let closed=0,cancelled=0,cleared=0;
  const context={performance,AbortController,OFF:['sea'],DTRACE:false,TILE_M:340,CONTEXT_FLOOR_M:{},gridAt:()=>()=>0,textureBudgetEnabled:()=>false,
    roadTile:(...a)=>new Promise(resolve=>a[7].addEventListener('abort',()=>{cancelled++;resolve(null);})),
    farGround:()=>Promise.resolve({bitmap:{close:()=>closed++}}),ringTile:()=>Promise.resolve(null)};
  vm.runInNewContext(transformSync('class W {'+worldMethod('load')+'};globalThis.W=W;',{loader:'ts'}).code,context);
  const w=new context.W();Object.assign(w,{o:{data:{center:{lat:37,lon:127},vworld_key:'synthetic'},hq:true,seed:1,extent:{ring:600}},loading:0,disposed:false,kx:1,ky:1,season:{lawn:'',paddy:''},tileGrid:async()=>({grid:{},wide:null}),roadExtras:()=>({}),clear:()=>cleared++});
  const t={key:'test',tries:0,cx:0,cy:0,i:0,j:0,box:[0,0,340,340],inner:false};
  await w.load(t);await Promise.resolve();
  assert.equal(t.state,'failed');assert.equal(w.loading,0);assert.equal(cancelled,1);assert.equal(closed,1);assert.equal(cleared,1);assert.ok(t.retryAt>performance.now());
});
test('tile resource cleanup removes stale detail state and large arrays exactly once',()=>{
  let disposed=0;
  const context={Set};vm.runInNewContext(transformSync('class W {'+worldMethod('clear')+'};globalThis.W=W;',{loader:'ts'}).code,context);
  const w=new context.W();Object.assign(w,{unplant(){},traffic:{removeTile(){}},o:{},root:{remove(){}}});
  const t={key:'test',zup:{},yup:{},materials:[],dispose:[()=>disposed++],survey:'ready',colour:'done',towers:new Float32Array(10000),spans:new Float32Array(10000),spanRings:[[[]]],planting:{},local:{},marks:[{}],fine:[{}],walkPaths:new Float32Array(10000)};
  w.clear(t);w.clear(t);assert.equal(disposed,1);assert.equal(t.survey,'none');assert.equal(t.towers,null);assert.equal(t.spans,undefined);assert.equal(t.fine,undefined);assert.equal(t.colour,undefined);
});
