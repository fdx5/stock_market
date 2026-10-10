import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
const between=(a,b)=>source.slice(source.indexOf('\t'+a+'( '),source.indexOf(b,source.indexOf('\t'+a+'( ')));
function fixture(){
  let creates=0,uploads=0,layouts=0;const GPU={frame:0,device:{createBuffer(){creates++;return {data:null,destroyed:false,destroy(){this.destroyed=true;}};}}};
  const methods=vm.runInNewContext('({'+between('_attributeBuffer','\n\t_indexBuffer')+','+between('_indexBuffer','\n\t// cached _layout')+','+between('_frameBuffers','\n\t// the pipeline of')+','+between('retainGeometry','\n\treleaseGeometry')+','+between('releaseGeometry','\n\tdispose')+'})',{
    GPU,GPUBufferUsage:{VERTEX:1,COPY_DST:2,INDEX:4},Uint16Array,Uint32Array,
    align4:n=>Math.ceil(n/4)*4,convertArray:a=>a.array,writePadded:(b,a)=>{uploads++;b.data=Array.from(a);},
  });
  const r={...methods,geometryEpoch:0,geometries:new Map(),_geometryGPU(g){let v=this.geometries.get(g);if(!v)this.geometries.set(g,v={buffers:new Map(),indexVersion:-1});return v;},
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
test('storage attributes obtain the current external GPU buffer on every frame',()=>{
  const f=fixture();let current={id:1};f.geometry.attributes.color.gpuBuffer={getGPU:()=>current};
  assert.equal(f.draw().vbs[1],current);current={id:2};assert.equal(f.draw().vbs[1],current);
});
test('admitting another tile preserves active buffers while retiring one geometry clears only its references',()=>{
 const f=fixture(),first=f.draw(),other=f.geometry.clone();
 f.r._drawRows=[{geo:f.geometry,o:{},vbs:first.vbs,index:first.index}];f.r._collectPools=[{items:[{geometry:f.geometry,object:{},material:{}}]}];
 f.r.retainGeometry([{geometry:f.geometry},{geometry:other}]);
 assert.equal(f.draw(),first);assert.deepEqual(f.count(),{creates:3,uploads:3});assert.equal(first.vbs[0].destroyed,false);
 f.r.releaseGeometry(f.geometry);assert.equal(first.vbs[0].destroyed,true);assert.equal(f.r._drawRows[0].geo,null);assert.equal(f.r._collectPools[0].items[0].geometry,null);
 const fresh=f.draw();assert.notEqual(fresh.vbs[0],first.vbs[0]);assert.equal(fresh.vbs[0].destroyed,false);assert.equal(f.count().creates,6);
});
