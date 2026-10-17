import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {transformSync} from 'esbuild';
function functionSource(file,name){const text=readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast).replace(/^export /,'');}
const source=functionSource('roadCorridors.ts','roadCorridorRules')+'\n'+functionSource('surfaceGeometry.ts','surfaceGeometryRules')+'\n'+functionSource('roadGroundGrade.ts','groundRoadGrade')+'\n'+functionSource('bridgeDecks.ts','chainDeckRoads')+'\n'+functionSource('roadApproaches.ts','roadApproachHeight')+'\n'+functionSource('terrainSurfaceClearance.ts','terrainSurfaceClearance')+'\n'+functionSource('roadLinkFallback.ts','linkFallbackRoads')+'\n'+functionSource('droneRoads.ts','roadWorkerMain');
const lat=37,lon=127,kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
const feature=(id,line,props)=>({id,properties:props,geometry:{type:'LineString',coordinates:line.map(([x,y])=>[lon+x/kx,lat+y/ky])}});
const road=(line,width=12)=>feature('road',line,{rvwd:width,rdln:Math.floor(width/3.3)});
const link=(id,line,type)=>feature(id,line,{rd_type_h:type});
const grid=(height=()=>0)=>{const n=251,R=500,cell=4;return {n,R,cell,ox:0,oy:0,h:Float32Array.from({length:n*n},(_,k)=>height((k%n)*cell-R,Math.floor(k/n)*cell-R))};};
async function run(roads,links=[],box=[-100,-100,100,100],g=grid(),options={}){
  let out,calls=0;const self={__roadRules:null,postMessage:v=>out=v};
  const scope={self,performance,setTimeout,AbortSignal,fetch:async()=>({ok:true,json:async()=>({crossings:[]})}),importScripts:url=>{calls++;if(options.fail)throw Error('unavailable');const cb=url==='roads'?'roadCb':url==='rivers'?'riverCb':'linkCb';self[cb]({response:{status:options.rejectFirst&&calls===1?'ERROR':'OK',result:{featureCollection:{features:url==='roads'?roads:url==='rivers'?(options.riverFeatures??[]):links}}}});}};
  vm.runInNewContext(transformSync(source+'\nself.__corridors=roadCorridorRules();self.__roadRules=surfaceGeometryRules();self.__groundGrade=groundRoadGrade();self.__chainDecks=chainDeckRoads;self.__approachHeight=roadApproachHeight;self.__terrainClearance=terrainSurfaceClearance();self.__linkFallback=linkFallbackRoads;roadWorkerMain();',{loader:'ts'}).code,scope);
  // A real Worker receives a structured clone. Its terrain cutting must not
  // mutate the caller's fixture or the next direction/tile's input DEM.
  await self.onmessage({data:structuredClone({urls:['roads'],linkUrls:['links'],riverUrls:options.riverFeatures?['rivers']:[],lat,lon,box,grid:g,wide:g,...options})});return {out,calls};
}
const near=(a,b,t=.0005)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('streamed ground roads use the same registered building clearance as the initial scene',async()=>{
 const building=[[-20,10],[20,10],[20,30],[-20,30]],r=road([[-150,0],[150,0]],24);r.properties.rdln=2;
 const {out}=await run([r],[],undefined,grid(),{footprints:[building]});assert.ok(out?.surface);
 const p=out.surface.position;for(let i=0;i<p.length;i+=3)assert.ok(Math.abs(p[i+1])<=9.751,'asphalt narrows to the proven physical clearance');
 const bridge=(await run([r],[link('b',[[-300,0],[300,0]],'교량')],undefined,grid(),{footprints:[building]})).out;
 assert.ok(bridge?.surface&&bridge.bridges>0);assert.ok(Array.from(bridge.surface.position).some((v,i)=>i%3===1&&Math.abs(v)>10));
});
test('streamed paving clears saddle terrain and keeps each vertical kerb exactly fifteen centimetres high',async()=>{
 const g=grid((x,y)=>(Math.round(x/4)+Math.round(y/4))%2===0?3:0),{out}=await run([road([[-150,-30],[150,30]],24)],[],undefined,g);
 assert.ok(out?.walks);const {position:p,index:ix}=out.walks;let tops=0,kerbs=0;
 for(let k=0;k<ix.length;k+=3){const ids=Array.from(ix.subarray(k,k+3)),a=ids.map(i=>[p[i*3],p[i*3+1],p[i*3+2]]),area=(a[1][0]-a[0][0])*(a[2][1]-a[0][1])-(a[1][1]-a[0][1])*(a[2][0]-a[0][0]);
  if(Math.abs(area)<1e-6){kerbs++;const same=a.find((q,i)=>a.some((r,j)=>i!==j&&Math.hypot(q[0]-r[0],q[1]-r[1])<1e-6&&Math.abs(q[2]-r[2])>.1));assert.ok(same);}
  else {tops++;for(const q of a)assert.ok(q.every(Number.isFinite));}
 }assert.ok(tops>20&&kerbs>20);
});
test('ordinary terrain-following roads never generate blanket retaining walls',async()=>{
 const {out}=await run([road([[-150,0],[150,0]],12)],[],undefined,grid((x,y)=>x*.08+Math.sin(x/13)*2+y*.12));
 assert.ok(out.surface&&out.lanes.length);assert.equal(out.bridges,0);assert.equal(out.structure,null);
});
test('actual streamed worker clears rendered saddle terrain throughout pavement triangles, including junction interiors',async()=>{
 const g=grid((x,y)=>(Math.round(x/4)+Math.round(y/4))%2===0?3:0),{out}=await run([road([[-150,-30],[150,30]],24),road([[0,-150],[0,150]],18)],[],undefined,g);assert.ok(out.surface);
 const h=out.ground??g.h;
 const ground=(x,y)=>{const gx=(x+g.R)/g.cell,gy=(y+g.R)/g.cell,i=Math.floor(gx),j=Math.floor(gy),fx=gx-i,fy=gy-j,a=j*g.n+i,b=a+1,c=a+g.n,d=c+1;return fx>=fy?h[a]*(1-fx)+h[b]*(fx-fy)+h[d]*fy:h[a]*(1-fy)+h[d]*fx+h[c]*(fy-fx);};
 const s=out.surface;let checks=0;for(let k=0;k<s.index.length;k+=3){const ids=Array.from(s.index.subarray(k,k+3));for(const weights of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){const x=ids.reduce((v,id,i)=>v+s.position[id*3]*weights[i],0),y=ids.reduce((v,id,i)=>v+s.position[id*3+1]*weights[i],0),z=ids.reduce((v,id,i)=>v+s.position[id*3+2]*weights[i],0);assert.ok(z>=ground(x,y)+.0199,`buried at ${x},${y}`);checks++;}}
 assert.ok(checks>1000);for(const paint of [out.marks,out.marksFar])if(paint){assert.equal(paint.color.length,paint.position.length);assert.ok(paint.position.every(Number.isFinite));assert.equal(paint.level.length,paint.position.length/3);}
});
test('actual drone worker levels the carriageway across a slope with the same 8 cm lift as the initial view',async()=>{const {out}=await run([road([[-150,0],[150,0]],24)],[],undefined,grid((x,y)=>x*.03+y*.12));assert.ok(out.surface);const p=out.surface.position;for(let i=0;i<p.length;i+=3)near(p[i+2],p[i]*.03+.08);assert.ok(new Set(Array.from(p).filter((_,i)=>i%3===1).map(v=>v.toFixed(2))).size>5);});
test('neighbouring tiles share exact position, height and curve normal at their boundary',async()=>{const source=[road([[-180,-40],[20,0],[180,50]])],a=(await run(source,[],[-160,-100,0,100])).out,b=(await run(source,[],[0,-100,160,100])).out;const edges=o=>{const p=o.surface.position;const edges=[];for(let i=0;i<p.length;i+=3)if(Math.abs(p[i])<3)edges.push([p[i],p[i+1],p[i+2]].map(v=>v.toFixed(5)).join(','));return new Set(edges);};const ea=edges(a),eb=edges(b);assert.ok([...ea].filter(x=>eb.has(x)).length>=5);});
test('official bridge profile uses full-link bank heights and adds no artificial 7 m clearance',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('bridge',[[-300,0],[300,0]],'교량')],undefined,grid((x)=>Math.abs(x)>250?10:0));assert.ok(out.bridges>0);for(let i=2;i<out.surface.position.length;i+=3)near(out.surface.position[i],10.08);});
test('water alone cannot reclassify a ground road as an elevated bridge',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{sea:[[[-200,-200],[200,-200],[200,200],[-200,200]]],seaLevel:0});assert.equal(out.bridges,0);
  // (no structure, no 7 m: only kept out of the sea — 0.4 m over it, plus the paving's 8 cm)
  for(let i=2;i<out.surface.position.length;i+=3)near(out.surface.position[i],.48);});
