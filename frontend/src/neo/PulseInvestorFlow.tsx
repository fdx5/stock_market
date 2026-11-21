import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IndexQuote, MarketInvestorSummary } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useFxLevel } from "./settings";
import { FLOW_DURATION_MS, flowIsFresh, flowValuesAt, flowMicroValuesAt, investorWon, sameAmounts, type FlowAmounts, type FlowTransition } from "./investorFlowMotion";
import "./pulseInvestorFlow.css";

const format = (value: number) => Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
const signed = (value: number) => `${value < 0 ? "−" : value > 0 ? "+" : ""}${format(value)}`;
/** Readable at a glance: 1조 5,381억 (ko) or 1.54tn / 953.3bn (en) instead of thirteen digits of won. */
export function compactWon(value: number, ko: boolean) {
  const abs = Math.abs(value);
  if (ko) {
    const eok = Math.round(abs / 1e8), jo = Math.floor(eok / 10000), rest = eok % 10000;
    if (eok === 0) return `${Math.round(abs / 1e4).toLocaleString("en-US")}만`;
    return jo ? `${jo}조${rest ? ` ${rest.toLocaleString("en-US")}억` : ""}` : `${rest.toLocaleString("en-US")}억`;
  }
  return abs >= 1e12 ? `${(abs / 1e12).toFixed(2)}tn` : abs >= 1e9 ? `${(abs / 1e9).toFixed(1)}bn` : `${(abs / 1e6).toFixed(0)}m`;
}
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

const RollingAmount = memo(function RollingAmount({ value, animate, ko }: { value: number; animate: boolean; ko: boolean }) {
  const last = useRef(value);
  const direction = Math.abs(value) - Math.abs(last.current);
  useLayoutEffect(() => { last.current = value; }, [value]);
  const characters = compactWon(value, ko).split("");
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return <span className="pif-amount" aria-label={`${sign}${compactWon(value, ko)}${ko ? " 원" : " KRW"}`}>
    <span className="pif-sign" aria-hidden="true">{value < 0 ? "−" : value > 0 ? "+" : ""}</span>
    <span className="pif-places" aria-hidden="true">{characters.map((digit, index) => !/[0-9]/.test(digit)
      ? <span className={digit === "," || digit === "." ? "pif-comma" : "pif-unit"} key={characters.length - index}>{digit === " " ? " " : digit}</span>
      : <RollingDigit key={characters.length - index} digit={digit} direction={direction} animate={animate} />)}</span>
    <small aria-hidden="true">{ko ? "원" : "KRW"}</small>
  </span>;
});

