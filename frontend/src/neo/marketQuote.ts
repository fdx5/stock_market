import type { MarketMapItem } from "../api/client";

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
