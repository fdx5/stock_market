/** The exact 65x65 national DEM posts, shared by the page sampler and workers.
 * Cached source buffers stay on the page; worker requests clone them. */
export type TerrainPosts={tiles:Float32Array[];cols:number;tx0:number;tx1:number;ty0:number;ty1:number;tileSize:number};
export type TerrainAnchor={h:Float32Array;n:number;R:number;cell:number;half:number};
export type TerrainGridJob={posts:TerrainPosts;lon:number;lat:number;kx:number;ky:number;base:number;cx:number;cy:number;R:number;cell:number;n:number;anchor?:TerrainAnchor};

/** Continue the departure area's graded terrain through the boundary, then
 * smoothly return to the national DEM over a bounded 128 m approach. */
export function anchoredTerrainHeight(anchor:TerrainAnchor|undefined,x:number,y:number,height:number){
 if(!anchor)return height;
 const distance=Math.max(Math.abs(x),Math.abs(y))-anchor.half;if(distance>=128)return height;
 const gx=Math.max(0,Math.min(anchor.n-1.001,(x+anchor.R)/anchor.cell)),gy=Math.max(0,Math.min(anchor.n-1.001,(y+anchor.R)/anchor.cell));
 const i=Math.floor(gx),j=Math.floor(gy),fx=gx-i,fy=gy-j,h=anchor.h,n=anchor.n;
 const source=(h[j*n+i]*(1-fx)+h[j*n+i+1]*fx)*(1-fy)+(h[(j+1)*n+i]*(1-fx)+h[(j+1)*n+i+1]*fx)*fy;
 const t=Math.max(0,Math.min(1,(distance-32)/96)),w=1-t*t*(3-2*t);
 return height+(source-height)*w;
}

export function sampleTerrainPosts(p:TerrainPosts,lo:number,la:number){
  const fx=(lo+180)/p.tileSize,fy=(la+90)/p.tileSize;
  const x=Math.min(p.tx1,Math.max(p.tx0,Math.floor(fx))),y=Math.min(p.ty1,Math.max(p.ty0,Math.floor(fy)));
  const t=p.tiles[(y-p.ty0)*p.cols+(x-p.tx0)];
  const u=Math.min(64,Math.max(0,(fx-x)*64)),v=Math.min(64,Math.max(0,(1-(fy-y))*64));
  const c=Math.min(63,Math.floor(u)),r=Math.min(63,Math.floor(v)),a=u-c,b=v-r;
  return (t[r*65+c]*(1-a)+t[r*65+c+1]*a)*(1-b)+(t[(r+1)*65+c]*(1-a)+t[(r+1)*65+c+1]*a)*b;
}

export function fillTerrainGrid(job:TerrainGridJob){
  const {n,R,cell,cx,cy,lon,lat,kx,ky,base,posts}=job,h=new Float32Array(n*n);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const x=cx-R+i*cell,y=cy-R+j*cell;
    h[j*n+i]=anchoredTerrainHeight(job.anchor,x,y,sampleTerrainPosts(posts,lon+x/kx,lat+y/ky)-base);
  }
  return h;
}
