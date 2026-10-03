import { forwardRef,useImperativeHandle,useMemo,useState } from "react";
import type { IndicatorPoint } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import MarketChart,{PlotSeries} from "./MarketChart";
import {createController,SyncChart} from "./sync";
interface Props {points:IndicatorPoint[];latest:IndicatorPoint|null;defaultExpanded?:boolean;}
export interface IndicatorPanelHandle {getCharts():SyncChart[];}
const IndicatorPanel=forwardRef<IndicatorPanelHandle,Props>(({points,latest,defaultExpanded=false},ref)=>{
  const t=useT();const [expanded,setExpanded]=useState(defaultExpanded);
  const controllers=useMemo(()=>[createController(),createController()],[]);
  useImperativeHandle(ref,()=>({getCharts:()=>controllers}),[controllers]);
  const dates=useMemo(()=>points.map(p=>p.date),[points]);
  const rsi=useMemo<PlotSeries[]>(()=>[{name:'RSI (14)',values:points.map(p=>p.rsi14??null),color:'#438dde'},
    {name:'70',values:points.map(()=>70),color:'#e65d68',dashed:true},{name:'30',values:points.map(()=>30),color:'#1ca6a0',dashed:true}],[points]);
  const macd=useMemo<PlotSeries[]>(()=>[{name:'Histogram',type:'bar',values:points.map(p=>p.macd_hist??null),diverging:true},
    {name:'MACD',values:points.map(p=>p.macd??null),color:'#438dde'},{name:'Signal',values:points.map(p=>p.macd_signal??null),color:'#c28d36'}],[points]);
  return <section className="market-financial"><header className="market-financial-head"><strong>{t("보조 지표")}</strong>
    <div className="market-chart-tools"><button aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?t("접기"):t("펼치기")}</button></div></header>
    <div hidden={!expanded}><div className="market-financial-title">RSI (14) · 30 / 70</div>
      <MarketChart series={rsi} dates={dates} controller={controllers[0]} height={190} min={0} max={100} label="RSI (14)" />
      <div className="market-financial-title">MACD · SIGNAL · HISTOGRAM</div>
      <MarketChart series={macd} dates={dates} controller={controllers[1]} height={190} baseline={0} label="MACD" />
      {latest&&<div className="market-chart-reading"><span>RSI <strong>{latest.rsi14?.toFixed(1)??'—'}</strong></span><span>ATR <strong>{latest.atr14?.toFixed(2)??'—'}</strong></span>
        <span>MACD <strong>{latest.macd_hist?.toFixed(2)??'—'}</strong></span><span>{t("20일 변동성")} <strong>{latest.volatility20==null?'—':`${(latest.volatility20*100).toFixed(2)}%`}</strong></span>
        <span>{t("거래량/20일평균")} <strong>{latest.volume_ma20?`${(latest.volume/latest.volume_ma20*100).toFixed(0)}%`:'—'}</strong></span></div>}
    </div></section>;
});
IndicatorPanel.displayName="IndicatorPanel";
export default IndicatorPanel;
