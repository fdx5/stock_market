import { useEffect, useRef, useState } from "react";
import type { BuildingInterior } from "./BuildingInterior";

export default function BuildingMap({building}:{building:()=>BuildingInterior|null}) {
  const canvas=useRef<HTMLCanvasElement>(null),[shown,setShown]=useState(true),[big,setBig]=useState(false);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.code==="KeyM"&&!e.repeat)setShown(s=>!s);};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[]);
  useEffect(()=>{
    if(!shown)return;const c=canvas.current;if(!c)return;const dpr=window.devicePixelRatio||1,scale=big?2:1;c.width=c.height=240*dpr*scale;const ctx=c.getContext("2d")!;let raf=0,last=0;
    const draw=(t:number)=>{raf=requestAnimationFrame(draw);if(t-last<100)return;last=t;const s=building()?.mapState;if(!s?.plan)return;
      const p=s.plan,g=p.grid,W=g.nx*g.cell,D=g.nz*g.cell,k=216/Math.max(W,D),ox=12+(216-W*k)/2,oz=12+(216-D*k)/2;
      ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);ctx.fillStyle="#07131d";ctx.fillRect(0,0,240,240);
      const ring=(pts:[number,number][])=>{ctx.moveTo(ox+pts[0][0]*k,oz+pts[0][1]*k);pts.slice(1).forEach(([x,z])=>ctx.lineTo(ox+x*k,oz+z*k));ctx.closePath();};
      ctx.beginPath();for(const poly of p.polygons??[[[[0,0],[W,0],[W,D],[0,D]]]])for(const r of poly)ring(r);ctx.fillStyle="#173743";ctx.fill("evenodd");ctx.strokeStyle="#68d6e6";ctx.lineWidth=1;ctx.stroke();
      ctx.strokeStyle="#99aeb9";ctx.lineWidth=1;p.segs.forEach(w=>{ctx.beginPath();ctx.moveTo(ox+w.ax*k,oz+w.az*k);ctx.lineTo(ox+w.bx*k,oz+w.bz*k);ctx.stroke();});
      ctx.font="bold 9px sans-serif";ctx.textAlign="center";for(const z of p.zones.slice(0,14)){ctx.fillStyle="#ebf7ff";ctx.fillText(z.label.slice(0,9),ox+(z.rect[0]+z.rect[2])*.5*k,oz+(z.rect[1]+z.rect[3])*.5*k);}
      ctx.strokeStyle="#34ffe0";ctx.lineWidth=2;ctx.beginPath();s.route.forEach(([x,z],i)=>{if(i)ctx.lineTo(ox+x*k,oz+z*k);else ctx.moveTo(ox+x*k,oz+z*k);});ctx.stroke();
      for(const l of p.lifts){ctx.fillStyle="#ffcf70";ctx.fillRect(ox+l.x*k-3,oz+l.z*k-3,6,6);}
      if(p.door){ctx.fillStyle="#86ffab";ctx.fillText("출입구",ox+p.door.x*k,oz+p.door.z*k-5);}
      ctx.save();ctx.translate(ox+s.pos.x*k,oz+s.pos.y*k);ctx.rotate(-s.yaw);ctx.fillStyle="#42fff0";ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4,5);ctx.lineTo(4,5);ctx.closePath();ctx.fill();ctx.restore();
    };raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf);
  },[shown,building,big]);
  if(!shown)return <button className="wk-map-show wk-btn" onClick={()=>setShown(true)}>층별 지도 <kbd>M</kbd></button>;
  return <div className="wk-omap" onPointerDown={e=>e.stopPropagation()} title="M: 지도 숨기기"><div className="wk-map-tools"><span>실내 평면도</span><button aria-pressed={big} onClick={()=>setBig(b=>!b)}>{big?"원래 크기":"2배 확대"}</button></div><canvas ref={canvas} style={{width:big?480:240,height:"auto",maxWidth:"calc(100vw - 56px)",aspectRatio:"1"}}/><div className="wk-map-cap">층별 공간 · 청록색 길 안내 <kbd>M</kbd></div></div>;
}
