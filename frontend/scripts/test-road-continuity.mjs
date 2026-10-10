import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';

function load(source, extra={}) {
  const scope={module:{exports:{}},exports:{},THREE,performance,frameSlice:async()=>{},onSceneMemoryRelease(){},paintedTexture:async()=>new THREE.Texture(),...extra};
  vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);
  return scope.module.exports;
}
const read=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8');
const {continuousRoadGrade,corridorRoadGrade}=load(read('roadGrade.ts'));
const {gridAt}=load(read('waterCore.ts'));
const {drapeRoadSurface,raiseRoadPaint}=load(read('roadDrape.ts'));
const {gradeRoads}=load(read('sceneTerrain.ts'),{gridAt,corridorRoadGrade});
const levels=load(read('roadLevels.ts'));
const {roadJunctionHulls}=load(read('roadJunctions.ts'),levels);
const {roadLaneCount}=load(read('roadLanes.ts'));
const street=load(read('sceneStreet.ts'),{roadJunctionHulls,roadLaneCount,...levels});
const oldStreet=load(execFileSync('git',['show','66bc4ec:frontend/src/components/sceneStreet.ts'],{encoding:'utf8'}));
const {findBridges,roadGround,bridgeHeight}=load(read('sceneBridges.ts'),{...levels,...load(read('roadApproaches.ts'),levels),inRing:([x,y],ring)=>x>=ring[0][0]&&x<=ring[2][0]&&y>=ring[0][1]&&y<=ring[2][1],sidewalkWidth:()=>2});

test('road grade removes a DEM cliff and leaves remote terrain unchanged',async()=>{
  const n=51,cell=4,R=100,h=Float32Array.from({length:n*n},(_,k)=>k%n>=25?40:0);
  const original=Float32Array.from(h);
  const grid={h,n,cell,R},at=gridAt(grid),t={grid,at,base:()=>0,relief:40,elevation:100,source:'fixture'};
  const graded=await gradeRoads(t,[{line:[[-80,0],[80,0]],width:12}]);
  let max=0;
  for(let x=-76;x<76;x+=1)max=Math.max(max,Math.abs(graded.at(x+1,0)-graded.at(x,0)));
  assert.ok(max<=.201,`road grade ${max}`);
  assert.ok(Math.abs(graded.at(0,0)-at(0,0))>3,'a >3m discrepancy must still be corrected');
  assert.equal(graded.at(60,80),at(60,80));
  assert.deepEqual([...h],[...original]);
});

test('a hill outside the road corridor must not raise a level road',async()=>{
  const n=81,cell=4,R=160,h=Float32Array.from({length:n*n},(_,k)=>Math.floor(k/n)*cell-R>40?100:0);
  const grid={h,n,cell,R},at=gridAt(grid),t={grid,at,base:()=>0,relief:100,elevation:100,source:'fixture'};
  const graded=await gradeRoads(t,[{line:[[-80,0],[80,0]],width:12}]);
  assert.ok(Math.abs(graded.at(0,0))<.01,`level road shifted by ${graded.at(0,0)}m`);
  assert.equal(graded.at(0,80),at(0,80));
});

test('slope envelopes preserve a normal incline and bound spikes in both axes',()=>{
  const w=31,h=29,cell=4;
  const incline=Float32Array.from({length:w*h},(_,k)=>k%w*.2+Math.floor(k/w)*.1);
  const plain=continuousRoadGrade(incline,w,h,cell);
  for(let i=0;i<plain.length;i++)assert.ok(Math.abs(plain[i]-incline[i])<1e-5);
  const raw=Float32Array.from(incline);raw[14*w+15]=100;
  const bounded=continuousRoadGrade(raw,w,h,cell);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const k=j*w+i;
    for(const q of [i+1<w?k+1:-1,j+1<h?k+w:-1])if(q>=0)assert.ok(Math.abs(bounded[k]-bounded[q])<=.2*cell/Math.SQRT2+1e-5);
  }
});

