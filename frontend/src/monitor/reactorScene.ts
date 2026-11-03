import type { AtlasArchitecture, AtlasSnapshot } from '../components/systemAtlasApi';

type Options={live:AtlasSnapshot|null;selected:string;visible:Set<string>;motion:boolean;speed:number;focused:boolean};
type Point={x:number;y:number;z:number;scale:number};

/** A bounded, DPR-native canvas scene. React is updated only once per second. */
export class ReactorScene {
  private ctx:CanvasRenderingContext2D;
  private options:Options;
  private frame=0; private last=0; private elapsed=0; private frames=0; private statsAt=0;
  private width=1;private height=1;private dpr=1;private yaw=-.48;private pitch=.64;private zoom=1;
  private elevation=new Map<string,number>();
  private pointer={x:0,y:0,down:false,moved:false,lastX:0,lastY:0};
  private hits:{id:string;x:number;y:number}[]=[];
  private observer:ResizeObserver;private inView=true;private intersection:IntersectionObserver;
  private positions=new Map<string,[number,number,number]>();
  private glow:HTMLCanvasElement;
  constructor(private canvas:HTMLCanvasElement,private graph:AtlasArchitecture,private select:(id:string)=>void,private report:(fps:number)=>void){
    const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Canvas unavailable');this.ctx=ctx;
    this.options={live:null,selected:'gateway',visible:new Set(graph.nodes.map(n=>n.id)),motion:true,speed:1,focused:false};
    this.glow=document.createElement('canvas');this.glow.width=this.glow.height=64;
    const g=this.glow.getContext('2d')!,gradient=g.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'#e5ccff');gradient.addColorStop(.12,'#b87bff');gradient.addColorStop(.4,'#7841bd55');gradient.addColorStop(1,'#7841bd00');g.fillStyle=gradient;g.fillRect(0,0,64,64);
    const lane=(kind:string)=>kind==='client'?0:kind==='gateway'?1:kind==='service'?2:kind==='storage'?3:4;
    graph.nodes.forEach(n=>{const group=graph.nodes.filter(a=>lane(a.kind)===lane(n.kind)),i=group.indexOf(n);this.positions.set(n.id,[(lane(n.kind)-2)*125,70,(i-(group.length-1)/2)*88]);});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    this.intersection=new IntersectionObserver(entries=>{this.inView=entries[0].isIntersecting;this.schedule();});this.intersection.observe(canvas);
    canvas.addEventListener('pointerdown',this.down);canvas.addEventListener('pointermove',this.move);canvas.addEventListener('pointerup',this.up);canvas.addEventListener('pointercancel',this.cancel);canvas.addEventListener('wheel',this.wheel,{passive:false});document.addEventListener('visibilitychange',this.visibility);
    this.resize();this.schedule();
  }
  update(options:Options){this.options=options;this.schedule();}
  reset(){this.yaw=-.48;this.pitch=.64;this.zoom=1;this.schedule();}
  private resize(){const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;this.dpr=window.devicePixelRatio||1;this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);this.schedule();}
  private schedule=()=>{if(!this.frame&&this.inView&&!document.hidden)this.frame=requestAnimationFrame(this.draw);};
  private visibility=()=>{this.last=0;this.schedule();};
  private down=(e:PointerEvent)=>{this.pointer.down=true;this.pointer.moved=false;this.pointer.lastX=e.clientX;this.pointer.lastY=e.clientY;this.canvas.setPointerCapture(e.pointerId);};
  private move=(e:PointerEvent)=>{const r=this.canvas.getBoundingClientRect();this.pointer.x=(e.clientX-r.left)/r.width-.5;this.pointer.y=(e.clientY-r.top)/r.height-.5;if(this.pointer.down){const dx=e.clientX-this.pointer.lastX,dy=e.clientY-this.pointer.lastY;if(Math.abs(dx)+Math.abs(dy)>2)this.pointer.moved=true;this.yaw+=dx*.006;this.pitch=Math.max(-.4,Math.min(1.1,this.pitch+dy*.004));this.pointer.lastX=e.clientX;this.pointer.lastY=e.clientY;}this.canvas.style.cursor=this.hits.some(p=>Math.hypot(p.x-(e.clientX-r.left),p.y-(e.clientY-r.top))<24)?'pointer':this.pointer.down?'grabbing':'grab';this.schedule();};
  private up=(e:PointerEvent)=>{if(!this.pointer.moved){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=this.hits.filter(p=>Math.hypot(p.x-x,p.y-y)<28).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];if(hit)this.select(hit.id);}this.pointer.down=false;};
  private cancel=()=>{this.pointer.down=false;};
  private wheel=(e:WheelEvent)=>{e.preventDefault();this.zoom=Math.max(.65,Math.min(1.65,this.zoom-e.deltaY*.0007));this.schedule();};
  private project(x:number,y:number,z:number):Point{const a=this.yaw,rx=x*Math.cos(a)-z*Math.sin(a),rz=x*Math.sin(a)+z*Math.cos(a);const p=this.pitch,ry=y*Math.cos(p)-rz*Math.sin(p),depth=y*Math.sin(p)+rz*Math.cos(p),scale=1000/(1000+depth);const size=Math.min(this.width/900,this.height/700)*this.zoom;return{x:this.width/2+rx*scale*size+this.pointer.x*12,y:this.height*.46+ry*scale*size+this.pointer.y*12,z:depth,scale:scale*size};}
  private line(a:Point,b:Point,color:string,width=1){const c=this.ctx;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  private draw=(now:number)=>{
    this.frame=0;if(document.hidden||!this.inView){this.last=0;return;}
    const dt=this.last?Math.min((now-this.last)/1000,.05):0;this.last=now;if(this.options.motion)this.elapsed+=dt*this.options.speed;
    this.frames++;if(now-this.statsAt>=1000){this.report(Math.round(this.frames*1000/(now-this.statsAt)));this.frames=0;this.statsAt=now;}
    const c=this.ctx,w=this.width,h=this.height,t=this.elapsed;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.fillStyle='#090710';c.fillRect(0,0,w,h);
    const wash=c.createRadialGradient(w*.5,h*.45,0,w*.5,h*.45,w*.62);wash.addColorStop(0,'#30203f');wash.addColorStop(.43,'#130e20');wash.addColorStop(1,'#090710');c.fillStyle=wash;c.fillRect(0,0,w,h);
    // Fine star field and floor grid are ambient structure, never telemetry.
    for(let i=0;i<180;i++){const x=((i*97.31)%1)*w,y=((i*53.79)%1)*h;c.fillStyle=`rgba(186,160,223,${.12+((i*17)%10)*.025})`;c.fillRect(x,y,i%13===0?2:1,1);}
    for(let i=-6;i<=6;i++){this.line(this.project(i*65,125,-390),this.project(i*65,125,390),'#ad7bdd0c');this.line(this.project(-390,125,i*65),this.project(390,125,i*65),'#ad7bdd0c');}
    const polygon=(pts:Point[],fill:string,stroke:string)=>{c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.lineWidth=.7;c.stroke();};
    const related=new Set([this.options.selected,...this.graph.edges.filter(e=>e.source===this.options.selected||e.target===this.options.selected).flatMap(e=>[e.source,e.target])]);
    // Layered circuit terraces replace the conventional floating-node globe.
    for(let lane=0;lane<5;lane++){
      const x=(lane-2)*125;
      polygon([this.project(x-49,84,-285),this.project(x+49,84,-285),this.project(x+49,84,285),this.project(x-49,84,285)],lane%2?'#21132e':'#121324','#bc80fa30');
      for(let z=-270;z<=270;z+=18){this.line(this.project(x-45,83,z),this.project(x-38,83,z),'#bc80fa66');this.line(this.project(x+38,83,z),this.project(x+45,83,z),'#bc80fa66');}
      const cap=this.project(x,84,300);c.fillStyle='#b6a5c0';c.textAlign='center';c.font='8px monospace';c.fillText(['01 CLIENT','02 GATEWAY','03 SERVICES','04 STORAGE','05 EXTERNAL'][lane],cap.x,cap.y);
    }
    const points=new Map<string,Point>();for(const [id,p]of this.positions)points.set(id,this.project(...p));
    this.graph.edges.forEach((e,i)=>{
      const a=this.positions.get(e.source),b=this.positions.get(e.target);if(!a||!b)return;
      const selected=e.source===this.options.selected||e.target===this.options.selected,visible=this.options.visible.has(e.source)&&this.options.visible.has(e.target)&&(!this.options.focused||selected);
      c.globalAlpha=visible?1:.045;
      const y=58-(i%4)*7,mid=(a[0]+b[0])/2+(i%3)*5;
      const path=[this.project(a[0],y,a[2]),this.project(mid,y,a[2]),this.project(mid,y,b[2]),this.project(b[0],y,b[2])];
      c.beginPath();path.forEach((p,j)=>j?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=selected?'#cf9dff90':'#7f92cb50';c.lineWidth=selected?1.6:.8;c.stroke();
      const observed=this.options.live?.observed_edges[e.id]||(e.source==='gateway'?this.options.live?.api.groups[e.target]?.count||0:0);
      if(observed>0&&visible){for(let k=0;k<Math.min(5,Math.ceil(Math.log2(observed+1)));k++){
        const f=((t*.45+i*.173+k*.21)%1)*3,idx=Math.floor(f),q=f-idx,from=path[idx],to=path[idx+1],x=from.x+(to.x-from.x)*q,py=from.y+(to.y-from.y)*q;
        c.drawImage(this.glow,x-11,py-11,22,22);c.fillStyle='#f4eaff';c.fillRect(x-2,py-1,4,2);
      }}c.globalAlpha=1;
    });
    this.hits=[];
    [...this.graph.nodes].sort((a,b)=>(points.get(b.id)?.z||0)-(points.get(a.id)?.z||0)).forEach((n,index)=>{
      const base=this.positions.get(n.id);if(!base)return;
      const visible=this.options.visible.has(n.id)&&(!this.options.focused||related.has(n.id)),selected=n.id===this.options.selected;
      c.globalAlpha=visible?1:.09;
      const target=selected?24:0,old=this.elevation.get(n.id)||0,lift=this.options.motion?old+(target-old)*Math.min(1,dt*12):target;this.elevation.set(n.id,lift);
      const [x,y,z]=base,core=n.id==='gateway',height=(core?155:35+Math.min(60,n.endpoint_count*.35))+lift,half=core?29:19,top=y-height;
      const corners=[[-half,-half],[half,-half],[half,half],[-half,half]];
      const bottom=corners.map(([dx,dz])=>this.project(x+dx,y,z+dz)),roof=corners.map(([dx,dz])=>this.project(x+dx,top,z+dz));
      polygon([bottom[0],bottom[1],roof[1],roof[0]],'#161225',n.color+'80');
      polygon([bottom[1],bottom[2],roof[2],roof[1]],'#271739',n.color+'90');
      polygon([bottom[2],bottom[3],roof[3],roof[2]],'#151628',n.color+'60');
      polygon(roof,selected?n.color+'60':n.color+'25',n.color);
      // Hundreds of tiny facade segments give each service a readable machine texture.
      for(let floor=8;floor<height;floor+=7){const fy=y-floor;this.line(this.project(x-half,fy,z+half),this.project(x+half,fy,z+half),n.color+(floor%3?'40':'90'));for(let col=-12;col<=12;col+=8){const p=this.project(x+half+.2,fy,z+col);c.fillStyle=(Math.floor(t*3+floor+col+index)%7===0)?'#f4e6ff':n.color+'80';c.fillRect(p.x,p.y,Math.max(1,p.scale*2),Math.max(1,p.scale*2));}}
      const peak=this.project(x,top,z);c.drawImage(this.glow,peak.x-30,peak.y-30,60,60);
      if(core){const tip=this.project(x,top-35,z);for(let j=0;j<4;j++)this.line(roof[j],tip,n.color+'b0',1);c.drawImage(this.glow,tip.x-25,tip.y-25,50,50);}
      // Raised selection plate responds in the same frame as pointer/keyboard selection.
      if(selected){const slab=corners.map(([dx,dz])=>this.project(x+dx*1.6,y+3,z+dz*1.6));polygon(slab,n.color+'0a',n.color);for(let j=0;j<4;j++)this.line(slab[j],this.project(x+corners[j][0]*1.6,y-12,z+corners[j][1]*1.6),n.color);}
      const label=this.project(x,top-14,z);c.textAlign='center';c.font=(selected?'600 ':'400 ')+'9px sans-serif';c.fillStyle=selected?'#ffffff':'#e0d4ee';c.fillText(n.label.length>13?n.label.slice(0,12)+'?':n.label,label.x,label.y);c.font='7px monospace';c.fillStyle=n.color;c.fillText(n.id.toUpperCase(),label.x,label.y-11);
      if(visible){this.hits.push({id:n.id,x:peak.x,y:peak.y});this.hits.push({id:n.id,x:(peak.x+bottom[2].x)/2,y:(peak.y+bottom[2].y)/2});}c.globalAlpha=1;
    });
    // Ambient scanning plane is decorative, distinct from observed circuit signals.
    const scan=-280+(t*38)%560;
    this.line(this.project(-320,82,scan),this.project(320,82,scan),'#c28dff50',1.2);
    if(this.options.motion)this.schedule();
  };
  dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.intersection.disconnect();this.canvas.removeEventListener('pointerdown',this.down);this.canvas.removeEventListener('pointermove',this.move);this.canvas.removeEventListener('pointerup',this.up);this.canvas.removeEventListener('pointercancel',this.cancel);this.canvas.removeEventListener('wheel',this.wheel);document.removeEventListener('visibilitychange',this.visibility);}
}
