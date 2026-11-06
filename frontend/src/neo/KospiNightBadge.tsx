import { useLanguage } from "../i18n/LanguageContext";
import { useKospiNight } from "../useKospiNight";
import "./kospiNight.css";

export default function KospiNightBadge() {
  const quote = useKospiNight();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const change = quote?.change_pct;
  const tone = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const stamp = quote?.quote_time ? new Date(quote.quote_time * 1000).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : null;
  const status = quote?.stale ? L("수집 지연", "Delayed") : quote?.session_state === "open" ? L("야간 거래", "Night session") : quote ? L("최근 야간 종가", "Last night quote") : L("연결 중", "Connecting");
  return <a className={`ng-night-quote is-${tone}${quote?.stale ? " is-stale" : ""}`} href="https://kospi.donkiugi.com/" target="_blank" rel="noopener noreferrer" aria-label={L("코스피200 야간선물 외부 시세. 원문 열기", "KOSPI 200 night futures. Open source")} title={L("외부 시세 수집 · 10초 자동 조회 · 원천 갱신 주기에 따라 지연될 수 있습니다", "External quotes · checks every 10s · updates depend on the source")}>
    <span className="ng-night-label"><span className="ng-night-dot" aria-hidden="true" />{L("코스피200 야간선물", "KOSPI 200 NIGHT")}<em>{status}</em></span>
    <span className="ng-night-values"><strong>{quote?.close != null ? quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong><b>{change != null ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(2)}%` : "—"}</b><i aria-hidden="true">↗</i></span>
    <small>{stamp ? `${stamp} KST` : L("외부 시세 확인 중", "Waiting for source")}{" · "}{L("10초 조회", "10s refresh")}</small>
  </a>;
}
