import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import * as THREE from 'three';

const source = readFileSync(new URL('../src/components/ringBuildings.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('ringBuildings.ts', source, ts.ScriptTarget.Latest, true);
const worker = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ringWorkerMain');
const workerCode = transformSync(worker.getText(parsed), { loader: 'ts' }).code;
function renderTile(seed, x, y) {
  let result;
  const lat = 37.57, lon = 126.98, kx = Math.cos(lat * Math.PI / 180) * 111320;
  const ring = [[x+25,y+25],[x+60,y+25],[x+60,y+60],[x+25,y+60],[x+25,y+25]].map(([px,py]) => [lon+px/kx,lat+py/110540]);
  const self = { postMessage: value => result = value };
  const context = { self, performance, importScripts: () => self.ringCb({response:{result:{featureCollection:{features:[{geometry:{type:'Polygon',coordinates:[ring]},properties:{height:12,grnd_flr:3,usability:'01000',strct_cd:'21'}}]}}}}) };
  vm.runInNewContext(workerCode + '\nringWorkerMain();', context);
  self.onmessage({ data: { urls:['fixture'],lat,lon,inner:0,outer:Infinity,near:new Float32Array(),seed,roads:new Float32Array(),grid:null,
    floorM:{apt:2.9,villa:2.9,shop:3.3,office:3.5},box:[x,y,x+340,y+340],heightCell:2 } });
  return result;
}
test('west and south drone tiles generate finite buildings for negative and boundary seeds', () => {
  for (const [x,y] of [[0,0],[-340,0],[0,-340],[-340,-340]]) {
    for (const seed of [23,23+x/340*7919+y/340*104729,-2147483647,0,2147483647]) {
      const result = renderTile(seed,x,y);
      assert.equal(result.buildings,1);
      assert.ok(Object.values(result.styles).every(g => g.position.every(Number.isFinite) && g.color.every(v => Number.isFinite(v) && v>=0 && v<=1)));
    }
  }
});
test('three upstream failures never mark a missing drone tile as rendered',async()=>{
  const source=readFileSync(new URL('../src/components/droneWorld.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('droneWorld.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='DroneWorld');
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='load');
  const code=transformSync('class Harness{'+method.getText(ast)+'};module.exports=Harness;',{loader:'ts',format:'cjs'}).code;
  const module={exports:{}};vm.runInNewContext(code,{module,performance,AbortController,console});
  const h=new module.exports();Object.assign(h,{o:{data:{},hq:true},loading:0,disposed:false,tileGrid:async()=>null,clear:()=>{}});
  const tile={state:'queued',tries:0,readyAt:0};
  for(let n=0;n<4;n++){await h.load(tile);assert.equal(tile.state,'failed');assert.ok(tile.retryAt>performance.now());assert.equal(tile.readyAt,0);assert.equal(h.loading,0)}
});

test('adjacent sea tiles share the regional water level, depth and wave direction',()=>{
  const source=readFileSync(new URL('../src/components/droneWorld.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('droneWorld.ts',source,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='DroneWorld');
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='alignSea');
  const code=transformSync('class Harness{'+method.getText(ast)+'};module.exports=Harness;',{loader:'ts',format:'cjs'}).code;
  const module={exports:{}};vm.runInNewContext(code,{module,Math});
  const h=new module.exports();h.base=12;h.region={field:{shore:(x,y)=>Math.hypot(x+600,y-300)}};
  const mesh=x=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([x,7,-170],3));g.setAttribute('aShore',new THREE.Float32BufferAttribute([999999],1));g.setAttribute('aFlow',new THREE.Float32BufferAttribute([1,0],2));return new THREE.Mesh(g)};
  const a=mesh(170),b=mesh(-170);h.alignSea(a,0,0);h.alignSea(b,340,0);
  assert.ok(Math.abs(a.geometry.attributes.position.getY(0)+11.88)<0.00001);
  assert.equal(a.geometry.attributes.position.getY(0),b.geometry.attributes.position.getY(0));
  assert.equal(a.geometry.attributes.aShore.getX(0),b.geometry.attributes.aShore.getX(0));
  assert.deepEqual([...a.geometry.attributes.aFlow.array],[...b.geometry.attributes.aFlow.array]);
  for(const m of [a,b])m.geometry.dispose();
});

test('an unavailable facade uses its embedded survey photograph; cancellation skips fallback',async()=>{
  const source=readFileSync(new URL('../src/components/vworld3d.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('vworld3d.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='photoTexture');
  const code=transformSync(fn.getText(ast)+';module.exports=photoTexture;',{loader:'ts',format:'cjs'}).code;
  let decoded=0;const module={exports:{}};
  vm.runInNewContext(code,{module,THREE,Blob,createImageBitmap:async blob=>{decoded++;assert.equal(blob.size,4);return {width:64,height:32,close(){}}}});
  const thumb=new Uint8Array([255,216,255,217]).buffer;
  const texture=await module.exports(async()=>{throw Error('upstream XML error')},thumb,2048);
  assert.ok(texture.isTexture);assert.equal(texture.userData.embeddedThumbnail,true);assert.equal(texture.image.width,64);
  const good=await module.exports(async()=>thumb,thumb,2048);assert.equal(good.userData.embeddedThumbnail,undefined);
  assert.equal(await module.exports(async()=>{throw Error('cancelled')},thumb,2048,{aborted:true}),null);
  assert.equal(decoded,2);texture.dispose();good.dispose();
});

function landmarks(loader=async()=>[]) {
  const code = transformSync(readFileSync(new URL('../src/components/sceneLandmarks.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>name==='three'?THREE:{photoBuildings:loader},performance,AbortController,console});
  return module.exports;
}
test('Gwangan double deck stays finite, reaches both approaches, and has cables, railings and markings',()=>{
  const {gwanganDeck,buildGwanganBridge,GWANGAN_CENTRE}=landmarks();
  const project=(lon,lat)=>[(lon-GWANGAN_CENTRE.lon)*111320*Math.cos(GWANGAN_CENTRE.lat*Math.PI/180),(lat-GWANGAN_CENTRE.lat)*110540];
  const d=gwanganDeck(project,-18,()=>-18);
  assert.ok(d.total>3500 && d.total<5000);
  assert.equal(d.upper((d.s0+d.s1)/2),26);
  assert.equal(d.upper(0),-16);
  assert.equal(d.upper(d.total),-16);
  const bridge=buildGwanganBridge(project,-18,true,()=>-18);
  assert.equal(bridge.group.children.length,5);
  for(const mesh of bridge.group.children){assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));assert.ok(mesh.geometry.index.count>0)}
  assert.ok(bridge.group.children.some(m=>m.name.includes('both decks')));
  bridge.dispose();
});
test('an empty landmark survey backs off rather than retrying every animation frame',async()=>{
  let requests=0;
  const {Landmarks,LANDMARK_SITES}=landmarks(async()=>{requests++;return []});
  const s=LANDMARK_SITES.find(s=>s.id==='sajik-baseball');
  const l=new Landmarks({key:'fixture',lat0:s.lat,lon0:s.lon,hq:false,groundAt:()=>0,seaLevel:()=>null,addWarm:(p,o)=>p.add(o)});
  l.update(0,0);await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<100;i++)l.update(0,0);
  assert.equal(requests,1);assert.equal(l.placedSites().length,0);l.dispose();
});
test('a late terrain tile aligns the model; only surveyed footprints replace registered boxes',async()=>{
  let ground=0,closed=0;
  const model={key:'fixture',geometry:new THREE.BoxGeometry(20,20,10),texture:new THREE.Texture({close:()=>closed++}),cx:0,cy:0,ground:0,hull:[[-10,-10],[10,-10],[10,10],[-10,10]],src:{img:'fixture'}};
  const {Landmarks,LANDMARK_SITES}=landmarks(async(_key,_lat,_lon,_radius,opts)=>{opts.onBuilding(model);return [model]});
  const s=LANDMARK_SITES.find(s=>s.id==='sajik-baseball');
  const l=new Landmarks({key:'fixture',lat0:s.lat,lon0:s.lon,hq:false,groundAt:()=>ground,seaLevel:()=>null,addWarm:(p,o)=>p.add(o)});
  l.update(0,0);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(l.hasModelAt(s,0,0));assert.equal(l.hasModelAt(s,100,100),false);
  ground=12;l.alignedAt=-1000;l.update(0,0);
  assert.equal(l.root.children[0].children[0].position.y,11.85);
  l.dispose();assert.equal(closed,1);
});
