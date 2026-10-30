import { useEffect, useMemo, useRef, useState } from "react";
import { FACILITY_ROOMS, type FloorPlan, type RoomType } from "./interior/plan/types";

/* The flat's plan in a corner: its rooms named as people call them (마스터룸, 서브룸, 화장실 1·2…),
 * its doors and windows, where the walker is and which way they look, and the pet. The marker
 * moves by its own animation frame (no React render per frame). M hides it; a click enlarges it. */

export interface MapSubject { pos: { x: number; y: number }; yaw: number; pet?: { x: number; z: number } | null }

const FILL: Partial<Record<RoomType, string>> = {
  living: "rgba(94,240,255,.16)", kitchen: "rgba(94,240,255,.11)", master: "rgba(255,196,120,.18)", bedroom: "rgba(255,214,150,.13)",
  bathroom: "rgba(120,170,255,.2)", ensuite: "rgba(120,170,255,.2)", dressroom: "rgba(200,160,255,.14)", utility: "rgba(160,200,170,.16)",
  balcony: "rgba(160,200,170,.16)", entrance: "rgba(255,255,255,.08)", hall: "rgba(255,255,255,.05)", alpha: "rgba(255,214,150,.13)",
};

/** each room's name on the map: the kind of room, numbered where there are several */
export function roomNames(plan: FloorPlan): Map<string, string> {
  const out = new Map<string, string>(), n: Partial<Record<RoomType, number>> = {}, total: Partial<Record<RoomType, number>> = {};
  for (const r of plan.rooms) total[r.type] = (total[r.type] ?? 0) + 1;
  const baths = plan.rooms.filter(r => r.type === "bathroom" || r.type === "ensuite");
  for (const r of plan.rooms) {
    if(plan.imageAnalysis){
      const area=(q:typeof r)=>(q.rect[2]-q.rect[0])*(q.rect[3]-q.rect[1]);
      const lead=plan.rooms.filter(q=>q.zone===r.zone).reduce((a,b)=>area(b)>area(a)?b:a,r);
      if(lead!==r){out.set(r.id,"");continue;}
    }
    const i = (n[r.type] = (n[r.type] ?? 0) + 1), many = (total[r.type] ?? 0) > 1;
    // (a building's rooms carry their own names — 원장실, 회의실 2, 약국)
    if (FACILITY_ROOMS.has(r.type)) { out.set(r.id, r.label); continue; }
    const name: Partial<Record<RoomType, string>> = {
      living: "거실", kitchen: "주방", master: "마스터룸", bedroom: many ? `서브룸${i}` : "서브룸", alpha: "알파룸",
      bathroom: "", ensuite: "", dressroom: "드레스룸", entrance: "현관", utility: "다용도실", balcony: "베란다", hall: "복도",
    };
    // (the shared bathroom is 화장실1, the master's own 화장실2)
    out.set(r.id, r.type === "bathroom" || r.type === "ensuite" ? (baths.length > 1 ? `화장실${r.type === "ensuite" ? 2 : 1}` : "화장실") : name[r.type] ?? r.label);
  }
  return out;
}

