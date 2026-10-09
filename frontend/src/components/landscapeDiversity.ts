/** Five silhouettes and leaf tones, reusing the existing photographic atlas. */
export const PARK_TREE_STYLES = [
  {species:'zelkova',label:'느티나무',cell:2,width:1.08,depth:.32,taper:1,tint:[.78,1.12,.86]},
  {species:'ginkgo',label:'은행나무',cell:0,width:.70,depth:.43,taper:.65,tint:[.85,1.16,.73]},
  {species:'pine',label:'소나무',cell:10,width:1.15,depth:.21,taper:.85,tint:[.63,.88,.77]},
  {species:'cherry',label:'벚나무',cell:4,width:.90,depth:.34,taper:.83,tint:[1.18,1.08,1.04]},
  {species:'conifer',label:'원뿔형 침엽수',cell:12,width:.63,depth:.47,taper:.12,tint:[.65,.95,1.18]},
] as const;
export const WOODLAND_FLOWERS=['cosmos','daisy','coreopsis','lavender','hydrangea','salvia'] as const;
export type GrovePatch={pattern:number;points:[number,number][]};
export type WoodlandBed={species:string;points:[number,number][]};

/** Self-contained so the parcel worker can use the same function through its Blob.
 * Small clearings make the actual flower meshes visible below the dense canopy.
 * Existing road, building and water masks are consulted for every flower centre. */
export function woodlandBeds(patches:GrovePatch[],free:(x:number,y:number)=>boolean,seed:number,species:readonly string[],cap=1800){
 let state=(Math.abs(seed)%2147483646)+1;
 const random=()=>{state=state*16807%2147483647;return(state-1)/2147483646;};
 const beds:WoodlandBed[]=[],groves:GrovePatch[]=[];let count=0,bedIndex=0;
 for(let i=0;i<patches.length;i++){
  const patch=patches[i];
  if(i%3!==0 || patch.points.length<4 || count>=cap){groves.push(patch);continue;}
  const[cx,cy]=patch.points[Math.floor(random()*patch.points.length)],points:[number,number][]=[];
  const name=species[(bedIndex++ + Math.abs(seed)%species.length)%species.length];
  for(let n=0;n<24 && count<cap;n++){
   const angle=n*2.399963229728653,radius=2.5*Math.sqrt((n+.5)/24);
   const x=cx+Math.cos(angle)*radius+(random()-.5)*.2,y=cy+Math.sin(angle)*radius+(random()-.5)*.2;
   if(free(x,y)){points.push([x,y]);count++;}
  }
  if(points.length){beds.push({species:name,points});groves.push({...patch,points:patch.points.filter(([x,y])=>Math.hypot(x-cx,y-cy)>4.2)});}
  else groves.push(patch);
 }
 return {beds,groves};
}
