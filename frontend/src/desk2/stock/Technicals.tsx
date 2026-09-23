import type { IndicatorPoint } from "../../api/client";
import { Spark } from "../parts";
import { pct, toneOf, useL } from "../lib";

/* 기술 지표 — what the numbers under the chart say, set as a table a person can read.
 *
 * The classic page printed these as a grid of tiles, each a figure with no scale:
 * "RSI 61.3" means nothing until you know where 30 and 70 are. Here every reading
 * carries its own scale or its own reference — RSI on a 0–100 rule with the two
 * thresholds marked, the MACD histogram as the last sixty sessions of bars, each
 * moving average as the distance of today's close from it — and a plain-language
 * state next to it. Descriptive throughout: what the indicator reads, not what to do. */

export interface PeriodReturn {
  key: string;
  ko: string;
  en: string;
  value: number | null;
  /** The benchmark's return over the same sessions, when there is one. */
  bench: number | null;
}

/** Returns over the windows a reader asks about, from the daily closes. */
export function periodReturns(points: IndicatorPoint[], bench: IndicatorPoint[] | null): PeriodReturn[] {
  const windows = [
    { key: "1w", ko: "1주", en: "1W", n: 5 },
    { key: "1m", ko: "1개월", en: "1M", n: 21 },
    { key: "3m", ko: "3개월", en: "3M", n: 63 },
    { key: "6m", ko: "6개월", en: "6M", n: 126 },
    { key: "1y", ko: "1년", en: "1Y", n: 252 },
  ];
  const ret = (series: IndicatorPoint[], n: number) => {
    if (series.length <= n) return null;
    const last = series[series.length - 1].close;
    const then = series[series.length - 1 - n].close;
    return then ? (last / then - 1) * 100 : null;
  };
  const ytd = (series: IndicatorPoint[]) => {
    if (series.length === 0) return null;
    const year = series[series.length - 1].date.slice(0, 4);
    const prior = [...series].reverse().find((p) => p.date.slice(0, 4) < year);
    return prior ? (series[series.length - 1].close / prior.close - 1) * 100 : null;
  };
  const out: PeriodReturn[] = windows.map((w) => ({ key: w.key, ko: w.ko, en: w.en, value: ret(points, w.n), bench: bench ? ret(bench, w.n) : null }));
  out.push({ key: "ytd", ko: "연초 이후", en: "YTD", value: ytd(points), bench: bench ? ytd(bench) : null });
  return out;
}

