import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{contents:`export * from './src/rail/railCore';export {railGeometry} from './src/rail/railWorker';export {stationKit} from './src/rail/stationKit';`,resolveDir:base},bundle:true,write:false,platform:'node',format:'esm'});
const dir=await mkdtemp(join(tmpdir(),'surface-rail-')),entry=join(dir,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});
const {preparePath,samplePath,coachPose,pathMiters,makeRun,trainAt,railGeometry,stationKit,neededCorridors,STRIDE,BUDGET}=await import(pathToFileURL(entry));
const line={id:'2',name:'2호선',mode:'emu',colour:'#00a23f',cars:10,carLength:19.5,width:3.12,gauge:1.435};
const corridor=(points,stops=[])=>({id:'test',line:'2',route:1,points,stops,length:3000,ways:[1]});
const origin={lon:127,lat:37};
const straight=corridor([[127,37,0],[127.01,37,0],[127.02,37,0],[127.03,37,0]],[{id:'s1',name:'first',d:800,point:[127.009,37]},{id:'s2',name:'second',d:1700,point:[127.019,37]}]);
const path=preparePath(straight,origin,[0,0,0,0]),run=makeRun(path,line);
const near=(a,b,tol=.002)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('each coach uses the same geographic chainage as rendered rails',()=>{for(let d=0;d<path.length;d+=11){const p=samplePath(path,d);near(p.x,d);near(p.y,0);near(p.h,.16);}});
test('forward and endpoint samples remain finite without wrapping to the opposite end',()=>{for(const d of [-250,0,path.length,path.length+250]){const p=samplePath(path,d);assert.ok(Object.values(p).every(Number.isFinite));near(p.x,d);}});
test('station dwell ends at zero speed and leaves with bounded acceleration',()=>{for(const leg of run.legs){if(!leg.dwell)continue;const t=leg.at+leg.run+5,p=trainAt(run,t,0);near(p.d,leg.end);near(p.speed,0);assert.equal(p.doors,1);const next=trainAt(run,leg.at+leg.run+leg.dwell+.1,0);assert.ok(next.speed<=.08);}});
test('motion has continuous position and realistic nonnegative speeds',()=>{let old=trainAt(run,0,0);for(let t=.02;t<run.cycle-.01;t+=.02){const p=trainAt(run,t,0);assert.ok(p.speed>=0&&p.speed<=18.0001);assert.ok(p.d>=old.d-.001);assert.ok(p.d-old.d<.37);old=p;}});
test('deterministic clock does not change after a tile unload/reload',()=>{const again=makeRun(preparePath(straight,origin,[0,0,0,0]),line);for(const t of [0,100,500,5000])assert.deepEqual(trainAt(run,t,0),trainAt(again,t,0));});
test('short incomplete source fragments do not spawn a cut-down long train',()=>{const p=preparePath(corridor([[127,37,0],[127.001,37,0]]),origin,[0,0]);assert.equal(makeRun(p,line).count,0);});
test('elevated river span stays at bank elevation instead of dipping to river DEM',()=>{const c=corridor([[127,37,1],[127.004,37,1],[127.008,37,1],[127.012,37,1]]),p=preparePath(c,origin,[12,0,0,12]);for(let d=0;d<p.length;d+=10)near(samplePath(p,d).h,20.16);});
test('approaches are continuous at mapped elevated seams',()=>{const c=corridor([[126.996,37,0],[126.999,37,0],[127,37,1],[127.003,37,1],[127.004,37,0],[127.007,37,0]]),p=preparePath(c,origin,[0,0,0,0,0,0]);let previous=samplePath(p,0);for(let d=1;d<p.length;d++){const q=samplePath(p,d);assert.ok(Math.abs(q.h-previous.h)<.07);previous=q;}});
test('standard gauge rails and rubber/monorail guideways use distinct geometry',()=>{const eye={x:500,y:0},standard=railGeometry(path,line,eye,1400,true),mono=railGeometry(path,{...line,mode:'monorail'},eye,1400,false),agt=railGeometry(path,{...line,mode:'agt'},eye,1400,false);assert.ok(standard.steel.length&&standard.ties.length&&standard.poles.length);assert.equal(mono.steel.length,0);assert.equal(mono.ties.length,0);assert.equal(agt.ties.length,0);assert.equal(mono.wire.length,0);});
test('long sparse segments are indexed by all touched cells',()=>{const m={cell:.025,chunks:{'5080_1480':['one'],'5081_1480':['one','two']}};assert.deepEqual(new Set(neededCorridors(m,127.035,37.012,1700)),new Set(['one','two']));});
const assets=join(base,'public/rail/20261010-v7'),manifest=JSON.parse(await readFile(join(assets,'manifest.json'),'utf8'));
const all=await Promise.all((await readdir(join(assets,'corridors'))).map(async f=>JSON.parse(await readFile(join(assets,'corridors',f),'utf8'))));
test('Uijeongbu has two rubber-tyred cars and raised lateral guides',()=>{
  const l=manifest.lines.find(l=>l.id==='수도권:의정부');assert.equal(l.vehicle,'val208');assert.equal(l.mode,'agt');assert.equal(l.cars,2);
  const g=railGeometry(path,l,{x:500,y:0},1400,false);assert.equal(g.ties.length,0);assert.equal(g.wire.length,0);
  // Guide rail side faces must rise above the tyre running surface, with no
  // standard gauge sleepers. A flat ribbon alone cannot guide horizontal tyres.
  const heights=Array.from(g.steel).filter((_,i)=>i%3===1);
  assert.ok(Math.max(...heights)-Math.min(...heights)>.2);
  const u=all.filter(c=>c.line===l.id);assert.equal(new Set(u.flatMap(c=>c.stops.map(s=>s.name))).size,15);
  assert.ok(u.every(c=>c.route!==10700979));
});
test('nationwide source ways are unique and stop chainages are within their paths',()=>{const owned=new Set();for(const c of all){assert.equal(c.nodes.length,c.points.length);for(const id of c.ways){assert.ok(!owned.has(id),`duplicate ${id}`);owned.add(id);}for(const s of c.stops)assert.ok(s.d>=0&&s.d<=c.length+.02);}assert.equal(owned.size,manifest.stats.ways);});
test('all geographic paths produce finite transferred geometry and transforms',()=>{for(const c of all){const o={lon:c.points[0][0],lat:c.points[0][1]},p=preparePath(c,o,c.points.map(()=>0)),l=manifest.lines.find(l=>l.id===c.line),g=railGeometry(p,l,{x:0,y:0},400,c.overhead);for(const v of Object.values(g))assert.ok(v.every(Number.isFinite));for(let d=0;d<p.length;d+=Math.max(1,p.length/20))assert.ok(Object.values(samplePath(p,d)).every(Number.isFinite));}});
test('source-node seams keep the same rail elevation across separate paths',()=>{const ends=new Map();for(const c of all){const p=preparePath(c,{lon:127,lat:37},c.points.map(()=>0));for(const [i,d]of [[0,0],[c.nodes.length-1,p.length]]){const nid=c.nodes[i],h=samplePath(p,d).h;if(ends.has(nid))near(ends.get(nid),h,.01);else ends.set(nid,h);}}});
test('catalog references exist and total assets stay below the fixed budget',()=>{const ids=new Set(all.map(c=>c.id));for(const paths of Object.values(manifest.chunks))for(const id of paths)assert.ok(ids.has(id));assert.ok(manifest.stats.corridorBytes<2_500_000);assert.equal(BUDGET.parallel,2);assert.equal(BUDGET.cache,48);});
test('curved rails share exact mitered segment edges',()=>{const p=preparePath(corridor([[127,37,0],[127.002,37,0],[127.002,37.002,0]]),origin,[0,0,0]),g=railGeometry(p,line,{x:0,y:0},2000),m=pathMiters(p);assert.ok(m.every(Number.isFinite));const v=g.bed;for(let i=18;i<v.length;i+=54){if(i+54>=v.length)break;for(let a=0;a<3;a++){near(v[i-18+3+a],v[i+36+a]);}}});
test('stacked tracks retain mapped level ordering',()=>{const a=preparePath(corridor([[127,37,1,1],[127.01,37,1,1]]),origin,[0,0]),b=preparePath(corridor([[127,37,1,3],[127.01,37,1,3]]),origin,[0,0]);near(samplePath(b,300).h-samplePath(a,300).h,12);});
test('coach pitch is local to heading in every compass direction',()=>{for(const [dx,dy]of [[1,0],[0,1],[-1,0],[0,-1]]){const p=preparePath(corridor([[127,37,0],[127+dx*.01,37+dy*.01,0]]),origin,[0,20]);for(const reverse of [false,true]){const pose=coachPose(p,p.length/2,19.5,reverse);assert.equal(Math.sign(pose.pitch),reverse?1:-1);near(Math.tan(Math.abs(pose.pitch)),20/p.length,.001);}}});
test('station and platform source polygons include Changdong and stay finite',()=>{const fs=all.flatMap(c=>c.facilities??[]);assert.ok(fs.length>500);assert.ok(fs.some(f=>f.stationName.includes('창동')));for(const f of fs)assert.ok(f.points.length>=3&&f.points.flat().every(Number.isFinite));});
test('dense terrain catches a ridge between sparse source nodes',()=>{
  const c=corridor([[127,37,0],[127.01,37,0]]),basePath=preparePath(c,origin,[0,0]),dense=new Float32Array(basePath.points.length/STRIDE);
  for(let i=0;i<dense.length;i++)dense[i]=20*Math.max(0,1-Math.abs(i/(dense.length-1)-.5)*4);
  const p=preparePath(c,origin,[0,0],dense);for(let i=0;i<dense.length;i++)assert.ok(p.points[i*STRIDE+2]>=dense[i]+.1599);
  assert.ok(samplePath(p,p.length/2).h>19.9);
});
test('unknown dense terrain does not lower a mapped viaduct',()=>{
  const c=corridor([[127,37,1],[127.01,37,1]]),p=preparePath(c,origin,[12,12]),dense=new Float32Array(p.points.length/STRIDE).fill(NaN);dense[10]=0;
  const fresh=preparePath(c,origin,[12,12],dense);assert.deepEqual(fresh.points,p.points);
});
test('steel, AGT and monorail wheel contact matches the rendered running surface',()=>{
  for(const [mode,lift]of [['emu',.065],['agt',.055],['monorail',-.16]]){const l={...line,mode},g=railGeometry(path,l,{x:0,y:0},3000),p=coachPose(path,500,l.carLength,false,lift),v=mode==='emu'?g.steel:g.bed;
    assert.ok(Array.from(v).some((h,i)=>i%3===1&&Math.abs(h-p.h)<.0001),mode);
  }
});
const facility=(kind,points)=>({id:'f',kind,points,name:'test',stationName:'test',d:0,height:null,level:1,shelter:true,source:'test'});
test('separate station head houses do not get an elevated hall duplicate',()=>{
  const f=facility('station',[[127.003,37.00005],[127.005,37.00005],[127.005,37.0001],[127.003,37.0001]]),m=stationKit(f,path,origin,()=>0);assert.equal(m.group.children.length,0);m.dispose();
});
test('open station hall and tactile platform follow local rail height',()=>{
  const p=preparePath(corridor([[127,37,1,3],[127.01,37,1,3]]),origin,[0,20]);
  for(const kind of ['station','platform']){const f=facility(kind,[[127.003,36.99999],[127.005,36.99999],[127.005,37.00001],[127.003,37.00001]]),m=stationKit(f,p,origin,()=>0);
    assert.ok(m.group.children.length>=2);for(const mesh of m.group.children)assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    if(kind==='platform'){const v=m.group.children[1].geometry.attributes.position.array,ys=Array.from(v).filter((_,i)=>i%3===1);assert.ok(Math.max(...ys)-Math.min(...ys)>3);}
    else{const v=m.group.children[0].geometry.attributes.position.array,ys=Array.from(v).filter((_,i)=>i%3===1);assert.ok(Math.min(...ys)>35);}
    m.dispose();
  }
});
