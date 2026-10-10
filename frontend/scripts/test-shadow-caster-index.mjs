import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
const source=readFileSync(new URL('../src/vendor/tidewater/engine/render/MeshRenderer.js',import.meta.url),'utf8');
const method=(name,end)=>source.slice(source.indexOf('\t'+name+'( '),source.indexOf(end,source.indexOf('\t'+name+'( ')));
test('indexed caster collection matches full scene traversal for visibility, layers, materials, groups and filters',()=>{
 const GPU={frame:1},scope={GPU,_v:new THREE.Vector3(),_camPos:new THREE.Vector3(),Object};
 const r=vm.runInNewContext('({'+method('collect','\n\t_inFrustum')+','+method('_addItems','\n\t// ------------------------------------------------------------------------------ render')+'})',scope);
 r.reuseDrawLists=true;
 const scene=new THREE.Group();
 for(let i=0;i<100;i++){
  const geo=new THREE.BoxGeometry(),mat={id:i,visible:i%11!==0,transparent:i%7===0};
  const o=new THREE.Mesh(geo,mat);o.castShadow=i%3!==0;o.userData.moving=i%5===0;o.visible=i%13!==0;if(i%9===0)o.layers.mask=2;
  if(i%10===0){o.isInstancedMesh=true;o.worldTransformVersion=0;o.count=0;}
  if(i%17===0){o.material=[mat,{...mat,id:i+100}];geo.clearGroups();geo.addGroup(0,6,0);geo.addGroup(6,6,1);geo.setDrawRange(2,8);}
  scene.add(o);
 }
 const list=items=>Array.from([...items.opaque,...items.transparent],i=>[i.object.id,i.material.id,i.start,i.count]);
 for(const moving of [undefined,true,false]){
  GPU.frame++;const filter=moving===undefined?null:o=>o.userData.moving===moving;
  const options={kind:'depth',layerMask:1,filter};const expected=list(r.collect(scene,options));
  GPU.frame++;const objects=scene.children.filter(o=>o.castShadow&&(moving===undefined||o.userData.moving===moving));
  assert.deepEqual(list(r.collect(scene,{...options,objects})),expected);
 }
 GPU.frame++;assert.deepEqual(list(r.collect(scene,{kind:'depth',objects:[]})),[],'an empty caster set does not traverse the full scene');
});
