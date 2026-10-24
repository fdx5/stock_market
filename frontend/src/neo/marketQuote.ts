import type { MarketMapItem, MarketTickerItem } from "../api/client";
import { pct } from "../desk2/lib";

/** The ticker rounds change_pct to two places, so a −1.16pt move on NASDAQ 100 arrives
 *  as −0.0 and read as flat. Recover the unrounded figure from price and change. */
export function tickerChangePct(item?:MarketTickerItem) {
  if(!item)return undefined;
  const base=item.price-item.change;
  return Number.isFinite(item.change)&&Number.isFinite(base)&&base>0?item.change/base*100:item.change_pct;
}

/** A move too small for two places keeps its sign and shows a third digit. */
export const quotePct=(value?:number|null)=>value!=null&&value!==0&&Math.abs(value)<.005?pct(value,3):pct(value);

/** Upstream fallback zeroes are unverified, rather than a confirmed flat quote. */
export const hasReturn = (item:MarketMapItem) => Number.isFinite(item.change_pct) &&
  !(item.change_pct===0&&!item.volume&&!item.turnover&&!item.quote_time);

export function tradingValue(item:MarketMapItem) {
  if(Number.isFinite(item.turnover)&&item.turnover!>0)return {value:item.turnover!,estimated:false};
  if(Number.isFinite(item.close)&&item.close>0&&Number.isFinite(item.volume)&&item.volume!>0)
    return {value:item.close*item.volume!,estimated:true};
  return {value:0,estimated:false};
}

export function quoteColor(item:MarketMapItem) {
  if(!hasReturn(item))return "#a690e5";
  return item.change_pct>0?"#ff718b":item.change_pct<0?"#51baff":"#c9c1dd";
}
