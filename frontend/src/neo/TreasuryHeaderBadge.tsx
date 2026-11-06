import { useLanguage } from "../i18n/LanguageContext";
import { useTreasuryHeadlines } from "../useTreasuryHeadlines";
import "./treasuryHeader.css";

export default function TreasuryHeaderBadge() {
  const items = useTreasuryHeadlines();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  return <div className="ng-treasury-quote" role="group" aria-label={L("미국 국채 2년물·10년물 금리와 등락", "US 2-year and 10-year Treasury yields and changes")}>
    {(["2", "10"] as const).map(tenor => {
      const quote = items.find(item => item.tenor === tenor);
      const change = quote?.change_bp;
      const validChange = change != null && Number.isFinite(change);
      const tone = validChange ? change > 0 ? "up" : change < 0 ? "down" : "flat" : "flat";
      const title = `${L("전일 종가 대비 · 1bp = 0.01%p", "Vs. previous close · 1bp = 0.01 percentage point")} · CNBC / Tradeweb${quote?.quote_time_label ? ` · ${quote.quote_time_label}` : ""}${quote?.stale ? ` · ${L("수집 지연 · 최근 정상값", "Delayed · last valid quote")}` : ""}`;
      return <div key={tenor} className={`ng-treasury-row is-${tone}${quote?.stale ? " is-stale" : ""}`} title={title}>
        <span>{L(`미국 ${tenor}년`, `US ${tenor}Y`)}{quote?.stale && <i aria-label={L("시세 지연", "Delayed quote")}>!</i>}</span>
        <strong>{quote?.yield_pct != null && Number.isFinite(quote.yield_pct) ? `${quote.yield_pct.toFixed(3)}%` : "—"}</strong>
        <b>{validChange ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(1)}bp` : "—"}</b>
      </div>;
    })}
  </div>;
}