function contains(mesh,x,y){
  const p=mesh.geometry.attributes.position.array;
  for(let k=0;k<p.length;k+=9){
    const a=[p[k],-p[k+2]],b=[p[k+3],-p[k+5]],c=[p[k+6],-p[k+8]];
    const cross=(u,v)=>(v[0]-u[0])*(y-u[1])-(v[1]-u[1])*(x-u[0]);
    const s=[cross(a,b),cross(b,c),cross(c,a)];
    if(s.every(v=>v>=-1e-4)||s.every(v=>v<=1e-4))return true;
  }
  return false;
}
const flat={at:()=>0};
function assertPaintOnAsphalt(surface,marks){
 marks.group.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
  for(let i=0;i<p.count;i+=3){
   let x=0,y=0;for(let j=0;j<3;j++){x+=p.getX(i+j)/3;y-=p.getZ(i+j)/3;assert.ok(contains(surface.group,p.getX(i+j),-p.getZ(i+j)),`paint outside asphalt: ${p.getX(i+j)},${-p.getZ(i+j)}`);}
   assert.ok(contains(surface.group,x,y),`paint cuts outside asphalt: ${x},${y}`);
  }
 });
}
test('a short multi-lane road retains its centre, edges and partial lane dash',async()=>{
 const roads=[{line:[[0,0],[2.5,0]],width:14,lanes:4}],surface=await street.buildRoadSurface(roads,flat),marks=await street.buildRoadMarkings(roads,flat);
 assert.equal(marks.group.children.length,2);assert.ok(contains(marks.group.children[0],.1,0.17));assert.ok(contains(marks.group.children[0],2.4,0.17));
 assert.ok(contains(marks.group.children[1],2.4,3.5));assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
});

test('wide roads with the provider missing-lane sentinel retain centre and interior lane lines',async()=>{
 for(const lanes of [0,1]){
  const roads=[{line:[[0,0],[120,0]],width:14,lanes}],surface=await street.buildRoadSurface(roads,flat),marks=await street.buildRoadMarkings(roads,flat);
  assert.equal(roadLaneCount(roads[0]),4);
  const yellow=marks.group.children.find(m=>m.material.color.r>m.material.color.b*2),white=marks.group.children.find(m=>m!==yellow);
  for(let x=.5;x<119;x+=.5){assert.ok(contains(yellow,x,.17),`missing centre at ${x}`);assert.ok(contains(white,x,6.7),`missing edge at ${x}`);}
  assert.ok(contains(white,17.5,3.5));assert.ok(contains(white,17.5,-3.5));
  assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
 }
 assert.equal(roadLaneCount({width:25,lanes:6}),6,'registered counts remain authoritative');
});

test('single-lane narrow carriageways retain boundaries without an invented yellow centre',async()=>{
 const roads=[{line:[[0,0],[36,0]],width:3.3,lanes:1}],surface=await street.buildRoadSurface(roads,flat),marks=await street.buildRoadMarkings(roads,flat);
 assert.equal(marks.group.children.length,1);const white=marks.group.children[0];
 assert.ok(white.material.color.b>.8);assert.ok(!contains(white,18,0));
 for(let x=.5;x<35;x+=.5)for(const side of [-1,1])assert.ok(contains(white,x,side*1.35));
 assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
});

test('inferred multi-lane markings still exclude the intersection interior',async()=>{
 const roads=[{line:[[-40,0],[40,0]],width:14,lanes:1},{line:[[0,0],[0,30]],width:10,lanes:1}];
 const marks=await street.buildRoadMarkings(roads,flat),yellow=marks.group.children[0];
 assert.ok(!contains(yellow,0,.17));assert.ok(contains(yellow,-25,.17));assert.ok(contains(yellow,25,.17));marks.dispose();
});
test('crossing coordinates beyond a short road never extend paint past asphalt',async()=>{
 const roads=[{line:[[0,0],[9,0]],width:12,lanes:4}],surface=await street.buildRoadSurface(roads,flat);
 const marks=await street.buildRoadMarkings(roads,flat,()=>({crossA:12,crossB:16,stopA:17,stopB:17.4,surveyed:true}));
 assert.ok(marks.group.children.length);assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
});
test('all markings stay inside the same surveyed asphalt strip through tight bends',async()=>{
 const roads=[{line:[[0,0],[11,0],[14,9],[28,10]],width:8,lanes:3}],surface=await street.buildRoadSurface(roads,flat),marks=await street.buildRoadMarkings(roads,flat);
 assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
});

