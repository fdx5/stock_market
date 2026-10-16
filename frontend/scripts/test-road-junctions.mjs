import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// splitRoadJunctions (its segment cells) against every-pair testing: the same pieces.
const out=await build({entryPoints:[new URL('../src/components/roadTrafficNetwork.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const mod=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const out2=await build({entryPoints:[new URL('../src/components/roadLevels.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const lv=await import('data:text/javascript;base64,'+Buffer.from(out2.outputFiles[0].text).toString('base64'));
// the plain version (before the cells), for comparison
function plain(roads){const endpoints=roads.flatMap((r,road)=>[r.line[0],r.line[r.line.length-1]].map(p=>({road,p})));
 return roads.flatMap((r,road)=>{const cum=[0];for(let i=1;i<r.line.length;i++)cum.push(cum[i-1]+Math.hypot(r.line[i][0]-r.line[i-1][0],r.line[i][1]-r.line[i-1][1]));const cuts=[];
  const cut=(s,p)=>{if(s>6&&s<cum[cum.length-1]-6&&!cuts.some(c=>Math.abs(c.s-s)<6))cuts.push({s,p});};
  if(lv.roadLevel(r)===0)for(const [oi,o] of roads.entries())if(oi!==road&&lv.sameRoadLevel(r,o)&&r.structure!=='unknown'&&o.structure!=='unknown')for(let i=1;i<r.line.length;i++)for(let j=1;j<o.line.length;j++){
   const a=r.line[i-1],b=r.line[i],c=o.line[j-1],d=o.line[j],dx=b[0]-a[0],dy=b[1]-a[1],ux=d[0]-c[0],uy=d[1]-c[1],den=dx*uy-dy*ux,l=Math.hypot(dx,dy),ol=Math.hypot(ux,uy);
   if(!l||!ol||Math.abs(den)/(l*ol)<.2)continue;const t=((c[0]-a[0])*uy-(c[1]-a[1])*ux)/den,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/den;if(t>=0&&t<=1&&u>=0&&u<=1)cut(cum[i-1]+t*l,[a[0]+dx*t,a[1]+dy*t]);}
  for(const e of endpoints){if(e.road===road||lv.roadLevel(r)!==0||!lv.sameRoadLevel(r,roads[e.road]))continue;let best=Infinity,at=0,q=[0,0];
   for(let i=1;i<r.line.length;i++){const a=r.line[i-1],b=r.line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=cum[i]-cum[i-1];if(!len)continue;const t=Math.max(0,Math.min(1,((e.p[0]-a[0])*dx+(e.p[1]-a[1])*dy)/(len*len))),x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(x-e.p[0],y-e.p[1]);if(d<best){best=d;at=cum[i-1]+t*len;q=[x,y];}}
   if(best<=1.5)cut(at,q);}
  if(!cuts.length)return [r];cuts.sort((a,b)=>a.s-b.s);const stops=[{s:0,p:r.line[0]},...cuts,{s:cum[cum.length-1],p:r.line[r.line.length-1]}];
  return stops.slice(1).map((end,i)=>({...r,line:[stops[i].p,...r.line.filter((_,j)=>cum[j]>stops[i].s+.001&&cum[j]<end.s-.001),end.p]}));});}
test('a random street grid is split at the same places as by testing every pair',()=>{
  let seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(let n=0;n<20;n++){
    const roads=[];for(let k=0;k<40;k++){const line=[[rnd()*800-400,rnd()*800-400]];for(let i=1;i<2+Math.floor(rnd()*30);i++){const p=line[i-1];line.push([p[0]+(rnd()-.5)*80,p[1]+(rnd()-.5)*80]);}
      roads.push({line,width:6+rnd()*20,lanes:2,structure:rnd()<.1?'bridge':'ground'});}
    assert.deepEqual(JSON.stringify(mod.splitRoadJunctions(roads,true)),JSON.stringify(plain(roads)));
  }
});
test('roads ending on other roads (T junctions, ends meeting) are split as by testing every end',()=>{
  let seed=23;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(let n=0;n<12;n++){
    const roads=[];
    for(let k=0;k<30;k++){const line=[[rnd()*900-450,rnd()*900-450]];for(let i=1;i<2+Math.floor(rnd()*12);i++){const p=line[i-1];line.push([p[0]+(rnd()-.5)*120,p[1]+(rnd()-.5)*120]);}
      roads.push({line,width:6+rnd()*20,lanes:2,structure:rnd()<.08?'bridge':'ground'});}
    // (sixty more, each starting on a point of an earlier road — on it, or up to 1.4 m off — some ending on another)
    for(let k=0;k<60;k++){const on=(r)=>{const i=1+Math.floor(rnd()*(r.line.length-1)),a=r.line[i-1],b=r.line[i],t=rnd();return [a[0]+(b[0]-a[0])*t+(rnd()-.5)*2,a[1]+(b[1]-a[1])*t+(rnd()-.5)*2];};
      const a=on(roads[Math.floor(rnd()*roads.length)]),b=rnd()<.5?on(roads[Math.floor(rnd()*roads.length)]):[a[0]+(rnd()-.5)*200,a[1]+(rnd()-.5)*200];
      roads.push({line:[a,[(a[0]+b[0])/2+(rnd()-.5)*20,(a[1]+b[1])/2+(rnd()-.5)*20],b],width:6+rnd()*14,lanes:2,structure:'ground'});}
    const cuts=mod.splitRoadJunctions(roads,true);
    assert.ok(cuts.length>roads.length+40,'many cuts to compare');
    assert.deepEqual(JSON.stringify(cuts),JSON.stringify(plain(roads)));
    assert.deepEqual(JSON.stringify(mod.splitRoadJunctions(roads)),JSON.stringify(plainEnds(roads)));
  }
});
// (without planar crossings: the ends alone)
function plainEnds(roads){const endpoints=roads.flatMap((r,road)=>[r.line[0],r.line[r.line.length-1]].map(p=>({road,p})));
 return roads.flatMap((r,road)=>{const cum=[0];for(let i=1;i<r.line.length;i++)cum.push(cum[i-1]+Math.hypot(r.line[i][0]-r.line[i-1][0],r.line[i][1]-r.line[i-1][1]));const cuts=[];
  const cut=(s,p)=>{if(s>6&&s<cum[cum.length-1]-6&&!cuts.some(c=>Math.abs(c.s-s)<6))cuts.push({s,p});};
  for(const e of endpoints){if(e.road===road||lv.roadLevel(r)!==0||!lv.sameRoadLevel(r,roads[e.road]))continue;let best=Infinity,at=0,q=[0,0];
   for(let i=1;i<r.line.length;i++){const a=r.line[i-1],b=r.line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=cum[i]-cum[i-1];if(!len)continue;const t=Math.max(0,Math.min(1,((e.p[0]-a[0])*dx+(e.p[1]-a[1])*dy)/(len*len))),x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(x-e.p[0],y-e.p[1]);if(d<best){best=d;at=cum[i-1]+t*len;q=[x,y];}}
   if(best<=1.5)cut(at,q);}
  if(!cuts.length)return [r];cuts.sort((a,b)=>a.s-b.s);const stops=[{s:0,p:r.line[0]},...cuts,{s:cum[cum.length-1],p:r.line[r.line.length-1]}];
  return stops.slice(1).map((end,i)=>({...r,line:[stops[i].p,...r.line.filter((_,j)=>cum[j]>stops[i].s+.001&&cum[j]<end.s-.001),end.p]}));});}
