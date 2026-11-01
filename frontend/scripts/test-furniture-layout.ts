import assert from 'node:assert/strict';
import * as THREE from 'three';
import {generatePlan} from '../src/walkmode/interior/plan/generate';
import {packBedroom,Placer} from '../src/walkmode/interior/furnish';
import {bedV} from '../src/walkmode/interior/decor';
import {variantOf} from '../src/walkmode/interior/variants';
import type {Palette} from '../src/walkmode/interior/materials';
const plan=generatePlan({complexId:'layout-check',complexName:'QA',dong:'101',unitType:'59',area:59});
plan.rooms=[{id:'bed',zone:'bed',label:'침실',type:'master',rect:[0,0,3.2,3.5]}];
plan.openings=[{a:'bed',b:'out',type:'door',axis:'z',at:3.5,center:.6,width:.8,height:2.1,sill:0,swingInto:'bed'}];
const material=new THREE.MeshBasicMaterial(),P=new Proxy({}, {get:()=>material}) as Palette,C=new Proxy({}, {get:()=>material}) as Parameters<typeof bedV>[4];
for(let c=0;c<64;c++){
 const pl=new Placer(plan.rooms[0],plan),preferred=[1.4,1.6,1.6,1.8][variantOf('case'+c,'bed-size',4)],bed=packBedroom(pl,true,preferred);
 assert.ok(bed,'compact bed must preserve a real door route');
 assert.ok(bed.width<=preferred&&bed.width>=1.2&&bed.clearance>=.50&&bed.way.length);
 for(const variant of [0,1,3,6,7,8,9,10,11]){
  const kit=bedV(P,bed.width,bed.length,variant,C),bounds=new THREE.Box3();
  for(const part of kit){part.g.computeBoundingBox();bounds.union(part.g.boundingBox!.clone().applyMatrix4(bed.frame.m));part.g.dispose();}
  const r=bed.frame.rect;
  assert.ok(bounds.min.x>=r[0]-.01&&bounds.max.x<=r[2]+.01&&bounds.min.z>=r[1]-.01&&bounds.max.z<=r[3]+.01,`bed variant ${variant}: physical model exceeds placement footprint`);
 }
 pl.take(bed.frame.rect);pl.keep(bed.way);
 // All later furniture must respect the protected access path.
 for(const side of ['n','s','w','e'] as const){const wardrobe=pl.against(side,.8,.45,null,2.2,.6);if(wardrobe)assert.ok(pl.free(wardrobe.rect));}
}
material.dispose();console.log('64 furniture configurations: compact sizes, physical bounds for 9 bed models, protected access and wardrobe clearance passed');
