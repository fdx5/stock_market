import { IndexQuote, MarketInvestorSummary, MarketTickerItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { useFlashOnChange } from "./FrontPage";
import { Skel, Spark } from "./parts";
import { eok, pct, signed, useL } from "./lib";

/* 01 지수 · 수급 · 환율.
 *
 * The classic board put each index in a tile with three coloured words under it
 * for the investor flows, and rolled the seven FX and commodity prices through
 * two flip-tiles so that at any moment five of the seven were out of sight. Both
 * are fixed here by giving the numbers their own shapes:
 *
 *  - Investor flows are a diverging bar chart on a shared scale across both
 *    markets, so "외국인 −4,054억 on the KOSPI" and "−151억 on the KOSDAQ" are
 *    visibly different sizes rather than two similar-looking words.
 *  - The seven macro prices are one table, all visible at once, each with its
 *    day line. WTI keeps its warning levels ($80 / $85) — the one price here
 *    that is bad news for Korea when it rises. */

function IndexBlock({ quote, investor, label, to, span }: { quote: IndexQuote | null; investor: MarketInvestorSummary | null; label: string; to: string; span: number }) {
  const { lang } = useLanguage();
  const L = useL();
  const flash = useFlashOnChange(quote?.close);

  if (!quote) {
    return (
      <div className="d2-idx">
        <h3>{label}</h3>
        <Skel h={52} w="70%" />
        <Skel h={16} w="45%" />
        <Skel h={80} />
      </div>
    );
  }
  const tone = quote.change > 0 ? "up" : quote.change < 0 ? "down" : "flat";
  const flows = investor
    ? [
        { key: "individual", label: L("개인", "Individuals"), v: investor.individual_amount },
        { key: "foreign", label: L("외국인", "Foreigners"), v: investor.foreign_amount },
        { key: "institution", label: L("기관", "Institutions"), v: investor.institution_amount },
      ]
    : [];

  return (
    <div className={`d2-idx is-${tone}`}>
      <div className="d2-idx-top">
        <h3>{label}</h3>
        <Link to={to} className="d2-idx-chart">
          {L("지수 차트", "Chart")} →
        </Link>
      </div>
      <div className={`d2-idx-value ${flash ? `is-flash-${flash}` : ""}`}>
        {quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="d2-idx-change">
        <span>
          {quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : "–"} {Math.abs(quote.change).toFixed(2)}
        </span>
        <b>{pct(quote.change_pct)}</b>
      </div>
      <div className="d2-flows" role="img" aria-label={flows.map((f) => `${f.label} ${eok(f.v, lang)}`).join(", ")}>
        <div className="d2-flows-head">
          <span>{L("투자자별 누적 순매수", "Net buying by investor")}</span>
          <small>{L("억원", "KRW 100M")}</small>
        </div>
        {flows.length === 0 ? (
          <Skel h={60} />
        ) : (
          flows.map((f) => {
            const w = Math.min(50, (Math.abs(f.v) / span) * 50);
            return (
              <div key={f.key} className={`d2-flow is-${f.v >= 0 ? "up" : "down"}`}>
                <span className="d2-flow-name">{f.label}</span>
                <span className="d2-flow-track">
                  <i className="d2-flow-mid" />
                  <i className="d2-flow-bar" style={f.v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
                </span>
                <b className="d2-flow-val">{eok(f.v, lang)}</b>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface MacroRow {
  symbol: string;
  icon: string;
  ko: string;
  en: string;
  note?: { ko: string; en: string };
  alert?: { warn: number; danger: number };
}

const MACRO: MacroRow[] = [
  { symbol: "KRW=X", icon: "/img/ticker/usdkrw.webp", ko: "원/달러", en: "USD/KRW" },
  { symbol: "JPYKRW=X", icon: "/img/ticker/jpykrw.webp", ko: "원/엔", en: "JPY/KRW", note: { ko: "100엔", en: "per ¥100" } },
  { symbol: "EURKRW=X", icon: "/img/ticker/eurkrw.webp", ko: "원/유로", en: "EUR/KRW" },
  { symbol: "GBPKRW=X", icon: "/img/ticker/gbpkrw.webp", ko: "원/파운드", en: "GBP/KRW" },
  { symbol: "CL=F", icon: "/img/ticker/oil.webp", ko: "국제유가 WTI", en: "WTI crude", alert: { warn: 80, danger: 85 } },
  { symbol: "GC=F", icon: "/img/ticker/gold.webp", ko: "금", en: "Gold" },
  { symbol: "SI=F", icon: "/img/ticker/silver.webp", ko: "은", en: "Silver" },
];

function alertOf(row: MacroRow, item: MarketTickerItem): "" | "warn" | "danger" | "cool" {
  if (!row.alert || item.price <= row.alert.warn) return "";
  if (item.change <= -2) return "cool";
  return item.price > row.alert.danger ? "danger" : "warn";
}

function MacroTable() {
  const { lang } = useLanguage();
  const L = useL();
  const items = useMarketTicker();
  const bySymbol = new Map(items.map((i) => [i.symbol, i]));
  return (
    <div className="d2-macro">
      <div className="d2-block-head">
        <h3>{L("환율 · 원자재", "FX · commodities")}</h3>
        <small>{L("당일 흐름", "intraday")}</small>
      </div>
      <table className="d2-macro-table">
        <tbody>
          {MACRO.map((row) => {
            const item = bySymbol.get(row.symbol);
            if (!item) {
              return (
                <tr key={row.symbol}>
                  <th scope="row">
                    <img src={row.icon} alt="" loading="lazy" />
                    {lang === "ko" ? row.ko : row.en}
                  </th>
                  <td colSpan={3}>
                    <Skel h={12} />
                  </td>
                </tr>
              );
            }
            const tone = item.change > 0 ? "up" : item.change < 0 ? "down" : "flat";
            const alert = alertOf(row, item);
            const value = item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <tr key={row.symbol} className={alert ? `is-alert-${alert}` : ""}>
                <th scope="row">
                  <img src={row.icon} alt="" loading="lazy" />
                  <span>
                    {lang === "ko" ? row.ko : row.en}
                    {row.note && <small>{lang === "ko" ? row.note.ko : row.note.en}</small>}
                    {alert && (
                      <em className="d2-macro-alert" title={L("유가 경계 구간 ($80 초과)", "Oil above the $80 warning level")}>
                        {alert === "cool" ? L("진정", "cooling") : alert === "danger" ? L("경보", "alert") : L("주의", "watch")}
                      </em>
                    )}
                  </span>
                </th>
                <td className="d2-macro-val">{item.currency === "KRW" ? value : `$${value}`}</td>
                <td className={`d2-macro-ch is-${tone}`}>
                  {signed(item.change, 2)}
                  <small>{pct(item.change_pct)}</small>
                </td>
                <td className="d2-macro-spark">
                  <Spark points={item.points} tone={tone} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function IndexDesk() {
  const L = useL();
  const { kospi, kosdaq, kospiInvestor, kosdaqInvestor } = useMarketIndices();
  // One scale for both markets' bars, so their lengths can be compared.
  const span = Math.max(
    1,
    ...[kospiInvestor, kosdaqInvestor].flatMap((inv) => (inv ? [inv.individual_amount, inv.foreign_amount, inv.institution_amount].map(Math.abs) : []))
  );
  return (
    <div className="d2-index-grid">
      <IndexBlock quote={kospi} investor={kospiInvestor} label={L("코스피", "KOSPI")} to="/index/kospi" span={span} />
      <IndexBlock quote={kosdaq} investor={kosdaqInvestor} label={L("코스닥", "KOSDAQ")} to="/index/kosdaq" span={span} />
      <MacroTable />
    </div>
  );
}
