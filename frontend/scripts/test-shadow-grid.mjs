import test from 'node:test';
import assert from 'node:assert/strict';
import {GPU} from '../src/vendor/tidewater/engine/gpu/GPU.js';
import {SunShadows} from '../src/vendor/tidewater/engine/render/Shadows.js';
import {ShadowUniforms} from '../src/vendor/tidewater/engine/render/wgsl/lighting.js';
import {PerspectiveCamera} from '../src/vendor/tidewater/engine/scene/Camera.js';
import {Vector3,Vector4,Matrix4} from '../src/vendor/tidewater/engine/math/index.js';

test('padded shadow fits retain texel density, world reference bias and the entire prior caster volume',()=>{
 const device=GPU.device;GPU.device={limits:{maxTextureDimension2D:8192}};
 try{
  for(const size of [1024,2048,4096])for(const aspect of [1866/1408,1920/1080])for(const sunY of [.15,.8]){
   const sun=new Vector3(.3,sunY,.52).normalize(),camera=new PerspectiveCamera(60,aspect,.5,5000),old=new SunShadows({size,splits:[180,600,1800]}),next=new SunShadows({size,splits:[180,600,1800],cacheGrid:64});
   for(let step=0;step<16;step++){
    camera.position.set(123+step*1.7,180+step*.4,-317+step*.3);camera.lookAt(new Vector3(step*1.7,0,step*.3));camera.updateMatrixWorld();
    for(let c=0;c<3;c++){
     old._fit(c,camera,sun);next._fit(c,camera,sun);const a=old.cascades[c],b=next.cascades[c];
     assert.ok(Math.abs(2*a.radius/old.size-2*b.radius/next.size)<1e-12);
     const oldRange=a.camera.far-a.camera.near,newRange=b.camera.far-b.camera.near;
     assert.ok(Math.abs(ShadowUniforms.fields.depthBiasScale.value.getComponent(c)*newRange-oldRange)<1e-9);
     const inverse=new Matrix4().copy(a.viewProj).invert();
     for(const x of [-1,1])for(const y of [-1,1])for(const z of [0,1]){
      const p=new Vector4(x,y,z,1).applyMatrix4(inverse).applyMatrix4(b.viewProj);
      assert.ok(Math.abs(p.x/p.w)<=1+1e-10&&Math.abs(p.y/p.w)<=1+1e-10&&p.z/p.w>=-1e-10&&p.z/p.w<=1+1e-10);
     }
    }
   }
   old.dispose();next.dispose();
  }
 }finally{GPU.device=device;}
});

test('texture limits retain the requested shadow resolution and moving fits can remain cached',()=>{
 const device=GPU.device;GPU.device={limits:{maxTextureDimension2D:2048}};
 try{
  const capped=new SunShadows({size:2048,cacheGrid:64});assert.equal(capped.size,2048);assert.equal(capped.cacheGrid,0);capped.dispose();
  GPU.device.limits.maxTextureDimension2D=8192;
  const old=new SunShadows({size:2048,splits:[180,600,1800]}),next=new SunShadows({size:2048,splits:[180,600,1800],cacheGrid:64}),camera=new PerspectiveCamera(60,1.5,.5,5000),sun=new Vector3(.3,.8,.52).normalize();let same=0,oldSame=0,prev=null,oldPrev=null;
  for(let step=0;step<120;step++){
   camera.position.set(100+step*.2,140,220);camera.lookAt(new Vector3(step*.2,0,0));camera.updateMatrixWorld();old._fit(0,camera,sun);next._fit(0,camera,sun);
   if(prev?.equals(next.cascades[0].viewProj))same++;if(oldPrev?.equals(old.cascades[0].viewProj))oldSame++;
   prev=next.cascades[0].viewProj.clone();oldPrev=old.cascades[0].viewProj.clone();
  }
  assert.ok(same>80);assert.ok(oldSame<same);old.dispose();next.dispose();
 }finally{GPU.device=device;}
});