test('a thin lane ribbon stays filled when its offset curve reverses at a short bend',async()=>{
 const road={width:9.127627438746185,lanes:3,line:[[-70.65,370.87],[-100.68,360.51],[-108.25,357.95],[-109.98,357.95],[-111.29,360],[-112.97,366.08],[-116.86,378.95],[-117.42,380.81],[-117.54,387.03]]};
 const marks=await street.buildRoadMarkings([road],flat),surface=await street.buildRoadSurface([road],flat);
 assert.ok(contains(marks.group.children[1],-108.66617178218065,360.07563104623034),'folded lane ribbon leaves a hole');
 assertPaintOnAsphalt(surface,marks);surface.dispose();marks.dispose();
});
test('a T at the middle of a road excludes the junction and retains both approach lines',async()=>{
 const roads=[{line:[[-40,0],[40,0]],width:14,lanes:4},{line:[[0,0],[0,30]],width:10,lanes:2}];
 const marks=await street.buildRoadMarkings(roads,flat),yellow=marks.group.children[0];
 assert.ok(!contains(yellow,0,.17));for(let x=-39;x<40;x+=.5)if(Math.abs(x)>6)assert.ok(contains(yellow,x,.17),`missing approach at ${x}`);
 marks.dispose();
});
test('three- and five-lane roads include each lane separator and do not lose a trailing dash',async()=>{
 for(const lanes of [3,5]){
  const width=lanes*3.5,marks=await street.buildRoadMarkings([{line:[[0,0],[18,0]],width,lanes}],flat),white=marks.group.children[1];
  for(const side of [1,-1]){const count=side===1?Math.floor(lanes/2):Math.ceil(lanes/2);for(let k=1;k<count;k++)assert.ok(contains(white,17.5,side*k*width/2/count));}
  marks.dispose();
 }
});
test('an explicitly disabled stop line is not painted when zebra crossings are retained',async()=>{
 const road=[{line:[[0,0],[60,0]],width:12,lanes:2}],marks=await street.buildRoadMarkings(road,flat,(_r,start)=>start?{crossA:5,crossB:8,stopA:9,stopB:9.4,zebra:true,stop:false,surveyed:true}:null);
 assert.ok(contains(marks.group.children[1],6,.8));assert.ok(!contains(marks.group.children[1],9.2,3));marks.dispose();
});
test('two offset arms with different widths fill their previously uncovered joint',async()=>{
  const roads=[{line:[[-20,0],[0,0]],width:6,lanes:1},{line:[[1,1],[20,20]],width:14,lanes:2}];
  const before=await oldStreet.buildRoadSurface(roads,flat),after=await street.buildRoadSurface(roads,flat);
  const old=before.group,current=after.group;
  let repaired=0;
  for(let x=-5;x<8;x+=.5)for(let y=-7;y<7;y+=.5)if(!contains(old,x,y)&&contains(current,x,y))repaired++;
  assert.ok(repaired>=10,`new joint coverage ${repaired}`);
  before.dispose();after.dispose();
});

test('wide road is sampled across its width and markings remain above its surface',async()=>{
  const road=[{line:[[0,0],[30,0]],width:30,lanes:8}];
  const terrain={at:(x,y)=>.02*x+.1*y};
  const surface=await street.buildRoadSurface(road,terrain),mesh=surface.group,p=mesh.geometry.attributes.position.array;
  for(let k=0;k<p.length;k+=9)for(const [a,b] of [[0,3],[3,6],[6,0]])assert.ok(Math.hypot(p[k+a]-p[k+b],p[k+a+2]-p[k+b+2])<=4.25);
  const marks=await street.buildRoadMarkings(road,terrain);
  marks.group.traverse(o=>{if(o.isMesh){const v=o.geometry.attributes.position.array;for(let k=0;k<v.length;k+=3)assert.ok(v[k+1]-terrain.at(v[k],-v[k+2])>.08);}});
  surface.dispose();marks.dispose();
});

test('water adjacency cannot invent a bridge; a registered bridge uses DEM bank heights',()=>{
 const road={line:[[-200,0],[200,0]],width:12,lanes:2};
 const terrain={at:x=>x< -30||x>30?8:0,base:()=>0};
 const parcels=[{kind:'\uCC9C',ring:[[-30,-100],[30,-100],[30,100],[-30,100]]}];
 assert.equal(findBridges([road],parcels,[false],terrain).length,0);
 const actual={...road,structure:'bridge',layer:1,structure_source:'VWorld LT_L_MOCTLINK',link_id:'survey-bridge'};
 const bridges=findBridges([actual],parcels,[false],terrain);
 assert.equal(bridges.length,1);
 assert.ok([...bridges[0].h].every(h=>h===8),'no artificial 15m lift');
 const t=roadGround(terrain,bridges);assert.equal(t.at(0,0),0);assert.equal(t.roadAt(actual,0,0),8);assert.equal(t.roadAt(road,0,0),0);
});

