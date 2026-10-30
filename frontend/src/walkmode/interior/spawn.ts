import type { FloorPlan } from "./plan/types";
import type { Seg } from "./build";

type Point = [number, number];
const distance = (x:number,z:number,[a,b,c,d]:Seg) => {
  const dx=c-a,dz=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(x-a-t*dx,z-b-t*dz);
};

/** A furniture collider's closed footprint is solid inside too, not just at its four edges. */
export function furnitureFootprints(segments:Seg[]):[number,number,number,number][] {
  const out:[number,number,number,number][]=[];
  for(let i=0;i+3<segments.length;i++){
    const four=segments.slice(i,i+4);
    if(!four.every((s,k)=>Math.hypot(s[2]-four[(k+1)%4][0],s[3]-four[(k+1)%4][1])<.001))continue;
    const xs=four.flatMap(s=>[s[0],s[2]]),zs=four.flatMap(s=>[s[1],s[3]]);
    out.push([Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)]);i+=3;
  }
  return out;
}

/** Choose a floor location after furnishing, with a body-sized clearance and a real walking exit. */
export function walkingSpawn(plan:FloorPlan,walls:Seg[],furniture:Seg[],doors:Seg[],preferred:Point):[number,number,number]|null {
  const segments=[...walls,...furniture,...doors],footprints=furnitureFootprints(furniture),radius=.30;
  const free=(x:number,z:number)=>plan.rooms.some(r=>x>=r.rect[0]&&x<=r.rect[2]&&z>=r.rect[1]&&z<=r.rect[3])
    &&!footprints.some(([a,b,c,d])=>x>a-radius&&x<c+radius&&z>b-radius&&z<d+radius)
    &&segments.every(s=>distance(x,z,s)>=radius);
  const rank=(r:FloorPlan["rooms"][number])=>(preferred[0]>=r.rect[0]&&preferred[0]<=r.rect[2]&&preferred[1]>=r.rect[1]&&preferred[1]<=r.rect[3]?-2000:0)+(r.type==="living"?-1000:0)+(r.type==="entrance"?-500:0);
  const rooms=[...plan.rooms].sort((a,b)=>rank(a)-rank(b));
  for(const room of rooms){
    const [x0,z0,x1,z1]=room.rect;let best:{p:Point;yaw:number;score:number}|null=null;
    const step=.18,nx=Math.min(160,Math.ceil((x1-x0)/step)),nz=Math.min(160,Math.ceil((z1-z0)/step));
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const x=x0+(i+.5)*(x1-x0)/nx,z=z0+(j+.5)*(z1-z0)/nz;
      if(!free(x,z))continue;
      for(let k=0;k<8;k++){
        const yaw=k*Math.PI/4,dx=-Math.sin(yaw),dz=-Math.cos(yaw);let reach=0;
        for(let t=.1;t<=1.21;t+=.1){if(!free(x+dx*t,z+dz*t))break;reach=t;}
        if(reach<.79)continue;
        const score=reach*2-Math.hypot(x-preferred[0],z-preferred[1])*.3;
        if(!best||score>best.score)best={p:[x,z],yaw,score};
      }
    }
    if(best)return [...best.p,best.yaw];
  }
  return null;
}
