import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {floorPlanFromImage,type ImageAnalysis} from '../src/walkmode/interior/plan/imagePlan';
import {Placer,packKitchen} from '../src/walkmode/interior/furnish';
import * as THREE from 'three';
import {buildShell,wallHalfThickness} from '../src/walkmode/interior/build';
import {Batcher} from '../src/walkmode/interior/geom';
import type {Palette} from '../src/walkmode/interior/materials';
const directory=process.argv[2];assert.ok(directory,'Pass the read-only benchmark output directory');
let count=0,wallRays=0;const failures:string[]=[];
for(const file of readdirSync(directory).filter(n=>n.endsWith('-candidate.json'))){
 const a:ImageAnalysis=JSON.parse(readFileSync(join(directory,file),'utf8'));
 if(a.status!=='ready')continue;
 const plan=floorPlanFromImage({complexId:a.drawing.naverId,complexName:'source QA',dong:'101',unitType:a.drawing.typeName,area:a.drawing.exclusiveArea},a);
 assert.ok(plan,`${file}: source geometry must reach the interior builder`);
 const kitchens=plan.rooms.filter(r=>r.type==='kitchen');assert.ok(kitchens.length,`${file}: kitchen`);
 for(const kitchen of kitchens)if(!packKitchen(new Placer(kitchen,plan)))failures.push(file+':'+kitchen.id);
 for(let i=0;i<plan.rooms.length;i++)for(const b of plan.rooms.slice(i+1)){
  const a=plan.rooms[i];const overlap=Math.max(0,Math.min(a.rect[2],b.rect[2])-Math.max(a.rect[0],b.rect[0]))*Math.max(0,Math.min(a.rect[3],b.rect[3])-Math.max(a.rect[1],b.rect[1]));
  assert.ok(overlap<1e-5,`${file}: room overlap`);
 }
 const materials=new Map<string,THREE.MeshPhysicalMaterial>();
 const palette=new Proxy({}, {get:(_,key)=>{const name=String(key);if(!materials.has(name))materials.set(name,new THREE.MeshPhysicalMaterial({side:THREE.DoubleSide}));return materials.get(name);}}) as Palette;
 const B=new Batcher();buildShell(plan,palette,B,new THREE.Group());const meshes=B.build();meshes.forEach(m=>m.updateMatrixWorld(true));
 const structural=meshes.filter(m=>['wall','wallWet','wallAccent'].some(key=>materials.get(key)===m.material));
 const ray=new THREE.Raycaster(),half=wallHalfThickness(plan),Y=1.2;
 for(const room of plan.rooms)for(const axis of ['x','z'] as const){
  const j=axis==='x'?0:1,k=1-j;if(room.rect[j+2]-room.rect[j]<2*half+.16)continue;
  for(const side of [0,1])for(const fraction of [.18,.5,.82]){
   const at=room.rect[j+side*2],along=room.rect[k]+(room.rect[k+2]-room.rect[k])*fraction;
   // Start in open floor, outside the perpendicular corner volumes. Corners
   // themselves are covered by the manifold and radial junction regression.
   if(Math.min(along-room.rect[k],room.rect[k+2]-along)<half+.025)continue;
   if(plan.openings.some(o=>o.axis===axis&&Math.abs(o.at-at)<.002&&along>=o.center-o.width/2-.01&&along<=o.center+o.width/2+.01&&Y>=o.sill-.01&&Y<=o.sill+o.height+.01))continue;
   const inward=side?-1:1,position=axis==='x'?new THREE.Vector3(at+inward*(half+.05),Y,along):new THREE.Vector3(along,Y,at+inward*(half+.05));
   ray.set(position,axis==='x'?new THREE.Vector3(-inward,0,0):new THREE.Vector3(0,0,-inward));ray.far=.16;
   assert.ok(ray.intersectObjects(structural).length,`${file}: opaque wall missing at ${axis}=${at}, along=${along}`);wallRays++;
  }
 }
 meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());
 count++;
}
assert.ok(count>0);console.log(`source-image interiors: ${count} plans; ${wallRays} opaque-wall rays; kitchen failures: ${JSON.stringify(failures)}`);
assert.deepEqual(failures,[],'Every tested interior must fit its essential kitchen appliances');
