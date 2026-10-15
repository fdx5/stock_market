import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as THREE from 'three';
// (built under node_modules/.cache: the same `three` instance resolves from there)
const out=fileURLToPath(new URL('../node_modules/.cache/test-drone-plant-pool.mjs',import.meta.url));
buildSync({entryPoints:[fileURLToPath(new URL('../src/components/dronePlantPool.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:out,external:['three'],logLevel:'silent',nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))]});
const {PlantPool}=await import(pathToFileURL(out).href);
const geo=new THREE.BoxGeometry(),mat=new THREE.MeshStandardMaterial();
const grove=(cx,cy,n,tint)=>{const g=new THREE.Group();g.position.set(cx,0,-cy);const m=new THREE.InstancedMesh(geo,mat,n);m.name='woodland pine near leaves';m.castShadow=true;
  for(let k=0;k<n;k++){m.setMatrixAt(k,new THREE.Matrix4().makeTranslation(k,0,0));m.setColorAt(k,new THREE.Color(tint,0,0));}g.add(m);g.updateMatrixWorld(true);return g;};
const world=(pool)=>{const pts=[];pool.root.traverse(o=>{if(o.isInstancedMesh)for(let k=0;k<o.count;k++){const e=new THREE.Matrix4();o.getMatrixAt(k,e);const c=new THREE.Color();o.getColorAt(k,c);pts.push([+e.elements[12].toFixed(3),+e.elements[14].toFixed(3),+c.r.toFixed(3)]);}});return pts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
test('a tile\'s woodland is drawn from its cell\'s pool at the same places and tints, and leaves with it',()=>{
  const pool=new PlantPool({addWarm:(p,o)=>p.add(o)});
  const a=grove(170,170,5,.2),b=grove(510,170,7,.4),c=grove(170,510,3,.6); // one 2x2 cell
  assert.equal(pool.adopt('0,0',0,0,a),1);pool.adopt('1,0',1,0,b);pool.adopt('0,1',0,1,c);
  let meshes=0;pool.root.traverse(o=>{if(o.isInstancedMesh)meshes++;});assert.equal(meshes,1);
  assert.equal(world(pool).length,15);
  assert.ok(world(pool).some(([x,z,r])=>x===510+6&&z===-170&&r===.4));
  pool.release('1,0');
  const left=world(pool);assert.equal(left.length,8);assert.ok(left.every(([,,r])=>r===.2||r===.6));
  assert.ok(left.some(([x,z,r])=>x===170+2&&z===-510&&r===.6));
  pool.release('0,0');pool.release('0,1');meshes=0;pool.root.traverse(o=>{if(o.isInstancedMesh)meshes++;});assert.equal(meshes,0);
});
