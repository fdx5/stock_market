import { useEffect, useRef, useState } from "react";
import { useFxLevel } from "./settings";
import { installBackdrop } from "./backdropInstaller";
import { NANOTUBES } from "./nanotubeGeometry";
import "./riverBackground.css";

export default function NeoRiverBackground() {
  const fx=useFxLevel();
  const canvas=useRef<HTMLCanvasElement>(null);
  const [unavailable,setUnavailable]=useState(false);
  const [epoch,setEpoch]=useState(0);
  const [mainOnly,setMainOnly]=useState(false);
  useEffect(()=>{
    if(!canvas.current)return;
    setUnavailable(false);
    try {return installBackdrop(canvas.current,"nanotube",fx,()=>setUnavailable(true),()=>setEpoch(value=>value+1),mainOnly,()=>{setMainOnly(true);setEpoch(value=>value+1);});}
    catch {setUnavailable(true);}
  },[fx,epoch,mainOnly]);
  return <div className="ng-neon-river" data-pattern="neon-sculpture-bundles" data-tubes={NANOTUBES.length} data-level={fx} aria-hidden="true">
    <div className="ng-electric-atmosphere" />
    <canvas key={`${epoch}-${fx}`} ref={canvas} className="ng-electric-canvas" />
    {unavailable&&<div className="ng-electric-fallback" />}
    <div className="ng-electric-shade" />
  </div>;
}
