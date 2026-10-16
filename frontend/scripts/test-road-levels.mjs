import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const read=n=>readFileSync(new URL('../src/components/'+n,import.meta.url),'utf8');
function load(n,extra={}){const scope={module:{exports:{}},exports:{},THREE,performance,frameSlice:async()=>{},onSceneMemoryRelease(){},paintedTexture:async()=>new THREE.Texture(),...extra};vm.runInNewContext(transformSync(read(n).replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);return scope.module.exports;}
const levels=load('roadLevels.ts',{...load('surfaceGeometry.ts'),...load('roadGroundGrade.ts')}),network=load('roadTrafficNetwork.ts',levels),junction=load('roadJunctions.ts',levels);
const street=load('sceneStreet.ts',{...levels,...junction,...load('roadLanes.ts'),...load('surfaceGeometry.ts')});
const {drapeRoadSurface,roadSurfaceHeight,raiseRoadPaint}=load('roadDrape.ts');
const {waterField,fieldFrom,waterSurface,withSeaLevel}=load('waterCore.ts',{inRing:pointIn});
function pointIn([x,y],r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>y)!==(r[j][1]>y)&&x<(r[j][0]-r[i][0])*(y-r[i][1])/(r[j][1]-r[i][1])+r[i][0])inside=!inside;return inside;}
test('boats and wakes follow the sea datum in tidal overlap while inland river levels stay intact',()=>{
 const river={level:()=>5,wet:()=>true,bounds:{x0:-20,y0:-20,x1:20,y1:20}},sea={level:()=>0,wet:x=>x>=0};let current=null;
 const field=withSeaLevel(river,()=>current);assert.equal(field.level(8,0),5);
 current=sea;assert.equal(field.level(8,0),0);assert.equal(field.level(-8,0),5);
 current={...sea,level:()=>1};assert.equal(field.level(8,0),1);
 assert.equal(river.level(8,0),5);assert.equal(field.bounds,river.bounds);
});
const road=(line,structure='ground')=>({line,width:12,lanes:4,structure,layer:structure==='bridge'?1:structure==='underpass'?-1:0});
test('true planar mode never connects a bridge or underpass to the road below/above',()=>{
 const roads=[road([[-40,0],[40,0]],'bridge'),road([[0,-40],[0,40]]),road([[-40,-40],[40,40]],'underpass')];
 assert.equal(network.splitRoadJunctions(roads,true).length,3);
 const ground=network.splitRoadJunctions(roads.slice(0,2).map(r=>({...r,layer:0,structure:'ground'})),true);assert.equal(ground.length,4);
 assert.equal(network.splitRoadJunctions(roads.slice(0,2).map(r=>({...r,layer:1,structure:'bridge'})),true).length,2,'bridge category alone is no proof of shared height');
});
test('two different bridge profiles retain their own paint and tyre heights even at the same ordinal level',async()=>{
 const roads=[{...road([[-20,0],[20,0]],'bridge'),link_id:'lower'},{...road([[0,-20],[0,20]],'bridge'),link_id:'upper'}],t={at:()=>0,roadAt:r=>r.link_id==='lower'?6:12};
 const asphalt=await street.buildRoadSurface(roads,t),paint=await street.buildRoadMarkings(roads,t),at=roadSurfaceHeight(asphalt.group.geometry);
 assert.ok(Math.abs(at(0,0,6,1,'lower')-6.08)<1e-5);assert.ok(Math.abs(at(0,0,12,1,'upper')-12.08)<1e-5);
 for(const mesh of paint.group.children){await raiseRoadPaint(mesh.geometry,asphalt.group.geometry,async()=>true);const p=mesh.geometry.attributes.position,ids=mesh.geometry.attributes.roadProfile;for(let k=0;k<p.count;k++)assert.ok(Math.abs(p.getY(k)-(ids.getX(k)===0?6.115:12.115))<1e-5);}
 asphalt.dispose();paint.dispose();
});
test('a shared approach endpoint connects to the bank but an interior crossing cannot',()=>{
 const bridge=road([[-20,0],[0,0]],'bridge'),bank=road([[0,0],[20,0]]),under=road([[0,-20],[0,20]]);
 assert.equal(levels.roadEndsConnect(bridge,bank,0,0),true);assert.equal(levels.roadEndsConnect(bridge,under,0,0),false);
});
test('a manual vehicle below a parallel bridge retains its own level and can leave a bridge at a bank',()=>{
 const roads=[road([[-20,0],[20,0]]),road([[-20,0],[20,0]],'bridge')],t={at:()=>0,roadAt:r=>r.layer===1?8:0};
 assert.equal(levels.vehicleRoad(roads,t,{x:0,y:0,z:.08,hx:1,hy:0,road:0}),0);
 assert.equal(levels.vehicleRoad(roads,t,{x:0,y:0,z:8.08,hx:1,hy:0,road:1}),1);
 const approach=[road([[-20,0],[0,0]],'bridge'),road([[0,0],[20,0]])];assert.equal(levels.vehicleRoad(approach,{at:()=>0},{x:1,y:0,z:0,hx:1,hy:0,road:0}),1);
});
test('structure boundaries split a surveyed polyline without moving its coordinates',()=>{
 const links=[{id:'a',line:[[-40,0],[-8,0]],structure:'ground'},{id:'b',line:[[-8,0],[8,0]],structure:'bridge'},{id:'c',line:[[8,0],[40,0]],structure:'ground'}];
 const out=levels.attachRoadStructures([road([[-40,0],[40,0]])],links);
 assert.equal(out.filter(r=>r.structure==='bridge').length,1);assert.ok(out.every(r=>r.line.every(p=>p[1]===0)));
 assert.equal(out[0].line[0][0],-40);assert.equal(out.at(-1).line.at(-1)[0],40);
});
test('crossing directions and ambiguous parallel structure feeds do not borrow the bridge layer',()=>{
 const r=road([[-40,0],[40,0]]),out=levels.attachRoadStructures([r],[{id:'cross',line:[[0,-50],[0,50]],structure:'bridge'}]);
 assert.ok(out.every(r=>r.structure==='unknown'));
 const ambiguous=levels.attachRoadStructures([r],[{id:'bridge',line:[[-50,1],[50,1]],structure:'bridge'},{id:'ground',line:[[-50,-1],[50,-1]],structure:'ground'}]);assert.ok(ambiguous.every(r=>r.structure==='unknown'));
});
test('tyres and paint query their own road level at an overlapping XY coordinate',async()=>{
 const roads=[road([[-20,0],[20,0]]),road([[0,-20],[0,20]],'bridge')],terrain={at:()=>0,roadAt:r=>r.layer===1?8:0};
 const asphalt=await street.buildRoadSurface(roads,terrain),paint=await street.buildRoadMarkings(roads,terrain);
 const at=roadSurfaceHeight(asphalt.group.geometry);assert.ok(Math.abs(at(0,0,0,0)-.08)<1e-6);assert.ok(Math.abs(at(0,0,8,1)-8.08)<1e-6);
 for(const mesh of paint.group.children){await raiseRoadPaint(mesh.geometry,asphalt.group.geometry,async()=>true);const p=mesh.geometry.attributes.position,l=mesh.geometry.attributes.roadLevel;assert.equal(p.count,l.count);for(let k=0;k<p.count;k++)assert.ok(Math.abs(p.getY(k)-(l.getX(k)===1?8.115:.115))<1e-5);}
 asphalt.dispose();paint.dispose();
});
test('ground subdivision preserves the road level on every newly generated vertex',async()=>{
 const g=new THREE.PlaneGeometry(20,20,2,2),p=g.attributes.position;g.userData.grid={xs:Float64Array.from([-10,0,10]),ys:Float64Array.from([10,0,-10])};for(let i=0;i<p.count;i++)p.setZ(i,p.getX(i)===0?2:0);
 const road=new THREE.BufferGeometry();road.setAttribute('position',new THREE.Float32BufferAttribute([-9,.08,8,9,.08,8,0,.08,-8],3));road.setAttribute('roadLevel',new THREE.Float32BufferAttribute([0,0,0],1));await drapeRoadSurface(road,g,async()=>true);
 assert.ok(road.attributes.position.count>3);assert.equal(road.attributes.position.count,road.attributes.roadLevel.count);assert.ok([...road.attributes.roadLevel.array].every(v=>v===0));g.dispose();road.dispose();
});
test('a confirmed bridge keeps its continuous plane instead of stretching onto unrelated terrain',async()=>{
 const ground=new THREE.PlaneGeometry(20,20,2,2);ground.userData.grid={xs:Float64Array.from([-10,0,10]),ys:Float64Array.from([10,0,-10])};
 for(let i=0;i<ground.attributes.position.count;i++)ground.attributes.position.setZ(i,20);
 const values=[-9,5,8,9,5,8,0,5,-8],road=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(values,3)).setAttribute('roadLevel',new THREE.Float32BufferAttribute([1,1,1],1));
 await drapeRoadSurface(road,ground,async()=>true);assert.deepEqual(Array.from(road.attributes.position.array),values);assert.equal(road.attributes.roadLevel.count,3);
 const {terrainSurfaceClearance}=load('terrainSurfaceClearance.ts'),clearance=terrainSurfaceClearance(),p=Float32Array.from([-9,-8,5,9,-8,5,0,8,5]);
 const input={position:p,normal:Float32Array.from([0,0,1,0,0,1,0,0,1]),index:Uint32Array.from([0,1,2]),level:Float32Array.from([1,1,1])};
 const result=clearance.drape(input,{h:new Float32Array(9).fill(20),n:3,R:10,cell:10,ox:0,oy:0});
 assert.deepEqual(Array.from(result.position),Array.from(p));ground.dispose();road.dispose();
});
test('river clipping retains true intersections, and islands remain dry in the field and surface',async()=>{
 const outer=[[-40,-40],[40,-40],[40,40],[-40,40]],hole=[[-6,-6],[6,-6],[6,6],[-6,6]];
 const clipped=levels.clipRoadContextRing(outer,20);assert.equal(clipped.length,4);assert.ok(clipped.every(p=>Math.abs(p[0])===20&&Math.abs(p[1])===20));
 const data=await waterField([clipped],()=>0,async()=>true,[hole]),field=fieldFrom(data,()=>0);assert.equal(field.wet(0,0),false);assert.equal(field.wet(12,0),true);
 const surface=await waterSurface([clipped],field,async()=>true,[hole]);for(let k=0;k<surface.index.length;k+=3){const ids=[...surface.index.slice(k,k+3)],x=ids.reduce((s,i)=>s+surface.pos[i*3],0)/3,y=-ids.reduce((s,i)=>s+surface.pos[i*3+2],0)/3;assert.equal(pointIn([x,y],hole),false);}
});
