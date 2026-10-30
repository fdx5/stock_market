import assert from "node:assert/strict";
import * as THREE from "three";
import { buildShell } from "../src/walkmode/interior/build";
import { Batcher } from "../src/walkmode/interior/geom";
import type { Palette } from "../src/walkmode/interior/materials";
import { generatePlan } from "../src/walkmode/interior/plan/generate";
const material=new THREE.MeshPhysicalMaterial();
const palette=new Proxy({}, {get:()=>material}) as Palette;
const plan=generatePlan({complexId:"shell-test",complexName:"검사",dong:"101",unitType:"59",area:59.9});
plan.rooms=[{id:"a",type:"hall",label:"공간",zone:"one",rect:[0,0,3,4]},{id:"b",type:"hall",label:"공간",zone:"one",rect:[3,0,6,4]}];
plan.openings=[{type:"open",a:"a",b:"b",axis:"x",at:3,center:2,width:4,height:2.7,sill:0}];
plan.imageAnalysis={key:"test",typeName:"test",sourceUrl:"",scaleBasis:"test",elapsedMs:0,start:[1,2,0]};
plan.openings[0].width-=.0001;
const B=new Batcher();const shell=buildShell(plan,palette,B,new THREE.Group());
assert.ok(shell.segments.every(([a,b,c,d])=>Math.hypot(c-a,d-b)>.002),"OCR rounding must not create an invisible collision post");
const meshes=B.build();for(const m of meshes)m.updateMatrixWorld(true);
const ray=new THREE.Raycaster();
for(let z=.2;z<3.9;z+=.1){ray.set(new THREE.Vector3(1,1.2,z),new THREE.Vector3(1,0,0));const hits=ray.intersectObjects(meshes);assert.ok(hits.length);assert.ok(hits[0].distance>4.8,"open decomposition seam must contain no post or wall");}
for(let angle=0;angle<Math.PI*2;angle+=.013){ray.set(new THREE.Vector3(2,1.2,2),new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)));assert.ok(ray.intersectObjects(meshes).length,"exterior corner or seam must not expose outside");}
for(const m of meshes)m.geometry.dispose();material.dispose();
console.log("image shell: continuous open seam and sealed exterior corners PASS");
