import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build,transformSync} from 'esbuild';
import vm from 'node:vm';
import * as THREE from 'three';
const source=readFileSync(new URL('../src/components/buildingAppearance.ts',import.meta.url),'utf8');
const scope={THREE,module:{exports:{}},exports:{}};
vm.runInNewContext(transformSync(source.replace(/^import .*\r?\n/gm,''),{loader:'ts',format:'cjs'}).code,scope);
const {buildingAppearanceProfile:profile,applyBuildingAppearance:apply,surveyedAppearance,observedRoofColour}=scope.module.exports;
const priority=await build({entryPoints:[new URL('../src/components/droneLoadPriority.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
const {droneLoadPriority:rank}=await import('data:text/javascript;base64,'+Buffer.from(priority.outputFiles[0].text).toString('base64'));
test('registered use and structure constrain distinct finishes without photos',()=>{
  const base={id:'house',height:12,floors:4};
  assert.equal(profile({...base,structureName:'벽돌조'}).finish,1);
  assert.equal(profile({...base,structureName:'석조'}).finish,2);
  assert.equal(profile({...base,structureName:'철골조',use:'office'}).finish,3);
  assert.equal(profile({...base,height:80,use:'office'}).finish,4);
  assert.equal(profile({...base,height:60,use:'02000'}).style,'apt');
});
test('identity variations are stable across order, worker serialization and different tile seeds',()=>{
  const inputs=Array.from({length:32},(_,i)=>({id:'registered-'+i,height:30,floors:10,use:'02000'}));
  const first=inputs.map(profile),reverse=inputs.toReversed().map(profile).toReversed();
  assert.equal(JSON.stringify(first),JSON.stringify(reverse));
  assert.equal(new Set(first.map(p=>p.wall.join(','))).size,8);
  assert.equal(new Set(first.map(p=>p.bay)).size,8);
  const workerProfile=vm.runInNewContext('('+profile.toString()+')');
  assert.equal(JSON.stringify(first),JSON.stringify(inputs.map(workerProfile)));
});
test('appearance cannot alter surveyed positions, normals or topology; floors align at registered height',()=>{
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,10,4,0,10,4,0,50,0,0,50],3))
    .setAttribute('normal',new THREE.Float32BufferAttribute([0,-1,0,0,-1,0,0,-1,0,0,-1,0],3)).setAttribute('uv',new THREE.Float32BufferAttribute([0,0,4,0,4,40,0,40],2)).setIndex([0,1,2,0,2,3]);
  const pos=g.attributes.position,norm=g.attributes.normal,index=g.index,old=Array.from(pos.array);
  const p=profile({id:'actual',height:40,floors:10,use:'02000'});apply(g,p,10);
  assert.equal(g.attributes.position,pos);assert.equal(g.attributes.normal,norm);assert.equal(g.index,index);assert.deepEqual(Array.from(pos.array),old);
  assert.equal(g.attributes.uv.getY(2),10);assert.equal(g.attributes.facade.count,4);
  apply(g,p,10,true);assert.ok(g.attributes.facade.getX(0)>=32);
});
test('same GPU material can carry different cladding, colour and window parameters',()=>{
  const material=new THREE.MeshStandardMaterial(),a=new THREE.BoxGeometry(1,1,1),b=a.clone();
  apply(a,profile({id:'a',height:12,floors:4,structureName:'벽돌조'}),0);
  apply(b,profile({id:'b',height:12,floors:4,structureName:'석조'}),0);
  const one=new THREE.Mesh(a,material),two=new THREE.Mesh(b,material);
  assert.equal(one.material,two.material);assert.notDeepEqual(Array.from(a.attributes.facade.array),Array.from(b.attributes.facade.array));
  assert.notDeepEqual(Array.from(a.attributes.color.array),Array.from(b.attributes.color.array));
});
test('very close buildings win; visible ahead beats equally distant behind and ranking responds to a turn',()=>{
  assert.ok(rank(40,0,0,0,400,0,[1,0])<rank(400,0,0,0,400,0,[1,0]));
  assert.ok(rank(400,0,0,0,0,0,[1,0])<rank(-400,0,0,0,0,0,[1,0]));
  assert.ok(rank(0,400,0,0,0,0,[0,1])<rank(400,0,0,0,0,0,[0,1]));
});
test('measured worker payload carries geometry only and no photograph identifiers or bytes',async()=>{
  const bundled=await build({entryPoints:[new URL('../src/components/surveyShapeModel.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm'});
  const {surveyShapeModel}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const geometry=new THREE.BoxGeometry(1,2,3),m=surveyShapeModel({key:'actual',geometry,cx:0,cy:0,hull:[],src:{img:'private-photo.jpg'},images:[{thumbnail:new ArrayBuffer(5000)}]},0,0,0);
  assert.ok(m.position.length>0&&m.index.length>0);assert.equal('src' in m,false);assert.equal('images' in m,false);assert.equal(JSON.stringify(m).includes('private-photo'),false);
});

test('ordinary tall apartments retain painted walls and measured replacements fit registered storeys',()=>{
 const p=profile({id:'apartment',height:100,floors:32,use:'02000'});assert.equal(p.finish,0);
 assert.equal(surveyedAppearance(p,96).storey,3);
});

test('unverified roofs vary independently from wall colour and never default to green coating',()=>{
 const inputs=Array.from({length:128},(_,i)=>({id:'roof-'+i,height:60,floors:20,use:'02000',name:'래미안'}));
 const profiles=inputs.map(profile);
 assert.equal(new Set(profiles.map(p=>p.roof.join(','))).size,8);
 assert.equal(new Set(profiles.map(p=>p.wall.join(','))).size,1);
 for(const p of profiles)assert.ok(!(p.roof[1]>p.roof[0]+.01&&p.roof[1]>p.roof[2]+.01));
 const worker=vm.runInNewContext('('+profile.toString()+')');
 assert.equal(JSON.stringify(profiles),JSON.stringify(inputs.map(worker)));
});

test('late aerial roof colours reject vegetation contamination and convert trusted sRGB exactly once',()=>{
 const p=profile({id:'slab',height:60,floors:20});
 for(const rgb of [[.46,.71,.31],[.61,.64,.34],[.12,.39,.15],[NaN,.5,.5],[.4,1.4,.4],[.03,.04,.03]])assert.equal(observedRoofColour(p,rgb),p.roof);
 const gray=Array.from(observedRoofColour(p,[.5,.5,.5]));
 for(const v of gray)assert.ok(Math.abs(v-.21404114048223255)<1e-12);
 const tile=Array.from(observedRoofColour(p,[.6,.32,.22],true));
 assert.notDeepEqual(tile,Array.from(p.roof));assert.ok(tile[0]>tile[1]&&tile[1]>tile[2]);
 assert.equal(observedRoofColour(p,[.6,.32,.22],false),p.roof);
});

test('roof corrections cannot change the facade, footprint, heights or triangle topology',()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,20,1,0,20,0,1,20,0,0,0,1,0,0,1,0,20],3))
  .setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,-1,0,0,-1,0,0,-1,0],3)).setIndex([0,1,2,3,4,5]);
 const pos=g.attributes.position,norm=g.attributes.normal,index=g.index,p=profile({id:'slab',height:20,floors:6});
 apply(g,p,0);const wall=Array.from(g.attributes.color.array.slice(9));
 const rgb=observedRoofColour(p,[.4,.7,.3]);for(let i=0;i<3;i++)g.attributes.color.setXYZ(i,...rgb);
 assert.equal(g.attributes.position,pos);assert.equal(g.attributes.normal,norm);assert.equal(g.index,index);
 assert.deepEqual(Array.from(g.attributes.color.array.slice(9)),wall);
 for(let i=0;i<3;i++)for(let c=0;c<3;c++)assert.ok(Math.abs(g.attributes.color.array[i*3+c]-p.roof[c])<1e-7);
});

