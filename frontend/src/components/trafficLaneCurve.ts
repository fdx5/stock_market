export interface LaneCurve {startS:number;endS:number;len:number;speedLimit:number;points:Float64Array;cum:Float64Array}
export interface LaneCurvePose {x:number;y:number;z:number;dx:number;dy:number;dz:number}
type LaneLine={p:ArrayLike<number>;cum:ArrayLike<number>;len:number};
const POS=['x','y','z'] as const,DIR=['dx','dy','dz'] as const;
/** A forward merge over the real incoming tail/outgoing head. Tangents match
 * both lanes; arc-length travel avoids sideways snaps and speed pulses. */
export function trafficLaneCurve(from:LaneLine,to:LaneLine):LaneCurve|null {
  const n=from.cum.length-1, a=(n-1)*3, b=n*3;
  const ux=from.p[b]-from.p[a],uy=from.p[b+1]-from.p[a+1],u=Math.hypot(ux,uy)||1;
  const vx=to.p[3]-to.p[0],vy=to.p[4]-to.p[1],v=Math.hypot(vx,vy)||1;
  const gap=Math.hypot(to.p[0]-from.p[b],to.p[1]-from.p[b+1]),dot=(ux*vx+uy*vy)/(u*v);
  if(gap<.15&&dot>.999&&Math.abs(to.p[2]-from.p[b+2])<.05)return null;
  const lateral=Math.abs((to.p[0]-from.p[b])*uy/u-(to.p[1]-from.p[b+1])*ux/u);
  const take=dot>.97?Math.max(8,Math.min(24,lateral*5+8)):Math.max(4,Math.min(8,gap*.25+4));
  const tail=Math.min(take,u*.8),head=Math.min(take,v*.8),startS=from.len-tail,endS=head;
  const points=new Float64Array(12);
  points.set([from.p[b]-ux/u*tail,from.p[b+1]-uy/u*tail,from.p[b+2]-(from.p[b+2]-from.p[a+2])/u*tail],0);
  points.set([to.p[0]+vx/v*head,to.p[1]+vy/v*head,to.p[2]+(to.p[5]-to.p[2])/v*head],9);
  const distance=Math.hypot(points[9]-points[0],points[10]-points[1]),handle=Math.max(1,distance/3);
  for(let k=0;k<3;k++){
    const d0=(from.p[b+k]-from.p[a+k])/u,d1=(to.p[3+k]-to.p[k])/v;
    points[3+k]=points[k]+d0*handle;points[6+k]=points[9+k]-d1*handle;
  }
  // DEM/road edge partitioning can leave a millimetre-long terminal segment.
  // Extending its vertical tangent by a metre-sized XY handle launched cars
  // far above the road. A Bezier stays inside its control-point hull: bound
  // both height handles to the actual incoming/outgoing contact elevations.
  const minElevation=Math.min(points[2],points[11]),maxElevation=Math.max(points[2],points[11]);
  points[5]=Math.max(minElevation,Math.min(maxElevation,points[5]));
  points[8]=Math.max(minElevation,Math.min(maxElevation,points[8]));
  const cum=new Float64Array(49),pose={x:0,y:0,z:0,dx:0,dy:0,dz:0};let px=points[0],py=points[1],maxCurve=0;
  for(let i=1;i<cum.length;i++){
    const t=i/(cum.length-1);curveAt(points,t,pose);
    cum[i]=cum[i-1]+Math.hypot(pose.x-px,pose.y-py);px=pose.x;py=pose.y;
    const ddx=6*((1-t)*(points[6]-2*points[3]+points[0])+t*(points[9]-2*points[6]+points[3]));
    const ddy=6*((1-t)*(points[7]-2*points[4]+points[1])+t*(points[10]-2*points[7]+points[4]));
    maxCurve=Math.max(maxCurve,Math.abs(pose.dx*ddy-pose.dy*ddx)/Math.max(1e-6,Math.hypot(pose.dx,pose.dy)**3));
  }
  return {startS,endS,len:cum[cum.length-1],speedLimit:Math.sqrt(2.5/Math.max(maxCurve,.001)),points,cum};
}
function curveAt(p:Float64Array,t:number,out:LaneCurvePose) {
  const u=1-t;
  for(let k=0;k<3;k++){
    out[POS[k]]=u*u*u*p[k]+3*u*u*t*p[3+k]+3*u*t*t*p[6+k]+t*t*t*p[9+k];
    out[DIR[k]]=3*u*u*(p[3+k]-p[k])+6*u*t*(p[6+k]-p[3+k])+3*t*t*(p[9+k]-p[6+k]);
  }
  return out;
}
export function sampleLaneCurve(curve:LaneCurve,s:number,out:LaneCurvePose) {
  const d=Math.max(0,Math.min(curve.len,s)),c=curve.cum;let lo=1,hi=c.length-1;
  while(lo<hi){const m=(lo+hi)>>>1;if(c[m]<d)lo=m+1;else hi=m;}
  const t=(lo-1+(d-c[lo-1])/Math.max(1e-9,c[lo]-c[lo-1]))/(c.length-1);
  return curveAt(curve.points,t,out);
}
