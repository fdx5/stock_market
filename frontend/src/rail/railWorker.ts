import { preparePath,pathMiters,STRIDE,type RailCorridor,type RailPath,type RailLine } from './railCore';

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
    const width=l.mode==='monorail'?.8:l.vehicle==='val208'?2.8:3.45,depth=l.mode==='monorail'?1:a[4]>0?.6:.25;
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
  return {bed:new Float32Array(bed),steel:new Float32Array(steel),ties:new Float32Array(ties),piers:new Float32Array(piers),wire:new Float32Array(wire),poles:new Float32Array(poles)};
}

if(typeof self!=='undefined'&&typeof document==='undefined')self.onmessage=(e:MessageEvent)=>{
  const {id,corridor,origin,ground,denseGround,line,eye,radius}=e.data as {id:number;corridor:RailCorridor;origin:{lon:number;lat:number};ground:number[];denseGround?:Float32Array;line:RailLine;eye:{x:number;y:number};radius:number};
  try{
    const path=preparePath(corridor,origin,ground,denseGround),geometry=railGeometry(path,line,eye,radius,corridor.overhead);
    self.postMessage({id,path,geometry}, {transfer:[path.points.buffer,...Object.values(geometry).map(a=>a.buffer)]});
  }catch(error){self.postMessage({id,error:String(error)});}
};
