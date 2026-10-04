/** Survey models can contain annexes outside their matched register footprint.
 * Check their extent before replacing the measured building. A conflicting
 * model leaves the register-based geometry intact. Runs once, never per frame. */
export function modelBlocksRoad(position:ArrayLike<number>,index:ArrayLike<number>|null,dx:number,dy:number,
  onRoad:(x:number,y:number)=>boolean,onBuilding:(x:number,y:number)=>boolean):boolean {
 const at=(i:number)=>[position[i*3]+dx,position[i*3+1]+dy,position[i*3+2]];
 const blocked=(x:number,y:number)=>onRoad(x,y)&&!onBuilding(x,y);
 const count=index?.length??position.length/3;
 for(let i=0;i<count;i+=3){
  const tri=[0,1,2].map(j=>at(index?index[i+j]:i+j));
  for(let e=0;e<3;e++){
   let a=tri[e],b=tri[(e+1)%3];
   const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5));
   for(let j=0;j<=steps;j++)if(blocked(a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps))return true;
  }
  if(blocked(tri.reduce((s,p)=>s+p[0],0)/3,tri.reduce((s,p)=>s+p[1],0)/3))return true;
 }
 return false;
}
