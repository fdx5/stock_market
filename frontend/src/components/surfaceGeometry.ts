/** Self-contained factory: the same geometry rules can run in the scene and its
 * classic JSONP worker without duplicating road normals, clipping or lifts. */
export function surfaceGeometryRules(){
  // (the neighbours on each side that are another place: a line repeating a point — the survey's
  // centre lines often do — had a zero direction on one side there, its miter three times the
  // width or none at all, and its paint tapered to a point or flared between those vertices)
  const miters=(pts:number[][])=>pts.map((p,i)=>{
    let j=i-1;while(j>=0&&Math.abs(pts[j][0]-p[0])+Math.abs(pts[j][1]-p[1])<1e-3)j--;
    let m=i+1;while(m<pts.length&&Math.abs(pts[m][0]-p[0])+Math.abs(pts[m][1]-p[1])<1e-3)m++;
    if(j<0&&m>=pts.length)return [0,1];
    const a=j>=0?pts[j]:null,b=m<pts.length?pts[m]:null;
    let ax=a?p[0]-a[0]:0,ay=a?p[1]-a[1]:0,bx=b?b[0]-p[0]:0,by=b?b[1]-p[1]:0;
    if(!a){ax=bx;ay=by;}if(!b){bx=ax;by=ay;}
    const al=Math.hypot(ax,ay)||1,bl=Math.hypot(bx,by)||1;
    let nx=-ay/al-by/bl,ny=ax/al+bx/bl,l=Math.hypot(nx,ny);if(l<1e-5){nx=-by/bl;ny=bx/bl;l=1;}
    nx/=l;ny/=l;const scale=Math.min(3,1/Math.max(1/3,nx*(-by/bl)+ny*(bx/bl)));
    return [nx*scale,ny*scale];
  });
  const along=(pts:number[][],x:number,y:number)=>{let best=Infinity,d=0,s=0,total=0,px=x,py=y;
    for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(len*len))),distance=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);if(distance<best){best=distance;d=s+t*len;px=a[0]+t*dx;py=a[1]+t*dy;}s+=len;}total=s;return {distance:best,along:d,total,x:px,y:py};
  };
  type Support={h:number;d:number};
  const supports=new WeakMap<object,WeakMap<(x:number,y:number)=>number,WeakMap<number[][],Support[]>>>();
  const profileHeight=(pts:number[][],x:number,y:number,ground:(x:number,y:number)=>number,water?:(x:number,y:number)=>number|null,canSample?:(x:number,y:number)=>boolean,revision?:object)=>{
    const a=pts[0],b=pts[pts.length-1],p=along(pts,x,y);
    // Official structure links can end inside water. Sample dry bank support along
    // each source endpoint's outward tangent, without changing the road's XY or
    // inventing a fixed clearance. The same full-link anchors work across tiles.
    const bank=(end:number[],inside:number[])=>{
      const initial=ground(end[0],end[1]);
      const level=water?.(end[0],end[1]);
      if(level==null)return {h:initial,d:0};
      const dx=end[0]-inside[0],dy=end[1]-inside[1],len=Math.hypot(dx,dy);
      if(!len)return {h:initial,d:0};
      for(let d=4;d<=300;d+=4){const bx=end[0]+dx*d/len,by=end[1]+dy*d/len;
        if(canSample&&!canSample(bx,by))break;
        const h=ground(bx,by);
        if(!Number.isFinite(h))break;
        if(water!(bx,by)===null&&h>level)return {h,d};
      }
      return {h:initial,d:0};
    };
    let profiles:WeakMap<number[][],Support[]>|undefined;
    if(revision){let grounds=supports.get(revision);if(!grounds){grounds=new WeakMap();supports.set(revision,grounds);}profiles=grounds.get(ground);if(!profiles){profiles=new WeakMap();grounds.set(ground,profiles);}}
    let pair=profiles?.get(pts);
    if(!pair){pair=[bank(a,pts[1]),bank(b,pts[pts.length-2])];profiles?.set(pts,pair);}
    const [left,right]=pair;
    return left.h+(right.h-left.h)*(p.along+left.d)/(p.total+left.d+right.d||1);
  };
  /** A chained bridge's deck (bridgeChains.ts): its stations `s` (m along `line`) and heights. */
  const profileAt=(line:number[][],st:number[],z:number[],x:number,y:number)=>{
    const d=along(line,x,y).along;let lo=0,hi=st.length-1;
    if(d<=st[0])return z[0];if(d>=st[hi])return z[hi];
    while(hi-lo>1){const m=(lo+hi)>>1;if(st[m]<=d)lo=m;else hi=m;}
    return z[lo]+(z[hi]-z[lo])*(d-st[lo])/((st[hi]-st[lo])||1);
  };
  const clipSegment=(a:number[],b:number[],box:number[])=>{
    const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
    for(const[p,q]of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){if(Math.abs(p)<1e-8){if(q<0)return null;}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}
    return hi-lo>1e-8?{lo,hi,a:[a[0]+dx*lo,a[1]+dy*lo],b:[a[0]+dx*hi,a[1]+dy*hi]}:null;
  };
  /** A parallel source strip wholly replaced by a confirmed continuous deck.
   * Reject transverse roads, separate carriageways and every point past a bank. */
  const deckCoversLine=(line:number[][],deck:number[][],half:number)=>{
    if(line.length<2||deck.length<2)return false;
    for(let k=1;k<line.length;k++){
      const a=line[k-1],b=line[k],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)continue;
      const count=Math.max(1,Math.ceil(length/8));
      for(let n=0;n<=count;n++){
        const x=a[0]+dx*n/count,y=a[1]+dy*n/count;let distance=Infinity,tx=0,ty=0,station=0,segment=0;
        for(let i=1;i<deck.length;i++){
          const p=deck[i-1],q=deck[i],ex=q[0]-p[0],ey=q[1]-p[1],l=Math.hypot(ex,ey);if(!l)continue;
          const raw=((x-p[0])*ex+(y-p[1])*ey)/(l*l),t=Math.max(0,Math.min(1,raw)),d=Math.hypot(x-p[0]-ex*t,y-p[1]-ey*t);
          if(d<distance){distance=d;tx=ex/l;ty=ey/l;station=raw;segment=i;}
        }
        if(distance>half+.2||Math.abs(tx*dx+ty*dy)/length<.9||segment===1&&station<-.001||segment===deck.length-1&&station>1.001)return false;
      }
    }return true;
  };
  return {miters,along,profileHeight,profileAt,clipSegment,deckCoversLine,surfaceLift:.08,paintLift:.16,step:3};
}
export const surfaceGeometry=surfaceGeometryRules();