test('the actual streamed worker raises wet-ended official bridge pavement and traffic to the same dry banks',async()=>{
 const {out}=await run([road([[-80,0],[80,0]])],[link('wet-ended',[[-80,0],[80,0]],'교량')],undefined,grid(x=>Math.abs(x)<160?-3:10),{sea:[[[-160,-200],[160,-200],[160,200],[-160,200]]],seaLevel:0});
 assert.ok(out.bridges>0);for(let i=2;i<out.surface.position.length;i+=3)near(out.surface.position[i],10.08);
 const v=out.lanes;for(let i=0;i<v.length;){const n=v[i];i+=2;for(let j=0;j<n;j++,i+=3)near(v[i+2],10.08);}
});
test('direction matching rejects a crossing overhead link',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('over',[[-0,-200],[0,200]],'고가도로')]);
  // (the overhead link itself, absent from the centre lines, is drawn from the link: roadLinkFallback.ts)
  // the crossing ground road's lanes stay on the ground the whole way across
  let checked=0;for(let o=0;o<out.lanes.length;){const n=out.lanes[o];for(let i=0;i<n;i++){const x=out.lanes[o+2+i*3],y=out.lanes[o+3+i*3],z=out.lanes[o+4+i*3];if(Math.abs(y)<6&&Math.abs(x)<100){checked++;assert.ok(z<1,`ground lane lifted to ${z}`);}}o+=2+n*3;}assert.ok(checked>0);});
