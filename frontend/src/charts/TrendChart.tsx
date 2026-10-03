import {useMemo,useState} from "react";
import MarketChart from "./MarketChart";
interface Props {points:number[];dates?:string[];trend?:string;className?:string;format?:(value:number)=>string;}
export default function TrendChart({points,dates=[],trend='flat',className='',format=(v:number)=>v.toLocaleString()}:Props){
  const [hover,setHover]=useState<number|null>(null);
  const times=useMemo(()=>dates.slice(-points.length),[dates,points.length]);
  const series=useMemo(()=>[{name:'Price',values:points,color:trend==='up'?'var(--up)':trend==='down'?'var(--down)':'var(--ink-3)',fill:true}],[points,trend]);
  const index=Math.min(points.length-1,Math.max(0,hover??points.length-1));
  return <div className={`market-trend ${className}`}>
    {points.length>=2?<MarketChart series={series} dates={times.length===points.length?times:undefined} compact label="최근 시세 추이" onHover={setHover} baseline={points[0]}/>:<span className="market-chart-foot">차트 데이터 없음</span>}
    {points.length>0&&<span className="market-trend-read"><b>{format(points[index])}</b> <time>{hover===null?'현재':times[index]||''}</time></span>}
  </div>;
}