export default function MiniMap({ plan, subject }: { plan: FloorPlan; subject: () => MapSubject | null }) {
  const [shown, setShown] = useState(true), [big, setBig] = useState(false);
  const me = useRef<SVGGElement>(null), pet = useRef<SVGCircleElement>(null);
  const names = useMemo(() => roomNames(plan), [plan]);
  const [x0, z0, x1, z1] = plan.bounds, pad = 0.4;
  const vb = `${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return; if (e.code === "KeyM" && !e.repeat) setShown(s => !s); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (!shown) return;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 66) return; last = t;
      const s = subject(); if (!s) return;
      // (yaw 0 looks toward −z, up on the map)
      me.current?.setAttribute("transform", `translate(${s.pos.x.toFixed(3)} ${s.pos.y.toFixed(3)}) rotate(${(-s.yaw * 180 / Math.PI).toFixed(1)})`);
      if (pet.current) {
        if (s.pet) { pet.current.setAttribute("cx", s.pet.x.toFixed(3)); pet.current.setAttribute("cy", s.pet.z.toFixed(3)); pet.current.style.display = ""; }
        else pet.current.style.display = "none";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, subject]);
  if (!shown) return <button className="wk-map-show wk-btn" onClick={() => setShown(true)}>평면도 <kbd>M</kbd></button>;
  const span = Math.max(x1 - x0, z1 - z0), fs = span * 0.052;
  // (a building's room drawn in several rectangles: its name once, in its biggest; sized to fit)
  const labelled = new Set<string>();
  if (plan.facility) {
    const best = new Map<string, FloorPlan["rooms"][number]>(), ar = (q: FloorPlan["rooms"][number]) => (q.rect[2] - q.rect[0]) * (q.rect[3] - q.rect[1]);
    for (const r of plan.rooms) { const k = `${r.zone}|${names.get(r.id)}`, b = best.get(k); if (!b || ar(r) > ar(b)) best.set(k, r); }
    for (const r of best.values()) labelled.add(r.id);
  }
  return (
    <div className={`wk-map${big ? " is-big" : ""}`} onPointerDown={e => e.stopPropagation()}>
      <div className="wk-map-tools"><span>실내 평면도</span><button type="button" aria-pressed={big} onClick={() => setBig(b => !b)}>{big ? "원래 크기" : "2배 확대"}</button><button type="button" aria-label="평면도 숨기기" onClick={() => setShown(false)}>×</button></div>
      <svg viewBox={vb} preserveAspectRatio="xMidYMid meet">
        <rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="none" stroke="rgba(94,240,255,.55)" strokeWidth={span * 0.012} />
        {plan.rooms.map(r => {
          const [a, b, c, d] = r.rect;
          return (
            <g key={r.id}>
              <rect x={a} y={b} width={c - a} height={d - b} fill={FILL[r.type] ?? "rgba(255,255,255,.06)"} stroke="rgba(223,246,255,.55)" strokeWidth={span * 0.005} />
              {(() => {
                const t = names.get(r.id) ?? "";
                if (plan.facility && !labelled.has(r.id)) return null;
                const size = plan.facility ? Math.min(fs * 0.8, (c - a) / Math.max(1, t.length * 0.95), (d - b) / 1.4) : Math.min(fs, (c - a) / 2.5);
                return size < span * 0.011 ? null : <text x={(a + c) / 2} y={(b + d) / 2} fontSize={size} textAnchor="middle" dominantBaseline="middle" fill="#e8fbff">{t}</text>;
              })()}
            </g>
          );
        })}
        {plan.openings.map((o, i) => {
          const h = o.width / 2, win = o.type === "window" || o.type === "balcony_window";
          const [ax, az, bx, bz] = o.axis === "x" ? [o.at, o.center - h, o.at, o.center + h] : [o.center - h, o.at, o.center + h, o.at];
          return <line key={i} x1={ax} y1={az} x2={bx} y2={bz} stroke={win ? "#7fd8ff" : o.type === "front_door" ? "#ffcf6e" : "#0b1218"} strokeWidth={span * (win ? 0.014 : 0.016)} strokeLinecap="butt" />;
        })}
        <circle ref={pet} r={span * 0.013} fill="#ffb86b" stroke="#fff" strokeWidth={span * 0.004} style={{ display: "none" }} />
        <g ref={me}>
          <path d={`M0 0 L${-span * 0.07} ${-span * 0.12} A${span * 0.14} ${span * 0.14} 0 0 1 ${span * 0.07} ${-span * 0.12} Z`} fill="rgba(94,240,255,.28)" />
          <circle r={span * 0.018} fill="#5ef0ff" stroke="#fff" strokeWidth={span * 0.006} />
        </g>
      </svg>
      <div className="wk-map-cap">평면도 · {plan.source==="image_analysis"?"원본 이미지 분석":"추정"} <kbd>M</kbd></div>
    </div>
  );
}
