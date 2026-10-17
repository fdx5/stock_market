import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as THREE from 'three';
const out=fileURLToPath(new URL('../node_modules/.cache/test-lean-matrix-world.mjs',import.meta.url));
buildSync({entryPoints:[fileURLToPath(new URL('../src/components/leanMatrixWorld.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:out,external:['three'],logLevel:'silent'});
const {leanUpdateMatrixWorld}=await import(pathToFileURL(out).href);
// Two identical random scenes; one updated by three, the other by the lean walk, over frames
// where some objects move, some are set still with a matrix written once, some subtrees move.
function build(seed){
  let s=seed;const rnd=()=>((s=(s*16807)%2147483647)/2147483647);
  const scene=new THREE.Scene();scene.matrixAutoUpdate=false;const all=[scene];
  for(let i=0;i<400;i++){const parent=all[Math.floor(rnd()*all.length)];const o=rnd()<.3?new THREE.Group():new THREE.Mesh();
    o.position.set(rnd()*100,rnd()*10,rnd()*100);o.rotation.set(rnd(),rnd(),rnd());o.scale.setScalar(.5+rnd());
    if(rnd()<.2){o.updateMatrix();o.matrixAutoUpdate=false;}
    if(rnd()<.05)o.matrixWorldAutoUpdate=false;
    parent.add(o);all.push(o);}
  const cam=new THREE.PerspectiveCamera();all[5].add(cam);all.push(cam);
  return {scene,all,rnd};
}
test('the lean walk gives three\'s world matrices, frame after frame',()=>{
  const A=build(42),B=build(42);
  for(let f=0;f<30;f++){
    for(let k=0;k<20;k++){const i=1+Math.floor(A.rnd()*(A.all.length-1));B.rnd();const dx=A.rnd();B.rnd();
      for(const S of [A,B]){const o=S.all[i];
        if(o.matrixAutoUpdate)o.position.x+=dx;else{o.matrix.makeTranslation(dx,f,0);o.matrixWorldNeedsUpdate=true;}}}
    if(f%7===3)for(const S of [A,B])S.all[3].quaternion.set(0,Math.sin(f),0,Math.cos(f)).normalize();
    A.scene.updateMatrixWorld();leanUpdateMatrixWorld(B.scene);
    for(let i=0;i<A.all.length;i++){const a=A.all[i].matrixWorld.elements,b=B.all[i].matrixWorld.elements;for(let e=0;e<16;e++)assert.equal(b[e],a[e],`frame ${f} object ${i}`);}
    assert.deepEqual(B.all.at(-1).matrixWorldInverse.elements,A.all.at(-1).matrixWorldInverse.elements);
  }
});
