import { memo } from "react";
import { MarketTickerItem } from "../api/client";
import { useMarketTicker } from "../useMarketTicker";
import SessionBadge from "./SessionBadge";

const ICONS: Record<string, string> = {
  "^GSPC": "/img/ticker/spx500.png",
  "^NDX": "/img/ticker/nas100.png",
  NVDA: "/img/ticker/nvidia.png",
  SKHY: "/img/ticker/skhynix.png",
  MU: "/img/ticker/micron.png",
  AVGO: "/img/ticker/broadcom.png",
  INTC: "/img/ticker/intel.png",
  AMD: "/img/ticker/amd.png",
  AAPL: "/img/ticker/apple.png",
  GOOGL: "/img/ticker/google.png",
  MSFT: "/img/ticker/microsoft.png",
  META: "/img/ticker/meta.png",
  TSLA: "/img/ticker/tesla.png",
  SPCX: "/img/ticker/spacex.png",
  "CL=F": "/img/ticker/oil.png",
  "BTC-USD": "/img/ticker/btc.png",
  "ETH-USD": "/img/ticker/eth.png",
  "XRP-USD": "/img/ticker/xrp.png",
};

// FX crosses and the two metals ride the shared ticker payload so the macro strip
// can cycle through them, but they aren't part of the scrolling belt's line-up —
// the flip-tiles under the index already carry them, and printing them twice on the
// same screen just made the belt longer without saying anything new.
const BELT_EXCLUDED = new Set(["KRW=X", "JPYKRW=X", "EURKRW=X", "GBPKRW=X", "GC=F", "SI=F"]);

function formatPrice(item: MarketTickerItem): string {
  const value =
    item.symbol === "BTC-USD" || item.symbol === "ETH-USD"
      ? item.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value} ${item.currency}`;
}

function TickerIcon({ symbol, label }: { symbol: string; label: string }) {
  const src = ICONS[symbol];
  if (!src) return null;
  return <img src={src} alt="" className="ticker-icon" title={label} />;
}

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
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
      <path d={d} fill="none" stroke={up ? "var(--up-color)" : "var(--down-color)"} strokeWidth="1.5" />
    </svg>
  );
}

/** Memoised on the fields it actually paints. The belt holds 44 cards (the symbol
 * list twice), and a refresh typically moves only a handful of them — without this,
 * every poll rebuilt all 44 sparkline paths mid-animation. `points` is compared by
 * identity, which is exactly right: the fetch hands back a fresh array only when new
 * data arrived for that symbol. */
const TickerCard = memo(
  function TickerCard({ item }: { item: MarketTickerItem }) {
    const up = item.change >= 0;
    return (
      <div className="ticker-card">
        <TickerIcon symbol={item.symbol} label={item.label} />
        <div className="ticker-card-label">{item.label}</div>
        <Sparkline points={item.points} up={up} />
        <div className="ticker-card-price">
          <span className="ticker-card-value">
            {formatPrice(item)}
            <SessionBadge session={item.session} compact />
          </span>
          <span className={`ticker-card-change ${up ? "change-up" : "change-down"}`}>
            {up ? "▲" : "▼"} {Math.abs(item.change_pct).toFixed(2)}%
          </span>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.item.symbol === next.item.symbol &&
    prev.item.price === next.item.price &&
    prev.item.change === next.item.change &&
    prev.item.change_pct === next.item.change_pct &&
    prev.item.session === next.item.session &&
    prev.item.points === next.item.points
);

export default function MarketTickerBar() {
  const items = useMarketTicker().filter((item) => !BELT_EXCLUDED.has(item.symbol));

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
