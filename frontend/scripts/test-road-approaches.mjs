import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

// Pure source logic, fresh temporary bundle; no backend, network or saved DB.
const bundle=await build({stdin:{contents:`
 export {roadApproachTerrain} from './src/components/roadApproaches';
 export {roadHeight} from './src/components/roadLevels';
 export {findBridges,buildBridges} from './src/components/sceneBridges';
 export {surfaceGeometry,surfaceGeometryRules} from './src/components/surfaceGeometry';
`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'});
const dir=await mkdtemp(join(tmpdir(),'road-approaches-'));
const entry=join(dir,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});
const {roadApproachTerrain,roadHeight,findBridges,buildBridges,surfaceGeometry,surfaceGeometryRules}=await import(pathToFileURL(entry));
const road=(id,line,structure='ground',extra={})=>({id,line,width:8,lanes:2,structure,layer:structure==='ground'?0:1,structure_source:'fixture',...extra});
const profile=[[-8,0],[300,0]];
const bridge=road('bridge',[[0,2],[300,2]],'bridge',{link_id:'official',profile_line:profile});
const bank=road('bank',[[-50,2],[0,2]]);
const terrain={at:(x,y)=>x<=0?12+.05*x+.2*y:x>=300?35+.2*y:0,base:()=>0,relief:35,elevation:0,source:'synthetic'};
const height=(r,t,x,y=2)=>roadHeight(r,t,x,y);
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test('bank height, road edges and longitudinal slope meet the ground DEM',()=>{
 const t=roadApproachTerrain([bridge,bank],terrain);
 assert.ok(Math.abs(height(bridge,terrain,0)-height(bank,terrain,0))>.1,'reproduces the offset official-link bank mismatch');
 for(const y of [-2,2,6])near(height(bridge,t,0,y),height(bank,terrain,0,y));
 const epsilon=.001;
 near((height(bridge,t,epsilon)-height(bridge,t,0))/epsilon,.05,1e-5);
});
test('the inner edge restores the original deck height and slope without sampling the river bed as an approach',()=>{
 const t=roadApproachTerrain([bridge,bank],terrain),band=90;
 near(height(bridge,t,band),height(bridge,terrain,band));
 near(height(bridge,t,150),height(bridge,terrain,150));
 const epsilon=.001,originalSlope=(height(bridge,terrain,band+epsilon)-height(bridge,terrain,band))/epsilon;
 near((height(bridge,t,band)-height(bridge,t,band-epsilon))/epsilon,originalSlope,1e-5);
 assert.ok(height(bridge,t,30)>12,'river-bed DEM must not pull down the approach deck');
});
test('short fragments of one official profile share the same transition across clipping, reversal and worker copies',()=>{
 const a={...bridge,id:'a',line:[[0,2],[30,2]]},b={...bridge,id:'b',line:[[30,2],[300,2]]};
 const before=JSON.stringify([a,b,bank]);
 const t=roadApproachTerrain([a,b,bank],terrain);
 near(height(a,t,30),height(b,t,30));
 const clone=structuredClone({...a,line:[[20,2],[30,2]]});near(height(clone,t,20),height(a,t,20));
 near(height({...b,line:[...b.line].reverse()},t,30),height(a,t,30));
 assert.equal(JSON.stringify([a,b,bank]),before,'source coordinates/metadata are untouched');
});
test('a reversed full profile matches the opposite bank and ground slope',()=>{
 const r={...bridge,profile_line:[...profile].reverse(),line:[...bridge.line].reverse()};
 const t=roadApproachTerrain([r,bank],terrain);
 near(height(r,t,0),height(bank,terrain,0));
 near((height(r,t,.001)-height(r,t,0))/.001,.05,1e-5);
});
test('interior crossings, unknown structures and outwardly incompatible ends do not create approaches',()=>{
 for(const other of [road('cross',[[0,-40],[0,40]]),{...bank,structure:'unknown'},road('parallel',[[0,2],[50,2]])]){
  const t=roadApproachTerrain([bridge,other],terrain);
  for(const x of [0,30,150])near(height(bridge,t,x),height(bridge,terrain,x));
 }
});
test('nearby elevated owners and ground roads retain their own independent heights',()=>{
 const other=road('other',[[0,10],[300,10]],'bridge',{link_id:'other',profile_line:[[0,10],[300,10]]});
 const t=roadApproachTerrain([bridge,bank,other],terrain);
 near(height(other,t,30,10),height(other,terrain,30,10));
 near(height(bank,t,-20),height(bank,terrain,-20));
});
test('two banks remain continuous and their transition bands never overwrite the middle',()=>{
 const endBank=road('end-bank',[[300,2],[350,2]]),t=roadApproachTerrain([bridge,bank,endBank],terrain);
 near(height(bridge,t,0),terrain.at(0,2));near(height(bridge,t,300),terrain.at(300,2));
 near(height(bridge,t,150),height(bridge,terrain,150));
 for(let x=0;x<=300;x++)assert.ok(Number.isFinite(height(bridge,t,x)));
});
test('the bridge slab edges use the same crossfall as the road surface at the bank',()=>{
 const found=findBridges([bridge,bank],[],[],terrain),b=found[0];
 near(b.h[0],terrain.at(0,2),1e-5);near(b.left_h[0],terrain.at(0,6),1e-5);near(b.right_h[0],terrain.at(0,-2),1e-5);
 const made=buildBridges(found);
 made.group.traverse(o=>{if(o.geometry)assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
 made.dispose();
});

test('a surveyed bridge endpoint inside water uses dry bank support rather than river-bed DEM',()=>{
 const line=[[-80,0],[80,0]],saved=JSON.stringify(line);
 const water=(x,y)=>Math.abs(x)<160?0:null,ground=x=>Math.abs(x)<160?-3:10;
 const r=road('wet-ended',line,'bridge'),t={...terrain,at:ground,waterAt:water};
 for(const x of [-80,0,80])near(roadHeight(r,t,x,0),10);
 assert.equal(JSON.stringify(line),saved);
 const ordinary={...r,structure:'ground',layer:0};near(roadHeight(ordinary,t,0,0),-3);
});

test('wet-ended profiles share support across reversal, tile fragments and serialized rules',()=>{
 const line=[[-80,0],[80,0]],water=x=>Math.abs(x)<160?0:null,ground=x=>Math.abs(x)<160?-3:10+.02*x;
 const workerRules=Function('return ('+surfaceGeometryRules.toString()+')()')();
 for(const x of [-80,-40,0,40,80]){
  const expected=surfaceGeometry.profileHeight(line,x,0,ground,water);
  near(workerRules.profileHeight(line,x,0,ground,water),expected);
  near(surfaceGeometry.profileHeight([...line].reverse(),x,0,ground,water),expected);
  near(roadHeight(road('fragment',[[x,0],[x+1,0]],'bridge',{profile_line:line}),{...terrain,at:ground,waterAt:water},x,0),expected);
 }
});

test('bank support never samples clamped heights outside the available DEM',()=>{
 let outside=0;const ground=x=>{if(Math.abs(x)>=100)outside++;return Math.abs(x)>=120?10:-3;};
 const h=surfaceGeometry.profileHeight([[-80,0],[80,0]],0,0,ground,x=>Math.abs(x)<120?0:null,x=>Math.abs(x)<100);
 near(h,-3);assert.equal(outside,0);
});

test('a shoreline cell below water level is skipped until valid dry support is found',()=>{
 const ground=x=>Math.abs(x)<164?-3:10,water=x=>Math.abs(x)<140?0:null;
 near(surfaceGeometry.profileHeight([[-80,0],[80,0]],0,0,ground,water),10);
});

test('existing dry bank profiles and inland bridges keep their original heights',()=>{
 const line=[[-200,0],[200,0]],ground=x=>x*.05+20,water=x=>Math.abs(x)<160?0:null;
 for(const x of [-200,0,200])near(surfaceGeometry.profileHeight(line,x,0,ground,water),ground(x));
});

test('repeated bridge samples reuse bank searches and a new water revision refreshes support',()=>{
 const line=[[-80,0],[80,0]],water=x=>Math.abs(x)<160?0:null;let calls=0,bank=10;
 const ground=x=>{calls++;return Math.abs(x)<160?-3:bank;},revision={};
 const sample=key=>surfaceGeometry.profileHeight(line,0,0,ground,water,undefined,key);
 near(sample(revision),10);const first=calls;
 for(let i=0;i<100;i++)near(sample(revision),10);
 assert.equal(calls,first,'no repeated DEM/shore search on road vertices or traffic frames');
 bank=20;near(sample({}),20);assert.ok(calls>first);
});
