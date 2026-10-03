import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { IndicatorPoint } from "../api/client";
import MarketChart, { PlotSeries } from "./MarketChart";
import { createController, SyncChart } from "./sync";
import { useT, useLanguage } from "../i18n/LanguageContext";
export interface FinancialHandle { getChart(): SyncChart; }
interface Props { points: IndicatorPoint[]; currency?: "KRW" | "USD"; }
const ranges = [["1M",30],["3M",90],["6M",180],["1Y",365],["3Y",0]] as const;
const overlays = [["sma5","SMA 5","#c28d36"],["sma20","SMA 20","#1ca6a0"],
  ["sma60","SMA 60","#8570d8"],["sma120","SMA 120","#438dde"],["bb","Bollinger","#78869b"]] as const;
export const FinancialChart = forwardRef<FinancialHandle,Props>(({points,currency},ref) => {
  const t = useT(); const {lang} = useLanguage(); const controller = useMemo(createController,[]);
  useImperativeHandle(ref,() => ({getChart:()=>controller}),[controller]);
  const [range,setRange]=useState("6M");
  const [shown,setShown]=useState(new Set(["sma5","sma20","sma60"]));
  const [hover,setHover]=useState<number|null>(null);
  const valid = useMemo(() => points.filter(p => [p.open,p.close,p.low,p.high].every(Number.isFinite)),[points]);
  const dates=useMemo(() => valid.map(p=>p.date),[valid]);
  const instrumentStart=dates[0];
  useEffect(() => {
    if (!dates.length) return;
    const days=ranges.find(r=>r[0]===range)?.[1] ?? 0;
    const last=dates[dates.length-1]; const from=new Date(`${last}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate()-days);
    controller.timeScale().setVisibleRange({from:days?from.toISOString().slice(0,10):dates[0],to:last}); setHover(null);
  },[range,instrumentStart,controller]);
  const series=useMemo<PlotSeries[]>(() => {
    const lines:PlotSeries[]=[{name:t("일봉 차트"),type:"candlestick",values:valid.map(p=>[p.open,p.close,p.low,p.high])},
      {name:t("거래량"),type:"bar",volume:true,color:"#7797b9",values:valid.map(p=>p.volume)}];
    overlays.forEach(([key,name,color]) => {
      if (!shown.has(key)) return;
      if (key==="bb") {
        for (const field of ["bb_upper","bb_lower"] as const) lines.push({name:field,values:valid.map(p=>p[field]??null),color,dashed:true});
      } else lines.push({name,values:valid.map(p=>p[key]??null),color,dashed:key==="sma120"});
    }); return lines;
  },[valid,shown,lang]);
  const at=valid[hover ?? valid.length-1];
  const fmt=(v:number) => v.toLocaleString("en-US",{maximumFractionDigits:currency==="KRW"?0:2});
  return <figure className="market-financial">
    <header className="market-financial-head"><span className="market-financial-title">PRICE ACTION · {currency || "DAILY"}</span>
      <div className="market-chart-tools" role="group" aria-label={t("기간")}>{ranges.map(([key])=><button key={key} aria-pressed={range===key} onClick={()=>setRange(key)}>{key}</button>)}</div>
    </header>
    <div className="market-chart-reading">{at ? <><time>{at.date}</time>{([['O',at.open],['H',at.high],['L',at.low],['C',at.close]] as const).map(([key,v])=><span key={key}>{key} <strong>{fmt(v)}</strong></span>)}<span>{t("거래량")} <strong>{at.volume.toLocaleString()}</strong></span></>:<span>{t("차트 데이터가 없습니다.")}</span>}</div>
    <div className="market-chart-tools" role="group" aria-label={t("보조 지표")}>{overlays.map(([key,name,color])=><button key={key} aria-pressed={shown.has(key)} style={{borderColor:shown.has(key)?color:undefined}}
      onClick={()=>setShown(old=>{const next=new Set(old);next.has(key)?next.delete(key):next.add(key);return next;})}>{name}</button>)}</div>
    {valid.length ? <MarketChart series={series} dates={dates} height={430} controller={controller} onHover={setHover} label={t("일봉 차트")} /> : <div className="market-chart-empty">{t("차트 데이터가 없습니다.")}</div>}
    <figcaption className="market-chart-foot">{t("일봉 차트")} · {t("거래량")} · Ctrl + 휠로 확대 · 아래 구간 선택으로 기간 이동</figcaption>
  </figure>;
});
FinancialChart.displayName="FinancialChart";
