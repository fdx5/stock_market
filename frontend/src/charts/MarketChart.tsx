import { CSSProperties, useEffect, useRef, useState } from "react";
import type { EChartsType } from "echarts/core";
import type { EChartsOption } from "echarts";
import { watchTheme } from "../theme";
import type { SyncChart, DateRange } from "./sync";
import "./marketCharts.css";

export interface PlotSeries {
  name: string; values: (number | null | number[])[];
  type?: "line" | "bar" | "candlestick"; color?: string;
  fill?: boolean; dashed?: boolean; volume?: boolean; diverging?: boolean; colors?: string[];
}
interface Props {
  series: PlotSeries[]; dates?: string[]; height?: number; className?: string;
  compact?: boolean; label: string; baseline?: number | null; controller?: SyncChart;
  onHover?: (index: number | null) => void; min?: number; max?: number;
  gauge?: number | null; interactive?: boolean; horizontal?: boolean;
}
export default function MarketChart(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const latest = useRef(props); latest.current = props;
  const engine = useRef<typeof import("./engine") | null>(null);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<DateRange | null>(props.controller?.timeScale().getVisibleRange() ?? null);
  const entered = useRef(false);
  const reduced = useRef(false);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let live = true; let loading = false;
    // ZRender can consume wheel events even when zoom requires Ctrl. Keep normal
    // wheel gestures as native page scrolling before they reach the renderer.
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) event.stopPropagation(); };
    element.addEventListener("wheel", wheel, { capture: true, passive: true });
    const start = async () => {
      if (loading || chart.current || !element.clientWidth || !element.clientHeight) return;
      loading = true;
      try {
        const module = await import("./engine");
        if (!live) return;
        engine.current = module;
        chart.current = module.init(element, undefined, { renderer: "canvas", devicePixelRatio: Math.min(devicePixelRatio || 1, 2) });
        element.dataset.chartReady = "true";
        chart.current.on("updateAxisPointer", (event: unknown) => {
          const axis = (event as { axesInfo?: { value: number }[] }).axesInfo?.[0];
          latest.current.onHover?.(axis ? Number(axis.value) : null);
        });
        chart.current.getZr().on("globalout", () => latest.current.onHover?.(null));
        chart.current.on("datazoom", () => {
          const opt = chart.current?.getOption() as { dataZoom?: { start?: number; end?: number; startValue?: number; endValue?: number }[] };
          const zoom = opt.dataZoom?.[0]; const dates = latest.current.dates;
          if (!zoom || !dates?.length) return;
          const start = Math.max(0, Math.round(zoom.startValue ?? (zoom.start ?? 0) / 100 * (dates.length - 1)));
          const end = Math.min(dates.length-1, Math.round(zoom.endValue ?? (zoom.end ?? 100) / 100 * (dates.length - 1)));
          latest.current.controller?.timeScale().setVisibleRange({ from: dates[start], to: dates[end] });
        });
        setReady(true);
      } catch { if (live) element.dataset.chartError = "true"; }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { entered.current = true; void start(); }
    }, { threshold: 0.08 });
    observer.observe(element);
    const resize = new ResizeObserver(() => { if (entered.current) void start(); chart.current?.resize(); });
    resize.observe(element);
    const stop = watchTheme(() => setRevision(n => n+1));
    const media = matchMedia("(prefers-reduced-motion: reduce)"); reduced.current = media.matches;
    const motion = () => { reduced.current = media.matches; setRevision(n => n+1); };
    media.addEventListener("change", motion);
    return () => { live = false; observer.disconnect(); resize.disconnect(); stop(); media.removeEventListener("change", motion);
      element.removeEventListener("wheel", wheel, true);
      chart.current?.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const scale = props.controller?.timeScale(); if (!scale) return;
    setRange(scale.getVisibleRange()); scale.subscribeVisibleTimeRangeChange(setRange);
    return () => scale.unsubscribeVisibleTimeRangeChange(setRange);
  }, [props.controller]);
  useEffect(() => {
    if (!ready || !chart.current || !host.current || !engine.current) return;
    const css = getComputedStyle(host.current);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const paper = !!host.current.closest(".d2");
    const text = token(paper ? "--ink-3" : "--text-secondary", "#858d9e");
    const up = token(paper ? "--up" : "--up-color", "#e65d68");
    const down = token(paper ? "--down" : "--down-color", "#4c8ee9");
    const colors = ["#c28d36", "#1ca6a0", "#8570d8", "#438dde"];
    const compact = props.compact;
    const dates = props.dates ?? props.series[0]?.values.map((_,i) => String(i+1)) ?? [];
    const hasVolume = props.series.some(s => s.volume);
    const first = host.current.dataset.chartPainted !== "true";
    const startIndex = range ? Math.max(0, dates.findIndex(date => date >= range.from)) : 0;
    let endIndex = dates.length - 1;
    if (range) { while (endIndex > startIndex && dates[endIndex] > range.to) endIndex--; }
    const option: EChartsOption = {
      backgroundColor: "transparent", color: colors, textStyle: { fontFamily: "Pretendard, sans-serif", color: text },
      animation: !reduced.current, animationDuration: first ? 1100 : 300,
      animationDurationUpdate: reduced.current ? 0 : 280, animationEasing: "cubicOut", animationThreshold: 3000,
      aria: { enabled: true, description: props.label },
      tooltip: props.interactive === false ? { show: false } : {
        trigger: "axis", renderMode: "richText", confine: true, backgroundColor: paper ? token("--p0", "#efeadd") : token("--surface-1", "#151a23"),
        textStyle: { color: token(paper ? "--ink" : "--text-primary", "#eee"), fontSize: 11 },
        borderColor: "rgba(140,150,165,.25)", axisPointer: { type: "cross", label: { show: !compact } },
      },
      grid: hasVolume ? [{ left: 12, right: 66, top: 14, bottom: "29%" }, { left: 12, right: 66, top: "76%", bottom: 52 }] :
        { left: compact ? 2 : 12, right: compact ? 2 : 62, top: compact ? 4 : 12, bottom: compact ? 3 : 30 },
      xAxis: (hasVolume ? [0,1] : [0]).map((n) => ({ type: "category", data: dates, gridIndex: n,
        boundaryGap: props.series.some(s => s.type === "bar" || s.type === "candlestick"), axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: !compact && (!hasVolume || n===1), color: text, hideOverlap: true, fontSize: 10,
          formatter: (value: string) => value.length >=10 ? value.slice(5,10).replace("-", ".") : value },
        axisPointer: { show: props.interactive !== false, snap: true },
      })),
      yAxis: (hasVolume ? [0,1] : [0]).map(n => ({ type: "value", gridIndex: n, scale: true, position: "right",
        min: n===0 ? props.min : undefined, max: n===0 ? props.max : undefined,
        axisLabel: { show: !compact, color: text, fontSize: 10, formatter: (v: number) => Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:2}).format(v) },
        splitNumber: n ? 2 : 4, splitLine: { show: !compact && !n, lineStyle: { color: "rgba(130,140,155,.16)", type: "dashed" } },
      })),
      dataZoom: props.controller ? [{ type: "inside", xAxisIndex: hasVolume ? [0,1] : [0], filterMode: "filter", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false,
        startValue: startIndex, endValue: endIndex, preventDefaultMouseMove: false },
        { type: "slider", xAxisIndex: hasVolume ? [0,1] : [0], height: 18, bottom: 5, showDetail: false, borderColor: "transparent",
          backgroundColor: "rgba(130,140,155,.08)", fillerColor: "rgba(71,141,222,.16)", handleSize: "90%", textStyle: { color: text },
          startValue: startIndex, endValue: endIndex }] : undefined,
      series: props.series.map((s,index) => {
        const variable = s.color?.startsWith("var(") ? s.color.slice(4,-1) : null;
        const color = variable ? token(variable, variable === "--up" ? up : variable === "--down" ? down : colors[index%4]) : s.color || colors[index%4];
        return {
          id: s.name, name: s.name, type: s.type || "line", data: s.values.map(v => typeof v === "number" && !Number.isFinite(v) ? null : v),
          xAxisIndex: s.volume ? 1 : 0, yAxisIndex: s.volume ? 1 : 0,
          showSymbol: false, connectNulls: false, smooth: false, clip: true,
          lineStyle: { color, width: compact ? 1.8 : 2.2, type: s.dashed ? "dashed" : "solid", shadowColor: color, shadowBlur: compact ? 0 : 3 },
          itemStyle: s.type === "candlestick" ? { color: up, color0: down, borderColor: up, borderColor0: down, borderWidth: 1 } :
            { color: s.colors ? (p: { dataIndex: number }) => s.colors![p.dataIndex] : s.diverging ? (p: { value: unknown }) => Number(p.value) >=0 ? up : down : color, opacity: s.volume ? .48 : 1, borderRadius: s.type === "bar" ? [2,2,0,0] : 0 },
          areaStyle: s.fill ? { color: new engine.current!.graphic.LinearGradient(0,0,0,1,[{offset:0,color},{offset:1,color:"transparent"}]), opacity: .16 } : undefined,
          barMaxWidth: s.volume ? 10 : 16,
          animationDelay: first && (s.type === "bar" || s.type === "candlestick") ? (i: number) => Math.min(650, i / Math.max(1,dates.length-1) * 650) : index*50,
          markLine: index===0 && props.baseline != null ? { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: text, opacity: .45, type: "dashed" }, data: [{ yAxis: props.baseline }] } : undefined,
          emphasis: { focus: compact ? "none" : "series" },
        };
      }) as EChartsOption["series"],
    };
    if (props.horizontal) {
      option.grid={left:100,right:25,top:8,bottom:25};
      option.xAxis={type:"value",axisLabel:{color:text,fontSize:10},splitLine:{lineStyle:{color:"rgba(130,140,155,.16)",type:"dashed"}}};
      option.yAxis={type:"category",data:dates,inverse:true,axisTick:{show:false},axisLine:{show:false},axisLabel:{color:text,fontSize:11,width:90,overflow:"truncate"}};
    }
    if (props.gauge !== undefined) {
      option.series = [{ type: "gauge", min: 0, max: 100, startAngle: 180, endAngle: 0, center: ["50%","83%"], radius: "130%",
        axisLine: { lineStyle: { width: 7, color: [[.4,down],[.6,"#c28d36"],[1,up]] } },
        pointer: { width: 3, length: "65%", itemStyle: { color: text } }, anchor: { show: true, size: 6, itemStyle: { color: text } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, detail: { show: false }, title: { show: false },
        data: props.gauge == null ? [] : [{ value: props.gauge }], animationDuration: 1200 }];
      option.xAxis = []; option.yAxis=[]; option.grid=[]; option.tooltip={show:false};
    }
    chart.current.setOption(option, { notMerge: first, replaceMerge: ["series"], lazyUpdate: false });
    if (props.series.some(s => s.values.length) || props.gauge !== undefined) host.current.dataset.chartPainted = "true";
    host.current.dataset.chartMotion = reduced.current ? "reduced" : "animated";
  }, [ready, props.series, props.dates, props.compact, props.baseline, props.gauge, props.min, props.max, props.horizontal, range, revision]);
  const style: CSSProperties = props.height ? { height: props.height } : {};
  return <div ref={host} className={`market-chart ${props.className || ""}`} style={style}
    role="img" aria-label={props.label} data-chart-library="echarts" />;
}
