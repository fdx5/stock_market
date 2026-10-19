import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';

function load(name,extra={}){
 const text=readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'');
 const module={exports:{}};vm.runInNewContext(transformSync(text,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,THREE,performance,gridNormals(){},...extra});return module.exports;
}
const {syncGroundRelief,drapeRoadSurface}=load('roadDrape.ts');
const {excludeSurface}=load('surfaceExclusion.ts');
const {seaOutsideBox}=load('coastGeometry.ts');
const {cutSceneSurface,clipSceneStreetBox}=load('surfaceCutClient.ts',{sceneWork:()=>null,excludeSurface,seaOutsideBox});
const {packRings}=load('nearBuildingTargets.ts');
const {cutTileStreets,streetTransfer}=load('tileStreetCut.ts',{excludeSurface,packRings});
const {fitTileStreetSurfaces}=load('tileStreetSurfaces.ts',{sceneWork:()=>null,cutTileStreets,streetTransfer});
const {anchoredTerrainHeight}=load('terrainGrid.ts');
const go=async()=>true;
const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];

test('worker surface bounds are reused exactly without another vertex scan on the drawing thread',async()=>{
 const source=new THREE.BoxGeometry(20,8,12).translate(7,4,-3);source.computeBoundingSphere();
 const expected=source.boundingSphere.clone(),b=expected;
 const result={attributes:Object.entries(source.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array})),index:source.index.array,sphere:[b.center.x,b.center.y,b.center.z,b.radius]};
 const api=load('surfaceCutClient.ts',{sceneWork:()=>Promise.resolve(result),excludeSurface,seaOutsideBox});
 const target=new THREE.BufferGeometry();target.computeBoundingSphere=()=>{throw Error('main-thread vertex scan');};
 await api.cutSceneSurface(target,[rectangle(-1,-1,1,1)],go);
 assert.ok(target.boundingSphere.equals(expected));assert.equal(target.attributes.position.array,source.attributes.position.array);
 assert.equal(target.index.array,source.index.array);
});
test('paving reuses exact repeated heights within a build, yields on long runs and refreshes the next build',async()=>{
 const text=readFileSync(new URL('../src/components/sceneSidewalk.ts',import.meta.url),'utf8'),code=text.slice(text.indexOf('export async function buildSidewalks'),text.indexOf('/** Street trees:'));
 let clock=0,frames=0,calls=0,base=2;const points=new Set(),module={exports:{}};
 vm.runInNewContext(transformSync(code,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,THREE,PAVER_STYLES:['stretcher','herringbone','granite','basket'],KERB_H:.15,performance:{now:()=>clock+=4},frameSlice:async()=>{frames++;},paintedTexture:async()=>new THREE.Texture(),roadLevel:()=>0,
  roadHeight:(_r,_t,x,y)=>{calls++;points.add(x+','+y);return base+x*.01;},runPt:(r,i,off)=>[r.cx[i]+r.nx[i]*r.side*off,r.cy[i]+r.ny[i]*r.side*off]});
 const n=40,run={road:0,sourceRoad:{},side:1,half:4,width:3,cx:Float32Array.from({length:n},(_,i)=>i*2),cy:new Float32Array(n),nx:new Float32Array(n),ny:new Float32Array(n).fill(1),cum:Float32Array.from({length:n},(_,i)=>i*2)};
 const first=await module.exports.buildSidewalks([run],{at:()=>0},[]);assert.equal(calls,points.size);assert.ok(frames>1);
 let paving=first.group.children.find(m=>m.name.startsWith('paving ')),p=paving.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-(base+p.getX(i)*.01+.15))<1e-5);
 first.dispose();base=12;const second=await module.exports.buildSidewalks([run],{at:()=>0},[]);paving=second.group.children.find(m=>m.name.startsWith('paving '));assert.ok(paving.geometry.attributes.position.getY(0)>12);second.dispose();
});
test('streamed terrain agrees with the departure grade at its boundary and returns smoothly to DEM within 128 metres',()=>{
 const n=501,cell=4,R=1000,anchor={h:Float32Array.from({length:n*n},(_,k)=>8+((k%n)*cell-R)*.01),n,cell,R,half:680};
 for(const x of [679.99,680,680.01,700])assert.ok(Math.abs(anchoredTerrainHeight(anchor,x,0,25)-(8+x*.01))<1e-5);
 assert.equal(anchoredTerrainHeight(anchor,808,0,25),25);assert.equal(anchoredTerrainHeight(anchor,900,0,25),25);
 let previous=anchoredTerrainHeight(anchor,712,0,25);for(let x=713;x<=808;x++){const z=anchoredTerrainHeight(anchor,x,0,25);assert.ok(z>=previous&&z-previous<.2);previous=z;}
 assert.equal(anchoredTerrainHeight(undefined,0,0,25),25);
});
function ground(){const g=new THREE.PlaneGeometry(4,4);g.userData.grid={xs:new Float64Array([-2,2]),ys:new Float64Array([2,-2])};return g;}
test('late road grading reaches a clipped drone ground copy on the exact DEM triangles, without refilling water',async()=>{
 const source=ground(),p=source.attributes.position;[4,0,0,4].forEach((z,i)=>p.setZ(i,z));
 const visible=new THREE.BufferGeometry();visible.setAttribute('position',new THREE.Float32BufferAttribute([0,0,10,1,1,10,0,0,-3],3));
 await syncGroundRelief(source,visible,go);assert.deepEqual(Array.from(visible.attributes.position.array),[0,0,0,1,1,0,0,0,-3]);
 const saved=visible.attributes.position.array.slice();await syncGroundRelief(source,visible,go);assert.deepEqual(visible.attributes.position.array,saved);
 source.dispose();visible.dispose();
});
test('cancelled ground synchronization leaves the visible copy intact',async()=>{
 const source=ground(),visible=source.clone(),p=visible.attributes.position;p.setZ(0,50);const saved=p.array.slice();
 await syncGroundRelief(source,visible,async()=>false);assert.deepEqual(p.array,saved);source.dispose();visible.dispose();
});
test('indexed paving drapes onto exact terrain while preserving its UVs, colours and vertical kerbs',async()=>{
 const terrain=ground();[4,0,0,4].forEach((z,i)=>terrain.attributes.position.setZ(i,z));
 const paving=new THREE.PlaneGeometry(3,3).rotateX(-Math.PI/2),p=paving.attributes.position;
 paving.setIndex([0,2,3,0,3,1]);
 paving.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>[p.getX(i)/4+.5,-p.getZ(i)/4+.5,.3]).flat(),3));
 await drapeRoadSurface(paving,terrain,go,.17);
 assert.equal(paving.index,null);assert.ok(paving.attributes.position.count>6);
 for(const a of Object.values(paving.attributes))assert.equal(a.count,paving.attributes.position.count);
 const out=paving.attributes.position,uv=paving.attributes.uv,c=paving.attributes.color;
 for(let i=0;i<out.count;i++){assert.ok(Math.abs(uv.getX(i)-(out.getX(i)/3+.5))<1e-6);assert.ok(Math.abs(uv.getY(i)-(-out.getZ(i)/3+.5))<1e-6);assert.ok(Math.abs(c.getX(i)-(out.getX(i)/4+.5))<1e-6);}
 const kerb=new THREE.BufferGeometry();const values=[-1,.2,0,1,.2,0,1,.35,0,-1,.2,0,1,.35,0,-1,.35,0];kerb.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
 await drapeRoadSurface(kerb,terrain,go,.17);assert.deepEqual(Array.from(kerb.attributes.position.array),values.map(Math.fround));
 terrain.dispose();paving.dispose();kerb.dispose();
});
test('a confirmed elevated pavement keeps its profile even under hillside terrain',async()=>{
 const terrain=ground();for(let i=0;i<4;i++)terrain.attributes.position.setZ(i,30);
 const paving=new THREE.PlaneGeometry(3,3).rotateX(-Math.PI/2).translate(0,5,0);paving.setAttribute('roadLevel',new THREE.Float32BufferAttribute([1,1,1,1],1));
 await drapeRoadSurface(paving,terrain,go,.17);const p=paving.attributes.position;for(let i=0;i<p.count;i++)assert.equal(p.getY(i),5);terrain.dispose();paving.dispose();
});
test('exact exclusion supports streamed z-up coordinates and preserves vertex attributes',async()=>{
 const g=new THREE.PlaneGeometry(10,10);await excludeSurface(g,[rectangle(-2,-2,2,2)],go,true);
 const p=g.attributes.position;let area=0;for(let i=0;i<p.count;i+=3)area+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getY(i+2)-p.getY(i))-(p.getY(i+1)-p.getY(i))*(p.getX(i+2)-p.getX(i)))/2;
 assert.ok(Math.abs(area-84)<1e-6);assert.equal(g.attributes.uv.count,p.count);g.dispose();
});
test('a vertical kerb crossing a carriageway is clipped but a kerb on its boundary remains',async()=>{
 const make=y=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-5,y,0,5,y,0,5,y,.15,-5,y,0,5,y,.15,-5,y,.15],3));return g;};
 const crossing=make(0);await excludeSurface(crossing,[rectangle(-2,-2,2,2)],go,true);
 const p=crossing.attributes.position;for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;assert.ok(Math.abs(x)>=2-1e-6);}
 const boundary=make(2),saved=boundary.attributes.position;await excludeSurface(boundary,[rectangle(-2,-2,2,2)],go,true);assert.equal(boundary.attributes.position,saved);crossing.dispose();boundary.dispose();
});
function surface(x0,y0,x1,y1,z=0){const g=new THREE.PlaneGeometry(x1-x0,y1-y0).translate((x0+x1)/2,(y0+y1)/2,z),p=g.attributes.position.array;const a={position:p,normal:g.attributes.normal.array,index:new Uint32Array(g.index.array),level:new Float32Array(p.length/3)};g.dispose();return a;}
test('departure road and bridge width clips to the ground square with UVs, profiles and levels preserved',async()=>{
 const g=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2).translate(0,7,0).toNonIndexed();
 g.setAttribute('roadLevel',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(1),1));
 g.setAttribute('roadProfile',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(17),1));
 await clipSceneStreetBox(g,[-4,-3,4,3],go);assert.equal(g.index,null,'consecutive asphalt remains eligible for the WASM road BVH');const p=g.attributes.position,uv=g.attributes.uv;
 for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getX(i))<=4.0001&&Math.abs(p.getZ(i))<=3.0001);assert.equal(p.getY(i),7);assert.equal(g.attributes.roadProfile.getX(i),17);assert.equal(g.attributes.roadLevel.getX(i),1);assert.ok(Math.abs(uv.getX(i)-(p.getX(i)/20+.5))<1e-6);}
 g.dispose();
});
test('departure boundary clipping retains the vertical kerb face and its fifteen centimetre rise',async()=>{
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-5,0,0,5,0,0,5,.15,0,-5,0,0,5,.15,0,-5,.15,0],3));
 await clipSceneStreetBox(g,[-2,-2,2,2],go);const p=g.attributes.position;assert.ok(p.count>=6);let low=Infinity,high=-Infinity;
 for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getX(i))<=2.0001);low=Math.min(low,p.getY(i));high=Math.max(high,p.getY(i));}assert.ok(Math.abs(high-low-.15)<1e-6);g.dispose();
});
test('streamed asphalt, paint and paving share exact building and carriageway exclusions',async()=>{
 const roads={surface:surface(-20,-4,20,4),marks:{...surface(-20,-.1,20,.1,.03),color:new Float32Array(12).fill(1)},marksFar:null,walks:surface(-20,-8,20,8,.15)};
 const building=rectangle(-2,-2,2,2),guard=await fitTileStreetSurfaces(roads,[building],go);
 assert.ok(guard.ends.length>2);
 for(const s of [roads.surface,roads.marks,roads.walks]){const p=s.position;for(let k=0;k<s.index.length;k+=3){const ids=Array.from(s.index.subarray(k,k+3)),x=ids.reduce((a,i)=>a+p[i*3]/3,0),y=ids.reduce((a,i)=>a+p[i*3+1]/3,0);assert.ok(!(Math.abs(x)<2-1e-6&&Math.abs(y)<2-1e-6));if(s===roads.walks)assert.ok(Math.abs(y)>=4-1e-6);}}
 assert.equal(roads.marks.color.length,roads.marks.position.length);
});

