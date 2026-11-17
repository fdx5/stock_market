import { useEffect, useState } from "react";
import { api, type NasdaqFuturesQuote, type NasdaqFuturesQuotes } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./kospiNight.css";

function preserve(old: NasdaqFuturesQuote | null, next: NasdaqFuturesQuote | null): NasdaqFuturesQuote | null {
  return old && (!next || next.quote_time < old.quote_time) ? { ...old, stale: true } : next;
}

export default function NasdaqFuturesBadges() {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [quotes, setQuotes] = useState<NasdaqFuturesQuotes>({ day: null, night: null });
  useEffect(() => {
    let cancelled = false, inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      api.nasdaqFutures().then(next => {
        if (!cancelled) setQuotes(old => ({ day: preserve(old.day, next.day), night: preserve(old.night, next.night) }));
      }).catch(() => {
        if (!cancelled) setQuotes(old => ({ day: old.day && { ...old.day, stale: true }, night: old.night && { ...old.night, stale: true } }));
      }).finally(() => { inFlight = false; });
    };
    load();
    const stop = startVisibilityAwareInterval(load, 10_000);
    return () => { cancelled = true; stop(); };
  }, []);
  return <>{(["day", "night"] as const).map(window => {
    const quote = quotes[window];
    const change = quote?.change_pct;
    const tone = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
    const name = window === "day" ? L("나스닥100 선물", "NASDAQ 100 FUT") : L("나스닥100 야간선물", "NASDAQ 100 NIGHT");
    const stamp = quote ? new Date(quote.quote_time * 1000) : null;
    const time = stamp?.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false }) ?? "—";
    const date = stamp?.toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) ?? "—";
    const basis = window === "day" ? L("미국 정규장 시간대(09:30~16:00 ET) NQ 시세 · 전회 같은 시간대 종가 대비", "NQ during US cash hours (09:30–16:00 ET) · vs. prior regular-window close") : L("같은 NQ 계약의 정규장 밖 최신 시세 · 직전 정규시간대 종가 대비", "Same NQ contract outside cash hours · vs. preceding regular-window close");
    return <div key={window} className={`ng-night-quote is-${window} is-${tone}${quote?.stale ? " is-stale" : ""}`} role="group" aria-label={name} title={`${basis} · ${date} KST · ${L("공급자 시세 지연 가능", "Feed may be delayed")}${quote?.quote_source === "yahoo_5m" ? L(" · 5분봉 종가", " · 5-minute bar close") : ""}`}>
      <span className="ng-night-label"><span className="ng-night-dot" aria-hidden="true" />{name}</span>
      <time className="ng-night-time" dateTime={stamp?.toISOString()}>{time}</time>
      <span className="ng-night-values"><strong>{quote ? quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong><b>{change != null ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(2)}%` : "—"}</b></span>
      <span className="ng-night-state">{!quote ? L("연결중", "Loading") : quote.stale ? L("수집 지연", "Delayed") : window === "day" ? L("정규시간대", "Cash hours") : L("야간 시세", "Overnight")}</span>
    </div>;
  })}</>;
}
