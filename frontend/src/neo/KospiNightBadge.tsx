import { useLanguage } from "../i18n/LanguageContext";
import { useKospiFutures, useKospiNight } from "../useKospiNight";
import "./kospiNight.css";

/** KOSPI 200 futures header badge: the day session (Naver) or the night session (external crawl). */
export default function KospiNightBadge({ session = "night" }: { session?: "day" | "night" }) {
  const day = session === "day";
  const quote = (day ? useKospiFutures : useKospiNight)();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const change = quote?.change_pct;
  const tone = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const rising = change != null && change > 0 && !quote?.stale && quote?.session_state === "open";
  const stamp = quote?.quote_time ? new Date(quote.quote_time * 1000).toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : null;
  const status = quote?.stale ? L("수집 지연", "Delayed") : quote?.session_state === "open" ? (day ? L("주간 거래", "Day session") : L("야간 거래", "Night session")) : quote ? (day ? L("최근 주간 종가", "Last day close") : L("최근 야간 종가", "Last night quote")) : L("연결 중", "Connecting");
  const shortStamp = quote?.quote_time ? new Date(quote.quote_time * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false }) : "—";
  const compactStatus = quote?.stale ? L("지연", "Delayed") : quote?.session_state === "open" ? L("거래중", "Open") : quote ? L("마감", "Closed") : L("연결중", "Loading");
  const name = day ? L("코스피200 선물", "KOSPI 200 FUT") : L("코스피200 야간선물", "KOSPI 200 NIGHT");
  const source = day ? L("네이버 증권 주간선물 시세", "Naver day-session futures quote") : L("외부 시세 수집 원천 갱신 주기에 따라 지연될 수 있습니다", "External quotes · updates depend on the source");
  return <div className={`ng-night-quote is-${day ? "day" : "night"} is-${tone}${rising ? " is-rising" : ""}${quote?.stale ? " is-stale" : ""}`} role="group" aria-label={day ? L("코스피200 주간선물 시세", "KOSPI 200 day futures") : L("코스피200 야간선물 외부 시세", "KOSPI 200 night futures")} title={`${source} · ${stamp ?? "—"} KST · ${status}`}>
    <span className="ng-night-label"><span className="ng-night-dot" aria-hidden="true" />{name}</span>
    <small className="ng-night-time">{shortStamp}</small>
    <span className="ng-night-values"><strong>{quote?.close != null ? quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong><b>{change != null ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(2)}%` : "—"}</b></span>
    <span className="ng-night-state">{compactStatus}</span>
  </div>;
}
