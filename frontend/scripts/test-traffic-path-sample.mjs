import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficPathSample.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {trafficPathSampler}=scope.module.exports;
const collisionScope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/trafficCollision.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,collisionScope);
const {collisionFreeTravel,missesTrajectory}=collisionScope.module.exports;
// Original surveyed centreline/connector calculations, independently retained
// as a movement oracle. Compare exact doubles at bends and cumulative joints.
function oldRoad(p,d){
 let i=1;const last=p.cum.length-1;while(i<last&&p.cum[i]<d)i++;
 const [ax,ay]=p.line[i-1],[bx,by]=p.line[i],seg=p.cum[i]-p.cum[i-1]||1,t=Math.min(1,Math.max(0,(d-p.cum[i-1])/seg));
 const dir=i=>{const [a,b]=p.line[i-1],[c,d]=p.line[i],l=p.cum[i]-p.cum[i-1]||1;return [(c-a)/l,(d-b)/l];};
 let [ux,uy]=dir(i);const blend=(o,w)=>{w=w*w*(3-2*w);const x=ux*w+o[0]*(1-w),y=uy*w+o[1]*(1-w),l=Math.hypot(x,y)||1;ux=x/l;uy=y/l;};
 const bend=i=>Math.min(4,.45*(p.cum[i]-p.cum[i-1]),.45*(p.cum[i+1]-p.cum[i]));
 const into=d-p.cum[i-1],left=p.cum[i]-d;
 if(i>1){const r=bend(i-1);if(r>.05&&into<r)blend(dir(i-1),.5+.5*Math.max(0,into)/r);}
 if(i<last){const r=bend(i);if(r>.05&&left<r)blend(dir(i+1),.5+.5*Math.max(0,left)/r);}
 return {x:ax+(bx-ax)*t,y:ay+(by-ay)*t,ux,uy};
}
function oldTurn(xs,ys,cum,u){
 let i=1;while(i<cum.length-1&&cum[i]<u)i++;
 const seg=cum[i]-cum[i-1]||1,t=Math.max(0,Math.min(1,(u-cum[i-1])/seg)),dx=xs[i]-xs[i-1],dy=ys[i]-ys[i-1],li=Math.hypot(dx,dy)||1;
 const n=cum.length-1,j=t<.5?Math.max(1,i-1):Math.min(n,i+1),w=t<.5?.5+t:1.5-t,ox=xs[j]-xs[j-1],oy=ys[j]-ys[j-1],lo=Math.hypot(ox,oy)||1;
 const hx=dx/li*w+ox/lo*(1-w),hy=dy/li*w+oy/lo*(1-w),l=Math.hypot(hx,hy)||1;
 return {x:xs[i-1]+dx*t,y:ys[i-1]+dy*t,hx:hx/l,hy:hy/l};
}
test('cached polyline arithmetic preserves exact centreline and connector movement on bends, joints and degenerate pieces',()=>{
 let seed=18;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};let count=0;
 for(let k=0;k<60;k++){
  const line=[[rnd()*800-400,rnd()*800-400]],cum=[0];
  for(let i=1;i<2+k*3;i++){const [x,y]=line.at(-1);line.push(i%17===0?[x,y]:[x+rnd()*20-10,y+rnd()*20-10]);cum.push(cum.at(-1)+Math.hypot(line[i][0]-x,line[i][1]-y));}
  const xs=line.map(p=>p[0]),ys=line.map(p=>p[1]),road=trafficPathSampler(xs,ys,cum),turn=trafficPathSampler(xs,ys,cum,true),out={x:0,y:0,hx:1,hy:0},rout={x:0,y:0,ux:1,uy:0};
  const distances=[-20,cum.at(-1)+20,...cum.flatMap(d=>[d,d-1e-10,d+1e-10,d-.05,d+.05]),...Array.from({length:300},()=>rnd()*cum.at(-1))];
  for(const d of distances){assert.deepEqual({...road.road(d,rout)},oldRoad({line,cum},d));turn.turn(d,out);assert.deepEqual({...out},oldTurn(xs,ys,cum,d));count++;}
 }
 assert.ok(count>40000);
});
test('straight section gate excludes every eased bend, crossing connector and clamped endpoint',()=>{
 const p=trafficPathSampler([0,50,50,100],[0,0,50,50],[0,50,100,150]);
 for(const [a,b,want] of [[4,40,true],[46,49,false],[50,53,false],[54,95,true],[95,101,false],[-1,30,false],[120,151,false],[120,140,true]])assert.equal(p.straight(a,b),want);
});
test('continuous path envelopes enclose every curved lane/connector footprint, including heading quadrant extrema',()=>{
 let seed=553;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};let samples=0;
 for(let k=0;k<40;k++){
  const xs=[rnd()*100-50],ys=[rnd()*100-50],cum=[0];
  for(let i=1;i<30;i++){xs.push(xs.at(-1)+rnd()*20-10);ys.push(ys.at(-1)+rnd()*20-10);cum.push(cum.at(-1)+Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]));}
  const road=trafficPathSampler(xs,ys,cum),turn=trafficPathSampler(xs,ys,cum,true);
  for(let j=0;j<40;j++){
   const a=rnd()*(cum.at(-1)-30),b=a+rnd()*30,l=2+rnd()*10,w=1+rnd()*3,offset=rnd()*12-6;
   for(const [s,off,connector] of [[road,offset,false],[turn,0,true]]){
    const box=s.bounds(a,b,off,l,w);
    for(let d=a;d<=b;d+=.125){
     let x,y,hx,hy;if(connector){const p={};s.turn(d,p);({x,y,hx,hy}=p);}else{const p=s.road(d);hx=p.ux;hy=p.uy;x=p.x+hy*off;y=p.y-hx*off;}
     const rx=(Math.abs(hx)*l+Math.abs(hy)*w)/2,ry=(Math.abs(hy)*l+Math.abs(hx)*w)/2;
     assert.ok(x-rx>=box.minX&&x+rx<=box.maxX&&y-ry>=box.minY&&y+ry<=box.maxY);samples++;
    }
   }
  }
 }
 assert.ok(samples>300000);
});

