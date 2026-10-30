import assert from "node:assert/strict";
import {floorPlanFromImage,type ImageAnalysis} from "../src/walkmode/interior/plan/imagePlan";
const input={complexId:"test-complex",complexName:"Test",dong:"101",unitType:"80",area:80,areaBasis:"test",floor:4,style:"modern_white" as const};
const analysis:ImageAnalysis={status:"ready",version:"test",drawing:{key:"a".repeat(24),naverId:"123",typeId:"8",typeName:"T80A",exclusiveArea:80,supplyArea:104,variant:"기본형",imageId:"test-image",imageUrl:"https://landthumb-phinf.pstatic.net/test.jpg",sourceUrl:"https://land.naver.com/info/groundPlanGallery.naver?rletNo=123"},
 scale:{basis:"recognized_dimensions",xMetresPerPixel:.01,zMetresPerPixel:.01},areaM2:80,areaError:0,rooms:[
  {id:"living",type:"living",label:"거실",zone:"lk",rect:[0,0,6,4]},
  {id:"kitchen",type:"kitchen",label:"주방",zone:"lk",rect:[6,0,10,4]},
  {id:"master",type:"master",label:"안방",zone:"bed",rect:[0,4,6,8]},
  {id:"bath2",type:"bathroom",label:"욕실",zone:"wet",rect:[6,4,10,8]},
 ],openings:[{type:"open",a:"living",b:"kitchen",axis:"x",at:6,center:2,width:4,height:2.7,sill:0}]};
const plan=floorPlanFromImage(input,analysis)!;
assert.equal(plan.source,"image_analysis");assert.equal(plan.unitType,"T80A");assert.equal(plan.areaExclusiveM2,80);
assert.deepEqual(plan.rooms.map(r=>r.rect),analysis.rooms!.map(r=>r.rect)); // no mirroring or template/envelope stretching
assert.deepEqual(plan.bounds,[0,0,10,8]);assert.equal(plan.imageAnalysis!.scaleBasis,"recognized_dimensions");
assert.equal(floorPlanFromImage({...input,area:80.02},analysis),null); // nearby but distinct type is not substituted
assert.equal(floorPlanFromImage(input,{...analysis,status:"needs_review"}),null);
assert.equal(floorPlanFromImage(input,{...analysis,openings:[{...analysis.openings![0],width:NaN}]}),null);
assert.ok(floorPlanFromImage(input,{...analysis,rooms:[...analysis.rooms!,{id:"edge",type:"hall",label:"외곽",zone:"lk",rect:[10,0,10.12,4]}]}),"preserve a small unfurnished perimeter strip without rejecting the whole drawing");
console.log("image-plan: source geometry, identity, exact area, invalid-result checks passed");
