import { useEffect, useState } from "react";
import { MarketTickerItem, api } from "../api/client";

const TICKER_POLL_MS = 3_000;

function formatPrice(item: MarketTickerItem): string {
  if (item.symbol === "BTC-USD" || item.symbol === "ETH-USD") {
    return item.price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <svg className="ticker-sparkline" />;

  const w = 120;
  const h = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(" ");

  return (
    <svg className="ticker-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--series-red)" strokeWidth="1.5" />
    </svg>
  );
}

function TickerCard({ item }: { item: MarketTickerItem }) {
  const up = item.change >= 0;
  return (
    <div className="ticker-card">
      <div className="ticker-card-label">{item.label}</div>
      <Sparkline points={item.points} />
      <div className="ticker-card-price">
        <span className="ticker-card-value">{formatPrice(item)}</span>
        <span className={`ticker-card-change ${up ? "change-up" : "change-down"}`}>
          {up ? "▲" : "▼"} {Math.abs(item.change_pct).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

export default function MarketTickerBar() {
  const [items, setItems] = useState<MarketTickerItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api
        .marketTicker()
        .then((res) => {
          if (!cancelled) setItems(res.items);
        })
        .catch(() => {
          // A missed refresh just keeps the belt moving with the last known values.
        });
    };

    load();
    const id = window.setInterval(load, TICKER_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (items.length === 0) return <div className="ticker-bar" />;

  // The track is the item list rendered twice back to back, then scrolled exactly
  // one set's width — that's what makes the loop seamless instead of snapping.
  return (
    <div className="ticker-bar">
      <div className="ticker-track">
        {[...items, ...items].map((item, idx) => (
          <TickerCard key={`${item.symbol}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}
