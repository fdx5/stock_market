import { preparePath,pathMiters,STRIDE,TUNNEL_GRADE,type RailCorridor,type RailPath,type RailLine } from './railCore';
import { tunnelPortal } from '../components/tunnelPortal';

export function railGeometry(p:RailPath,l:RailLine,eye:{x:number;y:number},radius:number,overhead=false){
  const bed:number[]=[],steel:number[]=[],ties:number[]=[],piers:number[]=[],wire:number[]=[],poles:number[]=[];
  const miters=pathMiters(p);let ai=0,bi=1;
  const edge=(p:number[],index:number,o:number,h:number)=>[p[0]+miters[index*2]*o,p[2]+h,-p[1]-miters[index*2+1]*o];
  const ribbon=(out:number[],a:number[],b:number[],offset:number,width:number,lift:number)=>{
    const pt=(p:number[],o:number)=>edge(p,p===a?ai:bi,o,lift);
    const q=[pt(a,offset-width/2),pt(b,offset-width/2),pt(b,offset+width/2),pt(a,offset+width/2)];
    out.push(...q[0],...q[1],...q[2],...q[0],...q[2],...q[3]);
  };
  const side=(a:number[],b:number[],offset:number,depth:number)=>{
    const a0=edge(a,ai,offset,-.16),b0=edge(b,bi,offset,-.16);
    const a1=[a0[0],a0[1]-depth,a0[2]],b1=[b0[0],b0[1]-depth,b0[2]];
    bed.push(...a0,...a1,...b1,...a0,...b1,...b0);
  };
  const beam=(out:number[],a:number[],b:number[],offset:number,width:number,bottom:number,height:number)=>{
    ribbon(out,a,b,offset,width,bottom+height);
    for(const edge of [offset-width/2,offset+width/2]){
      const a0=[a[0]+miters[ai*2]*edge,a[2]+bottom,-a[1]-miters[ai*2+1]*edge],b0=[b[0]+miters[bi*2]*edge,b[2]+bottom,-b[1]-miters[bi*2+1]*edge];
      const a1=[a0[0],a0[1]+height,a0[2]],b1=[b0[0],b0[1]+height,b0[2]];
      out.push(...a0,...b0,...b1,...a0,...b1,...a1);
    }
  };
  const v=p.points;let lastTie=-1,lastPier=-1,lastWire=-1;
  for(let i=STRIDE;i<v.length;i+=STRIDE){
    ai=i/STRIDE-1;bi=ai+1;
    const a=Array.from(v.subarray(i-STRIDE,i)),b=Array.from(v.subarray(i,i+STRIDE));
    if(Math.hypot((a[0]+b[0])/2-eye.x,(a[1]+b[1])/2-eye.y)>radius+6)continue;
    // (down a ramp to a tunnel, -1: its walls solid to the ground, past it under the ground)
    const width=l.mode==='monorail'?.8:l.vehicle==='val208'?2.8:3.45,depth=l.mode==='monorail'?1:a[4]===-1||b[4]===-1?14:a[4]>0?.6:.25;
    ribbon(bed,a,b,0,width,-.16);side(a,b,-width/2,depth);side(a,b,width/2,depth);
    if(l.mode==='agt'){
      const running=l.vehicle==='val208'?l.gauge/2:.85;
      for(const side of [-1,1]){
        // Concrete tyre running strips and raised lateral guidance, rather than
        // conventional steel running rails or a straddle-type monorail beam.
        // Match the shared coach transform's +0.055 m wheel contact height.
        beam(bed,a,b,side*running,.34,-.16,.215);
        beam(bed,a,b,side*(width/2-.1),.2,-.16,.65);
        beam(steel,a,b,side*(l.width/2+.05),.09,.18,.24);
      }
    }
    else if(l.mode!=='monorail')for(const offset of [-l.gauge/2,l.gauge/2])ribbon(steel,a,b,offset,.075,.065);
    const dx=b[0]-a[0],dy=b[1]-a[1],len=b[3]-a[3];if(len<=0)continue;
    if(l.mode!=='monorail'&&l.mode!=='agt')for(let s=Math.ceil(a[3]/.7)*.7;s<b[3];s+=.7){
      if(s<=lastTie)continue;lastTie=s;const t=(s-a[3])/len;
      ties.push(a[0]+dx*t,a[2]+(b[2]-a[2])*t-.07,-a[1]-dy*t,Math.atan2(dx,-dy));
    }
    // These supports are schematic, not a surveyed bridge model.
    if(a[4]>0&&Math.floor(a[3]/35)>lastPier){lastPier=Math.floor(a[3]/35);piers.push(a[0],a[2]-4,-a[1]);}
    if(overhead){
      ribbon(wire,a,b,0,.035,5.25);
      if(Math.floor(a[3]/55)>lastWire){lastWire=Math.floor(a[3]/55);poles.push(a[0]-dy/len*2.7,a[2]+2.85,-a[1]-dx/len*2.7,Math.atan2(dx,-dy));}
    }
  }
  // Where the track goes into a tunnel (-2: past the portal): the portal and the first metres
  // of the bore round it, the track running on inside (the trains go out of sight in it).
  const portal={concrete:[] as number[],dark:[] as number[]},n=v.length/STRIDE;
  for(let i=0;i+1<n;i++){
    // (the portal: where the track reaches the ground going down, -2 past it; in: on into the tunnel)
    const here=v[i*STRIDE+4]===-2,next=v[(i+1)*STRIDE+4]===-2;if(here===next)continue;
    const at=here?i+1:i,inward=here?i:i+1;
    const x=v[at*STRIDE],y=v[at*STRIDE+1];if(Math.hypot(x-eye.x,y-eye.y)>radius+6)continue;
    // (the track drawn inside: as far as the tunnel's points go)
    const step=here?-1:1;let length=0;
    for(let k=at,j=at+step;j>=0&&j<n&&v[j*STRIDE+4]===-2;k=j,j+=step)length+=Math.hypot(v[j*STRIDE]-v[k*STRIDE],v[j*STRIDE+1]-v[k*STRIDE+1]);
    const half=l.mode==='monorail'?1.6:l.vehicle==='val208'?2.3:2.45;
    const shape=tunnelPortal(x,y,v[at*STRIDE+2]-.16,v[inward*STRIDE]-x,v[inward*STRIDE+1]-y,{halfWidth:half,height:l.mode==='monorail'?4.6:5.8,length:Math.max(14,Math.min(length+12,(6.6+1.5)/TUNNEL_GRADE)),floor:-.45,grade:TUNNEL_GRADE});
    for(const [from,to] of [[shape.concrete,portal.concrete],[shape.dark,portal.dark]] as const)for(let k=0;k<from.length;k+=3)to.push(from[k],from[k+2],-from[k+1]);
  }
  return {bed:new Float32Array(bed),steel:new Float32Array(steel),ties:new Float32Array(ties),piers:new Float32Array(piers),wire:new Float32Array(wire),poles:new Float32Array(poles),portal:new Float32Array(portal.concrete),portalDark:new Float32Array(portal.dark)};
}

