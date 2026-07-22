import { MarketTickerItem } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useMarketTicker } from "../useMarketTicker";

interface Row {
  symbol: string;
  icon: string;
  labelKo: string;
  sublabel: string;
  // A small qualifier printed after the label — JPY is quoted per 100 yen.
  noteKo?: string;
}

// The same icons the scrolling ticker uses for these symbols — one visual identity
// per instrument across the page, and they're already round with their own backdrop
// baked in. The four FX crosses are grouped first (USD, then JPY/EUR/GBP), each shown
// exactly the way USD/KRW is; the belt rolls them all past infinitely.
const ROWS: Row[] = [
  { symbol: "KRW=X", icon: "/img/ticker/usdkrw.png", labelKo: "원/달러 환율", sublabel: "USD/KRW" },
  { symbol: "JPYKRW=X", icon: "/img/ticker/jpykrw.png", labelKo: "원/엔 환율", sublabel: "JPY/KRW", noteKo: "100엔" },
  { symbol: "EURKRW=X", icon: "/img/ticker/eurkrw.png", labelKo: "원/유로 환율", sublabel: "EUR/KRW" },
  { symbol: "GBPKRW=X", icon: "/img/ticker/gbpkrw.png", labelKo: "원/파운드 환율", sublabel: "GBP/KRW" },
  { symbol: "CL=F", icon: "/img/ticker/oil.png", labelKo: "국제유가", sublabel: "WTI" },
  { symbol: "GC=F", icon: "/img/ticker/gold.png", labelKo: "금", sublabel: "Gold" },
  { symbol: "SI=F", icon: "/img/ticker/silver.png", labelKo: "은", sublabel: "Silver" },
];

function formatValue(item: MarketTickerItem, lang: Lang): string {
  const value = item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // KRW is written with its own suffix the way the rest of the app writes prices;
  // anything else (WTI is quoted in USD) takes the plain symbol prefix.
  return item.currency === "KRW" ? `${value}${wonSuffix(lang)}` : `$${value}`;
}

/** Decorative trend line only — no axes or hover, same treatment as the global
 * index tiles. Drawn from the intraday points the ticker payload already carries. */
function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <div className="macro-rate-spark" />;

  const w = 100;
  const h = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(" ");
  const color = up ? "var(--up-color)" : "var(--down-color)";

  return (
    <svg className="macro-rate-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L ${w},${h} L 0,${h} Z`} fill={color} opacity={0.1} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MacroTile({ row, item }: { row: Row; item: MarketTickerItem | null }) {
  const { lang } = useLanguage();
  const t = useT();

  if (!item) {
    return (
      <div className="macro-rate-tile" aria-hidden="true">
        <img className="macro-rate-icon" src={row.icon} alt="" />
        <div className="macro-rate-body">
          <span className="macro-rate-label">{t(row.labelKo)}</span>
          <span className="skeleton" style={{ width: "70%", height: 16, marginTop: 4 }} />
        </div>
      </div>
    );
  }

  const up = item.change >= 0;
  return (
    <div className="macro-rate-tile">
      <img className="macro-rate-icon" src={row.icon} alt="" loading="lazy" />
      <div className="macro-rate-body">
        <span className="macro-rate-label">
          {t(row.labelKo)}
          {/* The Korean label is a description ("원/달러 환율") that benefits from the
              latin ticker beside it; the English label already *is* that ticker, so
              showing both would just print the same string twice. */}
          {lang === "ko" && <span className="macro-rate-sublabel">{row.sublabel}</span>}
          {/* JPY is quoted per 100 yen — flag it in both languages so the value isn't
              misread against the other, per-unit crosses. */}
          {row.noteKo && <span className="macro-rate-sublabel">({t(row.noteKo)})</span>}
        </span>
        <span className="macro-rate-value">{formatValue(item, lang)}</span>
        <span className={`macro-rate-change ${up ? "change-up" : "change-down"}`}>
          {up ? "▲" : "▼"} {Math.abs(item.change).toFixed(2)} ({up ? "+" : ""}
          {item.change_pct.toFixed(2)}%)
        </span>
      </div>
      <Sparkline points={item.points} up={up} />
    </div>
  );
}

// The dashboard splits the strip into two independent vertical flip-tiles: the FX
// crosses cycle in one slot, the commodities (crude + the two metals) in the other.
// Each rolls its own members bottom-to-top on its own clock — they aren't a single
// belt. Split by symbol so the ROWS order above stays the single source of truth.
const FX_SYMBOLS = new Set(["KRW=X", "JPYKRW=X", "EURKRW=X", "GBPKRW=X"]);
const FX_ROWS = ROWS.filter((r) => FX_SYMBOLS.has(r.symbol));
const COMMODITY_ROWS = ROWS.filter((r) => !FX_SYMBOLS.has(r.symbol));

/** One flip-tile: a viewport exactly one tile tall that scrolls a vertical stack of
 * its rows upward, one member at a time. The first row is repeated at the end so the
 * wrap from the last member back to the first is seamless (the duplicate sits at the
 * same on-screen position the original starts from). The CSS keyframes are chosen per
 * member count — see `.macro-flip--3/4` — so the dwell-then-slide cadence is even. */
function MacroFlip({ rows, bySymbol }: { rows: Row[]; bySymbol: Map<string, MarketTickerItem> }) {
  return (
    <div className={`macro-flip macro-flip--${rows.length}`}>
      <div className="macro-flip-track">
        {[...rows, rows[0]].map((row, idx) => (
          <MacroTile key={`${row.symbol}-${idx}`} row={row} item={bySymbol.get(row.symbol) ?? null} />
        ))}
      </div>
    </div>
  );
}

/** Live FX and commodity numbers under the index tiles — the values a Korean investor
 * checks alongside the index itself, all riding the market-ticker payload so this
 * costs no new endpoint, just a second reader of it. */
/** `variant` only changes the tile chrome, never the data: "inline" (the dashboard)
 * shows two rolling flip-tiles — FX crosses in one, crude/gold/silver in the other —
 * while "card" (the global page) has the vertical room to lay every row out at once
 * as a static grid matching the bordered index tiles above it. */
export default function MacroRatesStrip({ variant = "inline" }: { variant?: "inline" | "card" }) {
  // Shares the scrolling belt's single poller rather than running one of its own —
  // see useMarketTicker for why that mattered.
  const items = useMarketTicker();
  const bySymbol = new Map(items.map((item) => [item.symbol, item]));

  if (variant === "inline") {
    return (
      <div className="macro-rates macro-rates--inline">
        <MacroFlip rows={FX_ROWS} bySymbol={bySymbol} />
        <MacroFlip rows={COMMODITY_ROWS} bySymbol={bySymbol} />
      </div>
    );
  }

  return (
    <div className="macro-rates macro-rates--card">
      {ROWS.map((row) => (
        <MacroTile key={row.symbol} row={row} item={bySymbol.get(row.symbol) ?? null} />
      ))}
    </div>
  );
}
