import assert from 'node:assert/strict';
import * as THREE from 'three';
import {solidWallUnion,type WallVolume} from '../src/walkmode/interior/solidWalls';
import {resolveWallOpenings} from '../src/walkmode/interior/plan/wallOpenings';
import {Batcher} from '../src/walkmode/interior/geom';
import {buildShell} from '../src/walkmode/interior/build';
import {generatePlan} from '../src/walkmode/interior/plan/generate';
import type {Opening,Room} from '../src/walkmode/interior/plan/types';
import type {Palette} from '../src/walkmode/interior/materials';
const material=new THREE.MeshPhysicalMaterial();
const wall=(axis:'x'|'z',at:number,lo:number,hi:number,inward=1):WallVolume=>({axis,at,lo,hi,inward,bottom:0,top:2.4,mat:material,zone:1});
const walls=[wall('x',0,0,4),wall('x',6,0,4,-1),wall('z',0,0,6),wall('z',4,0,6,-1),wall('x',3,0,4),wall('x',3,0,4,-1)];
const batch=new Batcher();solidWallUnion(batch,walls,.075);const meshes=batch.build();meshes.forEach(m=>m.updateMatrixWorld(true));
// A closed solid volume has exactly two triangles meeting along every edge,
// including material seams after vertices are keyed by world position.
const edges=new Map<string,number>();
for(const mesh of meshes){const g=mesh.geometry,p=g.getAttribute('position'),idx=g.getIndex()!;
 const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
 for(let i=0;i<idx.count;i+=3){const t=[key(idx.getX(i)),key(idx.getX(i+1)),key(idx.getX(i+2))];for(let k=0;k<3;k++){const e=[t[k],t[(k+1)%3]].sort().join('|');edges.set(e,(edges.get(e)??0)+1);}}
}
assert.ok([...edges.values()].every(n=>n===2),'wall union must be closed, without cracks or duplicate internal faces');
const ray=new THREE.Raycaster();
for(const origin of [new THREE.Vector3(1,1.2,1),new THREE.Vector3(5,1.2,3)])for(let a=0;a<Math.PI*2;a+=.009){ray.set(origin,new THREE.Vector3(Math.cos(a),0,Math.sin(a)));assert.ok(ray.intersectObjects(meshes).length,'no leak at an exterior corner or T junction');}
meshes.forEach(m=>m.geometry.dispose());
const room=(id:string,rect:Room['rect'],zone:string,type:Room['type']='hall'):Room=>({id,rect,zone,type,label:id});
const rooms=[room('a',[0,0,3,4],'a'),room('b',[3,0,6,2],'b'),room('c',[3,2.4,6,4],'b')];
const wide:Opening={type:'open',a:'a',b:'b',axis:'x',at:3,center:2,width:3,height:2.4,sill:0};
const split=resolveWallOpenings(rooms,[wide],true);
assert.equal(split.length,2);
assert.ok(split.every(o=>!(o.center-o.width/2<2.2&&o.center+o.width/2>2.2)),'missing floor strip must remain a solid wall');
assert.deepEqual(resolveWallOpenings(rooms,split,true),split,'normalization must be stable');
assert.equal(resolveWallOpenings([room('a',[0,0,3,4],'a','bedroom'),room('b',[3,0,6,4],'b')],[wide],true).length,0,'private room must not become a frame-only opening');
assert.equal(resolveWallOpenings(rooms,[{...wide,b:'out'}],true).length,0,'an open decomposition seam cannot become an exterior hole');
const plan=generatePlan({complexId:'wall-test',complexName:'wall test',dong:'101',unitType:'test',area:30});
plan.rooms=rooms;plan.openings=[wide];plan.ceilingHeightM=2.4;plan.imageAnalysis={key:'test',typeName:'test',sourceUrl:'',scaleBasis:'test',elapsedMs:0,start:[1,1,0]};
const palette=new Proxy({}, {get:()=>material}) as Palette;
const B=new Batcher();buildShell(plan,palette,B,new THREE.Group());const shellMeshes=B.build();shellMeshes.forEach(m=>m.updateMatrixWorld(true));
ray.set(new THREE.Vector3(2,1.2,2.2),new THREE.Vector3(1,0,0));
assert.ok(ray.intersectObjects(shellMeshes).some(h=>h.distance<1.1),'an opening spanning a gap must not punch through the exterior');
shellMeshes.forEach(m=>m.geometry.dispose());
plan.rooms=[room('a',[0,0,3,4],'a'),room('b',[3,0,6,4],'b')];plan.openings=[{...wide,type:'sliding_door',width:1.2}];
const SB=new Batcher(),dynamic=new THREE.Group(),shell=buildShell(plan,palette,SB,dynamic);
assert.equal(shell.doors.length,1);assert.equal(shell.doors[0].kind,'slide');assert.equal(shell.doors[0].want,0);
assert.equal(shell.doors[0].fixedSeg,undefined,'a pocket sliding door must not retain a fake fixed half-wall');
dynamic.updateMatrixWorld(true);ray.set(new THREE.Vector3(2,1.2,2),new THREE.Vector3(1,0,0));
assert.ok(ray.intersectObject(dynamic,true).length,'a closed sliding door must have a solid leaf, not only a frame');
SB.build().forEach(m=>m.geometry.dispose());material.dispose();
console.log('wall topology: manifold solid volumes, corners, T junctions, valid opening spans, exterior sealing and solid sliding leaves PASS');
