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
const {cutSceneSurface}=load('surfaceCutClient.ts',{sceneWork:()=>null,excludeSurface});
const {fitTileStreetSurfaces}=load('tileStreetSurfaces.ts',{cutSceneSurface});
const go=async()=>true;
const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
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
test('streamed asphalt, paint and paving share exact building and carriageway exclusions',async()=>{
 const roads={surface:surface(-20,-4,20,4),marks:{...surface(-20,-.1,20,.1,.03),color:new Float32Array(12).fill(1)},marksFar:null,walks:surface(-20,-8,20,8,.15)};
 const building=rectangle(-2,-2,2,2),guard=await fitTileStreetSurfaces(roads,[building],go);
 assert.ok(guard.length>2);
 for(const s of [roads.surface,roads.marks,roads.walks]){const p=s.position;for(let k=0;k<s.index.length;k+=3){const ids=Array.from(s.index.subarray(k,k+3)),x=ids.reduce((a,i)=>a+p[i*3]/3,0),y=ids.reduce((a,i)=>a+p[i*3+1]/3,0);assert.ok(!(Math.abs(x)<2-1e-6&&Math.abs(y)<2-1e-6));if(s===roads.walks)assert.ok(Math.abs(y)>=4-1e-6);}}
 assert.equal(roads.marks.color.length,roads.marks.position.length);
});
