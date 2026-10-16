// Times a streamed tile's river water (field + surface) on a synthetic Han tile: node scripts/bench-water-tile.mjs
import {buildSync} from 'esbuild';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(path.join(tmpdir(),'wbench-'));const out=path.join(dir,'waterCore.mjs');
buildSync({entryPoints:[new URL('../src/components/waterCore.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent'});
const W=await import(pathToFileURL(out).href);
const pace=async()=>true,H=170+12;
// the river over most of the tile, a 둔치 strip along one side
const ring=[[-H,-H],[H,-H],[H,120],[-H,90]];
const ground=(x,y)=>y>60?5+0.1*Math.sin(x/9):(y>40?5-(60-y)*0.12:2.5+0.05*Math.sin(x/13+y/7));
for(const k of [0,1,2]){
  let t=performance.now();
  const f=await W.waterField([ring],ground,pace,[],[false],[-H,-H,H,H],null);
  const tf=performance.now()-t;t=performance.now();
  const sr=W.surfaceRings([ring],[],[false],170);
  const s=await W.waterSurface(sr.rings,W.fieldFrom(f,ground),pace,sr.holes,sr.sea);
  console.log('field ms',tf.toFixed(0),'surface ms',(performance.now()-t).toFixed(0),'nodes',f.nx*f.ny,'tris',s.index.length/3);
}
