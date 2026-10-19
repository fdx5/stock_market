import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['src/components/ringBuildings.ts'],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},loader:{'.wasm':'binary'}}).outputFiles[0].text;
const {ringBuildings}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('raw surrounding worker respects a clean cached parcel and retains old buildings outside',async()=>{
 const original={Worker:globalThis.Worker,Blob:globalThis.Blob,url:URL.createObjectURL,document:globalThis.document,raf:globalThis.requestAnimationFrame};let source;
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=()=>0;
 const feature=(x,floors,year,use)=>({properties:{grnd_flr:String(floors),height:String(floors*3),useapr_day:year?'19800101':'',usability:use},geometry:{type:'Polygon',coordinates:[[[x/111320,-5/110540],[(x+8)/111320,-5/110540],[(x+8)/111320,5/110540],[x/111320,5/110540],[x/111320,-5/110540]]]}});
 const features=[feature(-10,2,true,'01000'),feature(70,2,true,'01000'),feature(5,1,false,''),feature(12,30,false,'02000')];
 globalThis.Blob=class {constructor(parts){source=globalThis.__ringSource=parts.join('');}};URL.createObjectURL=()=> 'fixture';
 globalThis.Worker=class {
  constructor(){source??=globalThis.__ringSource;const self={postMessage:result=>this.onmessage({data:result})};this.ctx=vm.createContext({self,performance,Float32Array,Uint32Array,importScripts:()=>self.ringCb({response:{result:{featureCollection:{features}}}})});vm.runInContext(source,this.ctx);}
  postMessage(data){this.ctx.self.onmessage({data});}terminate(){}
 };
 try{
  const data={center:{lat:0,lon:0},vworld_key:'fixture',roads:[],cleared_site:{built:2022,rings:[[[-25,-25],[30,-25],[30,25],[-25,25]]]}};
  const result=await ringBuildings(data,new Float32Array(),{grid:null},{outer:150,floorM:{},seed:7});
  const centres=result.footprints.map(r=>r.reduce((s,p)=>s+p[0],0)/r.length);
  assert.equal(centres.length,3);assert.ok(centres.some(x=>x>70),'old neighbouring house remains');
  assert.ok(centres.some(x=>x>5&&x<12),'current annex remains');assert.ok(centres.some(x=>x>12&&x<25),'current tower remains');
  assert.ok(!centres.some(x=>x<0),'demolished house cannot return');
 }finally{globalThis.Worker=original.Worker;globalThis.Blob=original.Blob;URL.createObjectURL=original.url;globalThis.document=original.document;globalThis.requestAnimationFrame=original.raf;}
});
test('a named successor not yet linked replaces the demolished building it stands on; a copy of the same storeys does not',async()=>{
 const original={Worker:globalThis.Worker,Blob:globalThis.Blob,url:URL.createObjectURL,document:globalThis.document,raf:globalThis.requestAnimationFrame};let source;
 globalThis.document={hidden:false};globalThis.requestAnimationFrame=()=>0;
 const box=(x0,y0,w,h)=>[[[x0/111320,y0/110540],[(x0+w)/111320,y0/110540],[(x0+w)/111320,(y0+h)/110540],[x0/111320,(y0+h)/110540],[x0/111320,y0/110540]]];
 const rec=(x,w,props)=>({properties:props,geometry:{type:'Polygon',coordinates:box(x,-w/2,w,w)}});
 const features=[
  // 성수 SK V1 CENTER II over the 1985 building it replaced
  rec(0,30,{bld_nm:'성수 SK V1 CENTER II',grnd_flr:'12',height:'0'}),rec(4,22,{bld_nm:'아남회관',grnd_flr:'9',height:'38.35',useapr_day:'19850525',usability:'14000'}),
  // an unnamed old record under an unnamed... and a stray copy: same storeys, the register's name
  rec(200,30,{bld_nm:'래미안',grnd_flr:'15',height:'0'}),rec(204,22,{bld_nm:'래미안 101동',grnd_flr:'15',height:'45',useapr_day:'20100101',usability:'02000'}),
 ];
 globalThis.Blob=class {constructor(parts){source=globalThis.__ringSource=parts.join('');}};URL.createObjectURL=()=> 'fixture';
 globalThis.Worker=class {
  constructor(){source??=globalThis.__ringSource;const self={postMessage:result=>this.onmessage({data:result})};this.ctx=vm.createContext({self,performance,Float32Array,Uint32Array,importScripts:()=>self.ringCb({response:{result:{featureCollection:{features}}}})});vm.runInContext(source,this.ctx);}
  postMessage(data){this.ctx.self.onmessage({data});}terminate(){}
 };
 try{
  const data={center:{lat:0,lon:0},vworld_key:'fixture',roads:[]};
  const result=await ringBuildings(data,new Float32Array(),{grid:null},{outer:400,floorM:{},seed:7});
  const sizes=result.footprints.map(r=>Math.round(Math.max(...r.map(p=>p[0]))-Math.min(...r.map(p=>p[0]))));
  const xs=result.footprints.map(r=>r.reduce((s,p)=>s+p[0],0)/r.length);
  // (footprints: every record kept for the street cuts; buildings: those drawn)
  assert.equal(result.buildings,2,String(sizes)+" "+xs.map(Math.round));
  assert.ok(!result.footprints.some((r,i)=>xs[i]<100&&sizes[i]===22),'the 1985 building is gone');
  assert.ok(result.footprints.some((r,i)=>xs[i]<100&&sizes[i]===30),'its successor stands');
 }finally{globalThis.Worker=original.Worker;globalThis.Blob=original.Blob;URL.createObjectURL=original.url;globalThis.document=original.document;globalThis.requestAnimationFrame=original.raf;}
});
