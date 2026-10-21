import { useId, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { pct } from "../desk2/lib";
import { NeoEmptyState } from "./NeoComponents";

type Quote = { name: string; price?: number; change?: number; points: number[] };
export default function NeoIndexChart({ quotes }: { quotes: Quote[] }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const quote = quotes[selected] ?? quotes[0];
  const points = quote?.points.filter(Number.isFinite) ?? [];
  const low = Math.min(...points), high = Math.max(...points), range = high - low || Math.abs(low) * .001 || 1;
  const x = (i: number) => 12 + i / Math.max(1, points.length - 1) * 858;
  const y = (v: number) => 149 - (v - low) / range * 121;
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const color = (quote?.change ?? 0) > 0 ? "var(--market-up)" : (quote?.change ?? 0) < 0 ? "var(--market-down)" : "var(--market-flat)";
  return <div className="ng-index-chart" data-points={points.length}>
    <div className="ng-chart-toolbar"><div className="ng-chart-tabs" role="group" aria-label={L("대표 지수 차트 선택", "Choose an index chart")}>{quotes.map((q, i) => <button type="button" key={q.name} aria-pressed={selected === i} onClick={() => { setSelected(i); setCursor(null); }}>{q.name}</button>)}</div><span>{L("최근 제공 흐름", "Latest available trend")} <b style={{ color }}>{pct(quote?.change)}</b></span></div>
    {points.length > 1 ? <div className="ng-chart-interaction" tabIndex={0} role="group" aria-label={L(`${quote.name} 최근 제공값 ${points.length}개 차트. 좌우 방향키로 탐색`, `${quote.name}, ${points.length} supplied values. Use left and right arrows to explore`)} onFocus={() => setCursor(points.length - 1)} onBlur={() => setCursor(null)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setCursor(value => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (value ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1)))); }}>
      <div className="ng-chart-plot"><svg viewBox="0 0 880 176" preserveAspectRatio="none" aria-hidden="true" onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * 880; setCursor(Math.max(0, Math.min(points.length - 1, Math.round((px - 12) / 858 * (points.length - 1))))); }} onPointerLeave={() => setCursor(null)}>
        <defs><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".2" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3].map(row => <line key={row} x1="12" x2="879" y1={28 + row * 40.33} y2={28 + row * 40.33} stroke="var(--baseline)" strokeOpacity=".25" strokeDasharray="2 5" />)}
        <path d={`${line} L${x(points.length - 1)},164 L12,164 Z`} fill={`url(#${id}-area)`} />
        <path className="ng-chart-trace" d={line} stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" fill="none" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3" fill={color} />
        {cursor != null && cursor < points.length && <g><line x1={x(cursor)} x2={x(cursor)} y1="10" y2="164" stroke="var(--text-secondary)" strokeOpacity=".6" strokeDasharray="3 4" /><circle cx={x(cursor)} cy={y(points[cursor])} r="3.5" stroke="var(--text-primary)" strokeWidth="1.5" fill="var(--bg-panel)" /></g>}
      </svg><div className="ng-chart-axis" aria-hidden="true">{[0, 1, 2, 3].map(row => <span key={row}>{(high - range * row / 3).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>)}</div></div>
      <div className="ng-chart-foot"><span>{L("지수별 최근 제공값 · 시간 간격은 다를 수 있습니다", "Latest supplied values · intervals may differ")}</span><output aria-live="polite">{cursor != null && cursor < points.length ? `${cursor + 1}/${points.length} · ${points[cursor].toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `${points.length} ${L("포인트", "points")}`}</output></div>
    </div> : <NeoEmptyState title={L("차트 흐름 확인 중", "Waiting for chart data")}>{L("확인된 지수값부터 표시합니다.", "Verified index quotes are displayed above.")}</NeoEmptyState>}
  </div>;
}
