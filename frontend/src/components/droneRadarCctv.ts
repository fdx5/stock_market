/** Fit the real camera coordinates into the circular radar, leaving room for its icons. */
export function cameraRadarZoom(lat:number, size:number, distances:readonly number[]) {
  const farthest=Math.max(0,...distances.filter(Number.isFinite));
  const radius=Math.max(16,size/2-22);
  if(farthest===0)return 15;
  const world=40075016.7*Math.cos(lat*Math.PI/180);
  return Math.max(7,Math.min(15,Math.floor(Math.log2(world*radius/(256*farthest)))));
}

export function radarCameraPoint(x:number,y:number,dx:number,dy:number,mpp:number,size:number,turn:number) {
  const px=(x-dx)/mpp,py=-(y-dy)/mpp;
  return {x:size/2+px*Math.cos(turn)-py*Math.sin(turn),
    y:size/2+px*Math.sin(turn)+py*Math.cos(turn),visible:Math.hypot(px,py)<size/2-11};
}
