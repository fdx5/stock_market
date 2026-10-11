import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
const between=(a,b)=>source.slice(source.indexOf('\t'+a+'( '),source.indexOf(b,source.indexOf('\t'+a+'( ')));
function fixture(){
  let creates=0,uploads=0,layouts=0;const GPU={frame:0,queue:{writeBuffer(b,offset,array,start,length){uploads++;const next=new Uint32Array(array,start,length/4);b.data.splice(offset/4,next.length,...next);}},device:{createBuffer(){creates++;return {data:null,destroyed:false,destroy(){this.destroyed=true;}};}}};
  const methods=vm.runInNewContext('({'+between('_geometryGPU','\n\t// CPU geometry')+','+between('_attributeBuffer','\n\t_indexBuffer')+','+between('_indexBuffer','\n\t// cached _layout')+','+between('_frameBuffers','\n\t// the pipeline of')+','+between('geometryReady','\n\tmaterialReady')+','+between('retainGeometry','\n\treleaseGeometry')+','+between('releaseGeometry','\n\tdispose')+'})',{
    GPU,GPUBufferUsage:{VERTEX:1,COPY_DST:2,INDEX:4},Uint16Array,Uint32Array,
    align4:n=>Math.ceil(n/4)*4,convertArray:a=>a.array,writePadded:(b,a)=>{uploads++;b.data=Array.from(a);},
  });
  const r={...methods,geometryEpoch:0,geometries:new Map(),
    _cachedLayout(_o,g){layouts++;if(!g.layout)g.layout={buffers:[{attr:g.attributes.position},{attr:g.attributes.color}]};return g.layout;}};
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)).setAttribute('color',new THREE.Float32BufferAttribute([1,0,0,1,0,0,1,0,0],3)).setIndex([0,1,2]);
  const o={},material={};const draw=()=>{GPU.frame++;return r._frameBuffers(o,geometry,material);};
  return {r,o,geometry,material,draw,GPU,layouts:()=>layouts,count:()=>({creates,uploads})};
}

