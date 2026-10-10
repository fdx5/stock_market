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
`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'});
const dir=await mkdtemp(join(tmpdir(),'road-approaches-'));
const entry=join(dir,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});
const {roadApproachTerrain,roadHeight,findBridges,buildBridges}=await import(pathToFileURL(entry));
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