export function Returns({ items, benchName }: { items: PeriodReturn[]; benchName: string | null }) {
  const L = useL();
  const span = Math.max(1, ...items.map((i) => Math.abs(i.value ?? 0)));
  return (
    <div className="sk-returns">
      <table>
        <thead>
          <tr>
            <th>{L("기간", "Period")}</th>
            <th>{L("수익률", "Return")}</th>
            <th aria-hidden="true" />
            {benchName && <th>{benchName}</th>}
            {benchName && <th>{L("상대", "Relative")}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const rel = r.value != null && r.bench != null ? r.value - r.bench : null;
            const w = r.value == null ? 0 : (Math.abs(r.value) / span) * 50;
            return (
              <tr key={r.key}>
                <th scope="row">{L(r.ko, r.en)}</th>
                <td className={`d2-num is-${toneOf(r.value)}`}>{pct(r.value)}</td>
                <td className="sk-returns-bar" aria-hidden="true">
                  <i className="sk-mid" />
                  {r.value != null && <i className={`sk-fill is-${toneOf(r.value)}`} style={r.value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />}
                </td>
                {benchName && <td className={`d2-num is-${toneOf(r.bench)}`}>{pct(r.bench)}</td>}
                {benchName && <td className={`d2-num sk-rel is-${toneOf(rel)}`}>{rel == null ? "—" : `${rel > 0 ? "+" : rel < 0 ? "−" : ""}${Math.abs(rel).toFixed(2)}%p`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RangeBar({ low, high, now, fmt }: { low: number; high: number; now: number; fmt: (v: number) => string }) {
  const L = useL();
  const pos = high > low ? Math.min(100, Math.max(0, ((now - low) / (high - low)) * 100)) : 50;
  return (
    <div className="sk-range">
      <div className="sk-range-head">
        <span>{L("52주 범위", "52-week range")}</span>
        <b>{pos.toFixed(0)}%</b>
      </div>
      <div className="sk-range-track" role="img" aria-label={`${fmt(low)} — ${fmt(high)}, ${pos.toFixed(0)}%`}>
        <i style={{ left: `${pos}%` }} />
      </div>
      <div className="sk-range-ends">
        <span>
          {L("저", "L")} {fmt(low)}
        </span>
        <span>
          {L("고", "H")} {fmt(high)}
        </span>
      </div>
    </div>
  );
}

function state(label: string, tone: "up" | "down" | "flat" | "warn" = "flat") {
  return <em className={`sk-state is-${tone}`}>{label}</em>;
}

export default function Technicals({ points, currency }: { points: IndicatorPoint[]; currency: "KRW" | "USD" }) {
  const L = useL();
  const latest = points[points.length - 1];
  if (!latest) return null;
  const tail = points.slice(-60);
  const money = (v: number) => (currency === "KRW" ? `${Math.round(v).toLocaleString()}${L("원", " KRW")}` : `$${v.toFixed(2)}`);

  const rsi = latest.rsi14;
  const rsiState =
    rsi == null ? state(L("산출 대기", "pending")) : rsi >= 70 ? state(L("과열권", "overbought"), "up") : rsi <= 30 ? state(L("침체권", "oversold"), "down") : state(L("중립", "neutral"));

  const hist = latest.macd_hist;
  const prevHist = points[points.length - 2]?.macd_hist ?? null;
  const macdState =
    hist == null
      ? state(L("산출 대기", "pending"))
      : hist > 0
        ? state(prevHist != null && prevHist <= 0 ? L("양전환", "turned positive") : L("시그널 상회", "above signal"), "up")
        : state(prevHist != null && prevHist >= 0 ? L("음전환", "turned negative") : L("시그널 하회", "below signal"), "down");

  const bandPos =
    latest.bb_upper != null && latest.bb_lower != null && latest.bb_upper > latest.bb_lower ? ((latest.close - latest.bb_lower) / (latest.bb_upper - latest.bb_lower)) * 100 : null;
  const bandWidth = latest.bb_upper != null && latest.bb_lower != null && latest.bb_mid ? ((latest.bb_upper - latest.bb_lower) / latest.bb_mid) * 100 : null;

  const gap = (ma: number | null) => (ma ? (latest.close / ma - 1) * 100 : null);
  const mas = [
    { ko: "5일선", en: "5-day MA", v: latest.sma5 },
    { ko: "20일선", en: "20-day MA", v: latest.sma20 },
    { ko: "60일선", en: "60-day MA", v: latest.sma60 },
    { ko: "120일선", en: "120-day MA", v: latest.sma120 },
  ];
  const arrangement =
    latest.sma5 != null && latest.sma20 != null && latest.sma60 != null
      ? latest.sma5 > latest.sma20 && latest.sma20 > latest.sma60
        ? state(L("정배열", "bullish order"), "up")
        : latest.sma5 < latest.sma20 && latest.sma20 < latest.sma60
          ? state(L("역배열", "bearish order"), "down")
          : state(L("혼조", "mixed"))
      : state(L("산출 대기", "pending"));

  const volRatio = latest.volume_ma20 ? (latest.volume / latest.volume_ma20) * 100 : null;
  const vol = latest.volatility20 != null ? latest.volatility20 * 100 : null;
  const obv20 = points.length > 20 && latest.obv != null && points[points.length - 21].obv != null ? latest.obv - (points[points.length - 21].obv as number) : null;

  return (
    <div className="sk-tech">
      <div className="sk-tech-gauges">
        <section>
          <h4>
            RSI 14 {rsiState}
          </h4>
          <div className="sk-rsi">
            <b className="d2-num">{rsi == null ? "—" : rsi.toFixed(1)}</b>
            <div className="sk-rsi-rule" aria-hidden="true">
              <i className="sk-rsi-zone is-low" />
              <i className="sk-rsi-zone is-high" />
              {rsi != null && <i className="sk-rsi-mark" style={{ left: `${rsi}%` }} />}
              <span style={{ left: "30%" }}>30</span>
              <span style={{ left: "70%" }}>70</span>
            </div>
          </div>
          <Spark points={tail.map((p) => p.rsi14 ?? NaN)} tone="flat" fill={false} baseline={50} className="sk-tech-spark" />
          <small>{L("최근 60거래일 RSI · 점선은 50", "RSI over 60 sessions · dashed line is 50")}</small>
        </section>
        <section>
          <h4>
            MACD {macdState}
          </h4>
          <div className="sk-macd-read">
            <span>
              MACD <b className="d2-num">{latest.macd?.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              {L("시그널", "Signal")} <b className="d2-num">{latest.macd_signal?.toFixed(2) ?? "—"}</b>
            </span>
            <span>
              {L("히스토그램", "Hist")} <b className={`d2-num is-${toneOf(hist)}`}>{hist?.toFixed(2) ?? "—"}</b>
            </span>
          </div>
          <MacdBars values={tail.map((p) => p.macd_hist)} />
          <small>{L("최근 60거래일 히스토그램", "Histogram over 60 sessions")}</small>
        </section>
        <section>
          <h4>
            {L("볼린저 밴드", "Bollinger band")} {bandPos == null ? state("—") : bandPos >= 90 ? state(L("상단 근접", "near upper"), "up") : bandPos <= 10 ? state(L("하단 근접", "near lower"), "down") : state(L("밴드 안", "inside"))}
          </h4>
          <div className="sk-band">
            <div className="sk-band-track" aria-hidden="true">
              {bandPos != null && <i style={{ left: `${Math.min(100, Math.max(0, bandPos))}%` }} />}
            </div>
            <div className="sk-band-ends">
              <span>{latest.bb_lower != null ? money(latest.bb_lower) : "—"}</span>
              <span>{latest.bb_mid != null ? money(latest.bb_mid) : "—"}</span>
              <span>{latest.bb_upper != null ? money(latest.bb_upper) : "—"}</span>
            </div>
          </div>
          <small>
            {L("밴드 내 위치", "Position")} {bandPos == null ? "—" : `${bandPos.toFixed(0)}%`} · {L("밴드 폭", "Width")} {bandWidth == null ? "—" : `${bandWidth.toFixed(1)}%`}
          </small>
        </section>
      </div>

      <table className="sk-tech-table">
        <tbody>
          <tr>
            <th scope="row">{L("이동평균 배열", "Moving averages")}</th>
            <td colSpan={2}>{arrangement}</td>
          </tr>
          {mas.map((m) => {
            const g = gap(m.v);
            return (
              <tr key={m.ko}>
                <th scope="row">
                  {L(m.ko, m.en)} {L("이격", "gap")}
                </th>
                <td className="d2-num">{m.v == null ? "—" : money(m.v)}</td>
                <td className={`d2-num is-${toneOf(g)}`}>{pct(g)}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row">{L("거래량 강도", "Volume vs 20D avg")}</th>
            <td className="d2-num">{volRatio == null ? "—" : `${volRatio.toFixed(0)}%`}</td>
            <td>{volRatio == null ? "" : volRatio >= 150 ? state(L("거래 급증", "heavy"), "warn") : volRatio <= 60 ? state(L("거래 한산", "light")) : state(L("평소 수준", "normal"))}</td>
          </tr>
          <tr>
            <th scope="row">{L("20일 변동성", "20D volatility")}</th>
            <td className="d2-num">{vol == null ? "—" : `${vol.toFixed(2)}%`}</td>
            <td>{vol == null ? "" : vol >= 3 ? state(L("높음", "high"), "warn") : vol >= 1.5 ? state(L("보통", "moderate")) : state(L("낮음", "low"))}</td>
          </tr>
          <tr>
            <th scope="row">ATR 14</th>
            <td className="d2-num">{latest.atr14 == null ? "—" : money(latest.atr14)}</td>
            <td className="sk-muted">{latest.atr14 != null ? `${L("종가 대비", "of close")} ${((latest.atr14 / latest.close) * 100).toFixed(2)}%` : ""}</td>
          </tr>
          <tr>
            <th scope="row">{L("OBV 20일 변화", "OBV, 20 sessions")}</th>
            <td className={`d2-num is-${toneOf(obv20)}`}>{obv20 == null ? "—" : `${obv20 > 0 ? "+" : ""}${Math.round(obv20).toLocaleString()}`}</td>
            <td>{obv20 == null ? "" : obv20 > 0 ? state(L("매수 우위 누적", "accumulation"), "up") : state(L("매도 우위 누적", "distribution"), "down")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MacdBars({ values }: { values: (number | null)[] }) {
  const clean = values.map((v) => (v == null || !Number.isFinite(v) ? 0 : v));
  const max = Math.max(1e-9, ...clean.map(Math.abs));
  const n = clean.length || 1;
  return (
    <svg className="sk-macd" viewBox={`0 0 ${n * 4} 40`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={n * 4} y1="20" y2="20" className="sk-macd-zero" vectorEffect="non-scaling-stroke" />
      {clean.map((v, i) => {
        const h = (Math.abs(v) / max) * 19;
        return <rect key={i} x={i * 4 + 0.5} width="3" y={v >= 0 ? 20 - h : 20} height={Math.max(h, 0.3)} className={v >= 0 ? "is-up" : "is-down"} />;
      })}
    </svg>
  );
}
