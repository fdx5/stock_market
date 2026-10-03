import TrendChart from "../charts/TrendChart";


/** Currency-aware prices for the shared ECharts trend component. */

export function formatPrice(value: number, currency: string | null): string {
  if (!currency) return value.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: value >= 1000 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognized ISO currency code (shouldn't happen, but Intl throws rather
    // than degrading) falls back to a bare number with the raw code prefixed.
    return `${currency} ${value.toLocaleString()}`;
  }
}

export default function GlobalTop100Sparkline({points,dates,currency,trend}:{points:number[];dates:string[];currency:string|null;trend:"up"|"down"|"flat"}) {
 return <TrendChart points={points} dates={dates} trend={trend} className="gt100-spark" format={v=>formatPrice(v,currency)} />;
}
