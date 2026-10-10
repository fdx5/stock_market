import * as THREE from 'three';
let cached: THREE.DataTexture | null = null;
/** One small repeating bubble mask for the WebGL fallback. Generated once; the
 * foam is never a regular square grid and requires no extra download. */
export function coastFoamTexture() {
  if (cached) return cached;
  const size = 128, cells = 32, centres = new Float32Array(cells * cells * 2), coverage = new Float32Array(64);
  const hash = (x: number, y: number, seed = 0) => {
    let n = (x & 31) + (y & 31) * 32 + seed * 104729;
    n = Math.imul(n ^ 0x85ebca6b, 0x27d4eb2d); n ^= n >>> 15; n = Math.imul(n, 0x85ebca6b); return (n >>> 0) / 4294967296;
  };
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const k=(y*32+x)*2;centres[k]=.15+.7*hash(x,y);centres[k+1]=.15+.7*hash(x,y,1);}
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)coverage[y*8+x]=hash(x*4,y*4,2);
  const smooth=(a:number,b:number,x:number)=>{const u=Math.max(0,Math.min(1,(x-a)/(b-a)));return u*u*(3-2*u);};
  const data = new Uint8Array(size * size * 4);
  for(let py=0;py<size;py++)for(let px=0;px<size;px++){
    const qx=(px+.5)/size*cells,qy=(py+.5)/size*cells,cx=Math.floor(qx),cy=Math.floor(qy),fx=qx-cx,fy=qy-cy;
    let d1=100,d2=100;
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      const k=(((cy+y)&31)*32+((cx+x)&31))*2,dx=x+centres[k]-fx,dy=y+centres[k+1]-fy,d=dx*dx+dy*dy;
      if(d<d1){d2=d1;d1=d;}else d2=Math.min(d2,d);
    }
    const a=Math.sqrt(d1),wall=1-smooth(.035,.13,Math.sqrt(d2)-a),small=1-smooth(.05,.14,a);
    const bx=qx/4,by=qy/4,ix=Math.floor(bx),iy=Math.floor(by),ux=smooth(0,1,bx-ix),uy=smooth(0,1,by-iy);
    const v=(x:number,y:number)=>coverage[(y&7)*8+(x&7)],m0=v(ix,iy)*(1-ux)+v(ix+1,iy)*ux,m1=v(ix,iy+1)*(1-ux)+v(ix+1,iy+1)*ux,k=(py*size+px)*4;
    data[k]=Math.round(Math.max(wall,small*.65)*255);data[k+1]=Math.round((m0*(1-uy)+m1*uy)*255);data[k+3]=255;
  }
  cached = new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  cached.wrapS=cached.wrapT=THREE.RepeatWrapping;cached.magFilter=THREE.LinearFilter;cached.minFilter=THREE.LinearMipmapLinearFilter;cached.generateMipmaps=true;cached.needsUpdate=true;
  return cached;
}
