import assert from 'node:assert/strict';
import {moveThroughGaps,passageNear} from '../src/walkmode/interior/movement';
import type {Seg} from '../src/walkmode/interior/build';
for(const gap of [.45,.2,.05,.01,.001]){
 const walls:Seg[]=[[0,0,0,2],[gap,0,gap,2]];
 const p=moveThroughGaps([gap/2,.1],[gap/2,1.9],walls);
 assert.ok(Math.abs(p[1]-1.9)<1e-9,`${gap}m passage blocked`);
 assert.ok(passageNear(...p,walls)<gap/2,'camera near plane must fit the passage');
 const door:Seg=[0,1,gap,1];
 assert.ok(moveThroughGaps([gap/2,.1],[gap/2,1.9],[...walls,door])[1]<1,'closed door must stop the user');
}
const wall:Seg=[0,-5,0,5];
assert.ok(moveThroughGaps([-1,0],[10,0],[wall])[0]<0,'long frame tunnels through wall');
const slide=moveThroughGaps([-1,0],[1,2],[wall]);
assert.ok(slide[0]<0&&Math.abs(slide[1]-2)<1e-6,'wall should allow sliding');
const corner:Seg[]=[[0,-3,0,0],[-3,0,0,0]];
const p=moveThroughGaps([-1,-1],[2,2],corner);
assert.ok(p[0]<0&&p[1]<0,'corner crossing');
const chair:Seg[]=[[0,0,1,0],[1,0,1,1],[1,1,0,1],[0,1,0,0]];
assert.ok(moveThroughGaps([-.5,.5],[1.5,.5],chair)[0]<0,'solid furniture crossing');
console.log('narrow movement: 5 passage widths through 1mm; closed doors, continuous walls, furniture, corners, sliding and camera clearance passed');
