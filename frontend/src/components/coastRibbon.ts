import * as THREE from 'three';
type Point = [number, number];
/** Continuous vector strand, replacing square raster cells. Query edges stay open. */
export function coastRibbon(rings: { ring: Point[]; holes?: Point[][] }[], open: [number,number,number,number], width: number, height: (x:number,y:number)=>number) {
  const pos: number[] = [], distance: number[] = [], index: number[] = [];
  for (const parcel of rings) for (const [hi, ring] of [parcel.ring, ...(parcel.holes ?? [])].entries()) {
    const area = ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0);
    const side = (area < 0 ? 1 : -1) * (hi ? -1 : 1);
    const normals = ring.map((a,i)=>{
      const p=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],l0=Math.hypot(a[0]-p[0],a[1]-p[1])||1,l1=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
      const n0=[-(a[1]-p[1])/l0*side,(a[0]-p[0])/l0*side],n1=[-(b[1]-a[1])/l1*side,(b[0]-a[0])/l1*side];
      const nx=n0[0]+n1[0],ny=n0[1]+n1[1],l=Math.hypot(nx,ny);
      if(l<1e-4)return n1;
      const k=Math.min(2,1/Math.max(.5,(nx*n1[0]+ny*n1[1])/l));return [nx/l*k,ny/l*k];
    });
    ring.forEach((a,i)=>{
      const j=(i+1)%ring.length,b=ring[j];
      if ([0,2].some(k=>Math.abs(a[0]-open[k])<.05&&Math.abs(b[0]-open[k])<.05)||[1,3].some(k=>Math.abs(a[1]-open[k])<.05&&Math.abs(b[1]-open[k])<.05)) return;
      const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4)),bands=Math.max(1,Math.ceil(width/2)),start=pos.length/3;
      for(let q=0;q<=steps;q++)for(let k=0;k<=bands;k++){
        const t=q/steps,d=k/bands*width,nx=normals[i][0]*(1-t)+normals[j][0]*t,ny=normals[i][1]*(1-t)+normals[j][1]*t;
        const x=a[0]+(b[0]-a[0])*t+nx*d,y=a[1]+(b[1]-a[1])*t+ny*d;
        pos.push(x,height(x,y)+.03,-y);distance.push(d);
      }
      for(let q=0;q<steps;q++)for(let k=0;k<bands;k++){
        const a0=start+q*(bands+1)+k,b0=a0+bands+1,c0=b0+1,d0=a0+1;
        if(side>0)index.push(a0,b0,c0,a0,c0,d0);else index.push(a0,c0,b0,a0,d0,c0);
      }
    });
  }
  return {pos:new Float32Array(pos),distance:new Float32Array(distance),index:new Uint32Array(index)};
}
