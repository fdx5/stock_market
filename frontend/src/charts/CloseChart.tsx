import {useMemo,useState} from "react";
import type {OhlcvPoint} from "../api/client";
import MarketChart from "./MarketChart";
interface Props {points:OhlcvPoint[];tone:string;currency:"KRW"|"USD";loading:boolean;compact?:boolean;}
export default function CloseChart({points,tone,currency,loading,compact=false}:Props){
  const [range,setRange]=useState('3M');const [hover,setHover]=useState<number|null>(null);
  const rows=useMemo(()=>{const n=({"1M":21,"3M":63,"6M":126,"1Y":0} as Record<string,number>)[range];return (n?points.slice(-n):points).filter(p=>Number.isFinite(p.close));},[points,range]);
  const dates=useMemo(()=>rows.map(p=>p.date),[rows]);
  const series=useMemo(()=>[{name:currency,values:rows.map(p=>p.close),color:tone==='down'?'var(--down)':tone==='up'?'var(--up)':'var(--ink-3)',fill:true}],[rows,tone,currency]);
  const at=rows[hover??rows.length-1];
  const change=rows.length>1&&rows[0].close>0?(rows[rows.length-1].close/rows[0].close-1)*100:null;
  return <figure className="market-financial"><header className="market-financial-head"><span className="market-financial-title">PRICE TREND</span>
    <div className="market-chart-tools" aria-label="기간">{['1M','3M','6M','1Y'].map(key=><button key={key} aria-pressed={range===key} onClick={()=>{setRange(key);setHover(null);}}>{key}</button>)}</div></header>
    <div className="market-chart-reading">{at&&<><time>{at.date}</time><strong>{currency==='USD'?'$':''}{at.close.toLocaleString(undefined,{maximumFractionDigits:currency==='USD'?2:0})}{currency==='KRW'?'원':''}</strong></>}
      {change!=null&&<span>{range} <strong>{change>0?'+':''}{change.toFixed(2)}%</strong></span>}</div>
    {rows.length>=2?<MarketChart dates={dates} series={series} height={compact?110:230} compact={compact} onHover={setHover} label="기간별 종가 추이" baseline={rows[0].close}/>:<div className="market-chart-empty">{loading?'시세를 불러오는 중입니다…':'차트 데이터가 없습니다.'}</div>}
  </figure>;
}
