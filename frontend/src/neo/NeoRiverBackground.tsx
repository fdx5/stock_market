import { useEffect, useRef, useState } from "react";
import { useFxLevel } from "./settings";
import { installElectricRivers } from "./electricRiver";
import "./riverBackground.css";

export default function NeoRiverBackground() {
  const fx=useFxLevel();
  const canvas=useRef<HTMLCanvasElement>(null);
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    if(!canvas.current)return;
    try {return installElectricRivers(canvas.current,fx);}
    catch {setUnavailable(true);}
  },[fx]);
  return <div className="ng-neon-river" data-pattern="living-electric-rivers" data-strands="312" data-level={fx} aria-hidden="true">
    <div className="ng-electric-atmosphere" />
    <canvas ref={canvas} className="ng-electric-canvas" />
    {unavailable&&<div className="ng-electric-fallback" />}
    <div className="ng-electric-shade" />
  </div>;
}
