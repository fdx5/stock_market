import type { MarketMapItem } from "../api/client";
import { hasReturn, tradingValue } from "./marketQuote";

export type ScannerOrder = "cap" | "return" | "activity" | "sector";
export function marketScanner(items:MarketMapItem[],order:ScannerOrder,sector:string|null=null) {
  const unique=new Map<string,MarketMapItem>();
  for(const item of items) if(item.code&&!unique.has(item.code)&&Number.isFinite(item.marcap)&&item.marcap>0) unique.set(item.code,item);
  const all=[...unique.values()].sort((a,b)=>b.marcap-a.marcap).slice(0,60);
  const groups=new Map<string,{name:string;count:number;cap:number;knownCap:number;movement:number}>();
  for(const item of all) {
    const name=item.sector||"—",group=groups.get(name)??{name,count:0,cap:0,knownCap:0,movement:0};
    group.count++;group.cap+=item.marcap;
    if(hasReturn(item)){group.knownCap+=item.marcap;group.movement+=item.marcap*item.change_pct;}
    groups.set(name,group);
  }
  const sectors=[...groups.values()].sort((a,b)=>b.cap-a.cap).map(group=>({...group,change:group.knownCap?group.movement/group.knownCap:null}));
  const stocks=all.filter(item=>!sector||(item.sector||"—")===sector).sort((a,b)=>{
    if(order==="return")return Number(hasReturn(b))-Number(hasReturn(a))||(hasReturn(a)&&hasReturn(b)?b.change_pct-a.change_pct:0)||b.marcap-a.marcap;
    if(order==="activity")return tradingValue(b).value-tradingValue(a).value||b.marcap-a.marcap;
    if(order==="sector")return (a.sector||"—").localeCompare(b.sector||"—")||b.marcap-a.marcap;
    return b.marcap-a.marcap;
  });
  const known=all.filter(hasReturn);
  return {stocks,sectors,count:all.length,maxCap:Math.max(1,...all.map(item=>item.marcap)),maxTrade:Math.max(1,...all.map(item=>tradingValue(item).value)),up:known.filter(item=>item.change_pct>0).length,down:known.filter(item=>item.change_pct<0).length,flat:known.filter(item=>item.change_pct===0).length,unknown:all.length-known.length};
}
