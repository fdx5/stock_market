import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';

// Source logic only: no backend imports, network, browser storage or existing DB.
const bundle=await build({stdin:{contents:`
 export * from './src/components/roadLevels';
 export {findBridges,bridgeHeight,roadGround} from './src/components/sceneBridges';
 export {RoadGraph} from './src/drivegame/traffic/RoadGraph';
`,resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,platform:'node',format:'esm'});
const directory=await mkdtemp(join(tmpdir(),'road-boundaries-'));
const entry=join(directory,'logic.mjs');await writeFile(entry,bundle.outputFiles[0].text,{flag:'wx'});
const {clipRoadLine,stitchRoadSegments,roadHeight,roadProfileKey,findBridges,bridgeHeight,roadGround,RoadGraph}=await import(pathToFileURL(entry));
const road=(line,extra={})=>({line,width:8,lanes:2,...extra});
const flat={at:()=>0,base:()=>0,relief:0,elevation:0,source:'synthetic'};
// Extract the actual pure survey parser; do not load its browser/API dependencies.
const surveySource=readFileSync(new URL('../src/components/vworldBuildings.ts',import.meta.url),'utf8');
const surveyAst=ts.createSourceFile('vworldBuildings.ts',surveySource,ts.ScriptTarget.Latest,true);
const parserSource=surveyAst.statements.filter(n=>
 ts.isFunctionDeclaration(n)&&n.name?.text==='parseRoads'||
 ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&['num','unique'].includes(d.name.text))
).map(n=>n.getText(surveyAst)).join('\n');
const parserScope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(parserSource,{loader:'ts',format:'cjs'}).code,parserScope);
const parseRoads=parserScope.module.exports.parseRoads;

test('the actual survey parser keeps registered single-lane connectors without admitting unregistered narrow paths',()=>{
 const feature=(id,rvwd,rdln)=>({id,properties:{rvwd,rdln},geometry:{type:'LineString',coordinates:[[0,rvwd],[10,rvwd]]}});
 const out=parseRoads([feature('ramp',3.3,1),feature('path',3,0),feature('wide',8,0)],p=>p);
 assert.equal(out.length,2);assert.equal(out[0].id,'ramp:0');assert.equal(out[0].lanes,1);assert.equal(out[0].width,3.3);
});
test('multipart survey geometry has distinct stable IDs and repeated features are not doubled',()=>{
 const f={id:'multi',properties:{rvwd:8,rdln:2},geometry:{type:'MultiLineString',coordinates:[[[0,0],[10,0]],[[0,10],[10,10]]]}};
 const out=parseRoads([f,f],p=>p);assert.equal(out.length,2);assert.equal(out[0].id,'multi:0');assert.equal(out[1].id,'multi:1');
});

