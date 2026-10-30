import type { FloorPlan } from "./interior/plan/types";
export default function LayoutPreview({plan}:{plan:FloorPlan}) {
  const [x0,z0,x1,z1]=plan.bounds,pad=.35;
  const lead=new Set(plan.rooms.filter(r=>!plan.imageAnalysis||!plan.rooms.some(q=>q.zone===r.zone&&(q.rect[2]-q.rect[0])*(q.rect[3]-q.rect[1])>(r.rect[2]-r.rect[0])*(r.rect[3]-r.rect[1]))).map(r=>r.id));
  const color=(type:string)=>type==="living"?"#8eaca2":type==="kitchen"?"#c0ad8e":type==="master"?"#a69fba":type==="bedroom"?"#9aaac3":/bath|ensuite|utility/.test(type)?"#89abb5":"#b6b5a9";
  return <figure className="wk-layout-preview"><svg viewBox={`${x0-pad} ${z0-pad} ${x1-x0+pad*2} ${z1-z0+pad*2}`} role="img" aria-label={`${plan.template} 평면 미리보기`}>
    {plan.rooms.map(r=><g key={r.id}><rect x={r.rect[0]} y={r.rect[1]} width={r.rect[2]-r.rect[0]} height={r.rect[3]-r.rect[1]} fill={color(r.type)} stroke="#182a30" strokeWidth={.08}/>{lead.has(r.id)&&<text x={(r.rect[0]+r.rect[2])/2} y={(r.rect[1]+r.rect[3])/2} textAnchor="middle" dominantBaseline="central" fontSize={.3} fill="#13232b">{r.label}</text>}</g>)}
    {plan.openings.map((o,i)=>{const w=o.width/2,a=o.axis==="x";return <line key={i} x1={a?o.at:o.center-w} y1={a?o.center-w:o.at} x2={a?o.at:o.center+w} y2={a?o.center+w:o.at} stroke={o.type.includes("window")?"#d9f8ff":o.b==="out"?"#efc865":"#f7eee0"} strokeWidth={o.type==="open"?.15:.1}/>;})}
  </svg><figcaption>{plan.template} · {plan.rooms.filter(r=>r.type==="master"||r.type==="bedroom").length}룸 · 전용 {plan.areaExclusiveM2.toFixed(2)}㎡<span>{plan.source==="image_analysis"?"원본 이미지 인식 · 공간·치수 해석 오차가 있을 수 있습니다":"가상 구조 · 실제 도면과 다를 수 있습니다"}</span></figcaption></figure>;
}
