import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import * as THREE from 'three';
const bundle = await build({entryPoints:[new URL('../src/components/surveyBuildingMatch.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const priorityBundle=await build({entryPoints:[new URL('../src/components/droneLoadPriority.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const {droneLoadPriority,droneDetailPriority}=await import('data:text/javascript;base64,'+Buffer.from(priorityBundle.outputFiles[0].text).toString('base64'));
const searchBundle=await build({entryPoints:[new URL('../src/components/surveySearch.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const {surveySearch,surveySourceOverlaps}=await import('data:text/javascript;base64,'+Buffer.from(searchBundle.outputFiles[0].text).toString('base64'));
const downloadsBundle=await build({entryPoints:[new URL('../src/components/surveyDownloads.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const {downloadSurveyModels}=await import('data:text/javascript;base64,'+Buffer.from(downloadsBundle.outputFiles[0].text).toString('base64'));
const { matchSurveyBuildings,surveyCompleteFor,surveyAlignment } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const storeBundle=await build({entryPoints:[new URL('../src/components/surveyGeometryStore.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'cjs',external:['three']});
const storeScope={require:()=>THREE,module:{exports:{}},exports:{}};vm.runInNewContext(storeBundle.outputFiles[0].text,storeScope);
const {SurveyGeometryStore}=storeScope.module.exports;
const appearanceScope={THREE,module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/buildingAppearance.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,appearanceScope);
const {buildingAppearanceProfile,observedRoofColour}=appearanceScope.module.exports;
const guardScope={THREE,module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/nearBuildingTargets.ts',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,guardScope);
const {packedRoadGuard}=guardScope.module.exports;
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

test('a stalled survey file returns completed models for immediate partial replacement and retry',async()=>{
  const source=readFileSync(new URL('../src/components/vworld3d.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('vworld.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='photoBuildingsNear').getText(ast).replace(/^export /,'');
  let failures=0,completeSecond=false;
  const entries=[{key:'first',lon:127,lat:37},{key:'slow',lon:127,lat:37}];
  const scope={AbortController,DOMException,setTimeout,clearTimeout,SIZE:36/2**15,surveySearch,surveySourceOverlaps,downloadSurveyModels,vworldToken:async()=>'',tileList:async()=>entries,
    model:async(_token,e,_lat,_lon,_max,signal)=>{
      if(e.key==='first'||completeSecond)return{key:e.key};
      return new Promise((_,reject)=>{const abort=()=>reject(new DOMException('stalled','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    }};
  vm.runInNewContext(transformSync(fn+';globalThis.load=photoBuildingsNear;',{loader:'ts'}).code,scope);
  const photos=await scope.load('',37,127,[{x:0,y:0}],{deadlineMs:20,onFailure:()=>failures++});
  assert.deepEqual(Array.from(photos,p=>p.key),['first']);assert.ok(failures>0);
  completeSecond=true;failures=0;
  const retry=await scope.load('',37,127,[{x:0,y:0}],{deadlineMs:20,onFailure:()=>failures++});
  assert.deepEqual(Array.from(retry,p=>p.key),['first','slow']);assert.equal(failures,0);
});
test('matching registered footprints keeps a real tower despite incorrect registered height and centre',()=>{
  const blocks=[{x:0,y:0,h:30,outline:rect(-30,-10,60,20)}];
  const models=[{cx:19,cy:0,height:77,hull:rect(-30,-10,60,20)}];
  assert.deepEqual([...matchSurveyBuildings(blocks,models)],[[0,[0]]]);
});

test('unequal footprint/hull vertex averages cannot move correct apartments into the road; consistent measured shifts still align',()=>{
 const blocks=Array.from({length:4},(_,i)=>({x:i*100+8,y:4,h:45,outline:rect(i*100-40,-8,80,16)}));
 const models=blocks.map((_,i)=>({cx:i*100,cy:0,height:48,hull:rect(i*100-40,-8,80,16)}));
 assert.deepEqual(Array.from(surveyAlignment(blocks,models)),[0,0]);
 const shifted=models.map(m=>({...m,cx:m.cx-2,cy:m.cy+1,hull:m.hull.map(([x,y])=>[x-2,y+1])}));
 assert.deepEqual(Array.from(surveyAlignment(blocks,shifted)),[2,-1]);
 shifted[0].hull=shifted[0].hull.map(([x,y])=>[x+5,y]);shifted[1].hull=shifted[1].hull.map(([x,y])=>[x-6,y]);
 assert.deepEqual(Array.from(surveyAlignment(blocks,shifted)),[0,0]);
 assert.deepEqual(Array.from(surveyAlignment(blocks.slice(0,2),models.slice(0,2))),[0,0]);
});
test('a model across a street cannot replace a nearby large complex',()=>{
  const blocks=[{x:0,y:0,h:60,outline:rect(-50,-50,100,100)}];
  const models=[{cx:70,cy:0,height:60,hull:rect(60,-10,20,20)}];
  assert.equal(matchSurveyBuildings(blocks,models).size,0);
});
test('concave registered outlines do not match a building inside their empty corner',()=>{
  const blocks=[{x:15,y:15,h:60,outline:[[0,0],[40,0],[40,10],[10,10],[10,40],[0,40]]}];
  assert.equal(matchSurveyBuildings(blocks,[{cx:27,cy:27,height:60,hull:rect(20,20,15,15)}]).size,0);
});
test('a small rooftop room alone cannot replace a complete tower',()=>{
  const blocks=[{x:0,y:0,h:60,outline:rect(-10,-10,20,20)}];
  assert.equal(matchSurveyBuildings(blocks,[{cx:0,cy:0,height:5,hull:rect(-5,-5,10,10)}]).size,0);
});
test('one model is assigned once and multiple surveyed pieces can share one registered outline',()=>{
  const blocks=[{x:0,y:0,h:60,outline:rect(-50,-50,100,100)},{x:90,y:0,h:60,outline:rect(60,-50,60,100)}];
  const models=[{cx:-25,cy:0,height:60,hull:rect(-50,-50,50,100)},{cx:25,cy:0,height:60,hull:rect(0,-50,50,100)}];
  assert.deepEqual([...matchSurveyBuildings(blocks,models)],[[0,[0,1]]]);
});
test('an incomplete multipart batch keeps the coarse building until both wings arrive',()=>{
  const blocks=[{x:0,y:0,h:60,outline:rect(-50,-50,100,100)}];
  const models=[{cx:-25,cy:0,height:60,hull:rect(-50,-50,50,100)},{cx:25,cy:0,height:60,hull:rect(0,-50,50,100)}];
  assert.equal(matchSurveyBuildings(blocks,models.slice(0,1),0,0,false).size,0);
  assert.deepEqual([...matchSurveyBuildings(blocks,models,0,0,false)],[[0,[0,1]]]);
});
test('a completed full tower progresses during a partial batch while a low roof piece waits',()=>{
  const blocks=[{x:0,y:0,h:60,outline:rect(-10,-10,20,20)}];
  assert.equal(matchSurveyBuildings(blocks,[{cx:0,cy:0,height:5,hull:rect(-10,-10,20,20)}],0,0,false).size,0);
  assert.deepEqual([...matchSurveyBuildings(blocks,[{cx:0,cy:0,height:40,hull:rect(-10,-10,20,20)}],0,0,false)],[[0,[0]]]);
});
test('an unrelated failed model or neighbouring forest tile cannot block a completed apartment; its own missing wing remains protected',()=>{
 const blocks=[{x:0,y:0,h:60,outline:rect(-50,-50,100,100)},{x:300,y:0,h:60,outline:rect(250,-50,100,100)}];
 const models=[{cx:-25,cy:0,height:60,hull:rect(-50,-50,60,100)},{cx:275,cy:0,height:60,hull:rect(250,-50,60,100)}];
 const complete=surveyCompleteFor(blocks,[{kind:'model',x:320,y:0},{kind:'list',box:[-220,-220,-140,-100]}]);
 assert.deepEqual(Array.from(complete),[true,false]);assert.deepEqual([...matchSurveyBuildings(blocks,models,0,0,complete)],[[0,[0]]]);
 assert.deepEqual(Array.from(surveyCompleteFor(blocks,[{kind:'unknown'}])),[false,false]);
});

const source=readFileSync(new URL('../src/components/droneWorld.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('world.ts',source,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='DroneWorld');
const method=name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast).replace(/^private /,'');
function harness(extra={}) {
  const raf=[];
  const scope={THREE,SurveyGeometryStore,packedRoadGuard,performance,console,droneDetailPriority,observedRoofColour,LANDMARK_SITES:[],TOWER:9,SURVEY_STYLES:['apt','villa','shop','office'],requestAnimationFrame:f=>raf.push(f),staticSceneTransforms:()=>{},sharedContextMaterial:()=>new THREE.MeshStandardMaterial(),photoAtlasMaterial:()=>({mat:new THREE.MeshStandardMaterial(),dispose(){}}),castShadows:()=>{},...extra};
  vm.runInNewContext(transformSync('class W {'+method('surveyTile')+method('paintSurvey')+method('colourTile')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
  const w=new scope.W();Object.assign(w,{o:{data:{center:{lat:37,lon:127},vworld_key:'synthetic'},drawReady:()=>false},landmarks:{},tiles:new Map(),liveTile:t=>w.tiles.get(t.key)===t,disposed:false,surveying:0,scheduleX:0,scheduleY:0,aheadX:0,aheadY:0,pace:async()=>true,plain:new THREE.MeshStandardMaterial()});
  const base=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute([.7,.6,.5,.1,.2,.3,.7,.6,.5],3)).setIndex([0,1,2]);
  const t={key:'fixture',stop:new AbortController(),towers:new Float32Array([0,0,30,0,0,3,0,0,400]),styleGeo:{apt:base},spanRings:[rect(-10,-10,20,20)],spans:new Float32Array([0,0,1,1,1]),zup:new THREE.Group(),survey:'none',dispose:[],materials:[],castB:true};
  w.tiles.set(t.key,t);return{w,t,raf};
}
test('download failure remains retryable instead of completing an empty detail tile',async()=>{
  const {w,t}=harness();w.surveyWork=async()=>({parts:[],retry:true,models:0,matched:0});await w.surveyTile(t);
  assert.equal(t.survey,'unavailable');assert.ok(t.surveyRetryAt>performance.now());assert.equal(w.surveying,0);assert.equal(t.surveyDeferred.size,1);
});
test('confirmed unavailable survey data is distinct from a rendered detail tile',async()=>{
  const {w,t}=harness();w.surveyWork=async()=>({parts:[],retry:false,models:0,matched:0});await w.surveyTile(t);
  assert.equal(t.survey,'unavailable');assert.equal(t.surveyGroup,undefined);
  assert.ok(t.surveyRetryAt>performance.now()+59000);assert.equal(t.surveyHidden,undefined);
});
test('a dense tile admits twelve nearest records at a time and continues beyond a completed lookup',async()=>{
  const {w,t}=harness();const records=[];
  for(let i=0;i<30;i++)records.push(290-i*10,0,30,0,i*3,3,0,i,400);
  t.towers=new Float32Array(records);t.spanRings=Array.from({length:30},()=>rect(-10,-10,20,20));
  const seen=[];w.surveyWork=async job=>{seen.push(Array.from(job.towers));return{parts:[],retry:false,models:0,matched:0};};
  await w.surveyTile(t);assert.equal(seen[0].length,12*9);assert.equal(seen[0][0],0);assert.equal(seen[0][11*9],110);assert.equal(t.survey,'none');assert.equal(t.surveyDeferred.size,12);
  await w.surveyTile(t);assert.equal(seen[1][0],120);assert.equal(t.surveyDeferred.size,24);assert.equal(t.survey,'none');
  await w.surveyTile(t);assert.equal(seen[2].length,6*9);assert.equal(t.surveyDeferred.size,30);assert.equal(t.survey,'unavailable');
});
test('coarse triangles remain until detail is GPU-ready; retries skip already replaced records',async()=>{
  const {w,t,raf}=harness();let submitted;
  const part={material:0,position:new Float32Array([0,0,0,1,0,0,0,1,0]),normal:new Float32Array([0,0,1,0,0,1,0,0,1]),uv:new Float32Array(6),color:new Float32Array(9),index:new Uint32Array([0,1,2]),box:[0,0,0,1,1,0],sphere:[0,0,0,2],paintSpans:new Uint32Array([0,0,0,3,0])};
  w.surveyWork=async job=>{submitted=job;return{parts:[part],hide:new Float32Array([0,0,3]),retry:true,models:1,matched:1};};
  await w.surveyTile(t);assert.equal(t.survey,'placed');assert.deepEqual([...t.styleGeo.apt.index.array],[0,1,2]);
  raf.shift()();assert.equal(t.survey,'placed');w.o.drawReady=()=>true;raf.shift()();
  assert.deepEqual([...t.styleGeo.apt.index.array],[0,0,0]);assert.equal(t.survey,'ready');
  assert.equal(t.surveyHidden.size,1);await w.surveyTile(t);assert.equal(t.survey,'ready');assert.equal(submitted.towers.length,9);
});
for(const failure of ['timeout','pipeline'])test('GPU '+failure+' preserves the coarse building and makes detail retryable',async()=>{
 let now=100;const {w,t,raf}=harness({performance:{now:()=>now}});
 const part={material:0,position:new Float32Array([0,0,0,1,0,0,0,1,0]),normal:new Float32Array(9),uv:null,color:new Float32Array(9),index:new Uint32Array([0,1,2]),box:[0,0,0,1,1,0],sphere:[0,0,0,2],paintSpans:new Uint32Array()};
 w.surveyWork=async()=>({parts:[part],hide:new Float32Array([0,0,3]),retry:false,models:1,matched:1});
 await w.surveyTile(t);assert.equal(t.survey,'placed');
 if(failure==='pipeline')w.o.drawReady=()=>{throw Error('pipeline rejected');};else now+=15001;
 raf.shift()();assert.deepEqual([...t.styleGeo.apt.index.array],[0,1,2]);assert.equal(t.surveyHidden,undefined);assert.equal(t.survey,'unavailable');assert.ok(t.surveyRetryAt>now);
 assert.equal(t.surveyStore.entries.length,0);assert.equal(t.surveyGroup.children.length,0);
});
test('failed nearest records cannot monopolise later records; expired missing models are requested again',async()=>{
  let now=100;const {w,t}=harness({performance:{now:()=>now}}),seen=[];
  t.towers=new Float32Array(Array.from({length:20},(_,i)=>[i*10,0,30,0,i*3,3,0,i,400]).flat());
  t.spanRings=Array.from({length:20},()=>rect(-10,-10,20,20));
  w.surveyWork=async job=>{seen.push(Array.from(job.towers));return{parts:[],retry:true,models:0,matched:0};};
  await w.surveyTile(t);assert.equal(t.survey,'none');assert.equal(t.surveyDeferred.size,12);
  await w.surveyTile(t);assert.equal(seen[1][0],120);assert.equal(t.survey,'unavailable');assert.equal(t.surveyDeferred.size,20);
  now=2601;await w.surveyTile(t);assert.equal(seen[2][0],0);assert.equal(t.surveyDeferred.get('0:0').tries,2);
});
test('the next visible building ranks a tile instead of its centre; completed and deferred neighbours cannot monopolise the corridor',()=>{
 const scope={droneDetailPriority,TOWER:9,SURVEY_R:{hq:800,lite:500}};
 vm.runInNewContext(transformSync('class W{'+method('surveyPriority')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
 const w=new scope.W();w.o={hq:true};w.radius=1400;
 const t={cx:-170,cy:-170,towers:new Float32Array([400,0,50,0,0,0,0,0,400,-300,0,40,0,1,0,0,1,400])};
 const order=()=>w.surveyPriority(t,0,0,240,0,300,0,[1,0],100);
 assert.equal(order(),droneDetailPriority(400,0,17,0,0,240,0,[1,0]));
 t.surveyHidden=new Set(['0:0']);assert.equal(order(),droneLoadPriority(-300,0,0,0,240,0,[1,0]));
 t.surveyDeferred=new Map([['0:1',{at:200,tries:1}]]);assert.equal(order(),Infinity);
 t.surveyDeferred.get('0:1').at=99;assert.ok(Number.isFinite(order()));
});

test('a rendered building in the forward buffer still receives detail past the drone-centred radius',()=>{
 const scope={droneDetailPriority,TOWER:9,SURVEY_R:{hq:800,lite:500}};
 vm.runInNewContext(transformSync('class W{'+method('surveyPriority')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
 const w=new scope.W();w.o={hq:true};w.radius=1200;
 const t={towers:new Float32Array([1800,0,60,0,0,0,0,0,400])};
 assert.ok(Number.isFinite(w.surveyPriority(t,0,0,240,0,300,0,[1,0],100)));
 assert.equal(w.surveyPriority(t,0,0,240,0,300,0,[-1,0],100),Infinity);
});

test('visible tall buildings cannot wait behind thousands of lower boxes; immediate buildings and near-first tall ordering remain',()=>{
 const score=(x,y,f)=>droneDetailPriority(x,y,f,0,0,240,0,[1,0]);
 assert.ok(score(100,0,2)<score(200,0,15));
 assert.ok(score(200,0,15)<score(1100,0,15));
 assert.ok(score(1800,0,15)<score(200,0,2));
 assert.ok(score(1800,0,15)<score(-200,0,15));
});

test('source world bounds exclude unrelated downloads and preserve multipart wings, tall boxes and unknown bounds',()=>{
 const R=6378137,lat=37.66,lon=127.02;
 const ecef=(x,y,z)=>{const la=lat*Math.PI/180+y/R,lo=lon*Math.PI/180+x/(R*Math.cos(lat*Math.PI/180)),r=R+z;return[r*Math.cos(la)*Math.cos(lo),-r*Math.cos(la)*Math.sin(lo),r*Math.sin(la)];};
 const box=(x,y,w,d,h)=>{const p=[];for(let i=0;i<8;i++)p.push(ecef(x+(i&1?w:0),y+(i&2?d:0),i&4?h:0));return[0,1,2].map(i=>Math.min(...p.map(p=>p[i]))).concat([0,1,2].map(i=>Math.max(...p.map(p=>p[i]))));};
 const outlines=[rect(-80,-15,160,30)];
 assert.equal(surveySourceOverlaps(box(-80,-15,80,30,60),lat,lon,outlines),true);
 assert.equal(surveySourceOverlaps(box(0,-15,80,30,60),lat,lon,outlines),true);
 assert.equal(surveySourceOverlaps(box(-15,-15,30,30,300),lat,lon,outlines),true);
 assert.equal(surveySourceOverlaps(box(40,80,10,10,12),lat,lon,outlines),false);
 for(const invalid of [undefined,[],[0,0,0,1,1,1],[NaN,0,0,1,1,1]])assert.equal(surveySourceOverlaps(invalid,lat,lon,outlines),true);
 assert.equal(surveySourceOverlaps(box(40,80,10,10,12),lat,lon,[[]]),true);
});
test('source discovery includes an adjacent indexed tile and interior multipart wings',()=>{
  const size=36/2**15,lat=37.66,lon=-180+279461*size+.00001;
  const search=surveySearch(lat,lon,[{x:0,y:0}],[rect(-220,-100,440,200)]);
  const kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
  for(const [x,y] of [[-30,0],[160,60],[-180,-50]]){
    assert.ok(search.near(x,y));assert.ok(search.tiles.some(([tx,ty])=>tx===Math.floor((lon+x/kx+180)/size)&&ty===Math.floor((lat+y/ky+90)/size)));
  }
  assert.equal(search.near(900,0),false);assert.equal(new Set(search.tiles.map(x=>x.join(','))).size,search.tiles.length);
});
test('late colours update the detailed facade, distinct roof and darkened end without new materials',async()=>{
  const {w,t}=harness();const geo=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(9),3));
  t.surveyPaint=[{geo,spans:new Uint32Array([0,0,0,1,0,0,0,1,1,1,0,0,2,1,2])}];await w.paintSurvey(t);
  const a=geo.attributes.color.array;assert.ok(Math.abs(a[0]-.7)<1e-6);assert.ok(Math.abs(a[3]-.1)<1e-6);assert.ok(Math.abs(a[6]-.7*.86)<1e-6);
});
for(const [name,roof] of [['vegetation',[.45,.75,.3]],['neutral gray',[.5,.5,.5]]])test('late '+name+' roof evidence preserves facade and corrects both coarse and ready measured roof',async()=>{
 const {w,t}=harness(),profile=buildingAppearanceProfile({id:'late-roof',height:30,floors:10});t.appearances=[profile];
 const geo=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(9),3));
 t.surveyPaint=[{geo,spans:new Uint32Array([0,0,0,1,0,0,0,1,1,1,0,0,2,1,2])}];
 w.surveyWork=async()=>({colours:[{roof,facade:[.9,.9,.9],pitched:false}],retry:false});
 const wall=Array.from(t.styleGeo.apt.attributes.color.array.slice(0,3));await w.colourTile(t);
 assert.equal(t.colour,'done');assert.deepEqual(Array.from(t.styleGeo.apt.attributes.color.array.slice(0,3)),wall);
 const expected=Array.from(observedRoofColour(profile,roof));
 for(let k=0;k<3;k++){
  assert.ok(Math.abs(t.styleGeo.apt.attributes.color.array[3+k]-expected[k])<1e-7);
  assert.ok(Math.abs(geo.attributes.color.array[3+k]-expected[k])<1e-7);
  assert.ok(Math.abs(geo.attributes.color.array[k]-wall[k])<1e-7);
 }
 const next=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(3),3));
 await w.paintSurvey(t,[{geo:next,spans:new Uint32Array([0,0,0,1,1])}]);
 for(let k=0;k<3;k++)assert.ok(Math.abs(next.attributes.color.array[k]-expected[k])<1e-7);
});
test('surveyed facades retain the registered floor grid instead of a universal floor height',async()=>{
  const {w,t}=harness();let submitted;
  t.styleGeo.apt.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,1,0,40],3));
  t.styleGeo.apt.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,-19],2));
  w.surveyWork=async job=>{submitted=job;return null;};await w.surveyTile(t);
  assert.equal(submitted.facadeScale[0],.5);
});
test('streamed measured replacements receive the exact tile road and registered building guard',async()=>{
 const {w,t}=harness();t.nearRoadGuard={key:'tile:fixture',roads:[rect(-30,-3,60,6)],buildings:[rect(-10,-10,20,20)]};
 let submitted;w.surveyWork=async job=>{submitted=job;return null;};await w.surveyTile(t);
 assert.equal(submitted.roadGuard.key,'tile:fixture');assert.deepEqual(Array.from(submitted.roadGuard.roads.xy),t.nearRoadGuard.roads.flat(2));
 assert.deepEqual(Array.from(submitted.roadGuard.buildings.xy),t.nearRoadGuard.buildings.flat(2));
});
test('initial neighbourhood targets use the same tile queue and restore coarse geometry on exit',()=>{
  const scope={THREE,Float32Array,Uint32Array,Map,Set,AbortController,SURVEY_STYLES:['apt','villa','shop','office'],TILE_M:340,TOWER:9,key:(i,j)=>i+','+j};
  vm.runInNewContext(transformSync('class W {'+method('adoptViewBuildings')+method('clear')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
  const geo=new THREE.BufferGeometry().setIndex([0,1,2,3,4,5]);
  const root=new THREE.Group(),view={roadGuard:{key:'initial-ring',roads:[rect(0,30,60,6)],buildings:[rect(0,0,20,20)]},ring:{towers:new Float32Array([10,10,30,0,0,3,0,1,400,400,10,30,0,3,3,0,0,400]),spans:new Float32Array([0,3,1,4,1,0,0,1,1,1]),spanRings:[rect(390,0,20,20),rect(0,0,20,20)]},group:new THREE.Group(),styles:{apt:geo}};
  const w=new scope.W();Object.assign(w,{o:{viewBuildings:()=>view,addWarm:(p,g)=>p.add(g)},root,viewTiles:new Map(),unplant(){},traffic:{removeTile(){}}});
  w.adoptViewBuildings();w.adoptViewBuildings();assert.equal(w.viewTiles.size,2);
  const t=w.viewTiles.get('view:0,0');assert.equal(t.towers[7],0);assert.equal(t.spans[1],0);assert.deepEqual(t.spanRings[0],view.ring.spanRings[1]);
  assert.equal(t.nearRoadGuard,view.roadGuard);
  t.surveyUndo=[{geo,start:0,indices:new Uint32Array([0,1,2])}];geo.index.array.fill(0,0,3);w.clear(t);
  assert.deepEqual([...geo.index.array],[0,1,2,3,4,5]);assert.equal(t.surveyUndo,undefined);
});