test('overlapping bridge approaches do not switch abruptly at a bounds edge',()=>{
  const bridge=x=>({x:Float32Array.from(x),y:Float32Array.from([0,0,0]),h:Float32Array.from([0,15,0]),outer:8,box:[x[0]-8,-8,x[2]+8,8]});
  const a=bridge([-100,0,100]),b=bridge([0,100,200]);
  const at=bridgeHeight([a,b]),reversed=bridgeHeight([b,a]);
  for(let x=80;x<120;x++){
    assert.equal(at(x,0),reversed(x,0));
    assert.ok(Math.abs(at(x+1,0)-at(x,0))<=.151);
  }
});

test('asphalt partitions at rendered ground triangles and clears an interior ridge',async()=>{
  const ground=new THREE.PlaneGeometry(20,20,2,2),p=ground.attributes.position;
  ground.userData.grid={xs:Float64Array.from([-10,0,10]),ys:Float64Array.from([10,0,-10])};
  for(let i=0;i<p.count;i++)p.setZ(i,p.getX(i)===0?2:0);
  const road=new THREE.BufferGeometry();
  road.setAttribute('position',new THREE.Float32BufferAttribute([-9,.08,8, 9,.08,8, 0,.08,-8],3));
  await drapeRoadSurface(road,ground,async()=>true);
  const v=road.attributes.position;
  assert.ok(v.count>3);
  for(let i=0;i<v.count;i+=3){
    let x=0,h=0;
    for(let j=0;j<3;j++){x+=v.getX(i+j)/3;h+=v.getY(i+j)/3;}
    const groundHeight=2*(1-Math.abs(x)/10);
    assert.ok(h>=groundHeight+.01499,`road is buried at ${x}: ${h} vs ${groundHeight}`);
  }
  const areaBefore=18*16/2;let areaAfter=0;
  for(let i=0;i<v.count;i+=3)areaAfter+=Math.abs((v.getX(i+1)-v.getX(i))*(v.getZ(i+2)-v.getZ(i))-(v.getZ(i+1)-v.getZ(i))*(v.getX(i+2)-v.getX(i)))/2;
  assert.ok(Math.abs(areaAfter-areaBefore)<1e-4,'clipping must retain the entire road footprint');
  ground.dispose();road.dispose();
});

test('a road already above level ground keeps its original triangle count',async()=>{
  const ground=new THREE.PlaneGeometry(20,20,2,2);
  ground.userData.grid={xs:Float64Array.from([-10,0,10]),ys:Float64Array.from([10,0,-10])};
  const road=new THREE.BufferGeometry();
  road.setAttribute('position',new THREE.Float32BufferAttribute([-9,.08,8, 9,.08,8, 0,.08,-8],3));
  const original=Array.from(road.attributes.position.array);
  await drapeRoadSurface(road,ground,async()=>true);
  assert.equal(road.attributes.position.count,3);
  assert.deepEqual(Array.from(road.attributes.position.array),original);
  ground.dispose();road.dispose();
});

test('paint clears the real asphalt interior ridge without adding triangles',async()=>{
 const asphalt=new THREE.BufferGeometry(),paint=new THREE.BufferGeometry();
 asphalt.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,0,0,1,0,-2,0,2, 0,1,0,2,0,0,2,0,2, 0,1,0,2,0,2,-2,0,2],3));
 paint.setAttribute('position',new THREE.Float32BufferAttribute([-1.5,.2,.2,1.5,.2,.2,0,.2,1.5],3));
 await raiseRoadPaint(paint,asphalt,async()=>true);assert.equal(paint.attributes.position.count,3);
 for(let i=0;i<3;i++)assert.ok(paint.attributes.position.getY(i)>=.9149);
 const original=Float32Array.from(paint.attributes.position.array);await raiseRoadPaint(paint,asphalt,async()=>true);assert.deepEqual([...paint.attributes.position.array],[...original]);
 asphalt.dispose();paint.dispose();
});
