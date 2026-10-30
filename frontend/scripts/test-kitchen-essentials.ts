import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePlan } from "../src/walkmode/interior/plan/generate";
import { floorPlanFromImage } from "../src/walkmode/interior/plan/imagePlan";
import { packKitchen, Placer } from "../src/walkmode/interior/furnish";
if(process.argv.includes("--source-samples"))for(const [prefix,name,area] of [["naver","81A",59.99],["naver","81B",59.9],["naver","108",84.92],["naver","154",127.07],["desiang","81A",59.81],["desiang","114A",84.81]] as const){
 const analysis=JSON.parse(readFileSync(`../tmp/large-floors/${prefix}-${name}-improved.json`,"utf8"));
 analysis.drawing={exclusiveArea:area,typeName:name,key:name,sourceUrl:""};
 const plan=floorPlanFromImage({complexId:prefix,complexName:prefix,dong:"101",unitType:name,area},analysis);assert.ok(plan,`${prefix} ${name} analysis`);
 const room=plan.rooms.find(r=>r.type==="kitchen");assert.ok(room);
 const packed=packKitchen(new Placer(room,plan));assert.ok(packed,`${prefix} ${name} must fit sink/cooktop and refrigerator`);
 console.log(prefix,name,packed.width,packed.fridgeWidth);
}
let count=0;
for(const area of [39,59.97,84.97,114.9,135])for(let layoutCase=0;layoutCase<512;layoutCase++){
 const plan=generatePlan({complexId:"kitchen-test",complexName:"독립 검사",dong:"101",unitType:String(area),area,layoutCase});
 for(const room of plan.rooms.filter(r=>r.type==="kitchen"))assert.ok(packKitchen(new Placer(room,plan)),`${area} case ${layoutCase} essentials`);
 count++;
}
console.log(`kitchen essentials PASS: ${count} generated plans`);
