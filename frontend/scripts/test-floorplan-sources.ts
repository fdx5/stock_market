import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {floorPlanFromImage,type ImageAnalysis} from '../src/walkmode/interior/plan/imagePlan';
import {Placer,packKitchen,packBathroom,packBedroom} from '../src/walkmode/interior/furnish';
import {fixturesFor} from '../src/walkmode/interior/plan/generate';
import * as THREE from 'three';
import {buildShell,wallHalfThickness} from '../src/walkmode/interior/build';
import {Batcher} from '../src/walkmode/interior/geom';
import type {Palette} from '../src/walkmode/interior/materials';
const directory=process.argv[2];assert.ok(directory,'Pass the read-only benchmark output directory');
let count=0,wallRays=0,bathrooms=0,beds=0,doorLiners=0;const failures:string[]=[];
for(const file of readdirSync(directory).filter(n=>n.endsWith('-candidate.json'))){
 const a:ImageAnalysis=JSON.parse(readFileSync(join(directory,file),'utf8'));
 if(a.status!=='ready')continue;
 const plan=floorPlanFromImage({complexId:a.drawing.naverId,complexName:'source QA',dong:'101',unitType:a.drawing.typeName,area:a.drawing.exclusiveArea},a);
 assert.ok(plan,`${file}: source geometry must reach the interior builder`);
 const kitchens=plan.rooms.filter(r=>r.type==='kitchen');assert.ok(kitchens.length,`${file}: kitchen`);
 for(const kitchen of kitchens)if(!packKitchen(new Placer(kitchen,plan)))failures.push(file+':'+kitchen.id);
 for(const room of plan.rooms.filter(r=>r.type==='master'||r.type==='bedroom')){
  const pl=new Placer(room,plan),bed=packBedroom(pl,room.type==='master',room.type==='master'?1.6:1.1);
  assert.ok(bed,`${file}:${room.id}: compact bed must have access`);
  const r=bed.frame.rect,zone=plan.rooms.filter(v=>v.zone===room.zone),area=(r[2]-r[0])*(r[3]-r[1]);
  const covered=zone.reduce((s,v)=>s+Math.max(0,Math.min(r[2],v.rect[2])-Math.max(r[0],v.rect[0]))*Math.max(0,Math.min(r[3],v.rect[3])-Math.max(r[1],v.rect[1])),0);
  assert.ok(Math.abs(covered-area)<1e-4&&bed.way.length,'bed must stay on the actual source floor and have an accessible side');beds++;
 }
 for(const room of plan.rooms.filter(r=>r.type==='bathroom'||r.type==='ensuite')){
  const pl=new Placer(room,plan),layout=packBathroom(pl);
  assert.ok(layout,`${file}:${room.id}: toilet and shower must fit`);
  const zone=plan.rooms.filter(r=>r.id===room.id||(room.zone&&r.zone===room.zone));
  const local={...plan,openings:plan.openings.filter(o=>!(o.type==='open'&&zone.some(r=>r.id===o.a)&&zone.some(r=>r.id===o.b)))};
  assert.ok(zone.some(r=>new Placer(r,local).free(layout.toilet.rect)),`${file}: toilet intersects doorway or boundary`);
  for(const rect of [layout.toilet.rect,layout.shower.rect])assert.ok(zone.some(r=>{const p=new Placer(r,plan);return rect[0]>=p.X0-.005&&rect[2]<=p.X1+.005&&rect[1]>=p.Z0-.005&&rect[3]<=p.Z1+.005;}),`${file}: fixture crosses room boundary`);
  const markers=fixturesFor(plan).filter(f=>f.room===room.id);
  assert.ok(markers.some(f=>f.type==='toilet')&&markers.some(f=>f.type==='shower'),`${file}: semantic bathroom essentials`);
  bathrooms++;
 }
 for(let i=0;i<plan.rooms.length;i++)for(const b of plan.rooms.slice(i+1)){
  const a=plan.rooms[i];const overlap=Math.max(0,Math.min(a.rect[2],b.rect[2])-Math.max(a.rect[0],b.rect[0]))*Math.max(0,Math.min(a.rect[3],b.rect[3])-Math.max(a.rect[1],b.rect[1]));
  assert.ok(overlap<1e-5,`${file}: room overlap`);
 }
 const materials=new Map<string,THREE.MeshPhysicalMaterial>();
 const palette=new Proxy({}, {get:(_,key)=>{const name=String(key);if(!materials.has(name))materials.set(name,new THREE.MeshPhysicalMaterial({side:THREE.DoubleSide}));return materials.get(name);}}) as Palette;
 const B=new Batcher();const shell=buildShell(plan,palette,B,new THREE.Group());const meshes=B.build();meshes.forEach(m=>m.updateMatrixWorld(true));
 if(shell.removedPosts.length)console.log(file,'removed unsupported fragments',JSON.stringify(shell.removedPosts));
 const structural=meshes.filter(m=>['wall','wallWet','wallAccent'].some(key=>materials.get(key)===m.material));
 const ray=new THREE.Raycaster(),half=wallHalfThickness(plan),Y=1.2;
 for(const o of plan.openings.filter(o=>['door','sliding_door','front_door','glass_door'].includes(o.type)))for(const sign of [1,-1]){
  const edge=o.center-sign*o.width/2,along=edge+sign*.025;
  const origin=o.axis==='z'?new THREE.Vector3(along,Y,o.at):new THREE.Vector3(o.at,Y,along);
  ray.set(origin,o.axis==='z'?new THREE.Vector3(-sign,0,0):new THREE.Vector3(0,0,-sign));ray.far=.07;
  const walls=ray.intersectObjects(structural);if(!walls.length)continue;
  const trim=ray.intersectObjects(meshes.filter(m=>m.material===materials.get('doorFrame')));if(!trim.length)continue;
  const frame=materials.get('doorFrame')!;
  assert.ok(Math.abs(walls[0].distance-trim[0].distance)>=.002||(frame.polygonOffset&&frame.polygonOffsetFactor<0&&frame.polygonOffsetUnits<0),`${file}: unprotected coplanar door trim`);doorLiners++;
 }
 for(const w of shell.removedPosts){
  if(w.hi-w.lo<.002||w.bottom>Y||w.top<Y)continue;
  const mid=(w.lo+w.hi)/2;
  for(const offset of [-half,half])assert.ok(!shell.segments.some(s=>w.axis==='x'
   ?Math.abs(s[0]-w.at-offset)<.001&&Math.abs(s[2]-w.at-offset)<.001&&mid>Math.min(s[1],s[3])+.001&&mid<Math.max(s[1],s[3])-.001
   :Math.abs(s[1]-w.at-offset)<.001&&Math.abs(s[3]-w.at-offset)<.001&&mid>Math.min(s[0],s[2])+.001&&mid<Math.max(s[0],s[2])-.001),`${file}: removed post collision survived`);
  for(const side of [-1,1]){
   const p=w.axis==='x'?new THREE.Vector3(w.at+side*(half+.025),.2,mid):new THREE.Vector3(mid,.2,w.at+side*(half+.025));
   ray.set(p,new THREE.Vector3(0,-1,0));ray.far=.5;
   assert.ok(ray.intersectObjects(meshes).length,`${file}: removing an interior post must not leave a floor hole`);
  }
 }
 for(const room of plan.rooms)for(const axis of ['x','z'] as const){
  const j=axis==='x'?0:1,k=1-j;if(room.rect[j+2]-room.rect[j]<2*half+.16)continue;
  for(const side of [0,1])for(const fraction of [.18,.5,.82]){
   const at=room.rect[j+side*2],along=room.rect[k]+(room.rect[k+2]-room.rect[k])*fraction;
   if(shell.removedPosts.some(w=>w.axis===axis&&Math.abs(w.at-at)<.002&&along>=w.lo-.001&&along<=w.hi+.001&&Y>=w.bottom&&Y<=w.top))continue;
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
assert.ok(count>0);console.log(`source-image interiors: ${count} plans; ${bathrooms} complete bathrooms; ${beds} accessible beds; ${doorLiners} separated door liners; ${wallRays} opaque-wall rays; kitchen failures: ${JSON.stringify(failures)}`);
assert.deepEqual(failures,[],'Every tested interior must fit its essential kitchen appliances');
