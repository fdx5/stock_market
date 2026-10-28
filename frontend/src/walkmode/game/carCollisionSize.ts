import type * as THREE from "three";
const cache=new WeakMap<THREE.BufferGeometry,{length:number;width:number}>();
/** Driving hull excludes mirrors; the clearance skin is 5 cm per side. */
export function carCollisionSize(g:THREE.BufferGeometry){
  const previous=cache.get(g);if(previous)return previous;
  if(!g.boundingBox)g.computeBoundingBox();const box=g.boundingBox!,p=g.getAttribute("position"),uv=g.getAttribute("uv"),index=g.getIndex();let halfWidth=0,z0=Infinity,z1=-Infinity;
  const low=box.min.y+.10,high=box.min.y+(box.max.y-box.min.y)*.52;
  for(let i=0;i<(index?.count??p.count);i++){const a=index?index.getX(i):i,part=uv?Math.floor(uv.getX(a)*16):0;if(part!==0&&part!==11&&part!==10)continue;
    const y=p.getY(a);if(y>=low&&y<=high)halfWidth=Math.max(halfWidth,Math.abs(p.getX(a)));z0=Math.min(z0,p.getZ(a));z1=Math.max(z1,p.getZ(a));}
  const result={width:Math.max(.65,(halfWidth?halfWidth*2:box.max.x-box.min.x)-.10),length:Math.max(1,(Number.isFinite(z0)?z1-z0:box.max.z-box.min.z)-.18)};cache.set(g,result);return result;
}
