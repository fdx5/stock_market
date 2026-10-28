import * as THREE from "three";
type Vertex={p:number[];n:number[]};
/** The van's rear glazing used to occupy almost the complete upper rear panel.
 * Clip it to a smaller opening and put opaque, painted metal around that opening.
 * This runs once per asset/LOD, never per rendered frame. */
export function frameVanRearWindow(g:THREE.BufferGeometry,kind:string){
  if(!/van|mpv|kei-box/.test(kind))return;
  const pos=g.getAttribute("position"),normal=g.getAttribute("normal"),uv=g.getAttribute("uv"),index=g.getIndex()!,box=new THREE.Box3();
  for(let i=0;i<index.count;i++){const a=index.getX(i);if(Math.floor(uv.getX(a)*16)===13)box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos,a));}
  if(box.isEmpty())return;
  const centre=box.getCenter(new THREE.Vector3()),half=box.getSize(new THREE.Vector3()).multiplyScalar(.5),limits=[[0,centre.x+half.x*.82,1],[0,centre.x-half.x*.82,-1],[1,centre.y+half.y*.70,1],[1,centre.y-half.y*.70,-1]];
  const extraP:number[]=[],extraN:number[]=[],extraUv:number[]=[],indices:number[]=[];
  const emit=(poly:Vertex[],part:number)=>{if(poly.length<3)return;const start=pos.count+extraP.length/3;for(const v of poly){extraP.push(...v.p);const len=Math.hypot(...v.n)||1;extraN.push(...v.n.map(x=>x/len));extraUv.push((part+.5)/16,.5);}for(let j=1;j<poly.length-1;j++)indices.push(start,start+j,start+j+1);};
  const split=(poly:Vertex[],axis:number,bound:number,sign:number)=>{const inside:Vertex[]=[],outside:Vertex[]=[];if(!poly.length)return[inside,outside];
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a.p[axis]-bound)*sign,db=(b.p[axis]-bound)*sign;(da<=0?inside:outside).push(a);
      if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),v={p:a.p.map((x,k)=>x+(b.p[k]-x)*t),n:a.n.map((x,k)=>x+(b.n[k]-x)*t)};inside.push(v);outside.push(v);}}
    return[inside,outside];};
  for(let i=0;i<index.count;i+=3){const a=index.getX(i);if(Math.floor(uv.getX(a)*16)!==13){indices.push(a,index.getX(i+1),index.getX(i+2));continue;}
    let poly:Vertex[]=[];for(let j=0;j<3;j++){const v=index.getX(i+j);poly.push({p:[pos.getX(v),pos.getY(v),pos.getZ(v)],n:[normal.getX(v),normal.getY(v),normal.getZ(v)]});}
    for(const [axis,bound,sign]of limits){const [kept,frame]=split(poly,axis,bound,sign);emit(frame,0);poly=kept;}emit(poly,13);
  }
  const append=(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,extra:number[],size:number)=>{const values=new Float32Array(attribute.count*size+extra.length);for(let i=0;i<attribute.count;i++)for(let j=0;j<size;j++)values[i*size+j]=attribute.getComponent(i,j);values.set(extra,attribute.count*size);return new THREE.BufferAttribute(values,size);};
  g.setAttribute("position",append(pos,extraP,3));g.setAttribute("normal",append(normal,extraN,3));g.setAttribute("uv",append(uv,extraUv,2));g.setIndex(indices);g.userData.rearWindowFrame="opaque-van-frame-v1";
}
