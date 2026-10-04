import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficJunction.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {junctionSignalPolicy,junctionOccupied}=scope.module.exports;
const networkScope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/roadTrafficNetwork.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,networkScope);
const {splitRoadJunctions}=networkScope.module.exports;
test('a surveyed mid-block T junction splits the through road and keeps its width and lanes',()=>{
 const main={line:[[-20,0],[0,0],[20,0]],width:24,lanes:6},side={line:[[.5,.4],[0,20]],width:9,lanes:2};
 const out=splitRoadJunctions([main,side]);assert.equal(out.length,3);
 assert.equal(out[0].line.at(-1)[0],.5);assert.equal(out[1].line[0][0],.5);
 assert.equal(out[0].width,24);assert.equal(out[1].lanes,6);assert.equal(main.line.length,3);
});
test('unconnected bridge crossings and nearby parallel roads remain separate',()=>{
 const main={line:[[-20,0],[20,0]],width:12,lanes:4};
 assert.equal(splitRoadJunctions([main,{line:[[0,-20],[0,20]],width:9,lanes:2}]).length,2);
 assert.equal(splitRoadJunctions([main,{line:[[-20,3],[0,3]],width:8,lanes:2}]).length,2);
});
test('multiple surveyed branches yield nonzero connected sections without duplicate cuts',()=>{
 const out=splitRoadJunctions([{line:[[-40,0],[40,0]],width:12,lanes:4},...[-20,20].flatMap(x=>[-1,1].map(sign=>({line:[[x,0],[x,sign*20]],width:9,lanes:2}))) ]);
 assert.equal(out.length,7);assert.ok(out.every(r=>r.line.length>=2&&Math.hypot(r.line.at(-1)[0]-r.line[0][0],r.line.at(-1)[1]-r.line[0][1])>0));
});
for(const widths of [[50,47,14.5,15],[40,23.8,8.3,11.4],[28,12.9,44.9],[23.8,10.4,39],[10.4,8.3,47,44.9,11.4]]){
 test(`ordinary approaches retain signals beside a wide boulevard: ${widths}`,()=>{
  const p=junctionSignalPolicy(widths.map((width,i)=>({key:String(i),width})));
  assert.equal(p.signal,true);assert.equal(p.minor.size,0);
 });
}
test('a small driveway stays unsignalled and two-arm bends are not intersections',()=>{
 assert.equal(junctionSignalPolicy([50,50,4].map((width,i)=>({key:String(i),width}))).signal,false);
 assert.equal(junctionSignalPolicy([14,14].map((width,i)=>({key:String(i),width}))).signal,false);
});
test('the same tick reservation blocks another approach and red right turns',()=>{
 const first={approach:'east'},second={approach:'south'},occupants=[];
 const of=o=>o.approach,phase=k=>k;
 assert.equal(junctionOccupied(occupants,first,first.approach,of,phase),false);
 occupants.push(first);
 assert.equal(junctionOccupied(occupants,second,second.approach,of,phase),true);
 occupants.length=0;
 assert.equal(junctionOccupied(occupants,second,second.approach,of,phase),false);
});
test('same signal approach can follow while the previous phase rear still owns the box',()=>{
 const first={approach:'east1'},follower={approach:'east2'},other={approach:'south'},phase=k=>k.startsWith('east')?0:1;
 assert.equal(junctionOccupied([first],follower,follower.approach,o=>o.approach,phase),false);
 assert.equal(junctionOccupied([first],other,other.approach,o=>o.approach,phase),true);
});
