import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// roadLevels.nearestRoadPoint (its 20 m cell index) against the plain walk of every segment.
const out=await build({entryPoints:[new URL('../src/components/roadLevels.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const mod=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const plain=(line,x,y)=>{let best=Infinity,along=0,s=0;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(len*len))),d=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);if(d<best){best=d;along=s+t*len;}s+=len;}return {distance:best,along,total:s};};
test('the indexed nearest point is the plain walk\'s, near and far from long winding lines',()=>{
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  for(let n=0;n<40;n++){
    const line=[[0,0]];for(let i=1;i<60;i++){const p=line[i-1];line.push([p[0]+(rnd()-.3)*30,p[1]+(rnd()-.5)*30]);}
    for(let q=0;q<200;q++){const x=(rnd()-.2)*900,y=(rnd()-.5)*900,a=mod.nearestRoadPoint(line,x,y),b=plain(line,x,y);
      assert.ok(Math.abs(a.distance-b.distance)<1e-6,`distance ${a.distance} vs ${b.distance}`);assert.ok(Math.abs(a.total-b.total)<1e-6);
      if(Math.abs(a.along-b.along)>1e-6){const c=mod.nearestRoadPoint(line,x,y);assert.ok(Math.abs(c.distance-b.distance)<1e-6);}}
  }
});
