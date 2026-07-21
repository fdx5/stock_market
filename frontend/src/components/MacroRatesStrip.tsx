import { MarketTickerItem } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useMarketTicker } from "../useMarketTicker";

interface Row {
  symbol: string;
  icon: string;
  labelKo: string;
  sublabel: string;
}

// The same two icons the scrolling ticker uses for these symbols — one visual
// identity per instrument across the page, and they're already round with their
// own backdrop baked in.
const ROWS: Row[] = [
  { symbol: "KRW=X", icon: "/img/ticker/usdkrw.png", labelKo: "원/달러 환율", sublabel: "USD/KRW" },
  { symbol: "CL=F", icon: "/img/ticker/oil.png", labelKo: "국제유가", sublabel: "WTI" },
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

/** Live USD/KRW and WTI crude under the index tiles. Both are the numbers a Korean
 * investor checks alongside the index itself, and both already ride in the market
 * ticker payload — so this costs no new endpoint, just a second reader of it. */
/** `variant` only changes the tile chrome, never the data: "inline" (the dashboard)
 * tucks under the index tiles as a quieter, borderless sub-row, while "card" (the
 * global page) sits on its own below the index grid and so has to match those
 * bordered tiles instead. */
export default function MacroRatesStrip({ variant = "inline" }: { variant?: "inline" | "card" }) {
  // Shares the scrolling belt's single poller rather than running one of its own —
  // see useMarketTicker for why that mattered.
  const items = useMarketTicker();
  const bySymbol = new Map(items.map((item) => [item.symbol, item]));

  return (
    <div className={`macro-rates macro-rates--${variant}`}>
      {ROWS.map((row) => (
        <MacroTile key={row.symbol} row={row} item={bySymbol.get(row.symbol) ?? null} />
      ))}
    </div>
  );
}