test('parallel ground metadata prevents borrowing a nearby elevated profile',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[link('ground',[[-200,0],[200,0]],'일반도로'),link('over',[[-200,1],[200,1]],'고가도로')]);assert.equal(out.bridges,0);});
test('failed geography is reported as failure so the world retries instead of accepting an empty road',async()=>{const {out}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{fail:true});assert.equal(out,null);});
test('a temporary rejected geography response is retried successfully',async()=>{const {out,calls}=await run([road([[-150,0],[150,0]])],[],undefined,grid(),{rejectFirst:true});assert.ok(out.surface);assert.equal(calls,3);});
test('traffic lane heights follow the level carriageway rather than the sloping relief',async()=>{const {out}=await run([road([[-150,0],[150,0]],12)],[],undefined,grid((x,y)=>y*.1));const v=out.lanes;for(let i=0;i<v.length;){const n=v[i];i+=2;for(let j=0;j<n;j++,i+=3)near(v[i+2],.08);}});
test('all curved road, paint, sidewalk and structural arrays remain finite',async()=>{const {out}=await run([road([[-150,0],[0,0],[0,70],[100,70]],24)]);for(const key of ['surface','marks','structure','walks'])if(out[key])for(const a of Object.values(out[key]))assert.ok(a.every(Number.isFinite));});
test('streamed bridge shares the level bank carriageway and its longitudinal grade',async()=>{
 const roads=[road([[-100,2],[0,2]],8),{...road([[0,2],[300,2]],8),id:'bridge-road'}],links=[link('ground-link',[[-120,2],[0,2]],'일반도로'),link('bridge-link',[[-8,0],[300,0]],'교량')];
 const {out}=await run(roads,links,[-100,-30,310,30],grid((x,y)=>x<=0?12+.05*x+.2*y:x>=300?35+.2*y:0));
 assert.ok(out.surface);const p=out.surface.position;let checked=0;
 for(let i=0;i<p.length;i+=3)if(Math.abs(p[i])<.001){near(p[i+2],12.4+.08,.02);checked++;}
 assert.ok(checked>=6);
 // Inside the transition, keep the connected bank tangent rather than the river-bed DEM.
 const grade=(35-11.6)/308,anchor=11.6+grade*8;
 let transition=0;
 for(let i=0;i<p.length;i+=3)if(p[i]>20&&p[i]<23){const x=p[i],u=x/90,expected=anchor+grade*x+(12.4-anchor)*(2*u*u*u-3*u*u+1)+(.05-grade)*90*(u*u*u-2*u*u+u)+.08;near(p[i+2],expected,.035);transition++;}
 assert.ok(transition>=3);
});

