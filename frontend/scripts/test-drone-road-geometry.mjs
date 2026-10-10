import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
function functionSource(file,name){const text=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast).replace(/^export /,'');}
const source=functionSource('surfaceGeometry.ts','surfaceGeometryRules')+'\n'+functionSource('roadApproaches.ts','roadApproachHeight')+'\n'+functionSource('droneRoads.ts','roadWorkerMain');
const lat=37,lon=127,kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
const feature=(id,line,props)=>({id,properties:props,geometry:{type:'LineString',coordinates:line.map(([x,y])=>[lon+x/kx,lat+y/ky])}});
const road=(line,width=12)=>feature('road',line,{rvwd:width,rdln:Math.floor(width/3.3)});
const link=(id,line,type)=>feature(id,line,{rd_type_h:type});
const grid=(height=()=>0)=>{const n=251,R=500,cell=4;return {n,R,cell,ox:0,oy:0,h:Float32Array.from({length:n*n},(_,k)=>height((k%n)*cell-R,Math.floor(k/n)*cell-R))};};
async function run(roads,links=[],box=[-100,-100,100,100],g=grid(),options={}){
  let out,calls=0;const self={__roadRules:null,postMessage:v=>out=v};
  const scope={self,performance,setTimeout,AbortSignal,fetch:async()=>({ok:true,json:async()=>({crossings:[]})}),importScripts:url=>{calls++;if(options.fail)throw Error('unavailable');const cb=url==='roads'?'roadCb':'linkCb';self[cb]({response:{status:options.rejectFirst&&calls===1?'ERROR':'OK',result:{featureCollection:{features:url==='roads'?roads:links}}}});}};
  vm.runInNewContext(transformSync(source+'\nself.__roadRules=surfaceGeometryRules();self.__approachHeight=roadApproachHeight;roadWorkerMain();',{loader:'ts'}).code,scope);
  await self.onmessage({data:{urls:['roads'],linkUrls:['links'],riverUrls:[],lat,lon,box,grid:g,wide:g,...options}});return {out,calls};
}
const near=(a,b,t=.0005)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('actual drone worker paves across a slope using the same 8 cm lift as the initial view',async()=>{const {out}=await run([road([[-150,0],[150,0]],24)],[],undefined,grid((x,y)=>x*.03+y*.12));assert.ok(out.surface);const p=out.surface.position;for(let i=0;i<p.length;i+=3)near(p[i+2],p[i]*.03+p[i+1]*.12+.08);assert.ok(new Set(Array.from(p).filter((_,i)=>i%3===1).map(v=>v.toFixed(2))).size>5);});
test('neighbouring tiles share exact position, height and curve normal at their boundary',async()=>{const source=[road([[-180,-40],[20,0],[180,50]])],a=(await run(source,[],[-160,-100,0,100])).out,b=(await run(source,[],[0,-100,160,100])).out;const edges=o=>{const p=o.surface.position;const edges=[];for(let i=0;i<p.length;i+=3)if(Math.abs(p[i])<3)edges.push([p[i],p[i+1],p[i+2]].map(v=>v.toFixed(5)).join(','));return new Set(edges);};const ea=edges(a),eb=edges(b);assert.ok([...ea].filter(x=>eb.has(x)).length>=5);});
test('official bridge profile uses full-link bank heights and adds no artificial 7 m clearance',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('bridge',[[-300,0],[300,0]],'교량')],undefined,grid((x)=>Math.abs(x)>250?10:0));assert.ok(out.bridges>0);for(let i=2;i<out.surface.position.length;i+=3)near(out.surface.position[i],10.08);});
test('water alone cannot reclassify a ground road as an elevated bridge',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{sea:[[[-200,-200],[200,-200],[200,200],[-200,200]]],seaLevel:0});assert.equal(out.bridges,0);for(let i=2;i<out.surface.position.length;i+=3)near(out.surface.position[i],.08);});
test('direction matching rejects a crossing overhead link',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('over',[[-0,-200],[0,200]],'고가도로')]);assert.equal(out.bridges,0);});
test('parallel ground metadata prevents borrowing a nearby elevated profile',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('ground',[[-200,0],[200,0]],'일반도로'),link('over',[[-200,1],[200,1]],'고가도로')]);assert.equal(out.bridges,0);});
test('failed geography is reported as failure so the world retries instead of accepting an empty road',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{fail:true});assert.equal(out,null);});
test('a temporary rejected geography response is retried successfully',async()=>{const {out,calls}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{rejectFirst:true});assert.ok(out.surface);assert.equal(calls,3);});
test('traffic lane heights follow the visible pavement',async()=>{const {out}=await run([road([[-150,0],[150,0]],12)],[],undefined,grid((x,y)=>y*.1));const v=out.lanes;for(let i=0;i<v.length;){const n=v[i];i+=2;for(let j=0;j<n;j++,i+=3)near(v[i+2],v[i+1]*.1+.08);}});
test('all curved road, paint, sidewalk and structural arrays remain finite',async()=>{const {out}=await run([road([[-150,0],[0,0],[0,70],[100,70]],24)]);for(const key of ['surface','marks','structure','walks'])if(out[key])for(const a of Object.values(out[key]))assert.ok(a.every(Number.isFinite));});
test('streamed bridge shares bank height and crossfall with a confirmed adjoining ground road',async()=>{
 const roads=[road([[-100,2],[0,2]],8),{...road([[0,2],[300,2]],8),id:'bridge-road'}],links=[link('ground-link',[[-120,2],[0,2]],'일반도로'),link('bridge-link',[[-8,0],[300,0]],'교량')];
 const {out}=await run(roads,links,[-100,-30,310,30],grid((x,y)=>x<=0?12+.05*x+.2*y:x>=300?35+.2*y:0));
 assert.ok(out.surface);const p=out.surface.position;let checked=0;
 for(let i=0;i<p.length;i+=3)if(Math.abs(p[i])<.001){near(p[i+2],12+p[i+1]*.2+.08,.02);checked++;}
 assert.ok(checked>=6);
 // Inside the transition, keep the connected bank tangent rather than the river-bed DEM.
 const grade=(35-11.6)/308,anchor=11.6+grade*8;
 let transition=0;
 for(let i=0;i<p.length;i+=3)if(p[i]>20&&p[i]<23){const x=p[i],u=x/90,expected=anchor+grade*x+(12+p[i+1]*.2-anchor)*(2*u*u*u-3*u*u+1)+(.05-grade)*90*(u*u*u-2*u*u+u)+.08;near(p[i+2],expected,.035);transition++;}
 assert.ok(transition>=3);
});
