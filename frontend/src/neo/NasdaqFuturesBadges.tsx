import { useEffect, useState } from "react";
import { api, type NasdaqFuturesQuote, type NasdaqFuturesQuotes } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./kospiNight.css";

function preserve(old: NasdaqFuturesQuote | null, next: NasdaqFuturesQuote | null): NasdaqFuturesQuote | null {
  return old && (!next || next.quote_time < old.quote_time) ? { ...old, stale: true } : next;
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Which NQ window is trading right now: "day" = US cash hours 09:30–16:00 ET on weekdays,
 * "night" = the rest of CME Globex (Sun 18:00 – Fri 17:00 ET, minus the 17:00–18:00 break). */
export function nasdaqOpenWindow(nowMs: number): "day" | "night" | null {
  const parts = Object.fromEntries(ET_PARTS.formatToParts(new Date(nowMs)).map(part => [part.type, part.value]));
  const day = DAYS.indexOf(parts.weekday), minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (day >= 1 && day <= 5 && minute >= 570 && minute < 960) return "day";
  if (day === 6 || (day === 0 && minute < 1080) || (day === 5 && minute >= 1020)) return null;
  return minute >= 1020 && minute < 1080 ? null : "night";
}

/** A window counts as open only while the clock says so and the feed is actually printing
 * (a recent quote), which also hides the badge on exchange holidays. */
const FRESH_SECONDS = 30 * 60;

export default function NasdaqFuturesBadges({ openOnly = false }: { openOnly?: boolean }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [quotes, setQuotes] = useState<NasdaqFuturesQuotes>({ day: null, night: null });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false, inFlight = false;
    const load = () => {
      setNow(Date.now());
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
  const openWindow = nasdaqOpenWindow(now);
  const trading = (window: "day" | "night") => window === openWindow && quotes[window] != null && now / 1000 - quotes[window]!.quote_time < FRESH_SECONDS;
  const windows = (["day", "night"] as const).filter(window => !openOnly || trading(window));
  return <>{windows.map(window => {
    const quote = quotes[window];
    const change = quote?.change_pct;
    const tone = change == null ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat";
    const name = window === "day" ? L("나스닥100 선물", "NASDAQ 100 FUT") : L("나스닥100 야간선물", "NASDAQ 100 NIGHT");
    const stamp = quote ? new Date(quote.quote_time * 1000) : null;
    const time = stamp?.toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false }) ?? "—";
    const date = stamp?.toLocaleString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) ?? "—";
    const basis = window === "day" ? L("미국 정규장 시간대(09:30~16:00 ET) NQ 시세 · 전회 같은 시간대 종가 대비", "NQ during US cash hours (09:30–16:00 ET) · vs. prior regular-window close") : L("같은 NQ 계약의 정규장 밖 최신 시세 · 직전 정규시간대 종가 대비", "Same NQ contract outside cash hours · vs. preceding regular-window close");
    const live = trading(window) && !quote?.stale;
    return <div key={window} className={`ng-night-quote is-nasdaq is-${window} is-${tone}${quote?.stale ? " is-stale" : ""}${live ? " is-live" : ""}`} role="group" aria-label={name} title={`${basis} · ${date} KST · ${L("공급자 시세 지연 가능", "Feed may be delayed")}${quote?.quote_source === "yahoo_5m" ? L(" · 5분봉 종가", " · 5-minute bar close") : ""}`}>
      <span className="ng-night-label"><span className="ng-night-dot" aria-hidden="true" />{name}</span>
      <time className="ng-night-time" dateTime={stamp?.toISOString()}>{time}</time>
      <span className="ng-night-values"><strong>{quote ? quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong><b>{change != null ? `${change > 0 ? "▲ +" : change < 0 ? "▼ −" : ""}${Math.abs(change).toFixed(2)}%` : "—"}</b></span>
      <span className="ng-night-state">{live && <i className="ng-live-led" role="img" aria-label={L("거래 중", "Trading")} />}{!quote ? L("연결중", "Loading") : quote.stale ? L("수집 지연", "Delayed") : window === "day" ? L("정규시간대", "Cash hours") : L("야간 시세", "Overnight")}</span>
    </div>;
  })}</>;
}