test('unchanged building vertices and index reuse GPU buffers across many frames',()=>{
  const f=fixture(),first=f.draw();for(let i=0;i<90;i++)assert.equal(f.draw(),first);
  assert.deepEqual(f.count(),{creates:3,uploads:3});
});
test('late facade colour and moving-instance updates reach the very next draw',()=>{
  const f=fixture();f.draw();const color=f.geometry.attributes.color;color.setXYZ(0,.2,.4,.8);color.needsUpdate=true;
  const row=f.draw();assert.ok(Math.abs(row.vbs[1].data[0]-.2)<1e-6);assert.equal(f.count().uploads,4);
  const instance=new THREE.InstancedBufferAttribute(new Float32Array(16),16);f.geometry.layout.buffers.push({attr:instance});f.draw();
  instance.array[12]=25;instance.needsUpdate=true;assert.equal(f.draw().vbs[2].data[12],25);
});
test('replaced arrays upload even when the new attribute has the same version',()=>{
  const f=fixture();f.draw();f.geometry.attributes.position.array=new Float32Array([9,0,0,10,0,0,9,1,0]);
  f.geometry.index.array=new Uint16Array([2,1,0]);const row=f.draw();
  assert.equal(row.vbs[0].data[0],9);assert.deepEqual(row.index.buffer.data,[2,1,0]);assert.equal(f.count().uploads,5);
});
test('retired GPU geometry is recreated rather than replaying destroyed buffer references',()=>{
  const f=fixture(),old=f.draw();f.r.geometries.clear();f.r.geometryEpoch++;
  const next=f.draw();assert.notEqual(next.vbs[0],old.vbs[0]);assert.deepEqual(next.index.buffer.data,[0,1,2]);assert.equal(f.count().creates,6);
});
test('source disposal preserves the native predecessor until replacement ownership is reconciled',()=>{
 const f=fixture();f.r.deferGeometryDisposal=true;const old=f.draw();f.geometry.dispose();
 assert.equal(old.vbs[0].destroyed,false);assert.equal(f.r.geometries.has(f.geometry),true);
 f.r.retainGeometry([{geometry:f.geometry}]);assert.equal(old.vbs[0].destroyed,false);
 const replacement=f.geometry.clone(),next=f.r._frameBuffers({},replacement,{});
 f.r.retainGeometry([{geometry:replacement}]);assert.equal(old.vbs[0].destroyed,true);assert.equal(next.vbs[0].destroyed,false);assert.equal(f.r.geometries.size,1);
 replacement.dispose();f.r.retainGeometry([]);assert.equal(next.vbs[0].destroyed,true);assert.equal(f.r.geometries.size,0);
});
test('standalone renderer disposal still releases geometry immediately',()=>{
 const f=fixture(),old=f.draw();f.geometry.dispose();assert.equal(old.vbs[0].destroyed,true);assert.equal(f.r.geometries.size,0);
});
test('storage attributes obtain the current external GPU buffer on every frame',()=>{
  const f=fixture();let current={id:1};f.geometry.attributes.color.gpuBuffer={getGPU:()=>current};
  assert.equal(f.draw().vbs[1],current);current={id:2};assert.equal(f.draw().vbs[1],current);
});
test('GPU readiness follows actual appended attribute/index versions, not shader readiness',()=>{
 const f=fixture();f.o.geometry=f.geometry;assert.equal(f.r.geometryReady(f.o,f.material),false);f.draw();assert.equal(f.r.geometryReady(f.o,f.material),true);
 f.geometry.attributes.color.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material),false);f.draw();assert.equal(f.r.geometryReady(f.o,f.material),true);
 f.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0,1,2,0,0,0]),1));f.draw();f.geometry.index.array.set([2,1,0],3);f.geometry.index.addUpdateRange(3,3);f.geometry.index.needsUpdate=true;
 assert.equal(f.r.geometryReady(f.o,f.material),false);const row=f.draw();assert.deepEqual(row.index.buffer.data,[0,1,2,2,1,0]);assert.equal(f.geometry.index.updateRanges.length,0);assert.equal(f.r.geometryReady(f.o,f.material),true);
 f.r.releaseGeometry(f.geometry);assert.equal(f.r.geometryReady(f.o,f.material),false);
});
test('animated instance poses cannot monopolise static scenery preparation slots',()=>{
 const f=fixture();f.o.geometry=f.geometry;const instance=new THREE.InstancedBufferAttribute(new Float32Array(16),16);f.geometry.layout={buffers:[{attr:f.geometry.attributes.position},{attr:instance}]};f.draw();
 instance.array[12]=40;instance.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material),false);assert.equal(f.r.geometryReady(f.o,f.material,true),true);
 f.draw();assert.equal(f.r.geometryReady(f.o,f.material),true);assert.equal(f.o.__frameRow.vbs[1].data[12],40);
 f.geometry.attributes.position.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material,true),false);
});
test('animated wake vertices cannot monopolise scenery slots and still upload completely on their next draw',()=>{
 const f=fixture();f.o.geometry=f.geometry;const p=f.geometry.attributes.position;p.setUsage(THREE.DynamicDrawUsage);
 assert.equal(f.r.geometryReady(f.o,f.material,true),false);f.draw();
 p.array[0]=30;p.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material),false);assert.equal(f.r.geometryReady(f.o,f.material,true),true);
 f.draw();assert.equal(f.o.__frameRow.vbs[0].data[0],30);assert.equal(f.r.geometryReady(f.o,f.material),true);
 f.geometry.attributes.color.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material,true),false);
});
test('unchanged readiness reuses the uploaded layout while array, material and source changes still invalidate it',()=>{
 const f=fixture();f.o.geometry=f.geometry;f.draw();
 f.geometry.layout.sourceNames=['position','color','normal'];f.geometry.layout.sourceRefs=[f.geometry.attributes.position,f.geometry.attributes.color,undefined];
 const layouts=f.layouts();for(let i=0;i<100;i++)assert.equal(f.r.geometryReady(f.o,f.material,true),true);assert.equal(f.layouts(),layouts);
 f.geometry.attributes.position.array=f.geometry.attributes.position.array.slice();assert.equal(f.r.geometryReady(f.o,f.material,true),false);
 f.draw();f.material.version=1;assert.equal(f.r.geometryReady(f.o,f.material,true),true);assert.ok(f.layouts()>layouts);
 const before=f.layouts();f.geometry.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(9),3));f.r.geometryReady(f.o,f.material,true);assert.ok(f.layouts()>before);
});
test('the production layout cache notices an attribute that was absent during the first upload',()=>{
 const f=fixture();f.o.geometry=f.geometry;Object.assign(f.material,{id:1,version:0,attributes:{},vertexColors:true});
 f.r.layouts=new WeakMap();f.r._cachedLayout=vm.runInNewContext('({'+between('_cachedLayout','\n\t// vertex buffer layouts')+'})._cachedLayout');
 let builds=0;f.r._layout=(_o,g)=>{builds++;const names=['position','normal','uv','color'].filter(n=>g.attributes[n]);return{layout:names.map(name=>({name})),buffers:names.map(name=>({attr:g.attributes[name]}))};};
 f.draw();for(let i=0;i<100;i++)assert.equal(f.r.geometryReady(f.o,f.material),true);assert.equal(builds,1);
 const normal=new THREE.Float32BufferAttribute(new Float32Array(9).fill(1),3);f.geometry.setAttribute('normal',normal);
 assert.equal(f.r.geometryReady(f.o,f.material),false);f.draw();assert.equal(f.r.geometryReady(f.o,f.material),true);assert.equal(builds,2);
 assert.equal(f.r.geometries.get(f.geometry).buffers.get(normal).buffer.data[0],1);
});

