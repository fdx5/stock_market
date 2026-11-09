import React from "react";
import { createRoot } from "react-dom/client";
import NeoSilkFlow from "../src/neo/NeoSilkFlow";
import GoldCursor from "../src/neo/GoldCursor";
import "../src/neo/neo.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <main className="ng-shell" style={{minHeight:"260vh",color:"#f8f6f1",fontFamily:"Pretendard, system-ui, sans-serif"}}>
    <NeoSilkFlow/><GoldCursor/>
    <aside style={{position:"fixed",left:28,bottom:28,maxWidth:400,padding:"20px 24px",border:"1px solid #54cced2e",borderRadius:16,background:"#0b070ec4",backdropFilter:"blur(12px)"}}>
      <div style={{fontSize:10,letterSpacing:3,color:"#35e6ad"}}>LIQUIDITY SILK / LOCAL PREVIEW</div>
      <h1 style={{fontSize:21,fontWeight:600,margin:"12px 0"}}>유동성의 비단</h1>
      <p style={{fontSize:13,lineHeight:1.8,color:"#b6a5c0",margin:0}}>수만 가닥의 빛이 자본의 강을 따라 흐릅니다<br/>소용돌이가 갈라지고, 이따금 한 줄기에 유동성이 몰려옵니다<br/>마우스 = 주변 실이 감겨 돌기 · 스크롤 = 실이 함께 떠오름</p>
      <a href="/" style={{color:"#00f5ff",fontSize:12,textDecoration:"none",display:"inline-block",marginTop:10}}>전체 사이트에서 확인하기 ↗</a>
    </aside>
  </main>
</React.StrictMode>);
