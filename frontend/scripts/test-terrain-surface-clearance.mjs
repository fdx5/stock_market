import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/terrainSurfaceClearance.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const rules=scope.module.exports.terrainSurfaceClearance();
const grid={n:2,R:2,cell:4,ox:2,oy:2,h:new Float32Array([2,0,0,2])};
const input=(z=.08,level=0)=>({position:new Float32Array([0,0,2+z,4,0,z,4,4,2+z,0,4,z]),normal:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),index:new Uint32Array([0,1,3,1,2,3]),level:new Float32Array([level,level,level,level])});
const height=(s,x,y,reference=0)=>rules.index(s).height(x,y,reference);
const terrain=(x,y)=>x>=y?2*(1-x/4)+2*y/4:2*(1-y/4)+2*x/4;
test('opposite ground/road diagonals bury the original asphalt, and exact partition fixes the entire overlap',()=>{
 const a=input(),b=rules.drape(a,grid);assert.ok(height(a,2,2)<terrain(2,2)-1);assert.ok(b.index.length>a.index.length);
 for(let y=.05;y<4;y+=.1)for(let x=.05;x<4;x+=.1)assert.ok(height(b,x,y)>=terrain(x,y)+.01999,`${x},${y}`);
 assert.equal(a.position[5],Math.fround(.08));assert.ok(b.position.every(Number.isFinite));
});
test('safe planes and already elevated bridges return their exact original buffers without geometry growth',()=>{
 const a=input(3,1),b=rules.drape(a,grid);assert.equal(b,a);assert.equal(b.position,a.position);assert.equal(b.index,a.index);
 const flat={...grid,h:new Float32Array(4)},c=input();c.position=new Float32Array([0,0,.08,4,0,.08,4,4,.08,0,4,.08]);assert.equal(rules.drape(c,flat),c);
});
test('near/far paint and traffic use the corrected pavement, with colours and all source attributes retained',()=>{
 const asphalt=rules.drape(input(),grid),paint=input(.16);paint.color=new Float32Array([1,1,1,1,1,1,1,1,1,1,1,1]);const p=rules.drape(paint,grid,.16),lookup=rules.index(asphalt);rules.raisePaint(p,asphalt,lookup);
 for(let y=.05;y<4;y+=.15)for(let x=.05;x<4;x+=.15)assert.ok(height(p,x,y)>=height(asphalt,x,y)+.01499);
 assert.equal(p.color.length,p.position.length);assert.ok(p.color.every(v=>Math.abs(v-1)<1e-6));assert.equal(p.normal.length,p.position.length);assert.equal(p.level.length,p.position.length/3);assert.ok(Math.abs(lookup.height(2,2,.08)-2.02)<1e-5);
});
test('ground road paint never jumps to a crossing bridge deck',()=>{
 const a=input(8,1),p=input(.16);const before=Array.from(p.position);rules.raisePaint(p,a,rules.index(a));assert.deepEqual(Array.from(p.position),before);
});
test('traffic segments follow corrected pavement between vertices without changing their horizontal route',()=>{
 const lookup=rules.index(rules.drape(input(),grid)),points=lookup.trace([0,2,.08],[4,2,.08]);assert.ok(points.length>6);
 for(let i=0;i<points.length;i+=3){assert.ok(Math.abs(points[i+1]-2)<1e-8);if(!i)continue;
  for(const t of [.25,.5,.75]){const x=points[i-3]*(1-t)+points[i]*t,z=points[i-1]*(1-t)+points[i+2]*t;assert.ok(Math.abs(z-lookup.height(x,2,.08))<1e-5);}}
 assert.ok(lookup.trace([0,0,.08],[4,4,2.08]).every(Number.isFinite));
});
test('missing surfaces and geometry beyond the supplied grid are preserved',()=>{
 assert.equal(rules.drape(null,grid),null);const a=input();for(let i=0;i<a.position.length;i+=3)a.position[i]+=100;assert.equal(rules.drape(a,grid),a);
});
