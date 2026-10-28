import type { RoadLine } from "../../drivegame/world/tileWorker";
export interface ParkingPose {x:number;y:number;heading:number;length:number;width:number}
/** Snap roadside detections into spaced, parallel bays outside the carriageway
 * and the pedestrian strip. Junction approaches and unsuitable surfaces are
 * rejected by the caller, rather than filling every available patch with cars. */
export function roadsideParking(source:ParkingPose,roads:Iterable<RoadLine>,clear:(p:ParkingPose)=>boolean):ParkingPose|null{
  let nearest:{road:RoadLine;ax:number;ay:number;hx:number;hy:number;len:number;along:number;side:number}|null=null,best=32;
  for(const road of roads){const p=road.pts;for(let i=0;i+5<p.length;i+=3){const ax=p[i],ay=p[i+1],dx=p[i+3]-ax,dy=p[i+4]-ay,len=Math.hypot(dx,dy);if(len<14)continue;const hx=dx/len,hy=dy/len,along=Math.max(0,Math.min(len,(source.x-ax)*hx+(source.y-ay)*hy)),signed=-(source.x-ax)*hy+(source.y-ay)*hx,d=Math.hypot(source.x-ax-hx*along,source.y-ay-hy*along);if(d<best){best=d;nearest={road,ax,ay,hx,hy,len,along,side:signed>=0?1:-1};}}}
  if(nearest){const r=nearest,spacing=source.length+1.1,base=Math.round(r.along/spacing)*spacing,offset=r.road.w/2+(r.road.major?3.2:1.8)+source.width/2+.45;
    for(const shift of [0,1,-1,2,-2]){const along=base+shift*spacing;if(along<8+source.length/2||along>r.len-8-source.length/2)continue;const pose={...source,x:r.ax+r.hx*along-r.hy*offset*r.side,y:r.ay+r.hy*along+r.hx*offset*r.side,heading:Math.atan2(r.hy,r.hx)+(r.side<0?Math.PI:0)};if(Math.hypot(pose.x-source.x,pose.y-source.y)<=20&&clear(pose))return pose;}
    return null;
  }
  // An aerial detection far from any surveyed road can be a marked courtyard
  // parking row. Keep its measured axis only when the complete bay is clear.
  return clear(source)?source:null;
}
