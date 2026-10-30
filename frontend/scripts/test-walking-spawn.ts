import assert from "node:assert/strict";
import { walkingSpawn, furnitureFootprints } from "../src/walkmode/interior/spawn";
import { generatePlan } from "../src/walkmode/interior/plan/generate";
import type { Seg } from "../src/walkmode/interior/build";
const box=(a:number,b:number,c:number,d:number):Seg[]=>[[a,b,c,b],[c,b,c,d],[c,d,a,d],[a,d,a,b]];
const plan=generatePlan({complexId:"spawn-test",complexName:"독립 검사",dong:"101",unitType:"59",area:59.9,built:1997});
plan.rooms=[{id:"living",type:"living",label:"거실",zone:"living",rect:[0,0,6,5]}];
const walls=box(0,0,6,5),table=box(2.3,1.9,3.7,3.1),sofa=box(.2,1,1.2,4);
const furniture=[...table,...sofa];
assert.equal(furnitureFootprints(furniture).length,2);
const spawn=walkingSpawn(plan,walls,furniture,[],[3,2.5]);assert.ok(spawn);
assert.ok(!(spawn[0]>2&&spawn[0]<4&&spawn[1]>1.6&&spawn[1]<3.4),"must not start inside or next to the coffee table");
for(let t=0;t<=.8;t+=.1){
 const x=spawn[0]-Math.sin(spawn[2])*t,z=spawn[1]-Math.cos(spawn[2])*t;
 assert.ok(!furnitureFootprints(furniture).some(([a,b,c,d])=>x>a-.24&&x<c+.24&&z>b-.24&&z<d+.24));
}
assert.equal(walkingSpawn(plan,walls,box(-1,-1,7,6),[],[3,2.5]),null,"fully blocked floor must not admit a trapped user");
console.log("walking spawn: coffee table interior, body clearance, walking exit and blocked floor PASS");
