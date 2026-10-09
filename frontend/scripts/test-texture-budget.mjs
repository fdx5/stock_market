import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync}from'node:fs';
import {build,transformSync}from'esbuild';
import vm from'node:vm';
import path from'node:path';
import {fileURLToPath,pathToFileURL}from'node:url';
import * as THREE from'three';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'tmp','budget-tests.mjs');
await build({stdin:{contents:"export {decodeTreeVariants} from './src/components/treeGeometry';export {densityCrown,shapeSpeciesCrown} from './src/components/densityTreeGeometry';export {assembleBudgetForest} from './src/components/budgetForestGeometry';export {packTrees,unpackTrees} from './src/components/treeGeometryWire';export {carGeometry,CAR_SPECS} from './src/components/sceneCars';export {drapeRoadSurface} from './src/components/roadDrape';export {drapeRoadOffThread} from './src/components/roadDrapeClient';export {plantingSnapshot,samePlanting} from './src/components/plantingSnapshot';export {treeMeshModel,groveForest} from './src/components/sceneGroves';export {PARK_TREE_STYLES,WOODLAND_FLOWERS,woodlandBeds} from './src/components/landscapeDiversity';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',external:['three'],define:{'import.meta.env':'{}'},loader:{'.wasm':'binary'},outfile:file});
const {decodeTreeVariants,densityCrown,shapeSpeciesCrown,assembleBudgetForest,packTrees,unpackTrees,carGeometry,CAR_SPECS,drapeRoadSurface,drapeRoadOffThread,treeMeshModel,groveForest,plantingSnapshot,samePlanting,PARK_TREE_STYLES,WOODLAND_FLOWERS,woodlandBeds}=await import(pathToFileURL(file));
const toneFile=path.join(root,'tmp','foliage-tests.mjs');
await build({entryPoints:[path.join(root,'src/components/foliageTone.ts')],bundle:true,platform:'node',format:'esm',outfile:toneFile});
const {treeFoliageTone,FOLIAGE_TONES}=await import(pathToFileURL(toneFile));
const layoutFile=path.join(root,'tmp','layout-tests.mjs');
await build({stdin:{contents:"export {streetLamps} from './src/components/complexScene';export {carriageway} from './src/components/sceneSidewalk';export {roadJunctionHulls} from './src/components/roadJunctions';export {inRing} from './src/components/ringMath';export {woodlandDensity} from './src/components/sceneGroves';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',external:['three'],define:{'import.meta.env':'{}'},loader:{'.wasm':'binary'},outfile:layoutFile});
const {streetLamps,carriageway,roadJunctionHulls,inRing,woodlandDensity}=await import(pathToFileURL(layoutFile));
const json=name=>JSON.parse(readFileSync(path.join(root,'public/3d',name),'utf8'));
const raw=readFileSync(path.join(root,'public/3d/trees.bin'));
const variants=await decodeTreeVariants(json('trees.json'),raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),json('twigs.json'),async()=>{},false);
test('the tested compact scene is default and legacy comparison remains explicit',()=>{
 const code=transformSync(readFileSync(path.join(root,'src/components/textureBudget.ts'),'utf8'),{loader:'ts',format:'cjs'}).code;
 for(const[search,expected]of [['',true],['?sceneBudget=texture',true],['?sceneBudget=standard',false]]){const scope={module:{exports:{}},exports:{},URLSearchParams,location:{search}};vm.runInNewContext(code,scope);assert.equal(scope.module.exports.textureBudgetEnabled(),expected);}
});

test('photographic crown groups retain the original species volume without unbounded growth',()=>{
 let before=0,after=0;
 for(const list of variants.values())for(const v of list)if(v.twig){
  const grouped=densityCrown(v.leaves,2,0);v.leaves.computeBoundingBox();
  const P=grouped.attributes.position;for(let i=0;i<P.count;i++){
   const point=new THREE.Vector3().fromBufferAttribute(P,i);
   for(const a of ['x','y','z'])assert.ok(point[a]>=v.leaves.boundingBox.min[a]-1e-5&&point[a]<=v.leaves.boundingBox.max[a]+1e-5);
  }
  before+=v.leaves.index.count;after+=grouped.index.count;
  for(const n of grouped.attributes.normal.array)assert.ok(Number.isFinite(n));
 }
 assert.ok(after<before*.04);console.log(JSON.stringify({crownReduction:1-after/before}));
});

test('compact tree assets retain all 66 variants, valid attributes and indexed triangles',()=>{
 const meta=json('trees-compact.json'),data=readFileSync(path.join(root,'public/3d/trees-compact.bin'));
 assert.equal(meta.variants.length,66);assert.deepEqual(meta.species,json('trees.json').species);assert.ok(data.length<raw.length*.6);
 for(const p of meta.parts){const pos=p.attributes.position?.count??0,vertices=pos/3;assert.equal(pos%3,0);
  for(const[name,a]of Object.entries(p.attributes)){assert.equal(a.count/a.size,vertices);assert.ok(a.offset+a.count*4<=data.length);}
  assert.equal(p.index.count%3,0);assert.ok(p.index.offset+p.index.count*4<=data.length);
  for(let i=0;i<p.index.count;i++)assert.ok(data.readUInt32LE(p.index.offset+i*4)<vertices);
 }
});

test('procedural trees keep species metadata without downloading obsolete cotton-shaped shells',()=>{
 const meta=json('trees-compact.json'),species=new Set(['zelkova','plane','ginkgo','cherry','fringe','pine','conifer']);
 for(const v of meta.variants.filter(v=>species.has(v.v.species))){assert.ok(v.v.height>1.6);assert.ok(v.parts.every(id=>meta.parts[id].index.count===0));}
 for(const v of meta.variants.filter(v=>!species.has(v.v.species)))assert.ok(meta.parts[v.parts[1]].index.count>0);
});

test('five species silhouettes differ without growing the source bounds or triangle budget',()=>{
 const source=new THREE.BoxGeometry(6,10,6).translate(0,6,0);source.computeBoundingBox();
 const shapes=new Map();
 for(const style of PARK_TREE_STYLES){
  const g=shapeSpeciesCrown(source.clone(),style.species);g.computeBoundingBox();
  assert.equal(g.index.count,source.index.count);assert.ok(source.boundingBox.containsBox(g.boundingBox));
  shapes.set(style.species,g);for(const value of g.attributes.normal.array)assert.ok(Number.isFinite(value));
 }
 assert.equal(new Set([...shapes.values()].map(g=>JSON.stringify(Array.from(g.attributes.position.array)))).size,5);
 const size=name=>shapes.get(name).boundingBox.getSize(new THREE.Vector3());
 assert.ok(size('ginkgo').x<size('zelkova').x);assert.ok(size('pine').y<size('zelkova').y);
 const cone=shapes.get('conifer'),p=cone.attributes.position,top=[],bottom=[];
 for(let i=0;i<p.count;i++)(p.getY(i)>10?top:bottom).push(Math.abs(p.getX(i)));
 assert.ok(Math.max(...top)<Math.max(...bottom)*.3);
});

test('woodland beds keep six species, exclude blocked ground and preserve clear canopy gaps',()=>{
 const patches=Array.from({length:30},(_,i)=>({pattern:i%4,points:Array.from({length:8},(_,j)=>[i*30+(j%4)*5,Math.floor(j/4)*5])}));
 const free=(x,y)=>x>=0&&y>=0&&!(x>80&&x<90);
 const a=woodlandBeds(patches,free,719,WOODLAND_FLOWERS,180),b=woodlandBeds(patches,free,719,WOODLAND_FLOWERS,180);
 assert.deepEqual(a,b);assert.equal(new Set(a.beds.map(b=>b.species)).size,6);
 assert.ok(a.beds.reduce((n,b)=>n+b.points.length,0)<=180);
 for(const bed of a.beds)for(const[x,y]of bed.points)assert.ok(free(x,y));
 assert.ok(a.groves.reduce((n,p)=>n+p.points.length,0)<patches.reduce((n,p)=>n+p.points.length,0));
 assert.equal(patches.reduce((n,p)=>n+p.points.length,0),240);
});

test('tree templates use distinct thin leaf outlines, visible trunks and three limbs',()=>{
 for(let species=0;species<5;species++){
  const geo=treeMeshModel(species),m=geo.userData.treeModel,p=geo.attributes.position;
  assert.equal(m.leafTriangles,768);assert.equal(m.treeTriangles,800);assert.equal(m.leafVertices,2304);assert.ok(m.exposedTrunk>4);
  assert.equal(geo.index.count/3,m.treeTriangles);
  for(let leaf=0;leaf<192;leaf++){
   const points=[];for(let i=leaf*12;i<(leaf+1)*12;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i);if(!points.some(q=>q.distanceTo(v)<1e-5))points.push(v);}
   assert.equal(points.length,4,'each leaf is a nonrectangular closed shape');
   const[a,b,c,d]=points;assert.ok(Math.abs(b.clone().sub(a).cross(c.clone().sub(a)).dot(d.clone().sub(a)))>.005,'leaves have thickness, not billboard planes');
  }
  geo.dispose();
 }
});

test('leaf and bark surfaces are closed and face outward after position welding',()=>{
 for(let species=0;species<5;species++){
  const geo=treeMeshModel(species),p=geo.attributes.position,idx=geo.index.array,edges=new Map();
  const vertex=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
  for(let i=0;i<idx.length;i+=3){const[a,b,c]=Array.from(idx.slice(i,i+3));
   for(const[u,v]of [[a,b],[b,c],[c,a]]){const key=[vertex(u),vertex(v)].sort().join(':');edges.set(key,(edges.get(key)??0)+1);}
   const A=new THREE.Vector3().fromBufferAttribute(p,a),B=new THREE.Vector3().fromBufferAttribute(p,b),C=new THREE.Vector3().fromBufferAttribute(p,c),face=B.sub(A).cross(C.sub(A));
   const n=[a,b,c].reduce((n,v)=>n.add(new THREE.Vector3().fromBufferAttribute(geo.attributes.normal,v)),new THREE.Vector3());assert.ok(face.dot(n)>0);
  }
  assert.ok([...edges.values()].every(n=>n===2));geo.dispose();
 }
});

test('dense shared forest preserves five silhouettes, leaf-only tint and terrain roots with small buffers',async()=>{
 const points=Array.from({length:6400},(_,i)=>[i%80*5.5,Math.floor(i/80)*5.5]),terrain={at:(x,y)=>x*.2+y*.05};
 const built=await groveForest([{pattern:0,points}],terrain,71,null,false,1,async()=>{}),b=built.group.userData.forestBudget;
 assert.equal(Object.keys(b.speciesCounts).length,5);assert.ok(built.group.children.length<=64);
 const far=built.group.children.filter(m=>m.userData.forestLod);
 assert.ok(far.length>0&&far.every(m=>m.count<=1024),'distant crowns use bounded spatial batches');
 assert.ok(built.group.children.filter(m=>m.name.endsWith('trunks')).every(m=>m.count<=4096));
 assert.ok(b.clusterCanopies>100,'keep forest density instead of funding shape by removing most trees');
 assert.ok(b.totalBufferBytes<b.cardBufferBytes*.7);assert.ok(b.minExposedTrunk>3,'woodland retains the previous visible-trunk quality floor');
 assert.ok(b.maxTreeHeight/b.minTreeHeight>2,'young trees and tall mature trees must coexist');
 assert.ok(b.clusterCanopies>800,'woodland should visibly fill the plantable fixture');
 for(const mesh of built.group.children){assert.ok(mesh.isInstancedMesh);assert.equal(mesh.material.alphaTest,0);assert.equal(mesh.material.side,THREE.FrontSide);assert.ok(mesh.boundingSphere.radius>0);
  if(mesh.name.endsWith('trunks'))assert.equal(mesh.instanceColor,null);else assert.ok(mesh.instanceColor);
  const m=new THREE.Matrix4();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);const p=new THREE.Vector3().setFromMatrixPosition(m);assert.ok(points.some(q=>Math.abs(q[0]-p.x)<.001&&Math.abs(q[1]+p.z)<.001));assert.ok(Math.abs(p.y-terrain.at(p.x,-p.z))<.001);}
 }
 built.dispose();
});

test('worker transfer and sliced fallback make identical forest geometry, colour and placement',async()=>{
 const sample=new Map([['ginkgo',variants.get('ginkgo')],['tulip_red',variants.get('tulip_red')]]);
 const plants=[{key:'ginkgo:0',matrix:new THREE.Matrix4().makeTranslation(3,61,-9).toArray(),tint:[1.8,1.1,.5],x:3,z:-9},
 {key:'tulip_red:1',matrix:new THREE.Matrix4().makeTranslation(-7,62,3).toArray(),tint:[.9,1.1,.8],x:-7,z:3}];
 const packed=packTrees(sample),copied=structuredClone(packed.wire);
 const a=await assembleBudgetForest(sample,plants,[0,0],async()=>{}),b=await assembleBudgetForest(unpackTrees(copied),plants,[0,0],async()=>{});
 for(const bucket of ['crowns','flowers','bark'])for(const attr of Object.keys(a[bucket]))assert.deepEqual(a[bucket][attr],b[bucket][attr]);
 assert.equal(a.crowns.index.length,sample.get('ginkgo')[0].leaves.index.count);
 const source=sample.get('ginkgo')[0].leaves.attributes.position;
 assert.ok(Math.abs(a.crowns.position[1]-source.getY(0)-61)<1e-5);
 assert.ok(Math.abs(a.crowns.color[0]-sample.get('ginkgo')[0].leaves.attributes.color.getX(0)*1.8)<1e-6);
 assert.equal(a.flowers.index.length,sample.get('tulip_red')[1].leaves.index.count);
});

test('concurrent woodland owners share buffers until the last owner closes',async()=>{
 const patches=[{pattern:0,points:Array.from({length:200},(_,i)=>[i%20*6,Math.floor(i/20)*6])}],terrain={at:()=>0},texture=new THREE.Texture();
 const[a,b]=await Promise.all([groveForest(patches,terrain,53,texture,false,1,async()=>{}),groveForest(patches,terrain,53,texture,false,1,async()=>{})]);
 assert.deepEqual(a.group.userData.forestBudget.roots,b.group.userData.forestBudget.roots);
 for(const mesh of a.group.children){const other=b.group.children.find(o=>o.name===mesh.name);assert.equal(mesh.geometry,other.geometry);assert.equal(mesh.material,other.material);assert.notEqual(mesh.instanceMatrix,other.instanceMatrix);}
 const geometry=a.group.children[0].geometry;let releases=0;geometry.addEventListener('dispose',()=>releases++);
 a.dispose();a.dispose();assert.equal(releases,0,'another visible woodland still owns the bank');
 b.dispose();b.dispose();assert.equal(releases,1,'shared buffer released once after the last woodland closes');texture.dispose();
});

test('unchanged water passes preserve planting while a removed or moved element invalidates it',()=>{
 const p={trees:[[1,2]],shrubs:[[3,4]],flowers:[[5,6]],grass:[[7,8]],street:[[9,10,1]],border:[[11,12,2]],groves:[{pattern:0,points:[[13,14]]}],woodlandFlowers:[{species:'cosmos',points:[[15,16]]}]};
 const snapshot=plantingSnapshot(p);assert.ok(samePlanting(snapshot,structuredClone(p)));
 for(const key of ['trees','shrubs','flowers','grass','street','border']){const moved=structuredClone(p);moved[key][0][0]+=.00001;assert.equal(samePlanting(snapshot,moved),false);const removed=structuredClone(p);removed[key]=[];assert.equal(samePlanting(snapshot,removed),false);}
 const movedGrove=structuredClone(p);movedGrove.groves[0].points[0][1]++;assert.equal(samePlanting(snapshot,movedGrove),false);
 const changedFlower=structuredClone(p);changedFlower.woodlandFlowers[0].species='daisy';assert.equal(samePlanting(snapshot,changedFlower),false);
 p.street.push([17,18,3]);p.groves[0].points=p.groves[0].points.filter(()=>false);assert.equal(snapshot.street.length,1);assert.equal(snapshot.groves[0].points.length,1);assert.equal(samePlanting(snapshot,p),false);
});

test('autumn tones stay balanced across quadrants without depending on load order',()=>{
 assert.ok(Math.abs(FOLIAGE_TONES.filter(t=>t.name!=='green').reduce((n,t)=>n+t.share,0)-44*.7)<1e-8);
 for(const sx of [-1,1])for(const sy of [-1,1]){
  const counts={};
  for(let x=0;x<60;x++)for(let y=0;y<60;y++){
   const tone=treeFoliageTone(sx*(x*9+1),sy*(y*9+1));counts[tone.name]=(counts[tone.name]??0)+1;
   assert.equal(tone,treeFoliageTone(sx*(x*9+1),sy*(y*9+1)));
  }
  for(const tone of FOLIAGE_TONES)assert.ok(Math.abs(counts[tone.name]/3600-tone.share/100)<.03,`${sx},${sy} ${tone.name}`);
 }
});

test('distant forest coverage grows smoothly without introducing more canopy planes',async()=>{
 const near=woodlandDensity(100,0),mid=woodlandDensity(400,0),far=woodlandDensity(700,0);
 assert.ok(near.crownScale<mid.crownScale&&mid.crownScale<far.crownScale);
 assert.ok(near.mergeCell<mid.mergeCell&&mid.mergeCell<far.mergeCell);
 const average=r=>Array.from({length:360},(_,i)=>{const a=i*Math.PI/180;return woodlandDensity(Math.cos(a)*r,Math.sin(a)*r).occupancy;}).reduce((a,b)=>a+b,0)/360;
 assert.ok(average(700)>average(100)*1.15,'distant woodland is denser across the whole visible region');
 assert.equal(far.treeSpacing,10.5);assert.equal(near.treeSpacing,10.5);
 const model=treeMeshModel(0);assert.equal(model.userData.treeModel.treeTriangles,800);model.dispose();
});

test('lamps avoid every carriageway, filled offset junction and curved self-overlap',()=>{
 const fixtures=[[
  {line:[[-100,0],[100,0]],width:20,lanes:4},{line:[[25,-100],[25,100]],width:20,lanes:4}
 ],[
  {line:[[-100,0],[0,0]],width:6,lanes:1},{line:[[1,1],[100,100]],width:14,lanes:2},{line:[[0,0],[0,-100]],width:12,lanes:2}
 ],[{line:[[-100,0],[0,0],[0,20],[-100,20]],width:20,lanes:4}]];
 for(const roads of fixtures){const data={roads,site:[],buildings:[],context:[]},lamps=streetLamps(data),onRoad=carriageway(roads,.5),hulls=roadJunctionHulls(roads);
  assert.ok(lamps.length>0);for(const l of lamps){assert.equal(onRoad(l.x,l.y),false);assert.ok(!hulls.some(h=>inRing([l.x,l.y],h)));}
  assert.deepEqual(lamps,streetLamps(data));
 }
});

test('autumn recolouring changes crowns only, preserving bark, flowers and topology',async()=>{
 const sample=new Map([['ginkgo',variants.get('ginkgo')],['tulip_red',variants.get('tulip_red')]]);
 const plants=[{key:'ginkgo:0',matrix:new THREE.Matrix4().toArray(),tint:[1,1,1],x:0,z:0},{key:'tulip_red:0',matrix:new THREE.Matrix4().toArray(),tint:[1,1,1],x:0,z:0}];
 const a=await assembleBudgetForest(sample,plants,[0,0],async()=>{}),b=await assembleBudgetForest(sample,plants.map(p=>({...p,crownTint:[2.8,.55,.4]})),[0,0],async()=>{});
 assert.notDeepEqual(a.crowns.color,b.crowns.color);
 for(const name of ['bark','flowers'])assert.deepEqual(a[name],b[name]);
 for(const attr of ['position','normal','uv','index'])assert.deepEqual(a.crowns[attr],b.crowns[attr]);
});

test('distant car meshes retain proportions and palette while close models remain independent',()=>{
 for(const kind of Object.keys(CAR_SPECS)){
  const detailed=carGeometry(kind),cheap=carGeometry(kind,true);assert.notEqual(cheap,detailed);
  assert.equal(carGeometry(kind),detailed);assert.equal(carGeometry(kind,true),cheap);
  assert.ok(cheap.attributes.position.count<detailed.attributes.position.count*.34);
  detailed.computeBoundingBox();cheap.computeBoundingBox();
  const a=detailed.boundingBox.getSize(new THREE.Vector3()),b=cheap.boundingBox.getSize(new THREE.Vector3());
  for(const axis of ['x','y','z'])assert.ok(Math.abs(b[axis]/a[axis]-1)<.06,`${kind} ${axis}`);
  for(const normal of cheap.attributes.normal.array)assert.ok(Number.isFinite(normal));
 }
});

test('off-thread road result preserves exact clearance geometry and respects owner cancellation',async()=>{
 const saved=globalThis.Worker;
 const ground=new THREE.PlaneGeometry(4,4,2,2);ground.userData.grid={xs:new Float64Array([-2,0,2]),ys:new Float64Array([2,0,-2])};ground.attributes.position.setZ(4,2);
 const make=()=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-2,.02,-2,2,.02,-2,0,.02,2],3));
 const expected=make();await drapeRoadSurface(expected,ground,async()=>true);
 class FakeWorker{terminate(){}postMessage(message){queueMicrotask(async()=>{
  const copy=structuredClone(message),r=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(copy.road,3)),g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(copy.ground,3));g.userData.grid={xs:copy.xs,ys:copy.ys};
  await drapeRoadSurface(r,g,async()=>true,copy.lift);this.onmessage({data:{result:Object.fromEntries(['position','normal','uv'].map(k=>[k,r.attributes[k].array]))}});
 });}}
 try{
  globalThis.Worker=FakeWorker;
  const actual=make(),source=actual.attributes.position.array;await drapeRoadOffThread(actual,ground,async()=>true);
  for(const key of ['position','normal','uv'])assert.deepEqual(actual.attributes[key].array,expected.attributes[key].array);
  assert.equal(source.length,9);assert.ok(ground.attributes.position.array.length>0);
  const cancelled=make(),original=cancelled.attributes.position;await drapeRoadOffThread(cancelled,ground,async()=>false);assert.equal(cancelled.attributes.position,original);
  globalThis.Worker=class extends FakeWorker{postMessage(){queueMicrotask(()=>this.onerror());}};
  const fallback=make();await drapeRoadOffThread(fallback,ground,async()=>true);assert.deepEqual(fallback.attributes.position.array,expected.attributes.position.array);
 }finally{globalThis.Worker=saved;}
});
