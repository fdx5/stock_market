import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
const dir=await mkdtemp(join(tmpdir(),'sea-ground-'));
const result=await build({entryPoints:['src/components/seaGroundGeometry.ts','src/components/coastField.ts'],bundle:true,write:false,platform:'node',format:'esm',outdir:dir});
for(const f of result.outputFiles)await writeFile(f.path,f.text,{flag:'wx'});
const {sinkSeaGeometry,waterOutsideCoast}=await import(pathToFileURL(join(dir,'seaGroundGeometry.js')));
const {coastField}=await import(pathToFileURL(join(dir,'coastField.js')));
const plane=()=>{const g=new THREE.PlaneGeometry(20,20,2,2),p=g.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,3+p.getX(i)*.03);return g;};
const data={rings:[[[-10,-10],[10,-10],[10,3],[-10,-3]]],holes:[],open:[-10,-10,10,10],level:0,seaOnly:true};
function check(source,d,offset=0){const before=JSON.stringify(source.toJSON()),g=sinkSeaGeometry(source,d,offset),f=coastField(d),p=g.attributes.position;let wet=0,dry=0,total=0;
 for(let k=0;k<g.index.count;k+=3){const v=[0,1,2].map(j=>g.index.getX(k+j)),x=v.reduce((s,i)=>s+p.getX(i),0)/3,y=v.reduce((s,i)=>s+p.getY(i),0)/3,area=Math.abs((p.getX(v[1])-p.getX(v[0]))*(p.getY(v[2])-p.getY(v[0]))-(p.getY(v[1])-p.getY(v[0]))*(p.getX(v[2])-p.getX(v[0])))/2;total+=area;
  if(f.wet(x,y)){wet+=area;for(const i of v)assert.ok(p.getZ(i)+offset<=d.level-.59999,'whole wet face below sea');}
  else{dry+=area;for(const i of v)assert.ok(Math.abs(p.getZ(i)-(3+p.getX(i)*.03))<1e-5,'dry coastline height unchanged');}
 }
 assert.equal(JSON.stringify(source.toJSON()),before);assert.ok(Math.abs(total-400)<1e-4);assert.ok(wet>0&&dry>0);return {g,wet,dry};}
test('diagonal coast splits triangle interiors instead of leaving elevated green wedges',()=>{const r=check(plane(),data);assert.ok(Math.abs(r.wet-200)<1e-4);});
test('island wholly within a coarse triangle retains its original land height',()=>{const d={...data,rings:[[[-10,-10],[10,-10],[10,10],[-10,10]]],holes:[[[-1,-1],[1,-1],[1,1],[-1,1]]]};const r=check(plane(),d);assert.ok(Math.abs(r.dry-4)<1e-4);});
test('lowered horizon uses world-height offset; source UVs and finite normals survive',()=>{const {g}=check(plane(),data,-30);assert.ok(g.attributes.uv.array.every(Number.isFinite));assert.ok(g.attributes.normal.array.every(Number.isFinite));});
test('translated streamed tile and initial ground classify the same exact shore',()=>{const g=plane(),p=g.attributes.position;for(let i=0;i<p.count;i++){p.setX(i,p.getX(i)+340);p.setY(i,p.getY(i)-680);}const d={...data,rings:data.rings.map(r=>r.map(([x,y])=>[x+340,y-680])),open:[330,-690,350,-670]};const r=sinkSeaGeometry(g,d),q=r.attributes.position,f=coastField(d);for(let k=0;k<r.index.count;k+=3){const ids=[0,1,2].map(j=>r.index.getX(k+j));const x=ids.reduce((s,i)=>s+q.getX(i),0)/3,y=ids.reduce((s,i)=>s+q.getY(i),0)/3;if(f.wet(x,y))for(const i of ids)assert.ok(q.getZ(i)<=-.59999);}});
test('tidal overlap is removed exactly while inland river height, UVs and source geometry survive',()=>{
 const g=plane();g.rotateX(-Math.PI/2);const before=JSON.stringify(g.toJSON()),matrix=new THREE.Matrix4().makeTranslation(100,0,-200);
 const d={...data,rings:data.rings.map(r=>r.map(([x,y])=>[x+100,y+200])),open:[90,190,110,210]},out=waterOutsideCoast(g,d,matrix),p=out.attributes.position,f=coastField(d);let area=0;
 for(let k=0;k<out.index.count;k+=3){const ids=[0,1,2].map(j=>out.index.getX(k+j)),x=ids.reduce((s,i)=>s+p.getX(i),0)/3,y=ids.reduce((s,i)=>s-p.getZ(i),0)/3;
  assert.equal(f.wet(x+100,y+200),false);
  for(const i of ids)assert.ok(Math.abs(p.getY(i)-(3+p.getX(i)*.03))<1e-5);
  const [a,b,c]=ids;area+=Math.abs((p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a)))/2;
 }
 assert.ok(Math.abs(area-200)<1e-4);assert.equal(JSON.stringify(g.toJSON()),before);assert.ok(out.attributes.uv.array.every(Number.isFinite));
});