test('long and diagonal segments retain exact window intersections',()=>{
 assert.deepEqual(clipRoadLine([[-1000,0],[1000,0]],650),[[[-650,0],[650,0]]]);
 assert.deepEqual(clipRoadLine([[-200,-100],[200,100]],100),[[[-100,-50],[100,50]]]);
 assert.deepEqual(clipRoadLine([[0,0],[1000,0]],650),[[[0,0],[650,0]]]);
});
test('an excursion outside the window never invents a chord across it',()=>{
 assert.deepEqual(clipRoadLine([[0,0],[200,0],[200,200],[0,200],[0,0]],100),[[[0,0],[100,0]],[[0,100],[0,0]]]);
});
test('invalid coordinates, duplicate points and corner tangencies produce no degenerate strip',()=>{
 assert.deepEqual(clipRoadLine([[0,0],[0,0],[50,0]],100),[[[0,0],[50,0]]]);
 assert.deepEqual(clipRoadLine([[200,0],[0,200]],100),[]);
 assert.deepEqual(clipRoadLine([[0,0],[NaN,0],[10,0]],100),[]);
 assert.deepEqual(clipRoadLine([[0,0],[10,0]],Infinity),[]);
});
test('close ends across rounding cells join without moving surveyed coordinates or input data',()=>{
 const input=[road([[-10,0],[.74,0]],{id:'a'}),road([[.76,0],[10,0]],{id:'b'})],before=JSON.stringify(input);
 const [out]=stitchRoadSegments(input);assert.equal(stitchRoadSegments(input).length,1);
 assert.deepEqual(out.line,[[-10,0],[.74,0],[.76,0],[10,0]]);assert.equal(JSON.stringify(input),before);
});
test('a same-cell diagonal beyond 1.5 metres and a three-arm branch stay separate',()=>{
 assert.equal(stitchRoadSegments([road([[-10,-10],[-.74,-.74]]),road([[.74,.74],[10,10]])]).length,2);
 assert.equal(stitchRoadSegments([road([[-10,0],[0,0]]),road([[0,0],[10,0]]),road([[0,0],[0,10]])]).length,3);
});
test('lane count, width change and different levels are preserved at a join',()=>{
 const a=road([[-10,0],[0,0]],{layer:0});
 for(const extra of [{lanes:1},{width:14},{layer:1,structure:'bridge'}])assert.equal(stitchRoadSegments([a,road([[0,0],[10,0]],extra)]).length,2);
});
test('bridge stitching retains the full official profile even after structured cloning',()=>{
 const profile=[[-100,0],[100,0]],a=road([[-20,0],[0,0]],{structure:'bridge',layer:1,link_id:'official',profile_line:profile});
 const b=structuredClone({...a,line:[[0,0],[20,0]]});const [out]=stitchRoadSegments([a,b]);
 assert.equal(stitchRoadSegments([a,b]).length,1);assert.deepEqual(out.profile_line,profile);assert.equal(roadProfileKey(out),'official');
 const t={at:x=>x===-100?10:x===100?30:0};assert.equal(roadHeight(out,t,0,0),20);
});
test('different elevated owners never acquire a shared or shortened profile',()=>{
 const a=road([[-20,0],[0,0]],{structure:'bridge',layer:1,link_id:'lower'});
 const b=road([[0,0],[20,0]],{structure:'bridge',layer:1,link_id:'upper'});
 assert.equal(stitchRoadSegments([a,b]).length,2);
});
test('relative layers never become metres of artificial bridge height',()=>{
 for(const layer of [1,2,3])assert.equal(roadHeight(road([[-10,0],[10,0]],{structure:'bridge',layer}),{at:()=>12},0,0),12);
});
test('water alone does not invent a bridge; official structures stay independent of water arrival',()=>{
 const river={kind:'천',ring:[[-20,-20],[20,-20],[20,20],[-20,20]]};
 assert.equal(findBridges([road([[-30,0],[30,0]])],[river],[false],flat).length,0);
 const bridge=road([[-30,0],[30,0]],{id:'official',structure:'bridge',structure_source:'VWorld LT_L_MOCTLINK',layer:1});
 assert.equal(findBridges([bridge],[],[],flat).length,1);
});
test('decks without a link ID still query their own road identity, not a neighbour',()=>{
 const a=road([[-20,0],[20,0]],{id:'lower',structure:'bridge',structure_source:'fixture',layer:1});
 const b=road([[-20,1],[20,1]],{id:'upper',structure:'bridge',structure_source:'fixture',layer:1});
 const t={...flat,roadAt:r=>r.id==='lower'?8:20};const found=findBridges([a,b],[],[],t),deck=bridgeHeight(found);
 assert.equal(deck(0,0,a),8);assert.equal(deck(0,0,b),20);
 assert.equal(roadGround(t,found).roadAt(a,0,0),8);
});
test('unowned deck lookup chooses the closest centreline independent of provider order',()=>{
 const a=road([[-20,0],[20,0]],{id:'a',structure:'bridge',structure_source:'fixture',layer:1});
 const b=road([[-20,6],[20,6]],{id:'b',structure:'bridge',structure_source:'fixture',layer:1});
 const found=findBridges([a,b],[],[],{...flat,roadAt:r=>r.id==='a'?20:8});
 assert.equal(bridgeHeight(found)(0,5),8);assert.equal(bridgeHeight([...found].reverse())(0,5),8);
});
const line=(id,pts)=>({id,pts:Float32Array.from(pts.flat()),w:8,lanes:2,major:true});
test('navigation joins same-height endpoints and separates stacked endpoints',()=>{
 const graph=new RoadGraph();graph.add([line('a',[[-20,0,0],[0,0,0]]),line('b',[[0,0,0],[20,0,0]]),line('upper',[[0,0,15],[20,0,15]])]);
 assert.equal(graph.edges[0].b,graph.edges[1].a);assert.notEqual(graph.edges[0].b,graph.edges[2].a);
});
test('navigation rejects a false T beneath a bridge and retains a real ground T',()=>{
 for(const height of [0,15]){
  const g=new RoadGraph();g.add([line('through',[[-30,0,height],[30,0,height]]),line('branch',[[0,-20,0],[0,0,0]])]);
  if(height===0)assert.equal(g.edges[1].teeB?.edge,0);else assert.equal(g.edges[1].teeB,undefined);
 }
});
