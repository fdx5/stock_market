/** Self-contained factory: the same geometry rules can run in the scene and its
 * classic JSONP worker without duplicating road normals, clipping or lifts. */
export function surfaceGeometryRules(){
  const miters=(pts:number[][])=>pts.map((p,i)=>{
    const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
    let ax=p[0]-a[0],ay=p[1]-a[1],bx=b[0]-p[0],by=b[1]-p[1];
    if(i===0){ax=bx;ay=by;}if(i===pts.length-1){bx=ax;by=ay;}
    const al=Math.hypot(ax,ay)||1,bl=Math.hypot(bx,by)||1;
    let nx=-ay/al-by/bl,ny=ax/al+bx/bl,l=Math.hypot(nx,ny);if(l<1e-5){nx=-by/bl;ny=bx/bl;l=1;}
    nx/=l;ny/=l;const scale=Math.min(3,1/Math.max(1/3,nx*(-by/bl)+ny*(bx/bl)));
    return [nx*scale,ny*scale];
  });
  const along=(pts:number[][],x:number,y:number)=>{let best=Infinity,d=0,s=0,total=0,px=x,py=y;
    for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(len*len))),distance=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);if(distance<best){best=distance;d=s+t*len;px=a[0]+t*dx;py=a[1]+t*dy;}s+=len;}total=s;return {distance:best,along:d,total,x:px,y:py};
  };
  const profileHeight=(pts:number[][],x:number,y:number,ground:(x:number,y:number)=>number)=>{const a=pts[0],b=pts[pts.length-1],p=along(pts,x,y);return ground(a[0],a[1])+(ground(b[0],b[1])-ground(a[0],a[1]))*p.along/(p.total||1);};
  const clipSegment=(a:number[],b:number[],box:number[])=>{
    const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
    for(const[p,q]of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){if(Math.abs(p)<1e-8){if(q<0)return null;}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}
    return hi-lo>1e-8?{lo,hi,a:[a[0]+dx*lo,a[1]+dy*lo],b:[a[0]+dx*hi,a[1]+dy*hi]}:null;
  };
  return {miters,along,profileHeight,clipSegment,surfaceLift:.08,paintLift:.16,step:3};
}
export const surfaceGeometry=surfaceGeometryRules();
