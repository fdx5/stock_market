import React from "react";
import { createRoot } from "react-dom/client";
import NeoRiverBackground from "../src/neo/NeoRiverBackground";
import GoldCursor from "../src/neo/GoldCursor";
import "../src/neo/neo.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <main className="ng-shell" style={{minHeight:"100vh",color:"#d9e5ef",fontFamily:"system-ui,sans-serif"}}>
    <NeoRiverBackground/><GoldCursor/>
    <aside style={{position:"fixed",left:28,bottom:28,maxWidth:380,padding:"20px 24px",border:"1px solid #a2c7d322",borderRadius:16,background:"#141017bd",backdropFilter:"blur(12px)"}}>
      <div style={{fontSize:10,letterSpacing:3,color:"#7bbfae"}}>NEON STRUCTURES / LOCAL PREVIEW</div>
      <h1 style={{fontSize:21,fontWeight:500,margin:"12px 0"}}>빛으로 이어진 네 개의 구조</h1>
      <p style={{fontSize:13,lineHeight:1.8,opacity:.65}}>이중나선 · 접히는 리본 · 분기 신경망 · 고리 마디<br/>은은한 곡면 반사와 천천히 흐르는 빛</p>
      <a href="/" style={{color:"#c7e4dc",fontSize:12,textDecoration:"none"}}>전체 사이트에서 확인하기 ↗</a>
    </aside>
  </main>
</React.StrictMode>);
