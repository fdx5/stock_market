import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { api, type IndicatorPoint } from "../api/client";
import { Link, navigate } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { pct, toneOf } from "../desk2/lib";
import { useAtlasMiniMaps, type AtlasMarket } from "./useAtlasMiniMaps";
import { hasReturn, quoteColor, quotePct, tickerChangePct, tradingValue } from "./marketQuote";
import { marketScanner, type ScannerOrder } from "./marketScannerModel";
import { useFxLevel } from "./settings";
import StockLogo from "../components/StockLogo";
import { useContentScroll } from "../useContentScroll";
import { pinnedScrollOffset } from "../scrollNavigation";
import { createGoldDust } from "./goldDust";
import "./marketScanner.css";
import "./marketScannerFx.css";
import "./marketScannerNeon.css";

const MARKETS=[{key:"kospi",label:"KOSPI",to:"/map"},{key:"kosdaq",label:"KOSDAQ",to:"/kosdaq-map"},{key:"nasdaq100",label:"NASDAQ 100",to:"/nasdaq100-map"}] as const;
const histories=new Map<string,Promise<IndicatorPoint[]>>();
const price=(value?:number|null)=>value!=null&&Number.isFinite(value)&&value>0?value.toLocaleString("en-US",{maximumFractionDigits:2}):"—";
function quoteTime(value?:string|number|null) {
  if(!value)return "—";
  const date=new Date(typeof value==="number"?value*1000:value);
  return Number.isFinite(+date)?date.toLocaleString("ko-KR",{timeZone:"Asia/Seoul",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})+" KST":"—";
}
function MiniTrend({values,label,tone}:{values:number[];label:string;tone:string}) {
  const id=useId().replace(/:/g,"");
  const points=values.filter(value=>Number.isFinite(value)&&value>0);
  if(points.length<2)return <span className="sc-trend-pending">—</span>;
  const low=Math.min(...points),high=Math.max(...points),spread=high-low||Math.abs(low)*.01||1;
  const path=points.map((value,i)=>`${i?"L":"M"}${(2+i/(points.length-1)*126).toFixed(2)},${(31-(value-low)/spread*26).toFixed(2)}`).join(" ");
  return <svg className={`sc-trend is-${tone}`} viewBox="0 0 130 36" role="img" aria-label={label}>
    <defs><linearGradient id={`${id}-field`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".32"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient><filter id={`${id}-light`} x="-15%" y="-50%" width="130%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>
    <path d={`${path}L128 36L2 36Z`} fill={`url(#${id}-field)`}/>
    <path d={path} fill="none" stroke="currentColor" strokeWidth="3.5" opacity=".65" filter={`url(#${id}-light)`}/>
    <path key={path} className="sc-trend-line" pathLength="1" d={path} fill="none" stroke="currentColor" strokeWidth="1.45" vectorEffect="non-scaling-stroke"/>
    <circle className="sc-trend-head" cx="128" cy={31-(points[points.length-1]-low)/spread*26} r="1.6" fill="#fff4f6"/>
  </svg>;
}

/** A compact quote board. Equal reading space; size differences use an explicit bar. */
export default function MarketScanner({market,onMarketChange}:{market:AtlasMarket;onMarketChange:(market:AtlasMarket)=>void}) {
  const {lang}=useLanguage(),L=(ko:string,en:string)=>lang==="ko"?ko:en;
  const [order,setOrder]=useState<ScannerOrder>("cap"),[sector,setSector]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null>(null),[expanded,setExpanded]=useState(false),[columns,setColumns]=useState(8);
  const [history,setHistory]=useState<Record<string,IndicatorPoint[]>>({});
  const [reducedMotion,setReducedMotion]=useState(()=>matchMedia("(prefers-reduced-motion: reduce)").matches);
  const gridRef=useRef<HTMLDivElement>(null),positions=useRef(new Map<string,{x:number;y:number}>());
  const dust=useRef<ReturnType<typeof createGoldDust>|null>(null),lastPointer=useRef<{x:number;y:number}|null>(null);
  const fieldRef=useRef<HTMLDivElement>(null),sectionRef=useRef<HTMLElement>(null);
  const quoteLedger=useRef(new Map<string,string>());
  const lastRefresh=useRef<{market:AtlasMarket;stamp:string|null;version:number;count:number}|null>(null);
  const lastLit=useRef(new Set<string>());
  const controlsRef=useRef<HTMLDivElement>(null);
  const alignControls=useContentScroll(controlsRef);
  const animations=useRef<Animation[]>([]),fx=useFxLevel();
  const indices=useMarketIndices(),ticker=useMarketTicker(),snapshots=useAtlasMiniMaps();
  const ndx=ticker.find(item=>item.symbol==="^NDX"),snapshot=snapshots[market];
  const quotes={kospi:{price:indices.kospi?.close,change:indices.kospi?.change_pct,at:indices.kospi?.updated_at},kosdaq:{price:indices.kosdaq?.close,change:indices.kosdaq?.change_pct,at:indices.kosdaq?.updated_at},nasdaq100:{price:ndx?.price,change:tickerChangePct(ndx),at:ndx?.quote_time}};
  const model=useMemo(()=>marketScanner(snapshot.items,order,sector),[snapshot.items,order,sector]);
  const rows=columns<4?4:6,limit=columns*rows;
  const visible=expanded?model.stocks:model.stocks.slice(0,limit);
  const active=model.stocks.find(item=>item.code===selected)??model.stocks[0];
  const config=MARKETS.find(item=>item.key===market)!;
  const money=(n:number)=>market==="nasdaq100"?`$${Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(n)}`:n>=1e12?`${(n/1e12).toFixed(1)}${L("조","T KRW")}`:`${(n/1e8).toFixed(0)}${L("억"," ×100M KRW")}`;
  useEffect(()=>{
    let live=true;
    for(const key of ["kospi","kosdaq"] as const){
      let request=histories.get(key);
      if(!request){request=api.indexHistory(key==="kospi"?"KOSPI":"KOSDAQ",1).then(response=>response.points.filter(p=>Number.isFinite(p.close)&&p.close>0).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30));histories.set(key,request);request.catch(()=>histories.delete(key));}
      request.then(points=>{if(live)setHistory(old=>({...old,[key]:points}));}).catch(()=>{});
    }
    return()=>{live=false;};
  },[]);
  useEffect(()=>()=>{dust.current?.dispose();dust.current=null;},[]);
  useEffect(()=>{
    // Ambient neon runs only while the board is on screen.
    const section=sectionRef.current;if(!section)return;
    const observer=new IntersectionObserver(([entry])=>{section.dataset.live=entry.isIntersecting?"on":"off";});
    observer.observe(section);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>setReducedMotion(media.matches);media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  useEffect(()=>{
    const grid=gridRef.current;if(!grid)return;
    const observer=new ResizeObserver(entries=>{
      const width=entries[0].contentRect.width;
      setColumns(Math.max(2,Math.min(8,Math.floor(width/139))));
    });observer.observe(grid);return()=>observer.disconnect();
  },[]);
  const layoutKey=`${market}:${sector}:${order}:${visible.map(item=>item.code).join(",")}:${columns}`;
  useLayoutEffect(()=>{
    const grid=gridRef.current;if(!grid)return;
    animations.current.forEach(animation=>animation.cancel());animations.current=[];
    const next=new Map<string,{x:number;y:number}>(),reduced=reducedMotion||fx==="minimal";
    let introduced=false;
    for(const element of grid.querySelectorAll<HTMLButtonElement>(".sc-stock")){
      const key=element.dataset.code!,point={x:element.offsetLeft,y:element.offsetTop},previous=positions.current.get(key);
      next.set(key,point);
      if(!reduced&&previous&&(previous.x!==point.x||previous.y!==point.y))animations.current.push(element.animate([{transform:`translate(${previous.x-point.x}px,${previous.y-point.y}px)`,opacity:.6},{transform:"translate(0,0)",opacity:1}],{duration:420,easing:"cubic-bezier(.2,.75,.25,1)"}));
      if(!previous)introduced=true;
    }
    if(!reduced&&introduced&&!document.hidden&&fieldRef.current)animations.current.push(fieldRef.current.animate([{transform:"translate3d(0,-110px,0)",opacity:0},{opacity:.85,offset:.18},{transform:`translate3d(0,${grid.clientHeight+40}px,0)`,opacity:0}],{duration:850,easing:"cubic-bezier(.18,.6,.3,1)"}));
    positions.current=next;
    return()=>{animations.current.forEach(animation=>animation.cancel());animations.current=[];};
  },[layoutKey,fx,reducedMotion]);
  const quoteKey=`${market}:${snapshot.generatedAt}:${snapshot.refreshVersion??0}:${visible.map(item=>`${item.code}:${item.close}:${item.change_pct}`).join("|")}`;
  useEffect(()=>{
    const next=new Map<string,string>(),effects:Animation[]=[];
    const grid=gridRef.current,changed:HTMLButtonElement[]=[];
    const allowed=fx!=="minimal"&&!reducedMotion&&!document.hidden&&!!grid&&grid.getBoundingClientRect().bottom>0&&grid.getBoundingClientRect().top<innerHeight;
    for(const item of visible){
      const key=`${market}:${item.code}`,signature=`${item.close}:${item.change_pct}`;
      next.set(key,signature);
      if(allowed&&quoteLedger.current.has(key)&&quoteLedger.current.get(key)!==signature){
        const element=gridRef.current?.querySelector<HTMLButtonElement>(`[data-code="${CSS.escape(item.code)}"]`);
        if(element)changed.push(element);
        const meter=element?.querySelector<HTMLElement>(".sc-stock-meter>i");
        if(meter)effects.push(meter.animate([{opacity:1,transform:"scaleY(3)"},{opacity:.65,transform:"scaleY(1)"}],{duration:750,easing:"ease-out"}));
      }
    }
    const previous=lastRefresh.current;
    const refreshed=previous?.market===market&&previous.count>0&&(previous.version!==(snapshot.refreshVersion??0)||previous.stamp!==snapshot.generatedAt||changed.length>0);
    if(allowed&&refreshed&&grid){
      const candidates=changed.length?changed:[...grid.querySelectorAll<HTMLButtonElement>(".sc-stock")];
      // Prefer a different set each refresh. The data order and text never move.
      const shuffled=[...candidates];
      for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
      shuffled.sort((a,b)=>Number(lastLit.current.has(a.dataset.code!))-Number(lastLit.current.has(b.dataset.code!)));
      const count=Math.min(candidates.length,fx==="full"?8:6,Math.max(2,Math.ceil(visible.length*.13)));
      const lit=shuffled.slice(0,count);lastLit.current=new Set(lit.map(element=>element.dataset.code!));
      lit.forEach(element=>{
        const glow=element.animate([{opacity:0},{opacity:.58+Math.random()*.2,offset:.25},{opacity:.18,offset:.64},{opacity:0}],{pseudoElement:"::after",duration:1050+Math.random()*400,delay:Math.random()*850,easing:"cubic-bezier(.25,.1,.25,1)"});
        glow.id="scanner-refresh-glow";effects.push(glow);
      });
    }
    lastRefresh.current={market,stamp:snapshot.generatedAt,version:snapshot.refreshVersion??0,count:visible.length};
    const stopHidden=()=>{if(document.hidden)effects.forEach(effect=>effect.cancel());};
    document.addEventListener("visibilitychange",stopHidden);
    quoteLedger.current=next;return()=>{document.removeEventListener("visibilitychange",stopHidden);effects.forEach(effect=>effect.cancel());};
  },[quoteKey,fx,reducedMotion]);
  // Gold dust pours from the mouse tip while it moves over the index and quote panels.
  const pourDust=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(event.pointerType!=="mouse"||fx==="minimal"||reducedMotion)return;
    const previous=lastPointer.current,speed=previous?Math.hypot(event.clientX-previous.x,event.clientY-previous.y):0;
    lastPointer.current={x:event.clientX,y:event.clientY};
    const source=(dust.current??=createGoldDust());
    if(!previous)source.shuffle();
    source.pour(event.clientX,event.clientY,speed);
  };
  const endDust=()=>{lastPointer.current=null;};
  const switchMarket=(key:AtlasMarket)=>{onMarketChange(key);setSector(null);setSelected(null);setExpanded(false);positions.current.clear();};
  const toggleExpanded=()=>{
    if(expanded&&controlsRef.current&&controlsRef.current.getBoundingClientRect().top<pinnedScrollOffset())alignControls();
    setExpanded(value=>!value);
  };
  const filters:[ScannerOrder,string][]=[["cap",L("시총순","Size")],["return",L("등락순","Return")],["activity",L("거래대금순","Turnover")],["sector",L("업종별","Sector")]];
  return <section ref={sectionRef} className="sc-scanner" aria-labelledby="sc-title" data-market={market} data-live="off">
    <i className="sc-hud-corner is-tl" aria-hidden="true"/><i className="sc-hud-corner is-tr" aria-hidden="true"/><i className="sc-hud-corner is-bl" aria-hidden="true"/><i className="sc-hud-corner is-br" aria-hidden="true"/>
    <header className="sc-heading"><h1 id="sc-title" key={market} data-text={L("시장 스캐너","Market scanner")}><i className="sc-live-dot" aria-hidden="true"/>{L("시장 스캐너","Market scanner")}<span className="sc-hud-tag" aria-hidden="true">SCAN//{market==="nasdaq100"?"US-NDX":market==="kospi"?"KR-KOSPI":"KR-KOSDAQ"}</span></h1><p>{L("최근 제공 시세 · 전일 대비","Latest supplied quotes · vs. previous close")}<span>{quoteTime(snapshot.generatedAt)}</span>{snapshot.delayed&&<b>{L("갱신 지연","Delayed")}</b>}</p></header>
    <div className="sc-markets" role="group" aria-label={L("시장 선택","Select market")} onPointerMove={pourDust} onPointerLeave={endDust}>{MARKETS.map(config=>{
      const quote=quotes[config.key],points=config.key==="nasdaq100"?ndx?.points??[]:(history[config.key]??[]).map(point=>point.close);
      const description=config.key==="nasdaq100"?L("제공 추세. 시간 간격 미제공.","Supplied trend; time intervals unavailable."):L("최근 30거래일 종가","Last 30 daily closes");
      return <button type="button" key={config.key} aria-pressed={market===config.key} onClick={()=>switchMarket(config.key)} title={`${description} · ${quoteTime(quote.at)}`}><span>{config.label}<small>{config.key==="nasdaq100"?"US":"KR"}</small></span><div><strong>{price(quote.price)}</strong><b className={`is-${toneOf(quote.change)}`}>{quotePct(quote.change)}</b></div><MiniTrend values={points} tone={toneOf(quote.change)} label={`${config.label} · ${description}`}/></button>;
    })}</div>
    <div className="sc-breadth"><div><span>{L("등락 분포","Breadth")}</span><b className="sc-up">↑ {model.up}</b><b className="sc-down">↓ {model.down}</b><small>{L("보합","Flat")} {model.flat}</small>{model.unknown>0&&<small>{L("미확인","Unknown")} {model.unknown}</small>}</div><div className="sc-breadth-track" role="img" aria-label={`${model.up} up, ${model.down} down, ${model.flat} flat, ${model.unknown} unknown`}>{[[model.up,"up"],[model.flat,"flat"],[model.down,"down"],[model.unknown,"unknown"]].map(([count,tone])=><i key={tone} className={`sc-${tone}`} style={{flex:Number(count)}}/>)}</div><Link to={config.to}>{L("전체 맵","Full map")} ↗</Link></div>
    <div ref={controlsRef} className="sc-controls"><div className="sc-count"><strong>{L("주요 종목","Leading stocks")}</strong><span>{visible.length}<small> / {model.stocks.length}</small></span></div><div role="group" aria-label={L("종목 정렬","Sort stocks")}>{filters.map(([key,label])=><button key={key} aria-pressed={order===key} onClick={()=>setOrder(key)}>{label}</button>)}</div><label className="sc-sector-filter"><span className="sc-sr-only">{L("업종 선택","Select sector")}</span><select aria-label={L("업종 선택","Select sector")} value={sector??""} onChange={event=>{setSector(event.target.value||null);setSelected(null);setExpanded(false);}}><option value="">{L("전체 업종","All sectors")}</option>{model.sectors.map(group=><option key={group.name} value={group.name}>{group.name} ({group.count})</option>)}</select></label></div>
    <div ref={gridRef} className="sc-grid" style={{"--sc-columns":columns} as CSSProperties} role="group" aria-label={L("종목 시세","Stock quotes")} onPointerMove={pourDust} onPointerLeave={endDust}>
      {visible.map(item=>{
        const known=hasReturn(item),color=quoteColor(item),turnover=tradingValue(item);
        const meter=order==="activity"?turnover.value/model.maxTrade:item.marcap/model.maxCap;
        return <button className={`sc-stock${item.code===active?.code?" is-selected":""}`} key={item.code} data-code={item.code} aria-current={item.code===active?.code?"true":undefined} onClick={()=>navigate(`/stock/${encodeURIComponent(item.code)}`)} onPointerEnter={event=>{if(event.pointerType==="mouse")setSelected(item.code);}} onFocus={()=>setSelected(item.code)} title={`${L("상세 보기","Open details")} · ${item.name} · ${item.sector||"—"} · ${price(item.close)} · ${known?pct(item.change_pct):L("등락 미확인","Return unavailable")}`} style={{"--sc-color":color,"--sc-strength":known?Math.min(Math.abs(item.change_pct)/8,.75):0} as CSSProperties}>
          <span className="sc-stock-name"><StockLogo code={item.code} name={item.name} className="sc-stock-logo"/><span>{market==="nasdaq100"?item.code:item.name}</span></span><b className="sc-stock-return">{known?pct(item.change_pct):"—"}</b><span className="sc-stock-price">{price(item.close)}</span><small>{order==="activity"?(turnover.value?money(turnover.value)+(turnover.estimated?"*":""):"—"):market==="nasdaq100"?`${item.marcap.toFixed(2)}%`:money(item.marcap)}</small><i className="sc-stock-meter" aria-hidden="true"><i style={{width:`${meter*100}%`}}/></i>
        </button>;
      })}
      {!model.stocks.length&&<div className="sc-empty">{snapshot.settled?L("시장 데이터를 확인하고 있습니다.","Market data is unavailable."):L("시장 데이터를 불러오는 중입니다.","Loading market data.")}</div>}
      <div ref={fieldRef} className="sc-scan-field" aria-hidden="true"/>
      <div className="sc-ambient-scan" aria-hidden="true"/>
    </div>
    <div className="sc-board-footer"><span>{order==="activity"?L("막대: 상대 거래대금 · * 종가×거래량 추정","Bar: relative turnover · * estimated close × volume"):market==="nasdaq100"?L("막대: 상대 지수 비중","Bar: relative index weight"):L("막대: 상대 시가총액","Bar: relative market cap")}</span>{model.stocks.length>limit&&<button className="sc-expand" onClick={toggleExpanded} aria-expanded={expanded}>{expanded?L("접기","Show less"):L(`${model.stocks.length}종목 모두 보기`, `Show all ${model.stocks.length}`)}<b>{expanded?"−":"+"}</b></button>}</div>
    {active&&<div className="sc-selected" style={{"--sc-color":quoteColor(active)} as CSSProperties}><div><i/><strong>{active.name}</strong><span>{active.code}</span><span>{active.sector||"—"}</span></div><div><strong>{price(active.close)}</strong><b className={`is-${toneOf(hasReturn(active)?active.change_pct:undefined)}`}>{hasReturn(active)?pct(active.change_pct):"—"}</b><Link to={`/stock/${encodeURIComponent(active.code)}`}>{L("상세","Details")} ↗</Link></div></div>}
  </section>;
}
