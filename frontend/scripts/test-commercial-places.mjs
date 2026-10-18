import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
function load(file){const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',external:['three']}).outputFiles[0].text,{module,exports:module.exports,require,fetch,AbortController,setTimeout,clearTimeout,performance,console});return module.exports;}
const {namedBuildingKind:kind}=load('src/components/dronePlaceLabels.ts');
const {DronePlaceCells,PlaceFootprints,DronePlaces,placeGeometry}=load('src/components/sceneCommercialPlaces.ts');
const {DroneSigns}=load('src/components/droneSigns.ts');
const tick=()=>new Promise(r=>setImmediate(r));
const ring=[[0,0],[40,0],[40,40],[0,40],[0,0]];
test('named low-rise commerce, markets and local streets get signs in every tile',()=>{
 for(const n of ['신세계백화점','스타필드 고양','코스트코 의정부점','홈플러스','이마트','롯데프리미엄아울렛','트레이더스'])assert.equal(kind(n,'04000',2,8),'commercial',n);
 assert.equal(kind('의정부제일시장','03000',1,4),'market');assert.equal(kind('의정부부대찌개거리','retail',0,0),'district');
 assert.equal(kind('이마트24','convenience',1,4),null);assert.equal(kind('기계실','',1,4),null);
 assert.equal(kind('서울시청','',3,10),'gov');assert.equal(kind('한빛아파트','02000',10,30),'apt');
});
test('static national cells contain requested chains and all three Uijeongbu targets',()=>{
 const root=new URL('../public/3d/drone/places-20261018-v2/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
 const rows=manifest.cells.flatMap(k=>JSON.parse(readFileSync(new URL(k+'.json',root))));
 assert.equal(rows.length,Object.values(manifest.counts).reduce((a,b)=>a+b,0));assert.ok(manifest.cells.length<=700);
 for(const brand of ['스타필드','코스트코','홈플러스','이마트','백화점','아울렛'])assert.ok(rows.some(p=>p.name.includes(brand)),brand);
 for(const tenant of ['스피드메이트 스타필드하남점','라미 스타필드 하남점','(차지비) 스타필드하남점 전기차충전소'])assert.ok(!rows.some(p=>p.name===tenant),tenant);
 const s=rows.find(p=>p.id==='r17978074');assert.equal(s.name,'신세계백화점');assert.ok(s.models.some(m=>m.height===69));assert.ok(s.models.some(m=>m.minHeight===10&&m.height===40));assert.ok(s.website.startsWith('https:'));
 const m=rows.find(p=>p.id==='r18034176');assert.equal(m.kind,'market');assert.ok(m.models.some(p=>p.canopy&&p.minHeight>=6));
 const d=rows.find(p=>p.id==='w708733828');assert.equal(d.kind,'district');assert.ok(!d.models?.length);
 assert.ok(rows.every(p=>!p.uid&&!p.user&&!p.changeset));
});
test('cell loading retries failure, bounds requests and cancels late results',async()=>{
 let requests=0,active=0,max=0,failed=false;const pending=[];
 const cells=new DronePlaceCells(()=>{},async(url,{signal})=>{
   requests++;
   if(url.endsWith('manifest.json'))return {ok:true,json:async()=>({cell:.05,cells:['754_2540','754_2541','755_2540']})};
   if(!failed){failed=true;throw Error('upstream');}
   active++;max=Math.max(max,active);
   return await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{active--;reject(Error('abort'));});pending.push(()=>{active--;resolve({ok:true,json:async()=>[{id:'n1'}]});});});
 });
 cells.update(37.749,127.049);await tick();cells.update(37.749,127.049);await tick();
 cells.update(37.749,127.049,Date.now()+61000);await tick();assert.ok(max<=2);assert.ok(requests>=3);
 cells.dispose();for(const f of pending)f();await tick();assert.equal(cells.rows().length,0);
});
test('registered coverage suppresses fallback only after geometry readiness; neighbours remain independent',()=>{
 const idx=new PlaceFootprints();let ready=false;idx.set('tile',[ring],()=>ready);
 assert.equal(idx.covered(ring),false);ready=true;assert.equal(idx.covered(ring),true);
 assert.equal(idx.covered(ring.map(([x,y])=>[x+70,y])),false);idx.remove('tile');assert.equal(idx.covered(ring),false);
});
test('commercial register and place labels merge information, while separate mapped branches remain distinct',()=>{
 const signs=new DroneSigns();signs.set('tile',[{name:'스타필드 하남',kind:'commercial',x:10,y:10,top:45,n:1,info:{pnu:'fixture',floors:5}}]);
 const place=(id,x)=>({key:id,name:'스타필드 하남',kind:'commercial',x,y:10,top:30,n:1,info:{place:{category:'상업시설',sourceUrl:'https://www.openstreetmap.org/way/1'}}});
 signs.set('places',[place('place:w1',12),place('place:w2',450)]);
 const all=signs.all();assert.equal(all.length,2);assert.equal(all.find(s=>s.key==='place:w1').top,45);assert.equal(all.find(s=>s.key==='place:w1').info.pnu,'fixture');assert.ok(all.every(s=>s.info.place));
});
test('market canopy geometry preserves min height and courtyard holes',()=>{
 const hole=[[10,10],[10,30],[30,30],[30,10],[10,10]];
 const g=placeGeometry({rings:[ring,hole],height:7.5,minHeight:6},p=>p,12);g.computeBoundingBox();
 assert.equal(g.boundingBox.min.y,18);assert.equal(g.boundingBox.max.y,19.5);
 const a=g.attributes.position;let cap=0;
 for(let i=0;i<a.count;i+=3){if(a.getY(i)!==19.5||a.getY(i+1)!==19.5||a.getY(i+2)!==19.5)continue;
   cap+=Math.abs((a.getX(i+1)-a.getX(i))*(a.getZ(i+2)-a.getZ(i))-(a.getX(i+2)-a.getX(i))*(a.getZ(i+1)-a.getZ(i)))/2;
 }
 assert.equal(cap,1200);g.dispose();
});
test('a mapped place keeps its sign when a registered model takes over; all GPU resources release',()=>{
 let covered=false,labels,disposed=0;const layer=new DronePlaces({lat:37,lon:127,groundAt:()=>3,roofAt:()=>-1e4,covered:()=>covered,addWarm:(p,m)=>{m.geometry.addEventListener('dispose',()=>disposed++);p.add(m);},onLabels:(k,l)=>labels=l});
 layer.cells.dispose();layer.cells={update(){},rows:()=>[{id:'w1',name:'Test Mall',kind:'commercial',lat:37,lon:127,models:[{id:'a',rings:[[[127,37],[127.0001,37],[127.0001,37.0001],[127,37.0001],[127,37]]],height:12,minHeight:0}]}],dispose(){}};
 layer.update(0,0,1000);assert.equal(layer.root.children.length,1);assert.equal(labels.length,1);
 covered=true;layer.update(0,0,2000);assert.equal(layer.root.children.length,0);assert.equal(labels.length,1);assert.equal(disposed,1);
 layer.dispose();assert.equal(labels,null);assert.equal(layer.root.children.length,0);
});
