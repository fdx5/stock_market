import assert from "node:assert/strict";
import { generatePlan } from "../src/walkmode/interior/plan/generate";
import { LAYOUT_CASES } from "../src/walkmode/interior/plan/layoutCases";

for (const area of [39,59.97,84.97,114.9,135]) {
  const shapes=new Set<string>(),graphs=new Set<string>();
  for(let i=0;i<LAYOUT_CASES;i++){
    const p=generatePlan({complexId:"test:independent",complexName:"test",dong:"101",unitType:String(area),area,areaBasis:"test",built:2019,layoutCase:i});
    assert.ok(p.check.error<.001,`${area}/${i}: area ${p.check.error}`);
    for(const r of p.rooms){assert.ok(r.rect.every(Number.isFinite));assert.ok(r.rect[2]>r.rect[0]&&r.rect[3]>r.rect[1]);}
    for(let a=0;a<p.rooms.length;a++)for(let b=a+1;b<p.rooms.length;b++){
      const r=p.rooms[a].rect,s=p.rooms[b].rect;
      const overlap=Math.max(0,Math.min(r[2],s[2])-Math.max(r[0],s[0]))*Math.max(0,Math.min(r[3],s[3])-Math.max(r[1],s[1]));
      assert.ok(overlap<.0001,`${area}/${i}: overlap ${p.rooms[a].id}, ${p.rooms[b].id}`);
    }
    const reached=new Set(["entry"]);
    for(let n=0;n<p.rooms.length;n++)for(const o of p.openings)if(o.b!=="out"&&(reached.has(o.a)||reached.has(o.b))){reached.add(o.a);reached.add(o.b);}
    assert.equal(reached.size,p.rooms.length,`${area}/${i}: inaccessible room`);
    for(const o of p.openings){
      assert.ok(o.width>.3&&Number.isFinite(o.center));
      const a=p.rooms.find(r=>r.id===o.a)!;
      const j=o.axis==="x"?1:0;
      assert.ok(o.center-o.width/2>=a.rect[j]-.001&&o.center+o.width/2<=a.rect[j+2]+.001,`${area}/${i}: opening beyond wall`);
    }
    shapes.add(JSON.stringify(p.rooms.map(r=>[r.id,...r.rect.map(x=>Math.round(x*1000))])));
    graphs.add(JSON.stringify(p.openings.filter(o=>o.b!=="out").map(o=>[o.a,o.b].sort().join("|")).sort()));
  }
  assert.ok(shapes.size>=500,`${area}: only ${shapes.size} distinct layouts`);
  assert.ok(graphs.size>=8,`${area}: only ${graphs.size} circulation graphs`);
  console.log(JSON.stringify({area,cases:LAYOUT_CASES,uniqueShapes:shapes.size,uniqueGraphs:graphs.size}));
}
