import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  Time,
  createChart,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IndicatorPoint } from "../../api/client";
import { PAGE_SCROLL_SAFE_CHART_OPTIONS, attachChartZoomGuard } from "../../chartScrollGuard";
import { holdChartSizeDuringResize } from "../../chartResizeHold";
import { watchTheme } from "../../theme";
import { Skel } from "../parts";
import { pct, useL } from "../lib";

/* The stock page's main chart, printed in the paper's own inks.
 *
 * Candles, volume, four moving averages and the Bollinger band — the instrument the
 * classic PriceChart was — but coloured from the page's design tokens rather than
 * the site-wide chart palette, so it sits on newsprint as a printed chart would and
 * follows the 주간판/야간판 switch. Canvas cannot read CSS variables, so the tokens
 * are resolved from the computed style and re-applied whenever the theme flips.
 *
 * The legend above the chart is the reading line: hovering a session sets it to
 * that day; otherwise it describes the last one. */

type Overlay = "sma5" | "sma20" | "sma60" | "sma120" | "bb";

const RANGES: { key: string; days: number | null }[] = [
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "6M", days: 183 },
  { key: "1Y", days: 366 },
  { key: "3Y", days: null },
];

interface Ink {
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  up: string;
  down: string;
  brass: string;
  paper: string;
}

function readInk(): Ink {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#16140e"),
    ink2: v("--ink-2", "#48443a"),
    ink3: v("--ink-3", "#7f7969"),
    rule: v("--rule", "rgba(0,0,0,.12)"),
    up: v("--up", "#b93227"),
    down: v("--down", "#1d4f9e"),
    brass: v("--brass", "#946313"),
    paper: v("--p0", "#efeadd"),
  };
}

/** A hex colour with alpha, for the volume bars — the tokens are opaque. */
function alpha(color: string, a: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const n = Math.round(a * 255).toString(16).padStart(2, "0");
    return `${color}${n}`;
  }
  return color;
}

const MA_STYLE: Record<Exclude<Overlay, "bb">, { key: keyof IndicatorPoint; width: 1 | 2; dash: 0 | 2; ink: keyof Ink }> = {
  sma5: { key: "sma5", width: 1, dash: 0, ink: "brass" },
  sma20: { key: "sma20", width: 2, dash: 0, ink: "ink" },
  sma60: { key: "sma60", width: 1, dash: 2, ink: "ink2" },
  sma120: { key: "sma120", width: 1, dash: 2, ink: "ink3" },
};

interface Readout {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev: number | null;
  volume: number;
}

