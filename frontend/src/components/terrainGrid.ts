/** The exact 65x65 national DEM posts, shared by the page sampler and workers.
 * Cached source buffers stay on the page; worker requests clone them. */
export type TerrainPosts={tiles:Float32Array[];cols:number;tx0:number;tx1:number;ty0:number;ty1:number;tileSize:number};
export type TerrainGridJob={posts:TerrainPosts;lon:number;lat:number;kx:number;ky:number;base:number;cx:number;cy:number;R:number;cell:number;n:number};

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
    h[j*n+i]=sampleTerrainPosts(posts,lon+x/kx,lat+y/ky)-base;
  }
  return h;
}
