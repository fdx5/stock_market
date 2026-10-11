/** Bounded priority for the visible corridor and the predicted travel position.
 * Very close buildings stay first; looking backward while flying forward still
 * prepares both corridors. Never changes detail, tile capacity or resolution. */
export function droneLoadPriority(px:number,py:number,x:number,y:number,aheadX:number,aheadY:number,look?:[number,number]){
  const dx=px-x,dy=py-y,d=Math.hypot(dx,dy);
  if(d<150)return d-1000;
  const cosine=look?(dx*look[0]+dy*look[1])/Math.max(1,d):1;
  const visible=cosine>.35;
  return Math.min(d,Math.hypot(px-aheadX,py-aheadY)+140)*(visible?.65:1.2);
}

/** Dense low-rise tiles must not consume the entire detailed-model queue while
 * visible apartment bodies remain boxes. Keep the immediate neighbourhood
 * first, then detail visible 5+ storey structures by distance. Lower buildings
 * retain their full models and follow in the same bounded workers. */
export function droneDetailPriority(px:number,py:number,floors:number,x:number,y:number,aheadX:number,aheadY:number,look?:[number,number]){
  const dx=px-x,dy=py-y,d=Math.hypot(dx,dy);
  if(d<150)return d-10000;
  const cosine=look?(dx*look[0]+dy*look[1])/Math.max(1,d):1;
  if(floors>=5&&cosine>.6)return d-5000;
  return droneLoadPriority(px,py,x,y,aheadX,aheadY,look);
}

/** Keep the ground directly beneath the camera first, then visible tiles.
 * Predicted-position proximity must not turn a tile behind the camera into
 * immediate work ahead of the visible corridor. Every candidate stays queued. */
export function droneTilePriority(box:readonly [number,number,number,number],x:number,y:number,look?:[number,number]){
  const d=Math.hypot(Math.max(box[0]-x,0,x-box[2]),Math.max(box[1]-y,0,y-box[3]));
  if(!look||d<40)return d;
  const dx=(box[0]+box[2])/2-x,dy=(box[1]+box[3])/2-y;
  const cosine=(dx*look[0]+dy*look[1])/Math.max(1,Math.hypot(dx,dy));
  return d*(cosine>.34?.7:cosine>-.34?1.6:3);
}