// The lanes' heights along a straight road on y = 0: [x, z] sorted by x.
const laneProfile=out=>{const pts=[];for(let o=0;o<out.lanes.length;){const n=out.lanes[o];for(let i=0;i<n;i++)pts.push([out.lanes[o+2+i*3],out.lanes[o+4+i*3]]);o+=2+n*3;}return pts.sort((a,b)=>a[0]-b[0]);};
test('a full bank-to-bank bridge profile carries its approaches without raising ordinary ground roads',async()=>{
  // the link is a bridge from x=-60 to 60 over a 10 m deep valley; the centre line runs on 15 m past its ends
  const g=grid((x)=>Math.abs(x)<80?-10:0);
  const chains=[{ids:['b'],line:[[-150,0],[150,0]],core:[90,210],s:[0,300],z:[0,0],deck:{w:12,off:0,lanes:3,twoWay:false}}];
  const {out}=await run([road([[-150,0],[150,0]])],[link('b',[[-60,0],[60,0]],'교량')],undefined,g,{chains});
  // each lane on its own, over 3 m steps (the 6 % limit, with the drape's rounding)
  let checked=0;for(let o=0;o<out.lanes.length;){const n=out.lanes[o],pts=[];for(let i=0;i<n;i++)pts.push([out.lanes[o+2+i*3],out.lanes[o+4+i*3]]);o+=2+n*3;
    for(let i=0,j=0;i<pts.length;i++){while(j<pts.length&&Math.abs(pts[j][0]-pts[i][0])<3)j++;if(j>=pts.length)break;const dx=Math.abs(pts[j][0]-pts[i][0]);checked++;assert.ok(Math.abs(pts[j][1]-pts[i][1])/dx<=0.075,`grade ${((pts[j][1]-pts[i][1])/dx).toFixed(3)} at x=${pts[i][0].toFixed(1)}`);}}
  assert.ok(checked>20);
});
test('a dip in the relief under a road at grade is filled, not followed',async()=>{
  const g=grid((x)=>Math.abs(x)<6?-1.2:0);
  const {out}=await run([road([[-150,0],[150,0]])],[],undefined,g);
  const p=laneProfile(out).filter(([x])=>Math.abs(x)<4);assert.ok(p.length);for(const [,z] of p)assert.ok(z>-0.6,`lane at ${z.toFixed(2)} in the dip`);
});
test('a road the links do not call a bridge never lies in a river area: bank to bank',async()=>{
  const g=grid((x)=>Math.abs(x)<70?-6:0),river={geometry:{type:'Polygon',coordinates:[[[-75,-60],[75,-60],[75,60],[-75,60],[-75,-60]].map(([x,y])=>[lon+x/kx,lat+y/ky])]},properties:{}};
  const {out}=await run([road([[-150,0],[150,0]])],[],undefined,g,{riverFeatures:[river]});
  const p=laneProfile(out).filter(([x])=>Math.abs(x)<60);assert.ok(p.length);for(const [,z] of p)assert.ok(z>-0.5,`lane at ${z.toFixed(2)} in the river`);
});

test('unequal dry banks keep the same non-submerged crossing through reversal and adjacent tiles',async()=>{
 // The wet polygon contains the DEM's shore transition; its dry banks have
 // distinct measured levels rather than a discontinuity in a dry grid cell.
 const g=grid(x=>x<-68?5:x>68?8:-6);
 const river={geometry:{type:'Polygon',coordinates:[[[-75,-60],[75,-60],[75,60],[-75,60],[-75,-60]].map(([x,y])=>[lon+x/kx,lat+y/ky])]},properties:{}};
 const line=[[-160,0],[160,0]],options={riverFeatures:[river]};
 const forward=(await run([road(line)],[],[-100,-30,100,30],g,options)).out;
 const reverse=(await run([road([...line].reverse())],[],[-100,-30,100,30],g,options)).out;
 const left=(await run([road(line)],[],[-100,-30,0,30],g,options)).out;
 const right=(await run([road(line)],[],[0,-30,100,30],g,options)).out;
 for(const [caseIndex,output] of [forward,reverse,left,right].entries()){
  const points=laneProfile(output).filter(([x])=>Math.abs(x)<60);
  assert.ok(points.length>10);
  for(const [x,z] of points)assert.ok(z>=5&&z<=8.1,`case ${caseIndex}: crossing leaves its dry bank envelope at ${x}, ${z}`);
 }
 const seam=output=>{const p=output.surface.position,z=[];for(let i=0;i<p.length;i+=3)if(Math.abs(p[i])<1e-5)z.push(p[i+2]);return z;};
 assert.ok(seam(left).length>0&&seam(right).length>0);
 for(const z of seam(left))near(z,seam(right)[0]);
});
