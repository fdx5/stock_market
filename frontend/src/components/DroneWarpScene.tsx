import {useEffect,useRef} from 'react';

/** A bounded, procedural star tunnel. No downloads, extra 3D context or workers;
 * the destination renderer keeps running. Canvas follows the device's real DPR. */
export default function DroneWarpScene({waiting}:{waiting:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),wait=useRef(waiting);wait.current=waiting;
  useEffect(()=>{
    const el=canvas.current,ctx=el?.getContext('2d',{alpha:true});if(!el||!ctx)return;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const stars=new Float32Array(600*4);let seed=170113;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<stars.length;i+=4){const angle=random()*Math.PI*2,r=70+random()*900;stars[i]=Math.cos(angle)*r;stars[i+1]=Math.sin(angle)*r;stars[i+2]=50+random()*1600;stars[i+3]=random();}
    let width=0,height=0,dpr=1,frame=0,last=0,drawnAt=0,started=performance.now(),maxDraw=0,draws=0;
    const size=()=>{const b=el.getBoundingClientRect();width=b.width;height=b.height;dpr=devicePixelRatio||1;el.width=Math.round(width*dpr);el.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);};
    size();
    const draw=(now:number)=>{
      const at=performance.now(),seconds=(now-started)/1000,still=motion.matches;
      const dt=last?Math.min(.07,(now-last)/1000):0;last=now;
      const ramp=still?0:Math.min(1,Math.max(0,(seconds-.35)/1.3)),speed=wait.current?120:100+1350*ramp*ramp;
      const cx=width*.5+Math.sin(seconds*.22)*width*.008*ramp,cy=height*.42+Math.cos(seconds*.18)*height*.007*ramp;
      const unit=Math.min(width,height),focal=unit*.8;
      ctx.clearRect(0,0,width,height);ctx.globalCompositeOperation='lighter';
      // Concentric depth shells and twisting plasma filaments form a real tunnel
      // silhouette, rather than a flat spinner. The center stays dark and deep.
      if(!still){
        for(let ring=0;ring<18;ring++){
          const depth=((ring/18+seconds*(wait.current ? .075 : .31))%1),r=unit*(.022+depth*depth*1.55);
          ctx.strokeStyle=`rgba(38,${110+ring*4},255,${.025+depth*.11*ramp})`;ctx.lineWidth=.7+depth*2.8;
          ctx.beginPath();ctx.ellipse(cx,cy,r,r*.72,Math.sin(seconds*.15)*.08,0,Math.PI*2);ctx.stroke();
        }
        for(let ribbon=0;ribbon<30;ribbon++){
          ctx.beginPath();
          for(let j=0;j<=24;j++){
            const z=j/24,r=unit*(.018+z*z*1.4),angle=ribbon*Math.PI*2/30+z*.42+Math.sin(z*8-seconds*2.1+ribbon)*.025;
            const x=cx+Math.cos(angle)*r,y=cy+Math.sin(angle)*r*.72;
            if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y);
          }
          ctx.strokeStyle=ribbon%3===0?'rgba(122,92,255,.12)':'rgba(29,150,255,.13)';ctx.lineWidth=1.2+ribbon%3;ctx.stroke();
        }
      }
      // Six color/depth batches keep the draw count fixed while 600 stars rush
      // past the lens. Long trails grow with acceleration; no per-frame objects.
      for(let batch=0;batch<6;batch++){
        ctx.beginPath();
        for(let i=batch*4;i<stars.length;i+=24){
          stars[i+2]-=still?0:speed*dt;
          if(stars[i+2]<35)stars[i+2]+=1600;
          const z=stars[i+2],x=cx+stars[i]*focal/z,y=cy+stars[i+1]*focal/z;
          if(x<-150||x>width+150||y<-150||y>height+150)continue;
          const tail=z+(still?2:12+speed*.36*(.4+stars[i+3]));
          ctx.moveTo(cx+stars[i]*focal/tail,cy+stars[i+1]*focal/tail);ctx.lineTo(x,y);
        }
        ctx.strokeStyle=['#419aff99','#75dbffbb','#d5f6ffdd','#f4fcffdd','#677bff88','#40bfffa0'][batch];ctx.lineWidth=.8+batch%3*.55;ctx.stroke();
      }
      // Optical bloom is a gradient, not a costly canvas blur/filter pass.
      const bloom=ctx.createRadialGradient(cx,cy,unit*.015,cx,cy,unit*.42);
      bloom.addColorStop(0,'#08102200');bloom.addColorStop(.25,'#0958af18');bloom.addColorStop(.57,'#0088cf32');bloom.addColorStop(1,'#006dff00');
      ctx.fillStyle=bloom;ctx.fillRect(0,0,width,height);
      ctx.globalCompositeOperation='source-over';
      const ms=performance.now()-at;maxDraw=Math.max(maxDraw,ms);draws++;
      if(draws%30===0){el.dataset.drawMaxMs=maxDraw.toFixed(2);el.dataset.draws=String(draws);el.dataset.pixelRatio=String(dpr);}
    };
    const tick=(now:number)=>{if(!document.hidden&&now-drawnAt>=1000/30){draw(now);drawnAt=now;}if(!motion.matches)frame=requestAnimationFrame(tick);};
    const restart=()=>{cancelAnimationFrame(frame);last=0;el.dataset.motion=motion.matches?'reduced':'animated';draw(performance.now());if(!motion.matches)frame=requestAnimationFrame(tick);};
    const resize=()=>{size();restart();};
    // Child effects precede dialog.showModal(): its initial bounds can be zero.
    // Observe the visible size rather than waiting for a window resize.
    const observer=new ResizeObserver(resize);observer.observe(el);
    restart();window.addEventListener('resize',resize);motion.addEventListener('change',restart);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',resize);motion.removeEventListener('change',restart);el.width=0;el.height=0;};
  },[]);
  return <canvas ref={canvas} className="drone-warp-stars" aria-hidden="true"/>;
}
