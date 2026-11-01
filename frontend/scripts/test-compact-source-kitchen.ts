import assert from 'node:assert/strict';
import {Placer,packKitchen} from '../src/walkmode/interior/furnish';
import type {FloorPlan} from '../src/walkmode/interior/plan/types';
const plan={rooms:[{id:'kitchen',type:'kitchen',zone:'k',rect:[0,1,.78,2.58]},{id:'tail',type:'hall',zone:'k',rect:[0,2.58,.78,3.18]},{id:'living',type:'living',zone:'l',rect:[.78,1,6,3.9]}],openings:[{a:'kitchen',b:'living',type:'open',axis:'x',at:.78,center:1.79,width:1.54,height:2.7,sill:0}],imageAnalysis:{wallThicknessMetres:.0882}} as FloorPlan;
const found=packKitchen(new Placer(plan.rooms[0],plan));assert.ok(found,'source kitchenette must fit its original same-zone alcove');
assert.notEqual(found.side,'e','the counter must face the open living space, backed by the actual wall');
for(const r of [found.run.rect,found.fridge.rect]){const area=(r[2]-r[0])*(r[3]-r[1]),covered=plan.rooms.filter(v=>v.zone==='k').reduce((s,v)=>s+Math.max(0,Math.min(r[2],v.rect[2])-Math.max(r[0],v.rect[0]))*Math.max(0,Math.min(r[3],v.rect[3])-Math.max(r[1],v.rect[1])),0);assert.ok(Math.abs(area-covered)<1e-5,'appliances must remain entirely on the original kitchen floor');}
const a=found.run.rect,b=found.fridge.rect;assert.ok(Math.min(a[2],b[2])-Math.max(a[0],b[0])<=.005||Math.min(a[3],b[3])-Math.max(a[1],b[1])<=.005);
const closed={...plan,openings:plan.openings.map(o=>({...o,type:'door' as const}))};assert.equal(packKitchen(new Placer(closed.rooms[0],closed)),null,'a real doorway must never be treated as a wall-free alcove');
console.log('compact source kitchenette: original floor, supported back, separate appliances, actual door preserved');