/** Non-indexed triangles' face normals, as three's computeVertexNormals gives them. */
export function flatNormals(p:Float32Array){
  const n=new Float32Array(p.length);
  for(let i=0;i+8<p.length;i+=9){
    const ax=p[i+3]-p[i],ay=p[i+4]-p[i+1],az=p[i+5]-p[i+2],bx=p[i+6]-p[i],by=p[i+7]-p[i+1],bz=p[i+8]-p[i+2];
    let x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;const l=Math.hypot(x,y,z)||1;x/=l;y/=l;z/=l;
    for(let k=0;k<9;k+=3){n[i+k]=x;n[i+k+1]=y;n[i+k+2]=z;}
  }
  return n;
}

if(typeof self!=='undefined'&&typeof document==='undefined')self.onmessage=(e:MessageEvent)=>{
  const {id,corridor,origin,ground,denseGround,line,eye,radius}=e.data as {id:number;corridor:RailCorridor;origin:{lon:number;lat:number};ground:number[];denseGround?:Float32Array;line:RailLine;eye:{x:number;y:number};radius:number};
  try{
    const path=preparePath(corridor,origin,ground,denseGround),geometry:Record<string,Float32Array>=railGeometry(path,line,eye,radius,corridor.overhead);
    // (the ribbons' flat normals here: on the page they were a long task as each corridor came in)
    for(const name of ['bed','steel','wire','portal','portalDark'])geometry[name+'Normal']=flatNormals(geometry[name]);
    self.postMessage({id,path,geometry}, {transfer:[path.points.buffer,...Object.values(geometry).map(a=>a.buffer)]});
  }catch(error){self.postMessage({id,error:String(error)});}
};
