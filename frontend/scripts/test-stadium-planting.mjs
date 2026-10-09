import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const scope={module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/stadiumPlanting.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {jamsilTreeMask,stadiumTreeAllowed,withoutStadiumTrees}=scope.module.exports;
const origin={lat:37.5122,lon:127.0719};
const project=(lon,lat,o=origin)=>[(lon-o.lon)*Math.cos(o.lat*Math.PI/180)*111320,(lat-o.lat)*110540];
const planting=()=>({trees:[[0,0],[500,0]],street:[[0,0,1],[500,0,2]],groves:[{pattern:3,points:[[0,0],[500,0]]}],shrubs:[[0,0]],flowers:[[0,0]],grass:[[0,0]],woodlandFlowers:[{species:'daisy',points:[[0,0]]}]});

test('playing-field, stand and street-tree roots are excluded while exterior trees and field surfaces survive',()=>{
 const p=planting(),mask=jamsilTreeMask(origin.lat,origin.lon,680),out=withoutStadiumTrees(p,mask);
 assert.equal(out.trees.length,1);assert.equal(out.trees[0],p.trees[1]);
 assert.equal(out.street.length,1);assert.equal(out.street[0],p.street[1]);
 assert.equal(out.groves[0].pattern,3);assert.equal(out.groves[0].points[0],p.groves[0].points[1]);
 for(const key of ['shrubs','flowers','grass','woodlandFlowers'])assert.equal(out[key],p[key]);
 assert.equal(p.trees.length,2);assert.equal(p.groves[0].points.length,2);
 assert.equal(stadiumTreeAllowed(mask,...project(127.0717,37.5115)),false);
});
test('the real stadium outline retains exterior corner landscaping that a radius mask would clear',()=>{
 const mask=jamsilTreeMask(origin.lat,origin.lon,680);
 assert.equal(stadiumTreeAllowed(mask,78,-95),true);
 assert.equal(stadiumTreeAllowed(mask,0,0),false);
 for(const [x,y] of mask.ring)assert.equal(stadiumTreeAllowed(mask,x,y),false);
});
test('adjacent tile and view origins give identical decisions at geographic sample points',()=>{
 const origins=[origin,{lat:37.5103,lon:127.0707},{lat:37.5144,lon:127.0743}],masks=origins.map(o=>jamsilTreeMask(o.lat,o.lon,680));
 let cleared=0,retained=0;
 for(let ix=0;ix<31;ix++)for(let iy=0;iy<31;iy++){
  const lon=127.070+ix*.00012,lat=37.5108+iy*.00012;
  const decisions=origins.map((o,i)=>stadiumTreeAllowed(masks[i],...project(lon,lat,o)));
  assert.ok(decisions.every(v=>v===decisions[0]));if(decisions[0])retained++;else cleared++;
 }
 assert.ok(cleared>100&&retained>100);
});
test('unrelated areas retain the original planting object without filtering work',()=>{
 const p=planting();assert.equal(jamsilTreeMask(37.5796,126.977,680),null);
 assert.equal(withoutStadiumTrees(p,null),p);
 const out=withoutStadiumTrees({...p,groves:[{pattern:2,points:[[0,0]]}]},jamsilTreeMask(origin.lat,origin.lon,680));
 assert.equal(out.groves.length,0);
});
