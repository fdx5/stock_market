import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
const load=name=>{const scope={module:{exports:{}},exports:{},THREE};vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8').replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;};
const {constrainRoadCorridors}=load('roadCorridors.ts'),{excludeSurface}=load('surfaceExclusion.ts');
const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
test('a clear surveyed road keeps its centreline, width and lane count',()=>{
 const road={line:[[-50,0],[50,0]],width:26.7,lanes:4};assert.equal(constrainRoadCorridors([road],[rectangle(-5,20,5,30)])[0],road);
});
test('registered excessive width is constrained by measured buildings without moving either',()=>{
 const road={line:[[-50,0],[50,0]],width:26.7,lanes:4},ring=rectangle(-20,7.16,20,20),before=JSON.stringify(ring);
 const [fixed]=constrainRoadCorridors([road],[ring]);assert.equal(fixed.line,road.line);assert.equal(fixed.lanes,4);assert.ok(Math.abs(fixed.width-13.82)<1e-7);assert.equal(JSON.stringify(ring),before);
});
test('an impossible school crossing excludes only obstructed sections and invents no detour',()=>{
 const ring=rectangle(-5,-5,5,5),out=constrainRoadCorridors([{line:[[-40,0],[40,0]],width:10.1,lanes:1}],[ring]);
 assert.equal(out.length,2);for(const r of out){assert.equal(r.width,3.3);assert.ok(r.line.every(p=>p[1]===0));assert.ok(r.line.every(p=>Math.abs(p[0])>=7.4));}assert.equal(out[0].line[0][0],-40);assert.equal(out[1].line.at(-1)[0],40);
});
const area=g=>{const p=g.getAttribute('position');let sum=0;for(let i=0;i<p.count;i+=3)sum+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i)))/2;return sum;};
test('exact clipping removes a building footprint and preserves UV interpolation',async()=>{
 const g=new THREE.PlaneGeometry(10,10).rotateX(-Math.PI/2);await excludeSurface(g,[rectangle(-2,-2,2,2)],async()=>true);
 assert.ok(Math.abs(area(g)-84)<1e-6);const p=g.getAttribute('position'),uv=g.getAttribute('uv');for(let i=0;i<p.count;i++){assert.ok(Math.abs(uv.getX(i)-(p.getX(i)/10+.5))<1e-6);assert.ok(Math.abs(uv.getY(i)-(-p.getZ(i)/10+.5))<1e-6);}g.dispose();
});
test('a boundary touch retains the original indexed mesh and avoids geometry growth',async()=>{
 const g=new THREE.PlaneGeometry(10,10).rotateX(-Math.PI/2),idx=g.index,pos=g.getAttribute('position');await excludeSurface(g,[rectangle(5,-2,9,2)],async()=>true);assert.equal(g.index,idx);assert.equal(g.getAttribute('position'),pos);g.dispose();
});
