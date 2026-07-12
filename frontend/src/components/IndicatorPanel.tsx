import {
  ColorType,
  CrosshairMode,
  HistogramData,
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
import { ThemeColors, getThemeColors, watchTheme } from "../theme";

interface Props {
  points: IndicatorPoint[];
  latest: IndicatorPoint | null;
}

export interface IndicatorPanelHandle {
  getCharts: () => IChartApi[];
}

function toLine(points: IndicatorPoint[], key: keyof IndicatorPoint): LineData<Time>[] {
  return points
    .filter((p) => p[key] !== null && p[key] !== undefined)
    .map((p) => ({ time: p.date as Time, value: p[key] as number }));
}

function referenceLine(points: IndicatorPoint[], value: number): LineData<Time>[] {
  if (points.length === 0) return [];
  return [
    { time: points[0].date as Time, value },
    { time: points[points.length - 1].date as Time, value },
  ];
}

function macdHistData(points: IndicatorPoint[], colors: ThemeColors): HistogramData<Time>[] {
  return points
    .filter((p) => p.macd_hist !== null && p.macd_hist !== undefined)
    .map((p) => ({
      time: p.date as Time,
      value: p.macd_hist as number,
      color: (p.macd_hist as number) >= 0 ? colors.good : colors.critical,
    }));
}

const IndicatorPanel = forwardRef<IndicatorPanelHandle, Props>(({ points, latest }, ref) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const pointsRef = useRef<IndicatorPoint[]>(points);
  pointsRef.current = points;

  useImperativeHandle(ref, () => ({
    getCharts: () => [rsiChartRef.current, macdChartRef.current].filter((c): c is IChartApi => c !== null),
  }));

  useEffect(() => {
    if (!rsiContainerRef.current || !macdContainerRef.current) return;
    const colors = getThemeColors();

    const baseOptions = {
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
      height: 130,
      autoSize: true,
    };

    const rsiChart = createChart(rsiContainerRef.current, baseOptions);
    const rsiSeries = rsiChart.addSeries(LineSeries, { color: colors.blue, lineWidth: 2, priceLineVisible: false });
    const rsiUpper = rsiChart.addSeries(LineSeries, {
      color: colors.textMuted,
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const rsiLower = rsiChart.addSeries(LineSeries, {
      color: colors.textMuted,
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const macdChart = createChart(macdContainerRef.current, baseOptions);
    const macdHist = macdChart.addSeries(HistogramSeries, { priceLineVisible: false });
    const macdLine = macdChart.addSeries(LineSeries, { color: colors.blue, lineWidth: 2, priceLineVisible: false });
    const macdSignal = macdChart.addSeries(LineSeries, { color: colors.yellow, lineWidth: 2, priceLineVisible: false });

    rsiChartRef.current = rsiChart;
    macdChartRef.current = macdChart;
    rsiSeriesRef.current = rsiSeries;
    rsiUpperRef.current = rsiUpper;
    rsiLowerRef.current = rsiLower;
    macdLineRef.current = macdLine;
    macdSignalRef.current = macdSignal;
    macdHistRef.current = macdHist;

    const stopWatching = watchTheme((next) => {
      [rsiChart, macdChart].forEach((chart) => {
        chart.applyOptions({
          layout: { textColor: next.textSecondary },
          grid: { vertLines: { color: next.gridline }, horzLines: { color: next.gridline } },
          rightPriceScale: { borderColor: next.baseline },
          timeScale: { borderColor: next.baseline },
        });
      });
      rsiSeries.applyOptions({ color: next.blue });
      rsiUpper.applyOptions({ color: next.textMuted });
      rsiLower.applyOptions({ color: next.textMuted });
      macdLine.applyOptions({ color: next.blue });
      macdSignal.applyOptions({ color: next.yellow });
      macdHist.setData(macdHistData(pointsRef.current, next));
    });

    return () => {
      stopWatching();
      rsiChart.remove();
      macdChart.remove();
    };
  }, []);

  useEffect(() => {
    rsiSeriesRef.current?.setData(toLine(points, "rsi14"));
    rsiUpperRef.current?.setData(referenceLine(points, 70));
    rsiLowerRef.current?.setData(referenceLine(points, 30));

    macdLineRef.current?.setData(toLine(points, "macd"));
    macdSignalRef.current?.setData(toLine(points, "macd_signal"));
    macdHistRef.current?.setData(macdHistData(points, getThemeColors()));

    rsiChartRef.current?.timeScale().fitContent();
    macdChartRef.current?.timeScale().fitContent();
  }, [points]);

  return (
    <div className="card">
      <div className="chart-toolbar">
        <span className="chart-title">{t("보조 지표")}</span>
        <button
          type="button"
          className="indicator-panel-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t("접기") : t("펼치기")}
          <span className={`fold-toggle-arrow ${expanded ? "up" : ""}`} aria-hidden="true">
            ▼
          </span>
        </button>
      </div>
      <div className={`indicator-panel-body ${expanded ? "expanded" : ""}`}>
        <div className="chart-legend">
          <span className="item">{t("RSI(14) · 점선 30/70")}</span>
        </div>
        <div ref={rsiContainerRef} className="chart-sub" />
        <div className="chart-legend" style={{ marginTop: 14 }}>
          <span className="item">
            <span className="swatch" style={{ background: "var(--series-blue)" }} />
            MACD
          </span>
          <span className="item">
            <span className="swatch" style={{ background: "var(--series-yellow)" }} />
            Signal
          </span>
          <span className="item">{t("히스토그램(녹/적)")}</span>
        </div>
        <div ref={macdContainerRef} className="chart-sub" />

        {latest && (
          <div className="indicator-stats">
            <StatTile label="RSI(14)" value={latest.rsi14?.toFixed(1) ?? "-"} />
            <StatTile label={t("MACD 히스토그램")} value={latest.macd_hist?.toFixed(2) ?? "-"} />
            <StatTile label="ATR(14)" value={latest.atr14?.toFixed(0) ?? "-"} />
            <StatTile
              label={t("20일 변동성")}
              value={latest.volatility20 !== null && latest.volatility20 !== undefined ? `${(latest.volatility20 * 100).toFixed(2)}%` : "-"}
            />
            <StatTile
              label={t("거래량/20일평균")}
              value={
                latest.volume_ma20 ? `${((latest.volume / latest.volume_ma20) * 100).toFixed(0)}%` : "-"
              }
            />
          </div>
        )}
      </div>
    </div>
  );
});

IndicatorPanel.displayName = "IndicatorPanel";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export default IndicatorPanel;
