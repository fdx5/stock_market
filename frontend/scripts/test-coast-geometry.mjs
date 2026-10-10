import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as THREE from 'three';
const base=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'coast-geometry-'));
const bundle=await build({stdin:{contents:`export * from './src/components/coastGeometry';export * from './src/components/waterCore';export * from './src/components/coastRibbon';`,resolveDir:base},bundle:true,write:false,platform:'node',format:'esm'});
const entry=join(dir,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});
const {seaOutsideBox,SeaCoverage,skirtedGridNormals,waterField,fieldFrom,waterSurface,coastRibbon}=await import(pathToFileURL(entry));
test('asynchronous sea replacement keeps its source until ready, rejects stale cuts and restores on exit',async()=>{
  const source=new THREE.PlaneGeometry(100,100);source.rotateX(-Math.PI/2);source.setAttribute('aSea',new THREE.BufferAttribute(new Float32Array(source.getAttribute('position').count).fill(1),1));
  const mesh=new THREE.Mesh(source),jobs=[];const coverage=new SeaCoverage((g,b,m,s)=>new Promise(resolve=>jobs.push({resolve,signal:s})));
  coverage.update([mesh],[-10,-10,10,10]);assert.equal(mesh.geometry,source);
  coverage.update([mesh],[-20,-20,20,20]);assert.equal(jobs[0].signal.aborted,true);
  const stale=source.clone();let released=0;stale.addEventListener('dispose',()=>released++);jobs[0].resolve(stale);await Promise.resolve();assert.equal(released,1);assert.equal(mesh.geometry,source);
  const live=source.clone();jobs[1].resolve(live);await Promise.resolve();assert.equal(mesh.geometry,live);
  coverage.restore();assert.equal(mesh.geometry,source);assert.equal(mesh.visible,true);source.dispose();
});
test('sea replacement finishing after landing releases its geometry without changing restored water',async()=>{
  const source=new THREE.PlaneGeometry(100,100);source.setAttribute('aSea',new THREE.BufferAttribute(new Float32Array(4).fill(1),1));const mesh=new THREE.Mesh(source);let complete;
  const coverage=new SeaCoverage(()=>new Promise(resolve=>complete=resolve));coverage.update([mesh],[-10,-10,10,10]);coverage.restore();
  const late=source.clone();let freed=0;late.addEventListener('dispose',()=>freed++);complete(late);await Promise.resolve();assert.equal(mesh.geometry,source);assert.equal(freed,1);source.dispose();
});
const geo=(sea=1)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,2,2,0,2,2,0,-2,-2,0,-2],3));g.setAttribute('aSea',new THREE.Float32BufferAttribute([sea,sea,sea,sea],1));g.setAttribute('aShore',new THREE.Float32BufferAttribute([0,4,4,0],1));g.setAttribute('aFlow',new THREE.Float32BufferAttribute([1,0,1,0,1,0,1,0],2));g.setIndex([0,2,1,0,3,2]);return g;};
const area=g=>{let total=0,p=g.attributes.position;for(let k=0;k<g.index.count;k+=3){const ids=[g.index.getX(k),g.index.getX(k+1),g.index.getX(k+2)],a=ids.map(i=>[p.getX(i),-p.getZ(i)]);total+=Math.abs((a[1][0]-a[0][0])*(a[2][1]-a[0][1])-(a[1][1]-a[0][1])*(a[2][0]-a[0][0]))/2;}return total;};
test('exact sea cut conserves area at a tile boundary crossing triangle interiors',()=>{const g=geo(),cut=seaOutsideBox(g,[-1,-1,1,1]);assert.ok(Math.abs(area(cut)-12)<1e-6);const p=cut.attributes.position;for(let k=0;k<cut.index.count;k+=3){const ids=[cut.index.getX(k),cut.index.getX(k+1),cut.index.getX(k+2)],x=ids.reduce((s,i)=>s+p.getX(i),0)/3,y=ids.reduce((s,i)=>s-p.getZ(i),0)/3;assert.ok(Math.abs(x)>=1-1e-6||Math.abs(y)>=1-1e-6);}});
test('cut vertices interpolate depth and flow and never mutate the original water',()=>{const g=geo(),before=JSON.stringify(g.toJSON()),cut=seaOutsideBox(g,[-1,-1,1,1]),p=cut.attributes.position;assert.equal(JSON.stringify(g.toJSON()),before);for(let i=0;i<p.count;i++)assert.ok(Math.abs(cut.attributes.aShore.getX(i)-(p.getX(i)+2))<1e-6);for(const a of Object.values(cut.attributes))assert.ok(a.array.every(Number.isFinite));assert.ok(cut.index.array.every(i=>i<p.count));});
test('regional sea replacement keeps every river triangle',()=>{const g=geo(0),cut=seaOutsideBox(g,[-10,-10,10,10]);assert.equal(area(cut),16);assert.equal(cut.index.count,6);});
test('translated water uses world boundaries and restores original geometry on landing',()=>{const original=geo(),mesh=new THREE.Mesh(original),coverage=new SeaCoverage();mesh.position.x=100;coverage.update([mesh],[98,-2,102,2]);assert.equal(mesh.geometry.index.count,0);coverage.update([mesh],[0,0,1,1]);assert.equal(area(mesh.geometry),16);coverage.restore();assert.equal(mesh.geometry,original);});
test('vertical skirts do not tilt a flat tile surface after sea sinking',()=>{const g=new THREE.BufferGeometry(),P=new Float32Array(12*3),N=new Float32Array(12*3),edges=[[0,1],[1,3],[3,2],[2,0]];for(let k=0;k<4;k++){P[k*3]=k%2;P[k*3+1]=Math.floor(k/2);P[k*3+2]=-.6;}let i=4;for(const e of edges)for(const k of e){P.set(P.subarray(k*3,k*3+3),i*3);P[i++*3+2]=-4;}g.setAttribute('position',new THREE.BufferAttribute(P,3));g.setAttribute('normal',new THREE.BufferAttribute(N,3));g.userData.skirtGrid={row:2,cell:1,edges};skirtedGridNormals(g);for(let k=0;k<12;k++)assert.equal(N[k*3+2],1);for(let k=4;k<12;k++)assert.ok(P[k*3+2]<=-4.59);});
const go=async()=>true;
test('sea datum is identical despite different coastal DEM noise; river level is retained',async()=>{const rings=[[[-40,-40],[0,-40],[0,40],[-40,40]],[[50,-40],[90,-40],[90,40],[50,40]]],data=await waterField(rings,(x)=>x<0?3:11,go,[],[true,false],null,-5),f=fieldFrom(data,()=>0);assert.equal(f.level(-20,0),-5);assert.equal(f.level(70,0),11);});
test('coarse raster never discards real coastal or island-edge sea triangles',async()=>{const ring=[[-100,-100],[100,-100],[70,100],[-100,100]],hole=[[-20,-20],[20,-20],[20,20],[-20,20]],f={level:()=>0,wet:()=>false,shore:()=>20};const s=await waterSurface([ring],f,go,[hole],[true]);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(s.pos,3));g.setIndex(new THREE.BufferAttribute(s.index,1));assert.ok(Math.abs(area(g)-(37000-1600))<.05);});
test('open query boundaries never become artificial surf lines',async()=>{const ring=[[-40,-40],[40,-40],[40,40],[-40,40]],data=await waterField([ring],()=>0,go,[],[true],[-40,-40,40,40],0),f=fieldFrom(data,()=>0);assert.ok(f.shore(39,0)>10000);assert.ok(f.shore(0,39)>10000);});
test('regional diagonal coastline is continuous below the raster step',async()=>{
  const ring=[[-2000,-2000],[2000,-2000],[2000,400],[-2000,-400]],d=await waterField([ring],()=>8,go,[],[true],[-2000,-2000,2000,2000],-3),f=fieldFrom(structuredClone(d),()=>8);
  assert.ok(d.s>4);
  for(let x=-100;x<=100;x+=2.3){const y=.2*x;
    assert.equal(f.wet(x,y-.001),true);assert.equal(f.wet(x,y+.001),false);
    assert.ok(Math.abs(f.shore(x,y-1.37)-1.37/Math.sqrt(1.04))<1e-5);
    assert.ok(f.shore(x,y)<1e-5);assert.equal(f.level(x,y-1),-3);
  }
});
test('exact sea membership keeps small islands dry without extending the shore into query edges',async()=>{
  const ring=[[-300,-300],[300,-300],[300,300],[-300,300]],hole=[[-7,-11],[9,-11],[9,13],[-7,13]],d=await waterField([ring],()=>0,go,[hole],[true],[-300,-300,300,300],0),f=fieldFrom(d,()=>0);
  assert.equal(f.wet(9.001,0),true);assert.equal(f.wet(8.999,0),false);assert.equal(f.wet(0,0),false);
  assert.ok(Math.abs(f.shore(10,0)-1)<1e-6);assert.ok(f.shore(299,0)>289);
});
test('prepared coastline nearest-edge tree agrees with the analytic polygon distance',async()=>{
  const ring=[[-90,-60],[12,-93],[95,30],[25,110],[-70,72]],d=await waterField([ring],()=>0,go,[],[true],null,0),f=fieldFrom(d,()=>0);
  for(let x=-130;x<130;x+=13)for(let y=-130;y<130;y+=17){let expected=Infinity;
    ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));expected=Math.min(expected,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));});
    assert.ok(Math.abs(f.coast.distance(x,y)-expected)<1e-8);
  }
});
test('adaptive surf distance stays within 25 cm while straight beaches retain coarse geometry',async()=>{
  const ring=[[-300,-300],[300,-300],[300,0],[-300,0]],d=await waterField([ring],()=>0,go,[],[true],[-300,-300,300,300],0),f=fieldFrom(d,()=>0),s=await waterSurface([ring],f,go,[],[true]);
  for(let k=0;k<s.index.length;k+=3){const ids=Array.from(s.index.subarray(k,k+3)),near=Math.min(...ids.map(i=>s.shore[i]));
    if(near<35){const x=ids.reduce((v,i)=>v+s.pos[i*3],0)/3,y=ids.reduce((v,i)=>v-s.pos[i*3+2],0)/3,interpolated=ids.reduce((v,i)=>v+s.shore[i],0)/3;assert.ok(Math.abs(f.shore(x,y)-interpolated)<.251);}
  }
  assert.ok(s.index.length/3<8000,'straight surf and open sea remain coarse');
});
test('vector strand follows an oblique source coast continuously on its land side',()=>{
  const ring=[[-100,-100],[100,-100],[100,20],[-100,-20]],r=coastRibbon([{ring}],[-100,-100,100,100],14,()=>3);
  // Vertical box edges and bottom edge are excluded: only the oblique shore remains.
  assert.ok(r.index.length>0);
  for(let i=0;i<r.pos.length;i+=3){const x=r.pos[i],y=-r.pos[i+2];assert.ok(y-.2*x>-.0001);assert.ok(r.pos[i+1]>3);}
  for(let i=0;i<r.index.length;i+=3){const a=r.index[i]*3,b=r.index[i+1]*3,c=r.index[i+2]*3;const nx=(r.pos[b+2]-r.pos[a+2])*(r.pos[c]-r.pos[a])-(r.pos[b]-r.pos[a])*(r.pos[c+2]-r.pos[a+2]);assert.ok(nx>0,'every strand face points upward');}
});
test('open sea query box creates no artificial sand strand',()=>{const r=coastRibbon([{ring:[[-100,-100],[100,-100],[100,100],[-100,100]]}],[-100,-100,100,100],14,()=>0);assert.equal(r.index.length,0);});
