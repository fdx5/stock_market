import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
const [beforeFile,fixtureFile]=process.argv.slice(2);
if(!beforeFile||!fixtureFile)throw Error('Pass preserved before-source and public geometry fixture paths.');
const load=source=>{const module={exports:{}};vm.runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports});return module.exports.constrainRoadCorridors;};
const before=load(readFileSync(beforeFile,'utf8')),after=load(readFileSync(new URL('../src/components/roadCorridors.ts',import.meta.url),'utf8'));
const {roads,footprints}=JSON.parse(readFileSync(fixtureFile,'utf8'));
const timings={before:[],after:[]};
let result;
for(let i=0;i<3;i++){
  let at=performance.now();const old=before(roads,footprints);timings.before.push(performance.now()-at);
  at=performance.now();const next=after(roads,footprints);timings.after.push(performance.now()-at);
  assert.equal(JSON.stringify(next),JSON.stringify(old),'Measured centreline/width/fragment output changed');result=next;
}
const median=a=>a.toSorted((x,y)=>x-y)[1];
console.log(JSON.stringify({roads:roads.length,footprints:footprints.length,outputRoads:result.length,exactOutput:true,timings,medianBeforeMs:median(timings.before),medianAfterMs:median(timings.after),speedup:median(timings.before)/median(timings.after)}));
