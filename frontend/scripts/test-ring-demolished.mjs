import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['src/components/ringBuildings.ts'],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},loader:{'.wasm':'binary'}}).outputFiles[0].text;
const {ringBuildings}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('raw surrounding worker respects a clean cached parcel and retains old buildings outside',async()=>{
 const original={Worker:globalThis.Worker,Blob:globalThis.Blob,url:URL.createObjectURL};let source;
 const feature=(x,floors,year,use)=>({properties:{grnd_flr:String(floors),height:String(floors*3),useapr_day:year?'19800101':'',usability:use},geometry:{type:'Polygon',coordinates:[[[x/111320,-5/110540],[(x+8)/111320,-5/110540],[(x+8)/111320,5/110540],[x/111320,5/110540],[x/111320,-5/110540]]]}});
 const features=[feature(-10,2,true,'01000'),feature(70,2,true,'01000'),feature(5,1,false,''),feature(12,30,false,'02000')];
 globalThis.Blob=class {constructor(parts){source=parts.join('');}};URL.createObjectURL=()=> 'fixture';
 globalThis.Worker=class {
  constructor(){const self={postMessage:result=>this.onmessage({data:result})};this.ctx=vm.createContext({self,performance,Float32Array,Uint32Array,importScripts:()=>self.ringCb({response:{result:{featureCollection:{features}}}})});vm.runInContext(source,this.ctx);}
  postMessage(data){this.ctx.self.onmessage({data});}terminate(){}
 };
 try{
  const data={center:{lat:0,lon:0},vworld_key:'fixture',roads:[],cleared_site:{built:2022,rings:[[[-25,-25],[30,-25],[30,25],[-25,25]]]}};
  const result=await ringBuildings(data,new Float32Array(),{grid:null},{outer:150,floorM:{},seed:7});
  const centres=result.footprints.map(r=>r.reduce((s,p)=>s+p[0],0)/r.length);
  assert.equal(centres.length,3);assert.ok(centres.some(x=>x>70),'old neighbouring house remains');
  assert.ok(centres.some(x=>x>5&&x<12),'current annex remains');assert.ok(centres.some(x=>x>12&&x<25),'current tower remains');
  assert.ok(!centres.some(x=>x<0),'demolished house cannot return');
 }finally{globalThis.Worker=original.Worker;globalThis.Blob=original.Blob;URL.createObjectURL=original.url;}
});