test('1–4 storey buildings retain about half their openings while the rest use all four new layouts',()=>{
 const inputs=Array.from({length:4096},(_,i)=>({id:'lowrise-'+i,height:12,floors:1+i%4,use:'shop'})),profiles=inputs.map(profile);
 const current=profiles.filter(p=>p.layout===0).length;
 assert.ok(current/profiles.length>.45&&current/profiles.length<.55);
 assert.deepEqual([...new Set(profiles.map(p=>p.layout))].sort(),[0,1,2,3,4]);
 const worker=vm.runInNewContext('('+profile.toString()+')');
 assert.equal(JSON.stringify(profiles),JSON.stringify(inputs.toReversed().map(worker).toReversed()));
 for(const floors of [5,6,10])for(let i=0;i<128;i++)assert.equal(profile({id:'lowrise-'+i,height:12,floors}).layout,0);
 // A four-storey building taller than 5m qualifies; a five-storey short data
 // record does not. Storeys are the user's criterion even in inconsistent data.
 assert.ok(profiles.some(p=>p.layout>0&&p.floors===4));
 for(let i=0;i<128;i++)assert.equal(profile({id:'lowrise-'+i,height:4.9,floors:5}).layout,0);
});

test('low-rise layouts reuse existing attributes and survive measured replacements without changing geometry or wall finish',()=>{
 const input=Array.from({length:64},(_,i)=>profile({id:'lowrise-'+i,height:12,floors:4,structureName:'벽돌조'})).find(p=>p.layout>0);
 const g=new THREE.BoxGeometry(5,6,12),position=g.attributes.position,normal=g.attributes.normal,index=g.index;
 apply(g,input,0);
 assert.equal(g.attributes.facade.itemSize,4);assert.equal(g.attributes.facade.getY(0),input.variant+input.layout*8);
 assert.equal(g.attributes.position,position);assert.equal(g.attributes.normal,normal);assert.equal(g.index,index);
 const measured=surveyedAppearance(input,18);
 assert.equal(measured.layout,input.layout);assert.equal(measured.floors,4);assert.equal(measured.finish,1);assert.equal(measured.storey,4.5);
 apply(g,measured,0,true);assert.equal(g.attributes.facade.getY(0),input.variant+input.layout*8);
});
