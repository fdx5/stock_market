import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IndexQuote, MarketInvestorSummary } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useFxLevel } from "./settings";
import { FLOW_DURATION_MS, flowIsFresh, flowValuesAt, investorWon, sameAmounts, type FlowAmounts, type FlowTransition } from "./investorFlowMotion";
import "./pulseInvestorFlow.css";

const format = (value: number) => Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
const signed = (value: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${format(value)}`;
type Mode = "loading" | "waiting" | "flowing" | "closed" | "delayed" | "paused";

/** Only a changed place rolls. Stable keys count from the units place. */
const RollingDigit = memo(function RollingDigit({ digit, direction, animate }: { digit: string; direction: number; animate: boolean }) {
  const previous = useRef(digit), reel = useRef<HTMLSpanElement>(null);
  const before = previous.current, rising = direction >= 0;
  useLayoutEffect(() => {
    previous.current = digit;
    if (before === digit || !animate || !reel.current) return;
    const animation = reel.current.animate([
      { transform: rising ? "translateY(0)" : "translateY(-50%)" },
      { transform: rising ? "translateY(-50%)" : "translateY(0)" },
    ], { duration: 115, easing: "cubic-bezier(.2,.65,.35,1)" });
    return () => animation.cancel();
  }, [digit, animate, before, rising]);
  return <span className="pif-digit"><span ref={reel} className="pif-reel" style={{ transform: rising ? "translateY(-50%)" : "translateY(0)" }}>
    <span>{rising ? before : digit}</span><span>{rising ? digit : before}</span>
  </span></span>;
}, (a, b) => a.digit === b.digit && a.animate === b.animate);

const RollingAmount = memo(function RollingAmount({ value, animate }: { value: number; animate: boolean }) {
  const last = useRef(value);
  const direction = Math.abs(value) - Math.abs(last.current);
  useLayoutEffect(() => { last.current = value; }, [value]);
  const characters = format(value).split("");
  return <span className="pif-amount" aria-label={`${signed(value)} 원`}>
    <span className="pif-sign" aria-hidden="true">{value < 0 ? "−" : value > 0 ? "+" : ""}</span>
    <span className="pif-places" aria-hidden="true">{characters.map((digit, index) => digit === ","
      ? <span className="pif-comma" key={characters.length - index}>,</span>
      : <RollingDigit key={characters.length - index} digit={digit} direction={direction} animate={animate} />)}</span>
    <small aria-hidden="true">원</small>
  </span>;
});

export default function PulseInvestorFlow({ market, source, quote }: {
  market: "kospi" | "kosdaq"; source: MarketInvestorSummary | null; quote: IndexQuote | null;
}) {
  const { lang } = useLanguage(), L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const fx = useFxLevel();
  const [paused, setPaused] = useState(false), [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [display, setDisplay] = useState<FlowAmounts | null>(() => investorWon(source));
  const [mode, setMode] = useState<Mode>("loading");
  const visible = useRef(display), previous = useRef<{ values: FlowAmounts; date?: string; fetched: number } | null>(null);
  const transition = useRef<FlowTransition | null>(null);
  const still = paused || reduced || fx === "minimal";

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const target = investorWon(source), now = Date.now();
    const fresh = flowIsFresh(source, quote, now), last = previous.current;
    const publish = (values: FlowAmounts | null) => {
      if (!sameAmounts(visible.current, values)) { visible.current = values; setDisplay(values); }
    };
    if (!target) { transition.current = null; publish(null); setMode("loading"); return; }
    const changed = !sameAmounts(last?.values ?? null, target);
    if (!still && fresh && !document.hidden && changed && last && last.date === source?.business_date
      && now - last.fetched <= 30_000 && visible.current) {
      transition.current = { from: visible.current, to: target, startedAt: now };
    } else if (changed || still || !fresh) {
      transition.current = null;
      publish(target);
    }
    previous.current = { values: target, date: source?.business_date, fetched: (source?.fetched_at ?? 0) * 1000 };
    let timer = 0;
    const tick = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const time = Date.now(), currentFresh = flowIsFresh(source, quote, time);
      const motion = transition.current;
      const moving = !still && currentFresh && !!motion && time - motion.startedAt < FLOW_DURATION_MS;
      publish(moving ? flowValuesAt(motion!, time) : target);
      if (!moving) transition.current = null;
      setMode(quote?.market_status && quote.market_status !== "OPEN" ? "closed"
        : !currentFresh ? "delayed" : still ? "paused" : moving ? "flowing" : "waiting");
      timer = window.setTimeout(tick, moving ? 120 : 1000);
    };
    const visibility = () => {
      clearTimeout(timer);
      // Resume at the received amount; never replay movements missed in another tab.
      transition.current = null;
      if (!document.hidden) { publish(target); tick(); }
    };
    tick();
    document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [source, quote, still]);

  const labels = [L("개인", "Individuals"), L("외국인", "Foreign"), L("기관", "Institutions")];
  const statuses: Record<Mode, string> = {
    loading: L("연결 중", "Connecting"), waiting: L("다음 수급 대기", "Awaiting change"), flowing: L("수급 흐르는 중", "Flowing"),
    closed: L("장 마감", "Market closed"), delayed: L("수신 지연", "Delayed"), paused: L("움직임 멈춤", "Motion paused"),
  };
  const stamp = source?.fetched_at ? new Date(source.fetched_at * 1000).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", hour12: false }) : "—";
  const actual = investorWon(source);
  return <section className="pif-panel" data-mode={mode} data-still={still} aria-label={L("투자자별 순매수·순매도 금액", "Investor net buying and selling")}>
    <div className="pif-content">
      <header className="pif-head"><div><span className="pif-kicker">{market.toUpperCase()} <i /> MONEY FLOW</span><h2>{L("돈의 흐름", "Money in motion")}</h2></div>
        <div className="pif-controls"><span className="pif-status"><i />{statuses[mode]}</span><button type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused} disabled={reduced || fx === "minimal"} aria-label={paused ? L("숫자 흐름 켜기", "Play number motion") : L("숫자 흐름 멈추기", "Pause number motion")} title={L("숫자 움직임 켜기·끄기", "Toggle number motion")}>{still ? "▶" : "Ⅱ"}</button></div>
      </header>
      <div className="pif-rows">{labels.map((label, index) => {
        const value = display?.[index], tone = value == null || value === 0 ? "flat" : value > 0 ? "buy" : "sell";
        return <div className="pif-row" data-tone={tone} key={index} title={actual ? `${L("최근 수신 순매수·순매도", "Latest received net flow")}: ${signed(actual[index])} KRW` : undefined}>
          <div className="pif-row-label"><span>{label}</span><small>{value == null ? "—" : value > 0 ? L("순매수", "Net buy") : value < 0 ? L("순매도", "Net sell") : L("중립", "Flat")}</small><i className="pif-trace" aria-hidden="true"><svg viewBox="0 0 96 16"><path d="M0 10 Q8 10 12 8 T24 8 T36 5 T48 9 T60 6 T72 7 T84 4 T96 5" /></svg></i></div>
          {value == null ? <span className="pif-empty">—</span> : <RollingAmount value={value} animate={!still && mode === "flowing"} />}
        </div>;
      })}</div>
      <footer className="pif-foot"><span>{L("10초 연동 · 원 단위 보간 연출", "10s sync · interpolated KRW digits")}</span><span>{L("수신", "Received")} {stamp} <span className="pif-zone">KST</span></span></footer>
      <p className="pif-explain">{L("순매수·순매도 원본은 억원 단위입니다. 원 단위 숫자는 수신값 사이의 연출이며 실제 체결 금액이 아닙니다.", "Source net amounts are rounded to KRW 100M. Interpolated digits between received values are visual motion, not individual trades.")}</p>
    </div>
  </section>;
}
