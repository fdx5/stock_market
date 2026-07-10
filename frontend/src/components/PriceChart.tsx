import {
  CandlestickData,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineData,
  Time,
  createChart,
} from "lightweight-charts";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { IndicatorPoint } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { getThemeColors, watchTheme } from "../theme";

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
      timeScale: { borderColor: colors.baseline },
      crosshair: { mode: CrosshairMode.Normal },
      height: 380,
      autoSize: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });

    const volumeSeries = chart.addHistogramSeries({
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
      smaSeries[key] = chart.addLineSeries({
        color: maColors[key],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    });

    const bbUpper = chart.addLineSeries({
      color: colors.blue,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const bbLower = chart.addLineSeries({
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

  return (
    <div className="card">
      <div className="chart-toolbar">
        <span className="chart-title">{t("일봉 차트")}</span>
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
        <span className="item">
          <span className="swatch" style={{ background: "var(--series-yellow)" }} />
          SMA5
        </span>
        <span className="item">
          <span className="swatch" style={{ background: "var(--series-aqua)" }} />
          SMA20
        </span>
        <span className="item">
          <span className="swatch" style={{ background: "var(--series-violet)" }} />
          SMA60
        </span>
        <span className="item">
          <span className="swatch" style={{ background: "var(--series-blue)" }} />
          {t("볼린저밴드(20,2)")}
        </span>
      </div>
      <div ref={containerRef} className="chart-main" />
    </div>
  );
});

PriceChart.displayName = "PriceChart";
export default PriceChart;