export default function PulseInvestorFlow({ market, source, quote, inline = false }: {
  market: "kospi" | "kosdaq"; source: MarketInvestorSummary | null; quote: IndexQuote | null; inline?: boolean;
}) {
  const { lang } = useLanguage(), L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const fx = useFxLevel();
  const [paused, setPaused] = useState(false), [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [display, setDisplay] = useState<FlowAmounts | null>(() => investorWon(source));
  const [mode, setMode] = useState<Mode>("loading");
  const [acceptedSource, setAcceptedSource] = useState(source);
  const visible = useRef(display), latest = useRef({ source, quote });
  latest.current = { source, quote };
  const wake = useRef<() => void>(() => {});
  const cycle = useRef<{ source: MarketInvestorSummary; target: FlowAmounts; change: FlowAmounts; transition: FlowTransition; direction: number } | null>(null);
  const still = paused || reduced || fx === "minimal";

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const publish = (values: FlowAmounts | null) => {
      if (!sameAmounts(visible.current, values)) { visible.current = values; setDisplay(values); }
    };
    let timer = 0;
    const tick = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const { source, quote } = latest.current;
      const target = investorWon(source), time = Date.now();
      const currentFresh = flowIsFresh(source, quote, time);
      const moving = !still && currentFresh && !!target && target.some(value => value !== 0);
      if (moving && target && source) {
        const last = cycle.current;
        if (!last || last.source.business_date !== source.business_date || time - last.transition.startedAt >= FLOW_DURATION_MS) {
          const sameDay = last?.source.business_date === source.business_date;
          const change = sameDay && last ? target.map((value, index) => value - last.target[index]) as FlowAmounts : [0, 0, 0] as FlowAmounts;
          cycle.current = { source, target, change: sameAmounts(change, [0, 0, 0]) && last && sameDay ? last.change : change,
            transition: { from: sameDay && visible.current ? visible.current : target, to: target, startedAt: time }, direction: quote?.change_pct ?? 0 };
          setAcceptedSource(source);
        }
        const active = cycle.current!;
        publish(flowMicroValuesAt(flowValuesAt(active.transition, time), active.change, active.transition.startedAt, time, active.direction));
      } else {
        cycle.current = null;
        publish(target);
        setAcceptedSource(source);
      }
      if (!target) setMode("loading");
      else
      setMode(quote?.market_status && quote.market_status !== "OPEN" ? "closed"
        : !currentFresh ? "delayed" : still ? "paused" : moving ? "flowing" : "waiting");
      timer = window.setTimeout(tick, moving ? 120 : 1000);
    };
    const visibility = () => {
      clearTimeout(timer);
      // Resume at the received amount; never replay movements missed in another tab.
      cycle.current = null;
      if (!document.hidden) { publish(investorWon(latest.current.source)); tick(); }
    };
    wake.current = tick;
    tick();
    document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(timer); wake.current = () => {}; document.removeEventListener("visibilitychange", visibility); };
  }, [still]);
  useEffect(() => { wake.current(); }, [source, quote]);

  const labels = [L("개인", "Individuals"), L("외국인", "Foreign"), L("기관", "Institutions")];
  const statuses: Record<Mode, string> = {
    loading: L("연결 중", "Connecting"), waiting: L("수급 대기", "Awaiting flow"), flowing: L("흐름 연출 중", "Visual flow"),
    closed: L("장 마감", "Market closed"), delayed: L("수신 지연", "Delayed"), paused: L("움직임 멈춤", "Motion paused"),
  };
  const actual = investorWon(acceptedSource);
  return <section className={`pif-panel${inline ? " pif-panel--inline" : ""}`} data-market={market} data-mode={mode} data-still={still} aria-label={L("투자자별 순매수·순매도 금액", "Investor net buying and selling")}>
    <div className="pif-content">
      <header className="pif-head"><div><span className="pif-kicker">{market.toUpperCase()}{!inline && <> <i /> MONEY FLOW</>}</span><h2>{L("돈의 흐름", "Money in motion")}</h2></div>
        <div className="pif-controls"><button type="button" onClick={() => setPaused(value => !value)} aria-pressed={paused} disabled={reduced || fx === "minimal"} aria-label={paused ? L("숫자 흐름 켜기", "Play number motion") : L("숫자 흐름 멈추기", "Pause number motion")} title={`${statuses[mode]} · ${L("숫자 움직임 켜기·끄기", "Toggle visual number motion")}`}><span aria-hidden="true">{still ? "▶" : "Ⅱ"}</span></button></div>
      </header>
      <div className="pif-rows">{labels.map((label, index) => {
        const value = display?.[index], tone = value == null || value === 0 ? "flat" : value > 0 ? "buy" : "sell";
        return <div className="pif-row" data-tone={tone} key={index} title={actual ? `${L("최근 수신 순매수·순매도", "Latest received net flow")}: ${signed(actual[index])} KRW` : undefined}>
          <div className="pif-row-label"><span>{label}</span><small>{value == null ? "—" : value > 0 ? L("순매수", "Net buy") : value < 0 ? L("순매도", "Net sell") : L("중립", "Flat")}</small><i className="pif-trace" aria-hidden="true"><svg viewBox="0 0 96 16"><path d="M0 10 Q8 10 12 8 T24 8 T36 5 T48 9 T60 6 T72 7 T84 4 T96 5" /></svg></i></div>
          {value == null ? <span className="pif-empty">—</span> : <RollingAmount value={value} animate={!still && mode === "flowing"} ko={lang === "ko"} />}
        </div>;
      })}</div>
    </div>
  </section>;
}
