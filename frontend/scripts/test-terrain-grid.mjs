import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const scope={module:{exports:{}},exports:{},Float32Array,Math};
vm.runInNewContext(transformSync(readFileSync(new URL('../src/components/terrainGrid.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,scope);
const {sampleTerrainPosts,fillTerrainGrid}=scope.module.exports;
const tileSize=36/2**13,tx0=70000,ty0=28000,cols=3;
const tiles=Array.from({length:9},(_,tile)=>Float32Array.from({length:65*65},(_,i)=>tile*170+Math.sin(i/51)*30+i/113));
const posts={tiles,cols,tx0,tx1:tx0+2,ty0,ty1:ty0+2,tileSize};
// Independent reference: the deployed sampler's arithmetic and clamped posts.
function before(lo,la){
 const fx=(lo+180)/tileSize,fy=(la+90)/tileSize;
 const x=Math.min(tx0+2,Math.max(tx0,Math.floor(fx))),y=Math.min(ty0+2,Math.max(ty0,Math.floor(fy)));
 const t=tiles[(y-ty0)*cols+x-tx0];
 const u=Math.min(64,Math.max(0,(fx-x)*64)),v=Math.min(64,Math.max(0,(1-(fy-y))*64));
 const c=Math.min(63,Math.floor(u)),r=Math.min(63,Math.floor(v)),a=u-c,b=v-r;
 return (t[r*65+c]*(1-a)+t[r*65+c+1]*a)*(1-b)+(t[(r+1)*65+c]*(1-a)+t[(r+1)*65+c+1]*a)*b;
}
test('worker sampling preserves every source post, edge clamp and bilinear value exactly',()=>{
 for(let i=-30;i<=240;i++)for(let j=-30;j<=240;j++){
  const lo=(tx0+i/65)*tileSize-180,la=(ty0+j/65)*tileSize-90;
  assert.equal(sampleTerrainPosts(posts,lo,la),before(lo,la));
 }
});
test('tile-grid transfer preserves Float32 heights and cached source buffers',()=>{
 const job={posts,lon:(tx0+1.5)*tileSize-180,lat:(ty0+1.5)*tileSize-90,kx:90000,ky:110540,base:75,cx:170,cy:-170,R:330,cell:4,n:166};
 const saved=tiles.map(t=>t.slice()),actual=fillTerrainGrid(structuredClone(job)),expected=new Float32Array(job.n*job.n);
 for(let j=0;j<job.n;j++)for(let i=0;i<job.n;i++)expected[j*job.n+i]=before(job.lon+(job.cx-job.R+i*job.cell)/job.kx,job.lat+(job.cy-job.R+j*job.cell)/job.ky)-job.base;
 assert.deepEqual(actual,expected);tiles.forEach((t,i)=>assert.deepEqual(t,saved[i]));
});