test('continuous rejection keeps identical sub-metre safe travel at bends, reverse lanes and grade crossings',()=>{
 let seed=621,fullCandidates=0,filteredCandidates=0,cases=0;
 const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const xs=[-45,-20,0,10,20,35,60],ys=[-15,-15,-2,18,25,28,5],cum=[0];
 for(let i=1;i<xs.length;i++)cum.push(cum.at(-1)+Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]));
 for(const connector of [false,true]){
  const s=trafficPathSampler(xs,ys,cum,connector);
  for(let k=0;k<1500;k++){
   const reverse=!connector&&rnd()<.5,start=4+rnd()*(cum.at(-1)-8),distance=.01+rnd()*3,offset=connector?0:rnd()*12-6;
   const length=2+rnd()*10,width=1+rnd()*2.5;
   const self={length,width},pose=d=>{
    const at=start+(reverse?-d:d),p=connector?{}:s.road(at);if(connector)s.turn(at,p);
    const hx=connector?p.hx:p.ux,hy=connector?p.hy:p.uy;
    return {x:p.x+hy*offset,y:p.y-hx*offset,hx:hx*(reverse?-1:1),hy:hy*(reverse?-1:1),length,width,z:Math.sin(at/10)*8};
   };
   const p=pose(0),bodies=[self];
   for(let j=0;j<50;j++){
    const angle=rnd()*Math.PI*2;
    bodies.push({x:p.x+rnd()*80-40,y:p.y+rnd()*80-40,hx:Math.cos(angle),hy:Math.sin(angle),length:2+rnd()*10,width:1+rnd()*2.5,z:rnd()<.5?p.z:p.z+8});
   }
   // Include near touching bodies, not only easy distant rejection cases.
   if(k%3===0){const q=pose(distance*rnd());bodies.push({...q,x:q.x+.01,y:q.y+.01,length:2,width:1});}
   const box=s.bounds(start,start+(reverse?-distance:distance),offset,length+.06,width+.06);
   const nearby=bodies.filter(o=>o!==self&&!missesTrajectory(box,o));
   fullCandidates+=bodies.length;filteredCandidates+=nearby.length;
   const expected=collisionFreeTravel(distance,pose,bodies,self);
   const actual=nearby.length?collisionFreeTravel(distance,pose,nearby,self):distance;
   assert.equal(actual,expected);cases++;
  }
 }
 assert.equal(cases,3000);assert.ok(filteredCandidates<fullCandidates*.5);
});
