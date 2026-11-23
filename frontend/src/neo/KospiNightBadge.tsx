import { useLanguage } from "../i18n/LanguageContext";
import { useOpenKospiQuote } from "../useKospiNight";
import "./kospiNight.css";

export default function KospiNightBadge() {
  const active = useOpenKospiQuote();
  const { lang } = useLanguage();
  if (!active) return null;

  const { session, quote } = active;
  const day = session === "day";
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const change = quote.change_pct;
  const tone = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const live = !quote.stale;
  const rising = live && change != null && change > 0;
  const stamp = new Date(quote.quote_time * 1000);
  const date = stamp.toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const shortStamp = stamp.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false });
  const status = quote.stale ? L("수집 지연", "Delayed") : L("거래중", "Open");
  const name = day ? L("코스피200 선물", "KOSPI 200 FUT") : L("코스피200 야간선물", "KOSPI 200 NIGHT");
  const source = day ? L("네이버 증권 주간선물 시세", "Naver day-session futures quote") : L("외부 시세 수집 원천 갱신 주기에 따라 지연될 수 있습니다", "External quotes · updates depend on the source");
  return <div className={`ng-night-quote is-${session} is-${tone}${rising ? " is-rising" : ""}${quote.stale ? " is-stale" : ""}${live ? " is-live" : ""}`} role="group" aria-label={day ? L("코스피200 주간선물 시세", "KOSPI 200 day futures") : L("코스피200 야간선물 외부 시세", "KOSPI 200 night futures")} title={`${source} · ${date} KST · ${status}`}>
    <span className="ng-night-label"><span className="ng-night-dot" aria-hidden="true" />{name}</span>
    <time className="ng-night-time" dateTime={stamp.toISOString()}>{shortStamp}</time>
    <span className="ng-night-values"><strong>{quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><b>{change != null ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(2)}%` : "—"}</b></span>
    <span className="ng-night-state">{live && <i className="ng-live-led" role="img" aria-label={L("거래 중", "Trading")} />}{status}</span>
  </div>;
}
