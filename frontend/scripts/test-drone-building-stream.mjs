import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import * as THREE from 'three';
const bundle = await build({entryPoints:[new URL('../src/components/surveyBuildingMatch.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const { matchSurveyBuildings } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

test('a stalled survey file returns completed models for immediate partial replacement and retry',async()=>{
  const source=readFileSync(new URL('../src/components/vworld3d.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('vworld.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='photoBuildingsNear').getText(ast).replace(/^export /,'');
  let failures=0,completeSecond=false;
  const entries=[{key:'first',lon:127,lat:37},{key:'slow',lon:127,lat:37}];
  const scope={AbortController,DOMException,setTimeout,clearTimeout,SIZE:36/2**15,vworldToken:async()=>'',tileList:async()=>entries,
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

const source=readFileSync(new URL('../src/components/droneWorld.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('world.ts',source,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='DroneWorld');
const method=name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast).replace(/^private /,'');
function harness(extra={}) {
  const raf=[];
  const scope={THREE,performance,console,LANDMARK_SITES:[],TOWER:9,SURVEY_STYLES:['apt','villa','shop','office'],requestAnimationFrame:f=>raf.push(f),staticSceneTransforms:()=>{},sharedContextMaterial:()=>new THREE.MeshStandardMaterial(),castShadows:()=>{},...extra};
  vm.runInNewContext(transformSync('class W {'+method('surveyTile')+method('paintSurvey')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
  const w=new scope.W();Object.assign(w,{o:{data:{center:{lat:37,lon:127},vworld_key:'synthetic'},drawReady:()=>false},landmarks:{},tiles:new Map(),liveTile:t=>w.tiles.get(t.key)===t,disposed:false,surveying:0,pace:async()=>true,plain:new THREE.MeshStandardMaterial()});
  const base=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute([.7,.6,.5,.1,.2,.3,.7,.6,.5],3)).setIndex([0,1,2]);
  const t={key:'fixture',stop:new AbortController(),towers:new Float32Array([0,0,30,0,0,3,0,0,400]),styleGeo:{apt:base},spanRings:[rect(-10,-10,20,20)],spans:new Float32Array([0,0,1,1,1]),zup:new THREE.Group(),survey:'none',dispose:[],castB:true};
  w.tiles.set(t.key,t);return{w,t,raf};
}
test('download failure remains retryable instead of completing an empty detail tile',async()=>{
  const {w,t}=harness();w.surveyWork=async()=>({parts:[],retry:true,models:0,matched:0});await w.surveyTile(t);
  assert.equal(t.survey,'none');assert.ok(t.surveyRetryAt>performance.now());assert.equal(w.surveying,0);
});
test('confirmed unavailable survey data is distinct from a rendered detail tile',async()=>{
  const {w,t}=harness();w.surveyWork=async()=>({parts:[],retry:false,models:0,matched:0});await w.surveyTile(t);
  assert.equal(t.survey,'unavailable');assert.equal(t.surveyGroup,undefined);
});
test('coarse triangles remain until detail is GPU-ready; retries skip already replaced records',async()=>{
  const {w,t,raf}=harness();let submitted;
  const part={material:0,position:new Float32Array([0,0,0,1,0,0,0,1,0]),normal:new Float32Array([0,0,1,0,0,1,0,0,1]),uv:new Float32Array(6),color:new Float32Array(9),index:new Uint32Array([0,1,2]),sphere:[0,0,0,2],paintSpans:new Uint32Array([0,0,0,3,0])};
  w.surveyWork=async job=>{submitted=job;return{parts:[part],hide:new Float32Array([0,0,3]),retry:true,models:1,matched:1};};
  await w.surveyTile(t);assert.equal(t.survey,'placed');assert.deepEqual([...t.styleGeo.apt.index.array],[0,1,2]);
  raf.shift()();assert.equal(t.survey,'placed');w.o.drawReady=()=>true;raf.shift()();
  assert.deepEqual([...t.styleGeo.apt.index.array],[0,0,0]);assert.equal(t.survey,'none');
  assert.equal(t.surveyHidden.size,1);await w.surveyTile(t);assert.equal(t.survey,'ready');assert.equal(submitted.towers.length,9);
});
test('late colours update the detailed facade, distinct roof and darkened end without new materials',async()=>{
  const {w,t}=harness();const geo=new THREE.BufferGeometry().setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(9),3));
  t.surveyPaint=[{geo,spans:new Uint32Array([0,0,0,1,0,0,0,1,1,1,0,0,2,1,2])}];await w.paintSurvey(t);
  const a=geo.attributes.color.array;assert.ok(Math.abs(a[0]-.7)<1e-6);assert.ok(Math.abs(a[3]-.1)<1e-6);assert.ok(Math.abs(a[6]-.7*.86)<1e-6);
});
test('surveyed facades retain the registered floor grid instead of a universal floor height',async()=>{
  const {w,t}=harness();let submitted;
  t.styleGeo.apt.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,1,0,40],3));
  t.styleGeo.apt.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,-19],2));
  w.surveyWork=async job=>{submitted=job;return null;};await w.surveyTile(t);
  assert.equal(submitted.facadeScale[0],.5);
});
test('initial neighbourhood targets use the same tile queue and restore coarse geometry on exit',()=>{
  const scope={THREE,Float32Array,Uint32Array,Map,Set,AbortController,SURVEY_STYLES:['apt','villa','shop','office'],TILE_M:340,TOWER:9,key:(i,j)=>i+','+j};
  vm.runInNewContext(transformSync('class W {'+method('adoptViewBuildings')+method('clear')+'};globalThis.W=W;',{loader:'ts'}).code,scope);
  const geo=new THREE.BufferGeometry().setIndex([0,1,2,3,4,5]);
  const root=new THREE.Group(),view={ring:{towers:new Float32Array([10,10,30,0,0,3,0,1,400,400,10,30,0,3,3,0,0,400]),spans:new Float32Array([0,3,1,4,1,0,0,1,1,1]),spanRings:[rect(390,0,20,20),rect(0,0,20,20)]},group:new THREE.Group(),styles:{apt:geo}};
  const w=new scope.W();Object.assign(w,{o:{viewBuildings:()=>view,addWarm:(p,g)=>p.add(g)},root,viewTiles:new Map(),unplant(){},traffic:{removeTile(){}}});
  w.adoptViewBuildings();w.adoptViewBuildings();assert.equal(w.viewTiles.size,2);
  const t=w.viewTiles.get('view:0,0');assert.equal(t.towers[7],0);assert.equal(t.spans[1],0);assert.deepEqual(t.spanRings[0],view.ring.spanRings[1]);
  t.surveyUndo=[{geo,start:0,indices:new Uint32Array([0,1,2])}];geo.index.array.fill(0,0,3);w.clear(t);
  assert.deepEqual([...geo.index.array],[0,1,2,3,4,5]);assert.equal(t.surveyUndo,undefined);
});
