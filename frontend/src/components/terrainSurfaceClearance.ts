/** Pure worker geometry. Ground is rendered as two planes per DEM cell, not
 * bilinear interpolation. Clip only unsafe road triangles at those exact edges;
 * the maximum of the two planes then clears the whole overlap, not just corners. */
export function terrainSurfaceClearance(){
 type P=[number,number];
 type Surface={position:Float32Array;normal:Float32Array;index:Uint32Array;color?:Float32Array;level?:Float32Array};
 type Grid={h:Float32Array;n:number;R:number;cell:number;ox:number;oy:number};
 const cross=(a:P,b:P,c:P)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const clip=(input:P[],triangle:P[])=>{
  let polygon=input;const sign=Math.sign(cross(triangle[0],triangle[1],triangle[2]));
  for(let i=0;i<3&&polygon.length;i++){const a=triangle[i],b=triangle[(i+1)%3],out:P[]=[];
   for(let j=0;j<polygon.length;j++){const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=cross(a,b,p)*sign,dq=cross(a,b,q)*sign;
    if(dp>=-1e-8)out.push(p);if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}
   polygon=out;
  }return polygon;
 };
 const weights=(triangle:P[],p:P)=>{const d=cross(triangle[0],triangle[1],triangle[2]),u=cross(triangle[0],p,triangle[2])/d,v=cross(triangle[0],triangle[1],p)/d;return[1-u-v,u,v];};
 /** Surface ownership follows tile bounds, including road width. Clipping just
  * the centreline leaves asphalt over a neighbour's independently graded DEM. */
 const clipBox=(input:Surface|null,box:readonly number[]):Surface|null=>{
  if(!input)return null;
  const p:number[]=[],n:number[]=[],c:number[]=[],l:number[]=[],idx:number[]=[],originals=new Map<number,number>();let changed=false;
  const vertex=(id:number)=>[...input.position.subarray(id*3,id*3+3),...input.normal.subarray(id*3,id*3+3),...(input.color?Array.from(input.color.subarray(id*3,id*3+3)):[])];
  const emit=(v:number[],level:number)=>{const id=p.length/3;p.push(v[0],v[1],v[2]);n.push(v[3],v[4],v[5]);if(input.color)c.push(v[6],v[7],v[8]);if(input.level)l.push(level);idx.push(id);};
  for(let k=0;k<input.index.length;k+=3){const ids=Array.from(input.index.subarray(k,k+3)),level=input.level?.[ids[0]]??0;
   let poly=ids.map(vertex);
   if(poly.every(v=>v[0]>=box[0]-1e-7&&v[0]<=box[2]+1e-7&&v[1]>=box[1]-1e-7&&v[1]<=box[3]+1e-7)){
    for(const id of ids){const old=originals.get(id);if(old!==undefined)idx.push(old);else{originals.set(id,p.length/3);emit(vertex(id),level);}}continue;
   }
   changed=true;
   for(const [axis,bound,sign]of [[0,box[0],1],[0,box[2],-1],[1,box[1],1],[1,box[3],-1]]){
    const out:number[][]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign;
     if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}}
    poly=out;if(!poly.length)break;
   }
   for(let i=1;i+1<poly.length;i++){const a=poly[0],b=poly[i],c=poly[i+1],u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-9)continue;
    for(const q of [a,b,c])emit(q,level);
   }
  }
  return changed?{position:new Float32Array(p),normal:new Float32Array(n),index:new Uint32Array(idx),...(input.color?{color:new Float32Array(c)}:{}),...(input.level?{level:new Float32Array(l)}:{})}:input;
 };
 const drape=(input:Surface|null,g:Grid,lift=.02):Surface|null=>{
  if(!input)return null;
  const positions:number[]=[],normals:number[]=[],colours:number[]=[],levels:number[]=[],indices:number[]=[],originals=new Map<number,number>(),p=input.position,x0=g.ox-g.R,y0=g.oy-g.R;let changed=false;
  const emit=(q:P,z:number,w:number[],ids:number[])=>{const k=positions.length/3;positions.push(q[0],q[1],z);for(let n=0;n<3;n++){normals.push(ids.reduce((s,id,i)=>s+input.normal[id*3+n]*w[i],0));if(input.color)colours.push(ids.reduce((s,id,i)=>s+input.color![id*3+n]*w[i],0));}if(input.level)levels.push(input.level[ids[0]]);indices.push(k);};
  for(let k=0;k<input.index.length;k+=3){
   const ids=Array.from(input.index.subarray(k,k+3)),triangle:P[]=ids.map(id=>[p[id*3],p[id*3+1]]),heights=ids.map(id=>p[id*3+2]);
   if(Math.abs(cross(triangle[0],triangle[1],triangle[2]))<1e-9)continue;
   const start=positions.length,parts:{polygon:P[];surface:P[];h:number[]}[]=[];let unsafe=false;
   // A confirmed deck owns its bank profile. Terrain beneath/alongside it
   // cannot stretch its triangles up a hillside or turn the slab into a ramp.
   if(input.level?.[ids[0]]){for(let i=0;i<3;i++)emit(triangle[i],heights[i],i===0?[1,0,0]:i===1?[0,1,0]:[0,0,1],ids);continue;}
   const ix0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[0]))-x0)/g.cell)),ix1=Math.min(g.n-2,Math.floor((Math.max(...triangle.map(p=>p[0]))-x0)/g.cell));
   const iy0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[1]))-y0)/g.cell)),iy1=Math.min(g.n-2,Math.floor((Math.max(...triangle.map(p=>p[1]))-y0)/g.cell));
   for(let j=iy0;j<=iy1;j++)for(let i=ix0;i<=ix1;i++){
    const a=j*g.n+i,b=a+1,c=a+g.n,d=c+1;
    // Same a-b-d / a-d-c diagonal and ascending y as DroneWorld.groundMesh.
    for(const gi of [[a,b,d],[a,d,c]]){const surface:P[]=gi.map(id=>[x0+(id%g.n)*g.cell,y0+Math.floor(id/g.n)*g.cell]),polygon=clip(triangle,surface);if(polygon.length<3)continue;
     const h=gi.map(id=>g.h[id]);parts.push({polygon,surface,h});
     for(const q of polygon){const w=weights(triangle,q),v=weights(surface,q);if(w.reduce((s,w,i)=>s+w*heights[i],0)<v.reduce((s,w,i)=>s+w*h[i],0)+lift-1e-5)unsafe=true;}
    }
   }
   if(!unsafe){for(let i=0;i<3;i++){const old=originals.get(ids[i]);if(old!==undefined)indices.push(old);else{originals.set(ids[i],positions.length/3);emit(triangle[i],heights[i],i===0?[1,0,0]:i===1?[0,1,0]:[0,0,1],ids);}}}
   else {changed=true;for(const {polygon,surface,h}of parts)for(let i=1;i+1<polygon.length;i++){
    const t=[polygon[0],polygon[i],polygon[i+1]];if(Math.abs(cross(t[0],t[1],t[2]))<1e-9)continue;
    for(const q of t){const w=weights(triangle,q),v=weights(surface,q);emit(q,Math.max(w.reduce((s,w,i)=>s+w*heights[i],0),v.reduce((s,w,i)=>s+w*h[i],0)+lift),w,ids);}
   }}
   // Road inputs are confined to the tile plus its margin. Preserve an input
   // outside a supplied grid rather than treating an absent overlap as a hole.
   if(positions.length===start)for(let i=0;i<3;i++)emit(triangle[i],heights[i],i===0?[1,0,0]:i===1?[0,1,0]:[0,0,1],ids);
  }
  return changed?{position:new Float32Array(positions),normal:new Float32Array(normals),index:new Uint32Array(indices),...(input.color?{color:new Float32Array(colours)}:{}),...(input.level?{level:new Float32Array(levels)}:{})}:input;
 };
 const index=(surface:Surface)=>{
  const bins=new Map<string,number[]>(),p=surface.position,size=8;
  for(let k=0;k<surface.index.length;k+=3){const ids=Array.from(surface.index.subarray(k,k+3)),xs=ids.map(i=>p[i*3]),ys=ids.map(i=>p[i*3+1]);for(let i=Math.floor(Math.min(...xs)/size);i<=Math.floor(Math.max(...xs)/size);i++)for(let j=Math.floor(Math.min(...ys)/size);j<=Math.floor(Math.max(...ys)/size);j++){const key=i+','+j,list=bins.get(key);if(list)list.push(k);else bins.set(key,[k]);}}
  const query=(triangle:P[])=>{const out=new Set<number>();for(let i=Math.floor(Math.min(...triangle.map(p=>p[0]))/size);i<=Math.floor(Math.max(...triangle.map(p=>p[0]))/size);i++)for(let j=Math.floor(Math.min(...triangle.map(p=>p[1]))/size);j<=Math.floor(Math.max(...triangle.map(p=>p[1]))/size);j++)for(const k of bins.get(i+','+j)??[])out.add(k);return out;};
  const height=(x:number,y:number,reference:number)=>{let height=reference,best=Infinity;const q:P=[x,y];for(const k of query([q])){const ids=Array.from(surface.index.subarray(k,k+3)),t:P[]=ids.map(i=>[p[i*3],p[i*3+1]]);if(Math.abs(cross(t[0],t[1],t[2]))<1e-9)continue;const w=weights(t,q);if(w.some(v=>v< -1e-6))continue;const h=w.reduce((s,w,i)=>s+w*p[ids[i]*3+2],0),d=Math.abs(h-reference);if(d<best){best=d;height=h;}}return height;};
  // Cars interpolate between path vertices. Insert pavement edges so a segment
  // follows every corrected plane, rather than sinking through its interior.
  const trace=(a:number[],b:number[])=>{
   const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy,cuts=[0,1];
   if(length2>1e-12)for(const k of query([[a[0],a[1]],[b[0],b[1]]])){
    const ids=Array.from(surface.index.subarray(k,k+3));for(let i=0;i<3;i++){
     const u=ids[i]*3,v=ids[(i+1)%3]*3,ex=p[v]-p[u],ey=p[v+1]-p[u+1],qx=p[u]-a[0],qy=p[u+1]-a[1],den=dx*ey-dy*ex;
     if(Math.abs(den)>1e-10){const t=(qx*ey-qy*ex)/den,s=(qx*dy-qy*dx)/den;if(t>1e-7&&t<1-1e-7&&s>=-1e-7&&s<=1+1e-7)cuts.push(t);}
     else if(Math.abs(qx*dy-qy*dx)<1e-7)for(const id of [u,v]){const t=((p[id]-a[0])*dx+(p[id+1]-a[1])*dy)/length2;if(t>1e-7&&t<1-1e-7)cuts.push(t);}
    }
   }
   cuts.sort((a,b)=>a-b);const out:number[]=[];let last=-1;
   for(const t of cuts)if(t-last>1e-7){last=t;const x=a[0]+dx*t,y=a[1]+dy*t;out.push(x,y,height(x,y,a[2]+(b[2]-a[2])*t));}
   return out;
  };
  return{query,height,trace};
 };
 const raisePaint=(paint:Surface|null,surface:Surface,lookup:ReturnType<typeof index>,lift=.015)=>{
  if(!paint)return;
  const p=paint.position,a=surface.position;
  for(let k=0;k<paint.index.length;k+=3){const ids=Array.from(paint.index.subarray(k,k+3)),triangle:P[]=ids.map(id=>[p[id*3],p[id*3+1]]);if(Math.abs(cross(triangle[0],triangle[1],triangle[2]))<1e-9)continue;let raise=0;
   for(const n of lookup.query(triangle)){const ai=Array.from(surface.index.subarray(n,n+3));if(paint.level&&surface.level&&(paint.level[ids[0]]===0)!==(surface.level[ai[0]]===0))continue;const t:P[]=ai.map(id=>[a[id*3],a[id*3+1]]);if(Math.abs(cross(t[0],t[1],t[2]))<1e-9)continue;
    for(const q of clip(triangle,t)){const w=weights(triangle,q),v=weights(t,q),h=w.reduce((s,w,i)=>s+w*p[ids[i]*3+2],0),road=v.reduce((s,w,i)=>s+w*a[ai[i]*3+2],0);if(paint.level?.[ids[0]]&&Math.abs(road-h)>2)continue;raise=Math.max(raise,road+lift-h);}
   }if(raise>0)for(const id of ids)p[id*3+2]+=raise;
  }
 };
 return{drape,index,raisePaint,clipBox};
}
