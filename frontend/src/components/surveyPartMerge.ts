import type {SurveyPart} from './droneSurveyWorker';

/** Join full-resolution geometry by the same material/attribute layout. Vertex
 * order, normals, facade parameters and source colour spans are preserved. */
export function mergeSurveyParts(parts:readonly SurveyPart[]):SurveyPart[]{
 const groups=new Map<string,SurveyPart[]>();
 for(const p of parts){const key=p.material+':'+!!p.uv+':'+!!p.facade;let list=groups.get(key);if(!list)groups.set(key,list=[]);list.push(p);}
 return [...groups.values()].map(list=>{
  if(list.length===1)return list[0];
  const vertices=list.reduce((n,p)=>n+p.position.length/3,0),indices=list.reduce((n,p)=>n+p.index.length,0),spans=list.reduce((n,p)=>n+p.paintSpans.length,0);
  const position=new Float32Array(vertices*3),normal=new Float32Array(vertices*3),color=new Float32Array(vertices*3),uv=list[0].uv?new Float32Array(vertices*2):null,facade=list[0].facade?new Float32Array(vertices*4):null,index=new Uint32Array(indices),paintSpans=new Uint32Array(spans);
  const box:[number,number,number,number,number,number]=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];let v=0,i=0,s=0;
  for(const p of list){
   position.set(p.position,v*3);normal.set(p.normal,v*3);color.set(p.color,v*3);if(uv&&p.uv)uv.set(p.uv,v*2);if(facade&&p.facade)facade.set(p.facade,v*4);
   for(let k=0;k<p.index.length;k++)index[i+k]=p.index[k]+v;
   paintSpans.set(p.paintSpans,s);for(let k=2;k<p.paintSpans.length;k+=5)paintSpans[s+k]+=v;
   for(let k=0;k<3;k++){box[k]=Math.min(box[k],p.box[k]);box[k+3]=Math.max(box[k+3],p.box[k+3]);}
   v+=p.position.length/3;i+=p.index.length;s+=p.paintSpans.length;
  }
  // A conservative enclosing sphere avoids a second walk over every vertex.
  const x=(box[0]+box[3])/2,y=(box[1]+box[4])/2,z=(box[2]+box[5])/2,r=Math.hypot(box[3]-x,box[4]-y,box[5]-z);
  return {material:list[0].material,position,normal,color,uv,facade,index,paintSpans,box,sphere:[x,y,z,r]};
 });
}
