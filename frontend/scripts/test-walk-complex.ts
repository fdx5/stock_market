import assert from "node:assert/strict";
import { walkComplex } from "../src/walkmode/complexOf";
import { fetchUnits } from "../src/walkmode/interior/plan/fetchUnits";

void (async () => {
  const original = globalThis.fetch, realId = "11680:대치동:316:은마", pnu = "1168010600103160000";
  let lookups = 0, units = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://kospimap.com");
    if (url.pathname.endsWith("/explore")) {
      lookups++; assert.equal(url.searchParams.get("sgg"), "11680");
      return new Response(JSON.stringify({ items: [{ id: realId, name: "은마", built: 1979 }] }));
    }
    assert.equal(url.pathname, "/api/realestate/units");
    assert.equal(url.searchParams.get("id"), realId, "units never receives place: or an invented ID");
    assert.equal(url.searchParams.get("pnu"), pnu); units++;
    return new Response(JSON.stringify({ complexId: realId, name: "은마", built: 1979, households: 4424, types: [59.97,84.97,114.96].map(areaM2 => ({ key:String(areaM2),areaM2,trades:3,label:`${areaM2}㎡`,rooms:3,baths:2,source:"register" })), sources:["register"] }));
  };
  try {
    for (const id of ["place:은마", "pt:37.5,127.05", "", realId]) {
      const before = lookups;
      const resolved = await walkComplex({ id, name:"은마", built:null }, "은마", pnu);
      assert.equal(resolved?.id, realId);
      assert.equal(lookups-before, id === realId ? 0 : 1);
      const response = await fetchUnits(resolved!.id, "101동", undefined, pnu);
      assert.deepEqual(response.types.map(t=>t.areaM2), [59.97,84.97,114.96]);
    }
    assert.equal(units,4);
    assert.equal(await walkComplex({ id:"place:은마",name:"은마",built:null },"은마",null),null);
    assert.equal(units,4,"unresolved locations cannot call units with a fake ID");
    console.log("Walk complex regression passed: place/missing/point IDs resolve by name and PNU; collected IDs retained; real units preserved.");
  } finally { globalThis.fetch = original; }
})().catch(error=>{console.error(error);process.exitCode=1;});
