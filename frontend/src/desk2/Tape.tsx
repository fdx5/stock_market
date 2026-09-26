import { memo } from "react";
import { MarketTickerItem } from "../api/client";
import { useMarketTicker } from "../useMarketTicker";
import { useL } from "./lib";

/* The tape. The classic belt drew a card per symbol with a sparkline in each;
   this is set the way a stock tape actually reads — symbol, last, move, a thin
   rule — so twice as many instruments fit in the same pass and the eye can run
   along it like a line of type. The FX crosses and metals are left off because
   the index section prints them in full, as the belt always did. */

const EXCLUDED = new Set(["KRW=X", "JPYKRW=X", "EURKRW=X", "GBPKRW=X", "GC=F", "SI=F"]);

function priceText(item: MarketTickerItem): string {
  const big = item.symbol === "BTC-USD" || item.symbol === "ETH-USD";
  return item.price.toLocaleString("en-US", { minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 });
}

const Cell = memo(
  function Cell({ item }: { item: MarketTickerItem }) {
    const tone = item.change > 0 ? "up" : item.change < 0 ? "down" : "flat";
    return (
      <span className={`d2-tape-cell is-${tone}`}>
        <b>{item.label}</b>
        <span className="d2-tape-px">{priceText(item)}</span>
        <span className="d2-tape-ch">
          {item.change > 0 ? "▲" : item.change < 0 ? "▼" : "–"}
          {Math.abs(item.change_pct).toFixed(2)}%
        </span>
        {(item.session === "pre" || item.session === "post") && <em>{item.session === "pre" ? "PRE" : "AFT"}</em>}
      </span>
    );
  },
  (a, b) => a.item.price === b.item.price && a.item.change_pct === b.item.change_pct && a.item.session === b.item.session
);

export default function Tape() {
  const L = useL();
  const items = useMarketTicker().filter((item) => !EXCLUDED.has(item.symbol));
  if (items.length === 0) return <div className="d2-tape d2-tape--empty" aria-hidden="true" />;
  // Seconds per full pass scale with the number of cells so the tape moves at a
  // reading pace however many instruments the backend sends.
  const duration = Math.max(40, items.length * 4.2);
  return (
    <div className="d2-tape" role="marquee" aria-label={L("해외 주요 종목 시세 테이프", "Global quote tape")}>
      <span className="d2-tape-label" aria-hidden="true">
        TAPE
      </span>
      <div className="d2-tape-viewport">
        <div className="d2-tape-track" style={{ animationDuration: `${duration}s`, "--tape-dur": `${duration}s` } as React.CSSProperties}>
          {[...items, ...items].map((item, i) => (
            <Cell key={`${item.symbol}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
