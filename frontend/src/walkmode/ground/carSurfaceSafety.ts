import type * as THREE from "three";

/** Repair only unusable exported normals; preserve the artist's valid smoothing.
 * Degenerate LOD normals must not introduce NaNs into the HDR reflection probe. */
export function repairCarNormals(geometry: THREE.BufferGeometry): number {
  const p=geometry.getAttribute("position"),n=geometry.getAttribute("normal"),index=geometry.getIndex();
  if(!p||!n)return 0;
  const bad=new Uint8Array(n.count);let count=0;
  for(let i=0;i<n.count;i++){const x=n.getX(i),y=n.getY(i),z=n.getZ(i);if(!Number.isFinite(x+y+z)||x*x+y*y+z*z<1e-12){bad[i]=1;count++;}}
  if(!count)return 0;
  const sums=new Float32Array(n.count*3),length=index?.count??p.count;
  for(let i=0;i+2<length;i+=3){const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;if(!bad[a]&&!bad[b]&&!bad[c])continue;
    const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a),vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;if(!Number.isFinite(x+y+z))continue;
    for(const k of [a,b,c])if(bad[k]){sums[k*3]+=x;sums[k*3+1]+=y;sums[k*3+2]+=z;}}
  for(let i=0;i<n.count;i++)if(bad[i]){const x=sums[i*3],y=sums[i*3+1],z=sums[i*3+2],l=Math.hypot(x,y,z);if(l>1e-12)n.setXYZ(i,x/l,y/l,z/l);else n.setXYZ(i,0,1,0);}
  n.needsUpdate=true;geometry.userData.repairedCarNormals=count;return count;
}

/** Validate once behind the loading screen. Bounded row batches avoid a full
 * 50MB float readback allocation. No readback or extra pass runs while driving. */
export function finiteCarReflection(renderer:THREE.WebGLRenderer,target:THREE.WebGLRenderTarget):boolean {
  const gl=renderer.getContext(),previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const rows=Math.min(32,target.height),data=new Float32Array(target.width*rows*4);
  try{renderer.setRenderTarget(target);
    for(let y=0;y<target.height;y+=rows){const h=Math.min(rows,target.height-y);gl.readPixels(0,y,target.width,h,gl.RGBA,gl.FLOAT,data);if(gl.getError()!==gl.NO_ERROR)return false;
      for(let i=0;i<target.width*h*4;i++)if(!Number.isFinite(data[i]))return false;}
    return true;
  }catch{return false;}finally{renderer.setRenderTarget(previous,face,mip);}
}
