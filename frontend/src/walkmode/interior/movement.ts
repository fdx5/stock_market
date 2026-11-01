import type {Seg} from './build';
type Point=[number,number];

/** Sweep the viewpoint continuously; a positive gap is usable regardless of avatar width.
 * Segment crossings still stop at walls, furniture and the current door leaf. */
export function moveThroughGaps(from:Point,to:Point,segments:Seg[]):Point {
  let p:Point=[...from],v:Point=[to[0]-from[0],to[1]-from[1]];
  for(let pass=0;pass<4;pass++){
    const length=Math.hypot(...v);if(length<1e-10)break;
    let first=1,hit:Seg|null=null;
    for(const s of segments){
      const [a,b,c,d]=s,sx=c-a,sz=d-b,den=v[0]*sz-v[1]*sx;
      if(Math.abs(den)<1e-14)continue;
      const t=((a-p[0])*sz-(b-p[1])*sx)/den,u=((a-p[0])*v[1]-(b-p[1])*v[0])/den;
      if(t>=-1e-10&&t<=first&&u>=-1e-10&&u<=1+1e-10){first=Math.max(0,t);hit=s;}
    }
    if(!hit){p=[p[0]+v[0],p[1]+v[1]];break;}
    // A numerical margin, not a body-sized barrier. No tunnelling on long frames.
    const stop=Math.max(0,first-1e-7/length);
    p=[p[0]+v[0]*stop,p[1]+v[1]*stop];
    const dx=hit[2]-hit[0],dz=hit[3]-hit[1],l2=dx*dx+dz*dz;
    if(l2<1e-16)break;
    const along=(v[0]*dx+v[1]*dz)*(1-first)/l2;
    v=[dx*along,dz*along];
  }
  return p;
}

/** Keep the near plane inside even a very narrow passage, at full output resolution. */
export function passageNear(x:number,z:number,segments:Seg[]):number {
  let distance=.16;
  for(const [a,b,c,d] of segments){const dx=c-a,dz=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1)));distance=Math.min(distance,Math.hypot(x-a-t*dx,z-b-t*dz));}
  return Math.max(.0001,Math.min(.04,distance*.25));
}
