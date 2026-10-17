import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../src/components/ComplexHologram.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('ComplexHologram.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const method=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='withRoads').getText(tree);
function fixture(){
 const calls={footprints:0,roads:0,context:0},roadsOf=new Map(),footprintResolvers=[];
 const scope={module:{exports:{}},Promise,RING_M:600,FAR_HALF:680,roadsOf,
  prefetchRoadContext(){calls.context++;},
  vworldRoadFootprints(){calls.footprints++;return new Promise(resolve=>footprintResolvers.push(resolve));},
  vworldRoadsAround:async()=>{calls.roads++;return [{line:[[0,0],[40,0]],width:8,lanes:2}];},
  vworldRoads:async()=>[],vworldRoadContext:async(_res,roads)=>({roads,road_context:{source:'fixture'}}),
  stitchedRoads:roads=>roads,sceneWork:async(_kind,job)=>job.roads,constrainRoadCorridors:roads=>roads,
  remember(map,id,value){map.set(id,value);return value;},setTimeout:()=>0,window:{setTimeout:()=>0},
 };
 vm.runInNewContext(transformSync('export '+method,{loader:'ts',format:'cjs'}).code,scope);
 const res={found:true,vworld_key:'fixture',center:{lat:37.6,lon:127},buildings:[],context:[]};
 return {load:scope.module.exports.withRoads,calls,res,footprintResolvers};
}
test('prefetch and selection share one complete footprint and road request before pagination starts',async()=>{
 const f=fixture(),a=f.load('one',f.res),b=f.load('one',f.res),c=f.load('one',f.res);
 assert.equal(a,b);assert.equal(a,c);assert.deepEqual(f.calls,{footprints:1,roads:1,context:1});
 const rings=[[[0,0],[10,0],[0,10]]];f.footprintResolvers[0](rings);
 const [ra,rb,rc]=await Promise.all([a,b,c]);assert.equal(ra,rb);assert.equal(ra,rc);assert.equal(ra.road_building_footprints[0],rings[0]);
 assert.equal(f.load('one',f.res),a);assert.equal(f.calls.footprints,1,'revisiting the completed job starts no orphaned pagination');
});
test('different complexes still load their own full footprints and road context',async()=>{
 const f=fixture(),a=f.load('one',f.res),b=f.load('two',f.res);
 assert.notEqual(a,b);assert.deepEqual(f.calls,{footprints:2,roads:2,context:2});
 f.footprintResolvers.forEach(resolve=>resolve([]));await Promise.all([a,b]);
});
test('an already enriched result preserves all roads and footprints without new network work',async()=>{
 const f=fixture(),res={...f.res,road_surface_version:1,road_context:{source:'fixture-deck-v3'},roads:[{line:[[0,0],[1,1]]}],road_building_footprints:[[[0,0],[1,0],[0,1]]]};
 assert.equal(await f.load('complete',res),res);assert.deepEqual(f.calls,{footprints:0,roads:0,context:0});
});
test('an older enriched result refreshes road-width coverage without deleting the retained result',async()=>{
 const f=fixture(),res={...f.res,road_context:{source:'fixture-deck-v3'},roads:[{line:[[0,0],[1,1]]}],road_building_footprints:[[[0,0],[1,0],[0,1]]]};
 const before=JSON.stringify(res),job=f.load('older',res);assert.equal(f.calls.footprints,1);f.footprintResolvers[0]([]);const refreshed=await job;
 assert.equal(refreshed.road_surface_version,1);assert.equal(JSON.stringify(res),before);
});
