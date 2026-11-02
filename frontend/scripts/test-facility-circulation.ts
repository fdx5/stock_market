import assert from 'node:assert/strict';
import { Placer } from '../src/walkmode/interior/furnish';
import { walkingSpawn, furnitureFootprints } from '../src/walkmode/interior/spawn';
import { moveThroughGaps } from '../src/walkmode/interior/movement';
import { generatePlan } from '../src/walkmode/interior/plan/generate';
import type { Seg } from '../src/walkmode/interior/build';

// The hospital's shared-link entrance is a 2.5 × 3.5 m lobby piece. The former
// reception footprint enclosed its start and stopped every attempt to leave.
const plan=generatePlan({complexId:'facility-circulation',complexName:'통행 검사',dong:'',unitType:'test',area:25});
plan.rooms=[{id:'lobby',type:'lobby',label:'로비',zone:'lobby',rect:[0,0,2.5,3.5]},
  {id:'hall',type:'corridor',label:'복도',zone:'hall',rect:[0,3.5,2.5,10]}];
plan.bounds=[0,0,2.5,10];
plan.facility={kind:'clinic',name:'병원',level:1,levelLabel:'1층',use:'의료시설',start:[1.3,1.2,-Math.PI],lifts:[],people:[]};
plan.openings=[{type:'front_door',a:'lobby',b:'out',axis:'z',at:0,center:1.3,width:1.8,height:2.4,sill:0},
  {type:'open',a:'lobby',b:'hall',axis:'z',at:3.5,center:1.25,width:2.5,height:3.25,sill:0}];
const placer=new Placer(plan.rooms[0],plan);
assert.equal(placer.against('w',2.15,2.25,null,3),null,'reception must not seal a small entrance lobby');
assert.equal(placer.free([.075,.675,2.325,2.825]),false,'the old trapping footprint must be refused');
const walls:Seg[]=[[0,0,2.5,0],[0,0,0,10],[2.5,0,2.5,10],[0,10,2.5,10]];
const safe=walkingSpawn(plan,walls,[],[],[1.3,1.2]);
assert.deepEqual(safe,plan.facility.start,'a clear facility entrance retains its position and facing');
const end=moveThroughGaps([safe![0],safe![1]],[1.3,7],walls);
assert.deepEqual(end,[1.3,7],'the visitor can leave the lobby for the corridor');

const box=(a:number,b:number,c:number,d:number):Seg[]=>[[a,b,c,b],[c,b,c,d],[c,d,a,d],[a,d,a,b]];
const reception=box(.075,.675,2.325,2.825);
const recovered=walkingSpawn(plan,walls,reception,[],[1.3,1.2]);
assert.ok(recovered,'overlap recovery must also support public buildings');
assert.ok(!furnitureFootprints(reception).some(([a,b,c,d])=>recovered![0]>a-.3&&recovered![0]<c+.3&&recovered![1]>b-.3&&recovered![1]<d+.3));
const forward:[number,number]=[recovered![0]-Math.sin(recovered![2])*.8,recovered![1]-Math.cos(recovered![2])*.8];
const escaped=moveThroughGaps([recovered![0],recovered![1]],forward,[...walls,...reception]);
assert.ok(Math.hypot(escaped[0]-forward[0],escaped[1]-forward[1])<1e-6,'recovered start must offer a usable walking exit');
const closedDoor:Seg=[0,3.5,2.5,3.5];
assert.ok(moveThroughGaps([1.3,1.2],[1.3,7],[...walls,closedDoor])[1]<3.5,'real closed doors remain solid');
console.log('facility circulation: hospital entrance, reception clearance, corridor exit, overlap recovery and closed-door collision PASS');
