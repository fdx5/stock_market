import React from "react";
import { createRoot } from "react-dom/client";
import NeoPulseHorizon from "../src/neo/NeoPulseHorizon";
import GoldCursor from "../src/neo/GoldCursor";
import "../src/neo/neo.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <main className="ng-shell" style={{minHeight:"260vh",color:"#f8f6f1",fontFamily:"Pretendard, system-ui, sans-serif"}}>
    <NeoPulseHorizon/><GoldCursor/>
    <aside style={{position:"fixed",left:28,bottom:28,maxWidth:400,padding:"20px 24px",border:"1px solid #54cced2e",borderRadius:16,background:"#0b070ec4",backdropFilter:"blur(12px)"}}>
      <div style={{fontSize:10,letterSpacing:3,color:"#35e6ad"}}>PULSE HORIZON / LOCAL PREVIEW</div>
      <h1 style={{fontSize:21,fontWeight:600,margin:"12px 0"}}>시장의 심박이 지나가는 지평선</h1>
      <p style={{fontSize:13,lineHeight:1.8,color:"#b6a5c0",margin:0}}>능선 하나하나가 흐르는 가격선 · 오르면 빨강, 내리면 파랑<br/>몇 초마다 심전도 파동이 지평선에서 밀려옵니다<br/>클릭 = 그 지점에서 파동 · 스크롤 = 앞으로 비행 · 마우스 = 시차</p>
      <a href="/" style={{color:"#00f5ff",fontSize:12,textDecoration:"none",display:"inline-block",marginTop:10}}>전체 사이트에서 확인하기 ↗</a>
    </aside>
  </main>
</React.StrictMode>);
