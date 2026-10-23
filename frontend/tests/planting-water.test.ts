import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterPlanting,plantingWaterMask} from '../src/components/plantingWater';
import type {Planting} from '../src/components/complexScene';
import coast from './fixtures/haeundae-water.json';

const square=(x:number,y:number,s:number):[number,number][]=>[[x,y],[x+s,y],[x+s,y+s],[x,y+s]];
test('water polygons preserve their own islands, reject boundaries and union overlapping water',()=>{
  const wet=plantingWaterMask([{ring:square(0,0,100),islands:[square(20,20,20)]},{ring:square(25,25,5)}]);
  assert.equal(wet(10,10),true);assert.equal(wet(21,21),false);assert.equal(wet(27,27),true);
  assert.equal(wet(0,50),true);assert.equal(wet(20,30),true);assert.equal(wet(101,50),false);
});
test('every vegetation channel is filtered without changing input or species metadata',()=>{
  const points:[number,number][]=[[10,10],[150,150]];
  const p:Planting={trees:points,shrubs:points,flowers:points,grass:points,street:[[10,10,7],[150,150,9]],border:[[10,10,2],[150,150,3]],
    groves:[{pattern:4,points}],woodlandFlowers:[{points,species:2} as never]};
  const wet=plantingWaterMask([{ring:square(0,0,100)}]);
  const safe=filterPlanting(p,(x,y)=>!wet(x,y));
  for(const list of [safe.trees,safe.shrubs,safe.flowers,safe.grass!,safe.street,safe.border!,safe.groves![0].points,safe.woodlandFlowers![0].points])assert.equal(list.length,1);
  assert.equal(safe.street[0][2],9);assert.equal(safe.groves![0].pattern,4);assert.equal(p.trees.length,2);
  assert.equal(filterPlanting(safe,(x,y)=>!wet(x,y)),safe);
  assert.equal(filterPlanting(p,()=>false).trees.length,0);
});
test('late regional coverage rejects previous tile candidates using world coordinates',()=>{
  const p:Planting={trees:[[5,5],[80,80]],shrubs:[],flowers:[],street:[]};
  const wet=plantingWaterMask([{ring:square(1000,2000,50)}]);
  const safe=filterPlanting(p,(x,y)=>!wet(x+1000,y+2000));
  assert.deepEqual(safe.trees,[[80,80]]);assert.notEqual(safe,p);
});
test('Haeundae Jung-dong: actual offshore points cannot receive trees; inland stays plantable',()=>{
  const wet=plantingWaterMask(coast.rings as Parameters<typeof plantingWaterMask>[0]);
  const local=(lat:number,lon:number):[number,number]=>[(lon-coast.center.lon)*111320*Math.cos(coast.center.lat*Math.PI/180),(lat-coast.center.lat)*110540];
  for(const [lat,lon] of [[35.153,129.166],[35.153,129.173]])assert.equal(wet(...local(lat,lon)),true,`${lat},${lon}`);
  assert.equal(wet(...local(35.162,129.165)),false);
});
test('worker copies are self-contained and fail-closed when water is unknown',()=>{
  const workerMask=Function(`return (${plantingWaterMask.toString()})`)() as typeof plantingWaterMask;
  const workerFilter=Function(`return (${filterPlanting.toString()})`)() as typeof filterPlanting;
  const wet=workerMask([{ring:square(0,0,100)}]);
  const p:Planting={trees:[[5,5],[150,150]],shrubs:[],flowers:[],street:[]};
  assert.deepEqual(workerFilter(p,(x,y)=>!wet(x,y)).trees,[[150,150]]);
  assert.equal(workerFilter(p,()=>false).trees.length,0);
});