test('readiness shares verified static bindings with the same frame draw while animated or external buffers still refresh',()=>{
 const f=fixture();f.o.geometry=f.geometry;f.draw();f.GPU.frame++;
 assert.equal(f.r.geometryReady(f.o,f.material,true),true);assert.equal(f.o.__frameRow.frame,f.GPU.frame);
 const instance=new THREE.InstancedBufferAttribute(new Float32Array(16),16);f.geometry.layout.buffers.push({attr:instance});f.draw();
 f.GPU.frame++;instance.needsUpdate=true;
 assert.equal(f.r.geometryReady(f.o,f.material,true),true);assert.notEqual(f.o.__frameRow.frame,f.GPU.frame);
 f.draw();assert.equal(f.r.geometryReady(f.o,f.material),true);
 f.GPU.frame++;f.geometry.attributes.color.gpuBuffer={id:123};
 assert.equal(f.r.geometryReady(f.o,f.material,true),true);assert.notEqual(f.o.__frameRow.frame,f.GPU.frame);
 f.geometry.index.needsUpdate=true;assert.equal(f.r.geometryReady(f.o,f.material,true),false);
});

test('measured chunk capacity growth releases superseded GPU attributes and retains exact live bindings',()=>{
 const f=fixture();f.o.geometry=f.geometry;f.geometry.userData.surveyMaterial=0;
 const first=f.draw(),oldPosition=first.vbs[0],color=first.vbs[1];
 f.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,2,2,2],3));
 f.geometry.layout={buffers:[{attr:f.geometry.attributes.position},{attr:f.geometry.attributes.color}]};
 const next=f.draw(),state=f.r.geometries.get(f.geometry);
 assert.equal(oldPosition.destroyed,true);assert.equal(color.destroyed,false);assert.equal(next.vbs[1],color);
 assert.equal(state.buffers.size,2);assert.equal(next.vbs[0].data[9],2);assert.equal(f.r.geometryReady(f.o,f.material),true);
});
test('admitting another tile preserves active buffers while retiring one geometry clears only its references',()=>{
 const f=fixture(),first=f.draw(),other=f.geometry.clone();
 f.r._drawRows=[{geo:f.geometry,o:{},vbs:first.vbs,index:first.index}];f.r._collectPools=[{items:[{geometry:f.geometry,object:{},material:{}}]}];
 f.r.retainGeometry([{geometry:f.geometry},{geometry:other}]);
 assert.equal(f.draw(),first);assert.deepEqual(f.count(),{creates:3,uploads:3});assert.equal(first.vbs[0].destroyed,false);
 f.r.releaseGeometry(f.geometry);assert.equal(first.vbs[0].destroyed,true);assert.equal(f.r._drawRows[0].geo,null);assert.equal(f.r._collectPools[0].items[0].geometry,null);
 const fresh=f.draw();assert.notEqual(fresh.vbs[0],first.vbs[0]);assert.equal(fresh.vbs[0].destroyed,false);assert.equal(f.count().creates,6);
});
