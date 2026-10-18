import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Frustum,Matrix4,Sphere,Vector3,Quaternion} from '../src/vendor/tidewater/engine/math/index.js';
import {OrthographicCamera,PerspectiveCamera} from '../src/vendor/tidewater/engine/scene/Camera.js';
const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('\t_instanceRuns( '),source.indexOf('\n\t_inFrustum(',source.indexOf('\t_instanceRuns( ')));
function renderer(){return vm.runInNewContext('({'+body+'})',{Frustum,GPU:{frame:1},_runVP:new Matrix4(),_runInv:new Matrix4(),_runSphere:new Sphere()});}
const runsToIds=runs=>{const ids=new Set();for(let i=0;i<runs.length;i+=2)for(let j=runs[i];j<runs[i]+runs[i+1];j++)ids.add(j);return ids;};
test('thin blocks outside a cascade are rejected even when their large spheres intersect',()=>{
 const r=renderer(),camera=new OrthographicCamera(-10,10,10,-10,.1,100),o={matrixWorld:new Matrix4(),count:1,instanceRanges:{total:1,list:Float64Array.of(0,1,0,20,-30,Math.hypot(50,1,1)),halfExtents:Float64Array.of(50,1,1)}};
 camera.updateMatrixWorld();
 assert.deepEqual(Array.from(r._instanceRuns(o,{camera})),[]);
 delete o.instanceRanges.halfExtents;assert.deepEqual(Array.from(r._instanceRuns(o,{camera})),[0,1]);
});
test('affine block boxes never remove geometry intersecting camera or shadow frusta',()=>{
 let extraRejected=0,checked=0;
 const r=renderer(),list=[],half=[];
 for(let i=0;i<121;i++){const x=(i%11-5)*18,y=(i%7-3)*5,z=(Math.floor(i/11)-5)*18;const h=[3+i%4*2,1+i%3,4+i%5];list.push(i,1,x,y,z,Math.hypot(...h));half.push(...h);}
 const o={count:121,matrixWorld:new Matrix4(),instanceRanges:{total:121,list:Float64Array.from(list),halfExtents:Float64Array.from(half)}};
 for(let k=0;k<96;k++){
  o.matrixWorld.compose(new Vector3(Math.sin(k)*12,Math.cos(k)*6,-25),new Quaternion().setFromAxisAngle(new Vector3(.3,.8,.5).normalize(),k*.17),new Vector3(k%2?-1.1:.8,.7+k%3*.2,1.3));
  const camera=k%2?new PerspectiveCamera(52,1.7,.1,180):new OrthographicCamera(-30,30,24,-24,.1,180);
  if(k%3===0){camera.reversedDepth=false;camera.updateProjectionMatrix();}
  camera.position.set(Math.sin(k*.23)*70,25+Math.cos(k)*20,Math.cos(k*.23)*70);camera.lookAt(new Vector3());camera.updateMatrixWorld();
  const pass={camera},now=runsToIds(r._instanceRuns(o,pass));
  const saved=o.instanceRanges.halfExtents;delete o.instanceRanges.halfExtents;const before=runsToIds(r._instanceRuns(o,{camera}));o.instanceRanges.halfExtents=saved;
  for(const id of now)assert.ok(before.has(id));
  const frustum=pass.__runFrustum;
  for(let i=0;i<121;i++){
   const center=new Vector3(list[i*6+2],list[i*6+3],list[i*6+4]),corners=[];
   for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1])corners.push(new Vector3(center.x+sx*half[i*3],center.y+sy*half[i*3+1],center.z+sz*half[i*3+2]).applyMatrix4(o.matrixWorld));
   if(before.has(i)&&!now.has(i)){
    extraRejected++;assert.ok(frustum.planes.some(p=>corners.every(c=>p.distanceToPoint(c)<0)),'a removed box lies wholly outside at least one plane');
   }
   for(const point of [...corners,center.applyMatrix4(o.matrixWorld)])if(frustum.planes.every(p=>p.distanceToPoint(point)>=0))assert.ok(now.has(i),'a visible point must remain drawn');
   checked++;
  }
 }
 assert.ok(extraRejected>100);assert.equal(checked,96*121);
});
