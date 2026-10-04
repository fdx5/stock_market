/** Closed, smoothly shaded foliage lobes. Spatial merging funds rounded volumes
 * within the former card budget per source group.
 * Shared vertices and front faces replace the three intersecting double-sided cards. */
export type CrownLobe={x:number;y:number;z:number;rx:number;ry:number;rz:number;weight:number;tag:number};
export function unionCrownLobes(a:CrownLobe,b:CrownLobe):CrownLobe{
 const lo=[Math.min(a.x-a.rx,b.x-b.rx),Math.min(a.y-a.ry,b.y-b.ry),Math.min(a.z-a.rz,b.z-b.rz)],hi=[Math.max(a.x+a.rx,b.x+b.rx),Math.max(a.y+a.ry,b.y+b.ry),Math.max(a.z+a.rz,b.z+b.rz)];
 return {x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:(lo[2]+hi[2])/2,rx:(hi[0]-lo[0])/2,ry:(hi[1]-lo[1])/2,rz:(hi[2]-lo[2])/2,weight:a.weight+b.weight,tag:a.weight>=b.weight?a.tag:b.tag};
}
/** Offline tree lobes are few (at most 27). Preserve their complete bounds. */
export function compactCrownLobes(lobes:CrownLobe[],count:number){
 const out=lobes.map(l=>({...l}));
 while(out.length>count){let ai=0,bi=1,best=Infinity;for(let a=0;a<out.length;a++)for(let b=a+1;b<out.length;b++){
  const A=out[a],B=out[b],d=(A.x-B.x)**2+(A.y-B.y)**2+(A.z-B.z)**2;if(d<best){best=d;ai=a;bi=b;}
 }out[ai]=unionCrownLobes(out[ai],out[bi]);out.splice(bi,1);}
 return out;
}
export function appendCrownVolume(out:{position:number[];normal:number[];uv:number[];color:number[];index:number[]},c:CrownLobe,sides:number,angle:number,cell:number,rgb:readonly number[],bands=1,upperWidth=1){
 const base=out.position.length/3,u0=cell%8/8+4/1024,u1=(cell%8+1)/8-4/1024,v0=1-(Math.floor(cell/8)+1)/3+4/576,v1=1-Math.floor(cell/8)/3-4/576;
 const vertex=(dx:number,dy:number,dz:number,u:number,v:number)=>{
  out.position.push(c.x+dx,c.y+dy,c.z+dz);
  const nx=dx/Math.max(c.rx*c.rx,1e-8),ny=dy/Math.max(c.ry*c.ry,1e-8),nz=dz/Math.max(c.rz*c.rz,1e-8),n=Math.hypot(nx,ny,nz)||1;
  out.normal.push(nx/n,ny/n,nz/n);out.uv.push(u,v);out.color.push(...rgb);
 };
 vertex(0,c.ry,0,(u0+u1)/2,v1);vertex(0,-c.ry,0,(u0+u1)/2,v0);
 if(bands===2){
  for(let band=0;band<2;band++)for(let j=0;j<sides;j++){
   const a=angle+j*Math.PI*2/sides,spread=(.87+.035*Math.sin(j*2.37+cell))*(band===0?upperWidth:1),level=band===0?.43:-.43;
   vertex(Math.cos(a)*c.rx*spread,level*c.ry,Math.sin(a)*c.rz*spread,j%2?u1:u0,v0+(.5+level*.5)*(v1-v0));
  }
  for(let j=0;j<sides;j++){
   const u=base+2+j,un=base+2+(j+1)%sides,l=u+sides,ln=un+sides;
   out.index.push(base,un,u,base+1,l,ln,u,un,ln,u,ln,l);
  }
  return;
 }
 for(let j=0;j<sides;j++){const a=angle+j*Math.PI*2/sides;vertex(Math.cos(a)*c.rx,0,Math.sin(a)*c.rz,j%2?u1:u0,(v0+v1)/2);}
 for(let j=0;j<sides;j++){const cur=base+2+j,next=base+2+(j+1)%sides;out.index.push(base,next,cur,base+1,cur,next);}
}
