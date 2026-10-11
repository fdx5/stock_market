import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficLaneCurve.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {trafficLaneCurve,sampleLaneCurve}=scope.module.exports;
const lane=(a,b)=>({p:Float32Array.from([...a,...b]),cum:Float32Array.from([0,Math.hypot(b[0]-a[0],b[1]-a[1])]),len:Math.hypot(b[0]-a[0],b[1]-a[1])});
const pose=()=>({x:0,y:0,z:0,dx:0,dy:0,dz:0});
test('same-lane tile seam has no unnecessary lane change',()=>assert.equal(trafficLaneCurve(lane([-100,0,0],[0,0,0]),lane([0,0,0],[100,0,0])),null));
test('3.5m lane merge moves forward for several seconds, inside the two lane centres',()=>{
 const c=trafficLaneCurve(lane([-100,0,0],[0,0,0]),lane([0,3.5,0],[100,3.5,0]));
 assert.ok(c.len>40);let maxAngle=0;
 for(let i=0;i<=200;i++){const p=sampleLaneCurve(c,c.len*i/200,pose());assert.ok(p.dx>0);assert.ok(p.y>=-1e-6&&p.y<=3.500001);maxAngle=Math.max(maxAngle,Math.abs(Math.atan2(p.dy,p.dx)));}
 assert.ok(maxAngle<15*Math.PI/180);assert.ok(c.len/15>2.5);
 const a=sampleLaneCurve(c,0,pose()),b=sampleLaneCurve(c,c.len,pose());assert.equal(a.dy,0);assert.equal(b.dy,0);assert.ok(Math.abs(a.x+c.endS)<1e-6);assert.ok(Math.abs(b.x-c.endS)<1e-6);
});
test('quarter turn matches both endpoint headings and has a curvature speed limit',()=>{
 const c=trafficLaneCurve(lane([-100,0,0],[0,0,0]),lane([5,5,0],[5,100,0]));
 const a=sampleLaneCurve(c,0,pose()),b=sampleLaneCurve(c,c.len,pose());assert.ok(a.dx>0&&Math.abs(a.dy)<1e-9);assert.ok(b.dy>0&&Math.abs(b.dx)<1e-9);assert.ok(c.speedLimit<12);
 assert.ok(100-c.startS<=8&&c.endS<=8,'junction turn must not cut far back across roadside buildings');
});
test('an aligned seam with a small height discontinuity still has a smooth bridge transition',()=>{
 const c=trafficLaneCurve(lane([-100,0,5],[0,0,5]),lane([0,0,5.2],[100,0,5.2]));
 assert.ok(c);let previous=sampleLaneCurve(c,0,pose()).z;
 for(let i=1;i<=100;i++){const p=sampleLaneCurve(c,c.len*i/100,pose());assert.ok(Math.abs(p.z-previous)<.01);previous=p.z;}
});
test('bridge grade stays continuous rather than snapping height at the merge',()=>{
 const c=trafficLaneCurve(lane([-100,0,4],[0,0,5]),lane([0,3.5,5],[100,3.5,6]));
 let last=sampleLaneCurve(c,0,pose());
 for(let i=1;i<=100;i++){const p=sampleLaneCurve(c,c.len*i/100,pose());assert.ok(p.z>=4&&p.z<=6);assert.ok(Math.abs(p.z-last.z)<.02);last=p;}
});

const fragmented=(points)=>{const p=Float32Array.from(points.flat()),cum=new Float32Array(points.length);for(let i=1;i<points.length;i++)cum[i]=cum[i-1]+Math.hypot(p[i*3]-p[i*3-3],p[i*3+1]-p[i*3-2]);return{p,cum,len:cum.at(-1)};};
const microMerge=(step=.00001,z=0,rise=.01)=>[fragmented([[-100,0,z],[-step,0,z],[0,0,z+rise]]),fragmented([[0,3.5,z+rise],[step,3.5,z],[100,3.5,z]])];
test('reproduces the shipped height launch and prevents it on the same fragmented lane merge',()=>{
 const previous={module:{exports:{}},exports:{}};vm.runInNewContext(transformSync(execFileSync('git',['show','003c717:frontend/src/components/trafficLaneCurve.ts'],{encoding:'utf8'}),{loader:'ts',format:'cjs'}).code,previous);
 const lanes=microMerge(),old=previous.module.exports.trafficLaneCurve(...lanes),next=trafficLaneCurve(...lanes);let launch=0;
 for(let i=0;i<=1000;i++)launch=Math.max(launch,previous.module.exports.sampleLaneCurve(old,old.len*i/1000,pose()).z);
 assert.ok(launch>800,'baseline must reproduce the launch rather than merely test the fix');
 for(let i=0;i<=1000;i++){const p=sampleLaneCurve(next,next.len*i/1000,pose());assert.ok(p.z>=Math.min(next.points[2],next.points[11])-1e-9&&p.z<=Math.max(next.points[2],next.points[11])+1e-9);assert.ok(Object.values(p).every(Number.isFinite));}
 assert.deepEqual(Array.from(next.cum),Array.from(old.cum),'horizontal route, turn speed and timing must remain unchanged');
 console.log(`baseline reproduced vertical launch: ${launch.toFixed(3)}m; corrected height: ${next.points[2].toFixed(6)}..${next.points[11].toFixed(6)}m`);
});
test('uphill/downhill fragmented seams stay inside actual contact heights across terrain elevations',()=>{
 for(const step of [.00001,.0001,.001,.01,.05])for(const z of [-40,0,200])for(const rise of [-.2,-.01,.01,.2]){
  const c=trafficLaneCurve(...microMerge(step,z,rise)),lo=Math.min(c.points[2],c.points[11]),hi=Math.max(c.points[2],c.points[11]);
  for(let i=0;i<=150;i++){const p=sampleLaneCurve(c,c.len*i/150,pose());assert.ok(p.z>=lo-1e-8&&p.z<=hi+1e-8,`${step},${z},${rise}: ${p.z}`);}
 }
});
