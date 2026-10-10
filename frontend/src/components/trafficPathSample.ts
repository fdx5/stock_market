interface RoadPose { x:number; y:number; ux:number; uy:number }
interface TurnPose { x:number; y:number; hx:number; hy:number }

/** Immutable surveyed polyline sampling. Cache segment arithmetic, never sampled
 * positions: lane offsets, bend easing and connector poses stay continuous. */
export function trafficPathSampler(xs:ArrayLike<number>,ys:ArrayLike<number>,cum:ArrayLike<number>,connector=false){
 const n=cum.length-1,dx=new Float64Array(n+1),dy=new Float64Array(n+1),ux=new Float64Array(n+1),uy=new Float64Array(n+1),length=new Float64Array(n+1),bend=new Float64Array(n+1),head=new Float64Array((n+1)*4);
 for(let i=1;i<=n;i++){
  dx[i]=xs[i]-xs[i-1];dy[i]=ys[i]-ys[i-1];length[i]=cum[i]-cum[i-1]||1;
  const l=connector?(Math.hypot(dx[i],dy[i])||1):length[i];ux[i]=dx[i]/l;uy[i]=dy[i]/l;
  if(i<n)bend[i]=Math.min(4,.45*(cum[i]-cum[i-1]),.45*(cum[i+1]-cum[i]));
 }
 // Continuous eased headings lie on the shorter arc between adjacent segment
 // directions. Include quadrant extrema, raw directions and degenerate bends.
 let degenerate=false;
 for(let i=1;i<=n;i++){
  let minX=ux[i],maxX=ux[i],minY=uy[i],maxY=uy[i];
  for(const j of [Math.max(1,i-1),Math.min(n,i+1)]){
   if(j===i||(ux[j]===ux[i]&&uy[j]===uy[i]))continue;
   if((ux[i]===0&&uy[i]===0)||(ux[j]===0&&uy[j]===0)){degenerate=true;minX=minY=-1;maxX=maxY=1;continue;}
   const a=Math.atan2(uy[i],ux[i]),b=Math.atan2(uy[j],ux[j]),delta=Math.atan2(Math.sin(b-a),Math.cos(b-a));
   if(Math.abs(delta)>Math.PI-1e-8){degenerate=true;minX=minY=-1;maxX=maxY=1;continue;}
   const lo=Math.min(a,a+delta),hi=Math.max(a,a+delta);
   minX=Math.min(minX,ux[j],Math.cos(a),Math.cos(b));maxX=Math.max(maxX,ux[j],Math.cos(a),Math.cos(b));
   minY=Math.min(minY,uy[j],Math.sin(a),Math.sin(b));maxY=Math.max(maxY,uy[j],Math.sin(a),Math.sin(b));
   for(let q=Math.ceil(lo/(Math.PI/2));q<=Math.floor(hi/(Math.PI/2));q++){const k=((q%4)+4)%4,x=[1,0,-1,0][k],y=[0,1,0,-1][k];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  }
  head.set([minX,minY,maxX,maxY],i*4);
 }
 const segment=(d:number)=>{
  // At an exact joint the preceding segment wins, just as in the original scan.
  let lo=1,hi=n;while(lo<hi){const mid=(lo+hi)>>>1;if(cum[mid]<d)lo=mid+1;else hi=mid;}return lo;
 };
 return {
  /** A conservative continuous envelope, far cheaper than sampling each metre.
   * Every precise collision pose remains inside it; only impossible pairs leave. */
  bounds(a:number,b:number,offset:number,bodyLength:number,bodyWidth:number){
   const lo=Math.max(0,Math.min(a,b)),hi=Math.min(cum[n],Math.max(a,b));
   let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
   for(let i=segment(lo),last=segment(hi);i<=last;i++){
    const ta=Math.min(1,Math.max(0,(lo-cum[i-1])/length[i])),tb=Math.min(1,Math.max(0,(hi-cum[i-1])/length[i]));
    const ax=xs[i-1]+dx[i]*ta,ay=ys[i-1]+dy[i]*ta,bx=xs[i-1]+dx[i]*tb,by=ys[i-1]+dy[i]*tb,k=i*4;
    const rx=(Math.max(Math.abs(head[k]),Math.abs(head[k+2]))*bodyLength+Math.max(Math.abs(head[k+1]),Math.abs(head[k+3]))*bodyWidth)/2;
    const ry=(Math.max(Math.abs(head[k+1]),Math.abs(head[k+3]))*bodyLength+Math.max(Math.abs(head[k]),Math.abs(head[k+2]))*bodyWidth)/2;
    const x0=Math.min(ax,bx)+Math.min(head[k+1]*offset,head[k+3]*offset)-rx,x1=Math.max(ax,bx)+Math.max(head[k+1]*offset,head[k+3]*offset)+rx;
    const y0=Math.min(ay,by)-Math.max(head[k]*offset,head[k+2]*offset)-ry,y1=Math.max(ay,by)-Math.min(head[k]*offset,head[k+2]*offset)+ry;
    minX=Math.min(minX,x0);minY=Math.min(minY,y0);maxX=Math.max(maxX,x1);maxY=Math.max(maxY,y1);
   }
   return {minX:minX-1e-6,minY:minY-1e-6,maxX:maxX+1e-6,maxY:maxY+1e-6,degenerate};
  },
  /** Only a segment portion with no bend easing or end clamping is linear. */
  straight(a:number,b:number){
   const lo=Math.min(a,b),hi=Math.max(a,b);if(lo<0||hi>cum[n])return false;
   const i=segment(lo);if(i!==segment(hi))return false;
   if(i>1&&bend[i-1]>.05&&lo-cum[i-1]<bend[i-1])return false;
   if(i<n&&bend[i]>.05&&cum[i]-hi<bend[i])return false;
   return true;
  },
  road(d:number,out:RoadPose={x:0,y:0,ux:1,uy:0}){
   const i=segment(d),into=d-cum[i-1],left=cum[i]-d,t=Math.min(1,Math.max(0,into/length[i]));
   let hx=ux[i],hy=uy[i];
   if(i>1&&bend[i-1]>.05&&into<bend[i-1]){
    let w=.5+.5*Math.max(0,into)/bend[i-1];w=w*w*(3-2*w);
    const x=hx*w+ux[i-1]*(1-w),y=hy*w+uy[i-1]*(1-w),l=Math.hypot(x,y)||1;hx=x/l;hy=y/l;
   }
   if(i<n&&bend[i]>.05&&left<bend[i]){
    let w=.5+.5*Math.max(0,left)/bend[i];w=w*w*(3-2*w);
    const x=hx*w+ux[i+1]*(1-w),y=hy*w+uy[i+1]*(1-w),l=Math.hypot(x,y)||1;hx=x/l;hy=y/l;
   }
   out.x=xs[i-1]+dx[i]*t;out.y=ys[i-1]+dy[i]*t;out.ux=hx;out.uy=hy;return out;
  },
  turn(d:number,out:TurnPose){
   const i=segment(d),t=Math.max(0,Math.min(1,(d-cum[i-1])/length[i]));
   const j=t<.5?Math.max(1,i-1):Math.min(n,i+1),w=t<.5?.5+t:1.5-t;
   const hx=ux[i]*w+ux[j]*(1-w),hy=uy[i]*w+uy[j]*(1-w),l=Math.hypot(hx,hy)||1;
   out.x=xs[i-1]+dx[i]*t;out.y=ys[i-1]+dy[i]*t;out.hx=hx/l;out.hy=hy/l;
  }
 };
}