export default function StockChart({ points, currency }: { points: IndicatorPoint[]; currency: "KRW" | "USD" }) {
  const L = useL();
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRefs = useRef<Partial<Record<string, ISeriesApi<"Line">>>>({});
  const [range, setRange] = useState("6M");
  const [shown, setShown] = useState<Set<Overlay>>(new Set(["sma5", "sma20", "sma60"]));
  const [hover, setHover] = useState<Readout | null>(null);
  const precision = currency === "KRW" ? 0 : 2;
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });

  const byDate = useMemo(() => {
    const m = new Map<string, { i: number; p: IndicatorPoint }>();
    points.forEach((p, i) => m.set(p.date, { i, p }));
    return m;
  }, [points]);

  /* Build the chart once. */
  useEffect(() => {
    if (!box.current) return;
    const ink = readInk();
    const chart = createChart(box.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink.ink3, fontFamily: '"IBM Plex Sans Condensed", Pretendard, sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: ink.rule } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderColor: ink.ink, tickMarkFormatter: (t: Time) => (typeof t === "string" ? t.slice(5).replace("-", ".") : String(t)) },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: ink.ink3, labelBackgroundColor: ink.ink }, horzLine: { color: ink.ink3, labelBackgroundColor: ink.ink } },
      localization: { dateFormat: "yyyy.MM.dd" },
      autoSize: true,
      ...PAGE_SCROLL_SAFE_CHART_OPTIONS,
    });
    const releaseHold = holdChartSizeDuringResize(chart);
    const releaseGuard = attachChartZoomGuard(box.current, chart);
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: ink.up,
      downColor: ink.down,
      borderUpColor: ink.up,
      borderDownColor: ink.down,
      wickUpColor: ink.up,
      wickDownColor: ink.down,
      priceFormat: { type: "price", precision, minMove: precision ? 0.01 : 1 },
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.2 } });
    const lines: Partial<Record<string, ISeriesApi<"Line">>> = {};
    (Object.keys(MA_STYLE) as (keyof typeof MA_STYLE)[]).forEach((k) => {
      const st = MA_STYLE[k];
      lines[k] = chart.addSeries(LineSeries, { color: ink[st.ink], lineWidth: st.width, lineStyle: st.dash, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });
    lines.bbu = chart.addSeries(LineSeries, { color: alpha(ink.brass, 0.7), lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    lines.bbl = chart.addSeries(LineSeries, { color: alpha(ink.brass, 0.7), lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    lineRefs.current = lines;

    const stopTheme = watchTheme(() => {
      // The tokens change with data-theme on the next style pass.
      requestAnimationFrame(() => {
        const next = readInk();
        chart.applyOptions({
          layout: { textColor: next.ink3 },
          grid: { horzLines: { color: next.rule } },
          timeScale: { borderColor: next.ink },
          crosshair: { vertLine: { color: next.ink3, labelBackgroundColor: next.ink }, horzLine: { color: next.ink3, labelBackgroundColor: next.ink } },
        });
        candle.applyOptions({ upColor: next.up, downColor: next.down, borderUpColor: next.up, borderDownColor: next.down, wickUpColor: next.up, wickDownColor: next.down });
        (Object.keys(MA_STYLE) as (keyof typeof MA_STYLE)[]).forEach((k) => lines[k]?.applyOptions({ color: next[MA_STYLE[k].ink] }));
        lines.bbu?.applyOptions({ color: alpha(next.brass, 0.7) });
        lines.bbl?.applyOptions({ color: alpha(next.brass, 0.7) });
        paintVolume();
      });
    });

    return () => {
      stopTheme();
      releaseGuard();
      releaseHold();
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precision]);

  const paintVolume = () => {
    const ink = readInk();
    volumeRef.current?.setData(
      points.map((p, i) => ({
        time: p.date as Time,
        value: p.volume,
        color: alpha(p.close >= (points[i - 1]?.close ?? p.open) ? ink.up : ink.down, 0.35),
      }))
    );
  };

  /* Feed it. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    candleRef.current?.setData(points.map((p) => ({ time: p.date as Time, open: p.open, high: p.high, low: p.low, close: p.close })));
    paintVolume();
    (Object.keys(MA_STYLE) as (keyof typeof MA_STYLE)[]).forEach((k) => {
      const key = MA_STYLE[k].key;
      lineRefs.current[k]?.setData(points.filter((p) => p[key] != null).map((p) => ({ time: p.date as Time, value: p[key] as number })));
    });
    lineRefs.current.bbu?.setData(points.filter((p) => p.bb_upper != null).map((p) => ({ time: p.date as Time, value: p.bb_upper as number })));
    lineRefs.current.bbl?.setData(points.filter((p) => p.bb_lower != null).map((p) => ({ time: p.date as Time, value: p.bb_lower as number })));

    const onMove = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      if (!param.point || param.time === undefined || !candleRef.current) return setHover(null);
      const bar = param.seriesData.get(candleRef.current) as CandlestickData<Time> | undefined;
      const hit = byDate.get(String(param.time));
      if (!bar || !hit) return setHover(null);
      setHover({ date: String(param.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close, prev: points[hit.i - 1]?.close ?? null, volume: hit.p.volume });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, byDate]);

  /* Visible window. */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    const days = RANGES.find((r) => r.key === range)?.days;
    if (!days) {
      chart.timeScale().fitContent();
      return;
    }
    const last = new Date(points[points.length - 1].date);
    const from = new Date(last);
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    chart.timeScale().setVisibleRange({ from: fromStr as Time, to: points[points.length - 1].date as Time });
  }, [range, points]);

  /* Overlay visibility. */
  useEffect(() => {
    (Object.keys(MA_STYLE) as (keyof typeof MA_STYLE)[]).forEach((k) => lineRefs.current[k]?.applyOptions({ visible: shown.has(k) }));
    lineRefs.current.bbu?.applyOptions({ visible: shown.has("bb") });
    lineRefs.current.bbl?.applyOptions({ visible: shown.has("bb") });
  }, [shown, points]);

  const last = points[points.length - 1];
  const reading: Readout | null =
    hover ??
    (last ? { date: last.date, open: last.open, high: last.high, low: last.low, close: last.close, prev: points[points.length - 2]?.close ?? null, volume: last.volume } : null);
  const chg = reading && reading.prev ? ((reading.close - reading.prev) / reading.prev) * 100 : null;

  const toggle = (o: Overlay) =>
    setShown((s) => {
      const n = new Set(s);
      if (n.has(o)) n.delete(o);
      else n.add(o);
      return n;
    });

  const overlays: { id: Overlay; label: string }[] = [
    { id: "sma5", label: L("5일", "5D") },
    { id: "sma20", label: L("20일", "20D") },
    { id: "sma60", label: L("60일", "60D") },
    { id: "sma120", label: L("120일", "120D") },
    { id: "bb", label: L("볼린저", "Bollinger") },
  ];

  return (
    <figure className="sk-chart">
      <div className="sk-chart-bar">
        <div className="sk-chart-read" aria-live="polite">
          {reading ? (
            <>
              <time>{reading.date.replace(/-/g, ".")}</time>
              <span>
                {L("시", "O")} <b>{fmt(reading.open)}</b>
              </span>
              <span>
                {L("고", "H")} <b className="is-up">{fmt(reading.high)}</b>
              </span>
              <span>
                {L("저", "L")} <b className="is-down">{fmt(reading.low)}</b>
              </span>
              <span>
                {L("종", "C")} <b>{fmt(reading.close)}</b>
              </span>
              {chg != null && <b className={chg > 0 ? "is-up" : chg < 0 ? "is-down" : ""}>{pct(chg)}</b>}
              <span>
                {L("거래량", "Vol")} <b>{reading.volume.toLocaleString()}</b>
              </span>
            </>
          ) : (
            <Skel w={320} h={14} />
          )}
        </div>
        <div className="sk-chart-tools">
          <div className="sk-seg" role="group" aria-label={L("기간", "Range")}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" className={range === r.key ? "is-on" : ""} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                {r.key}
              </button>
            ))}
          </div>
          <div className="sk-seg sk-seg--keys" role="group" aria-label={L("보조선", "Overlays")}>
            {overlays.map((o) => (
              <button key={o.id} type="button" className={`is-${o.id} ${shown.has(o.id) ? "is-on" : ""}`} aria-pressed={shown.has(o.id)} onClick={() => toggle(o.id)}>
                <i aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sk-chart-canvas" ref={box}>
        {points.length === 0 && <Skel h={380} className="sk-chart-skel" />}
      </div>
      <figcaption>
        {L("▲ 봉은 일간 시가·고가·저가·종가, 아래 막대는 거래량. 드래그로 기간 이동, Ctrl+휠로 확대.", "▲ Daily candles with volume below. Drag to pan, Ctrl+wheel to zoom.")}
      </figcaption>
    </figure>
  );
}
