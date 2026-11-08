import { useEffect, useRef, useState } from "react";
import { useFxLevel } from "./settings";
import { installNanotubes } from "./nanotubeRenderer";
import { NANOTUBES } from "./nanotubeGeometry";
import "./riverBackground.css";

export default function NeoRiverBackground() {
  const fx=useFxLevel();
  const canvas=useRef<HTMLCanvasElement>(null);
  const [unavailable,setUnavailable]=useState(false);
  const [epoch,setEpoch]=useState(0);
  useEffect(()=>{
    if(!canvas.current)return;
    setUnavailable(false);
    try {return installNanotubes(canvas.current,fx,()=>setUnavailable(true),()=>setEpoch(value=>value+1));}
    catch {setUnavailable(true);}
  },[fx,epoch]);
  return <div className="ng-neon-river" data-pattern="neon-sculpture-bundles" data-tubes={NANOTUBES.length} data-level={fx} aria-hidden="true">
    <div className="ng-electric-atmosphere" />
    <canvas key={epoch} ref={canvas} className="ng-electric-canvas" />
    {unavailable&&<div className="ng-electric-fallback" />}
    <div className="ng-electric-shade" />
  </div>;
}