test('a streamed tile fits its streets in one worker job, its arrays handed over, not copied',async()=>{
 const roads={surface:surface(-20,-4,20,4),marks:{...surface(-20,-.1,20,.1,.03),color:new Float32Array(12).fill(1)},marksFar:null,walks:surface(-20,-8,20,8,.15)};
 const building=rectangle(-2,-2,2,2),jobs=[];
 const worker=(op,args,transfer)=>{jobs.push({op,transfer});return cutTileStreets(args,go);};
 const api=load('tileStreetSurfaces.ts',{sceneWork:worker,cutTileStreets,streetTransfer});
 const guard=await api.fitTileStreetSurfaces(roads,[building],go);
 assert.equal(jobs.length,1);assert.equal(jobs[0].op,'tileStreets');
 assert.ok(jobs[0].transfer.length>=8,'every surface array is transferred');
 assert.ok(guard.ends.length>2);
 for(const s of [roads.surface,roads.marks,roads.walks]){const p=s.position;for(let k=0;k<s.index.length;k+=3){const ids=Array.from(s.index.subarray(k,k+3)),x=ids.reduce((a,i)=>a+p[i*3]/3,0),y=ids.reduce((a,i)=>a+p[i*3+1]/3,0);assert.ok(!(Math.abs(x)<2-1e-6&&Math.abs(y)<2-1e-6));if(s===roads.walks)assert.ok(Math.abs(y)>=4-1e-6);}}
 const failed=load('tileStreetSurfaces.ts',{sceneWork:()=>Promise.reject(Error('worker failed')),cutTileStreets,streetTransfer});
 assert.equal(await failed.fitTileStreetSurfaces({...roads},[building],go),null,'a failed worker fails the tile (it is tried again)');
});
