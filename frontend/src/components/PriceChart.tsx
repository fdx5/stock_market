import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineData,
  LineSeries,
  Time,
  createChart,
} from "lightweight-charts";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { IndicatorPoint } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { getThemeColors, watchTheme } from "../theme";
import ChartSkeleton from "./ChartSkeleton";

interface Props {
  points: IndicatorPoint[];
}

export interface PriceChartHandle {
  getChart: () => IChartApi | null;
}

const RANGE_OPTIONS: { label: string; days: number | null }[] = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: null },
];

const MA_KEYS = ["sma5", "sma20", "sma60"] as const;

// Toggleable overlay series, keyed the same as the legend chips below. "bb"
// covers both Bollinger boundary lines as one unit.
type OverlayKey = "sma5" | "sma20" | "sma60" | "bb";

interface Readout {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Points arrive as "YYYY-MM-DD" business-day strings — split directly rather than
// going through Date (which would apply local-timezone shifting) to get "MM.dd".
function formatMonthDay(time: Time): string {
  if (typeof time === "string") {
    const parts = time.split("-");
    if (parts.length === 3) return `${parts[1]}.${parts[2]}`;
  }
  return String(time);
}

const PriceChart = forwardRef<PriceChartHandle, Props>(({ points }, ref) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaSeriesRef = useRef<Partial<Record<(typeof MA_KEYS)[number], ISeriesApi<"Line">>>>({});
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const [range, setRange] = useState<string>("3M");
  const [hidden, setHidden] = useState<Set<OverlayKey>>(new Set());
  const [readout, setReadout] = useState<Readout | null>(null);
  const stateRef = useRef({ points, range });
  stateRef.current = { points, range };

  useImperativeHandle(ref, () => ({ getChart: () => chartRef.current }));

  useEffect(() => {
    if (!containerRef.current) return;
    const colors = getThemeColors();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textSecondary,
      },
      grid: {
        vertLines: { color: colors.gridline },
        horzLines: { color: colors.gridline },
      },
      rightPriceScale: { borderColor: colors.baseline },
      timeScale: { borderColor: colors.baseline, tickMarkFormatter: formatMonthDay },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { dateFormat: "MM.dd" },
      height: 380,
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: colors.textMuted,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.2 } });

    const maColors: Record<(typeof MA_KEYS)[number], string> = {
      sma5: colors.yellow,
      sma20: colors.aqua,
      sma60: colors.violet,
    };
    const smaSeries: Partial<Record<(typeof MA_KEYS)[number], ISeriesApi<"Line">>> = {};
    MA_KEYS.forEach((key) => {
      smaSeries[key] = chart.addSeries(LineSeries, {
        color: maColors[key],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    });

    const bbUpper = chart.addSeries(LineSeries, {
      color: colors.blue,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const bbLower = chart.addSeries(LineSeries, {
      color: colors.blue,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    smaSeriesRef.current = smaSeries;
    bbUpperRef.current = bbUpper;
    bbLowerRef.current = bbLower;

    // Live OHLC readout: the bar under the crosshair while hovering, cleared on
    // leave so the header falls back to the latest bar (handled in render).
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || param.time === undefined) {
        setReadout(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      if (bar && typeof bar.open === "number") {
        setReadout({ time: param.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      } else {
        setReadout(null);
      }
    });

    const stopWatching = watchTheme((next) => {
      chart.applyOptions({
        layout: { textColor: next.textSecondary },
        grid: { vertLines: { color: next.gridline }, horzLines: { color: next.gridline } },
        rightPriceScale: { borderColor: next.baseline },
        timeScale: { borderColor: next.baseline },
      });
      candleSeries.applyOptions({
        upColor: next.up,
        downColor: next.down,
        borderUpColor: next.up,
        borderDownColor: next.down,
        wickUpColor: next.up,
        wickDownColor: next.down,
      });
      volumeSeries.applyOptions({ color: next.textMuted });

      const nextMaColors: Record<(typeof MA_KEYS)[number], string> = {
        sma5: next.yellow,
        sma20: next.aqua,
        sma60: next.violet,
      };
      MA_KEYS.forEach((key) => smaSeries[key]?.applyOptions({ color: nextMaColors[key] }));
      bbUpper.applyOptions({ color: next.blue });
      bbLower.applyOptions({ color: next.blue });

      const { points: currentPoints, range: currentRange } = stateRef.current;
      const opt = RANGE_OPTIONS.find((r) => r.label === currentRange);
      const filtered = !opt || opt.days === null ? currentPoints : currentPoints.slice(-opt.days);
      volumeSeries.setData(
        filtered.map((p) => ({
          time: p.date as Time,
          value: p.volume,
          color: p.close >= p.open ? next.up : next.down,
        }))
      );
    });

    return () => {
      stopWatching();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const colors = getThemeColors();

    const opt = RANGE_OPTIONS.find((r) => r.label === range);
    const filtered = !opt || opt.days === null ? points : points.slice(-opt.days);

    const candleData: CandlestickData<Time>[] = filtered.map((p) => ({
      time: p.date as Time,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
    }));
    candleSeriesRef.current.setData(candleData);

    volumeSeriesRef.current.setData(
      filtered.map((p) => ({
        time: p.date as Time,
        value: p.volume,
        color: p.close >= p.open ? colors.up : colors.down,
      }))
    );

    const toLine = (key: keyof IndicatorPoint): LineData<Time>[] =>
      filtered
        .filter((p) => p[key] !== null && p[key] !== undefined)
        .map((p) => ({ time: p.date as Time, value: p[key] as number }));

    MA_KEYS.forEach((key) => smaSeriesRef.current[key]?.setData(toLine(key)));
    bbUpperRef.current?.setData(toLine("bb_upper"));
    bbLowerRef.current?.setData(toLine("bb_lower"));

    chartRef.current?.timeScale().fitContent();
  }, [points, range]);

  // Interactive legend: clicking a chip hides/shows its overlay series without
  // touching the underlying data (re-applied here so it survives a data refresh).
  useEffect(() => {
    MA_KEYS.forEach((key) => smaSeriesRef.current[key]?.applyOptions({ visible: !hidden.has(key) }));
    const bbVisible = !hidden.has("bb");
    bbUpperRef.current?.applyOptions({ visible: bbVisible });
    bbLowerRef.current?.applyOptions({ visible: bbVisible });
  }, [hidden, points]);

  const legendItems: { key: OverlayKey; colorVar: string; label: string }[] = [
    { key: "sma5", colorVar: "--series-yellow", label: "SMA5" },
    { key: "sma20", colorVar: "--series-aqua", label: "SMA20" },
    { key: "sma60", colorVar: "--series-violet", label: "SMA60" },
    { key: "bb", colorVar: "--series-blue", label: t("볼린저밴드(20,2)") },
  ];

  const lastPoint = points[points.length - 1];
  const bar: Readout | null =
    readout ??
    (lastPoint
      ? {
          time: lastPoint.date as Time,
          open: lastPoint.open,
          high: lastPoint.high,
          low: lastPoint.low,
          close: lastPoint.close,
        }
      : null);
  const barUp = bar ? bar.close >= bar.open : true;

  const toggleOverlay = (key: OverlayKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="card">
      <div className="chart-toolbar">
        <span className="chart-title">{t("일봉 차트")}</span>
        {bar && (
          <div className="chart-readout" aria-hidden="true">
            <span className="chart-readout-date">{formatMonthDay(bar.time)}</span>
            <span className="chart-readout-item">
              <b>O</b>
              {bar.open.toLocaleString()}
            </span>
            <span className="chart-readout-item">
              <b>H</b>
              {bar.high.toLocaleString()}
            </span>
            <span className="chart-readout-item">
              <b>L</b>
              {bar.low.toLocaleString()}
            </span>
            <span className={`chart-readout-item chart-readout-close chart-readout-close--${barUp ? "up" : "down"}`}>
              <b>C</b>
              {bar.close.toLocaleString()}
            </span>
          </div>
        )}
        <div className="range-toggle">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={opt.label === range ? "active" : ""}
              onClick={() => setRange(opt.label)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        {legendItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`chart-legend-item${hidden.has(item.key) ? " chart-legend-item--off" : ""}`}
            onClick={() => toggleOverlay(item.key)}
            aria-pressed={!hidden.has(item.key)}
          >
            <span className="swatch" style={{ background: `var(${item.colorVar})` }} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="chart-main-wrap">
        <div ref={containerRef} className="chart-main" />
        {points.length === 0 && <ChartSkeleton />}
      </div>
    </div>
  );
});

PriceChart.displayName = "PriceChart";
export default PriceChart;
