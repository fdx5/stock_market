import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficCollision.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {VehiclePathHitCache,VehicleTrajectoryCache,VehicleHeightCache,VehicleBuckets,vehicleOverlap,missesTrajectory}=scope.module.exports;

test('reused vehicle buckets preserve insertion order, sorting and memberships over repeated frames',()=>{
 const buckets=new VehicleBuckets(80),plain=new Map();let seed=237;
 const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let frame=0;frame<1000;frame++){
  buckets.clear();plain.clear();
  for(let i=0;i<80;i++){const key=Math.floor(rnd()*30),value={id:i,s:rnd()*100};buckets.push(key,value);let list=plain.get(key);if(!list)plain.set(key,list=[]);list.push(value);}
  for(const lists of [buckets,plain])for(const list of lists.values())list.sort((a,b)=>a.s-b.s);
  assert.deepEqual(Array.from(buckets,([k,v])=>[k,Array.from(v)]),Array.from(plain));
  assert.ok(buckets.size+buckets.free.length<=80);
 }
 buckets.clear();assert.equal(buckets.size,0);assert.ok(buckets.free.every(list=>list.length===0));
});
test('stationary heights are exact and reload immediately when a bridge surface or travel input changes',()=>{
 const cache=new VehicleHeightCache(),c={conn:{},road:0,forward:true,lane:1,s:0,u:0,inConn:false,x:0,y:0,hx:1,hy:0,length:4,width:2};let queries=0,revision={level:0};
 const expected=()=>[revision.level+c.x*.1+c.hx*c.length*.35,revision.level+c.y*.1-c.hy*c.length*.35];
 const compute=out=>{queries++;[out[0],out[1]]=expected();};
 const first=cache.read(c,revision,compute);for(let i=0;i<1000;i++)assert.deepEqual(cache.read(c,revision,compute),first);assert.equal(queries,1);
 revision={level:18};assert.deepEqual(Array.from(cache.read(c,revision,compute)),[19.4,18]);assert.equal(queries,2);
 for(const key of ['road','lane','s','u','x','y','hx','hy','length']){c[key]+=.1;const before=queries;assert.deepEqual(Array.from(cache.read(c,revision,compute)),expected());assert.equal(queries,before+1);}
 for(const key of ['forward','inConn']){c[key]=!c[key];const before=queries;cache.read(c,revision,compute);assert.equal(queries,before+1);}
 c.conn={};const before=queries;cache.read(c,revision,compute);assert.equal(queries,before+1);
});
test('stationary pair results match curved path checks and invalidate every pose/path input',()=>{
 const cache=new VehiclePathHitCache(),c={conn:{},road:0,forward:true,lane:1,s:0,u:0,inConn:false,x:0,y:0,hx:1,hy:0,length:4,width:2},o={x:8,y:2,z:0,hx:0,hy:1,length:4,width:2};
 let checks=0;
 const compute=()=>{checks++;for(let d=0;d<=12;d++){const angle=(c.s+d)/20,x=c.x+20*Math.sin(angle),y=c.y+20*(1-Math.cos(angle));if(vehicleOverlap(x,y,Math.cos(angle),Math.sin(angle),c.length,c.width+.3,o))return d;}return Infinity;};
 const first=cache.read(c,o,12,compute);for(let i=0;i<1000;i++)assert.equal(cache.read(c,o,12,compute),first);assert.equal(checks,1);
 for(const key of ['x','y','z','hx','hy','length','width']){o[key]=(o[key]??0)+.2;const before=checks;assert.equal(cache.read(c,o,12,compute),compute());assert.equal(checks,before+2);}
 for(const key of ['road','lane','s','u','x','y','hx','hy','length','width']){c[key]+=.2;const before=checks;assert.equal(cache.read(c,o,12,compute),compute());assert.equal(checks,before+2);}
 for(const key of ['forward','inConn']){c[key]=!c[key];const before=checks;cache.read(c,o,12,compute);assert.equal(checks,before+1);}
 c.conn={};let before=checks;cache.read(c,o,12,compute);assert.equal(checks,before+1);before=checks;cache.read(c,o,13,compute);assert.equal(checks,before+1);
});

test('whole-trajectory rejection preserves exact metre hits through bends, dimensions and path changes',()=>{
 const cache=new VehicleTrajectoryCache(),pose={x:0,y:0,hx:1,hy:0};
 const c={conn:{},road:0,forward:true,lane:0,s:0,u:0,inConn:false,length:4,width:2};
 let seed=321,computed=0,rejected=0;
 const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const at=(c,d)=>{computed++;const angle=(c.s+d)/17,scale=c.forward?1:.6;pose.x=17*Math.sin(angle);pose.y=17*(1-Math.cos(angle));pose.hx=Math.cos(angle)*scale;pose.hy=Math.sin(angle)*scale;};
 const hit=(o,reach,fast)=>{
  const sweep=fast?cache.sweep(c,reach,pose,at,c.length,c.width+.3):null;
  if(sweep&&missesTrajectory(sweep,o)){rejected++;return Infinity;}
  for(let d=0;d<=reach;d++){
   if(sweep){const k=d*4;pose.x=sweep.values[k];pose.y=sweep.values[k+1];pose.hx=sweep.values[k+2];pose.hy=sweep.values[k+3];}else at(c,d);
   if(vehicleOverlap(pose.x,pose.y,pose.hx,pose.hy,c.length,c.width+.3,o)){
    if(d===0&&(o.x-17*Math.sin(c.s/17))*Math.cos(c.s/17)+(o.y-17*(1-Math.cos(c.s/17)))*Math.sin(c.s/17)<=0)return Infinity;
    return d;
   }
  }return Infinity;
 };
 for(let i=0;i<20000;i++){
  if(i%100===0){c.s+=.125;c.conn={};c.forward=!c.forward;}
  if(i%1000===0){c.length=2+rnd()*10;c.width=1+rnd()*2;}
  const theta=rnd()*Math.PI*2,scale=.1+rnd()*2;
  const o={x:rnd()*100-40,y:rnd()*100-40,hx:Math.cos(theta)*scale,hy:Math.sin(theta)*scale,length:2+rnd()*10,width:.5+rnd()*3};
  const reach=8+rnd()*30;assert.equal(hit(o,reach,true),hit(o,reach,false));
 }
 assert.ok(rejected>10000,`expected useful broad-phase rejection, got ${rejected}`);
 const sweep=cache.sweep(c,12,pose,at,c.length,c.width+.3),before=computed;
 cache.sweep(c,12,pose,at,c.length,c.width+.3);assert.equal(computed,before);
 assert.equal(missesTrajectory(sweep,{x:1000,y:1000,hx:0,hy:0,length:4,width:2}),false);
 const zeroCache=new VehicleTrajectoryCache();const zero=zeroCache.sweep(c,2,pose,()=>Object.assign(pose,{x:0,y:0,hx:0,hy:0}),4,2);
 assert.equal(missesTrajectory(zero,{x:1000,y:1000,hx:1,hy:0,length:4,width:2}),false);
});
