import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { compareSeries, number, signed, tone, type Point } from "./worldMarketModel";

type Sample = {date: string; value: number; benchmark?: number};

export default function WorldMarketsChart({points, label, benchmark}: {
  points: Point[];
  label: string;
  benchmark?: {label: string; points: Point[]};
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const peerPoints = benchmark?.points;
  const overlap = useMemo(() => peerPoints ? compareSeries(points, peerPoints) : [], [points, peerPoints]);
  const comparing = overlap.length >= 2;
  const samples: Sample[] = useMemo(() => comparing ? overlap : points.map(point => ({date: point.date, value: point.close})), [points, overlap, comparing]);
  const index = Math.min(cursor ?? samples.length - 1, samples.length - 1);
  const current = samples[index];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const values = samples.flatMap(point => point.benchmark == null ? [point.value] : [point.value, point.benchmark]);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = (max - min) * .09 || Math.abs(max) * .015 || 1;
  const top = max + padding, bottom = min - padding;
  const format = comparing ? signed : number;
  const trend = tone(last && first ? last.value - first.value : null);

  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext("2d");
    if (!surface || !context || samples.length < 2) return;
    const screen = surface;
    const ctx = context;

    function draw() {
      const {width, height} = screen.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (screen.width !== pixelWidth || screen.height !== pixelHeight) {
        screen.width = pixelWidth;
        screen.height = pixelHeight;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const styles = getComputedStyle(screen);
      const primary = styles.getPropertyValue("--accent-neon").trim();
      const secondary = styles.getPropertyValue("--series-aqua").trim();
      const grid = styles.getPropertyValue("--gridline").trim();
      const baseline = styles.getPropertyValue("--baseline").trim();
      const x = (i: number) => 8 + (width - 16) * i / (samples.length - 1);
      const y = (value: number) => height * (.06 + .88 * (top - value) / (top - bottom));

      const rule = (color: string, x0: number, y0: number, x1: number, y1: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      };
      ctx.setLineDash([3, 5]);
      for (let i = 0; i < 5; i++) {
        const row = y(top - (top - bottom) * i / 4);
        rule(grid, 0, row, width, row);
      }
      if (comparing) rule(baseline, 0, y(0), width, y(0));
      ctx.setLineDash([]);

      function series(key: "value" | "benchmark", color: string, fill = false) {
        ctx.beginPath();
        samples.forEach((point, i) => {
          const py = y(point[key]!);
          if (i === 0) ctx.moveTo(x(i), py);
          else ctx.lineTo(x(i), py);
        });
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        if (key === "benchmark") ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (fill) {
          const gradient = ctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, color);
          gradient.addColorStop(1, "transparent");
          ctx.lineTo(x(samples.length - 1), height);
          ctx.lineTo(x(0), height);
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.globalAlpha = .23;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      series("value", primary, true);
      if (comparing) series("benchmark", secondary);
      if (cursor != null) {
        ctx.setLineDash([3, 4]);
        rule(baseline, x(index), 0, x(index), height);
        ctx.setLineDash([]);
      }
      function marker(color: string, value: number) {
        ctx.beginPath();
        ctx.arc(x(index), y(value), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      marker(primary, current.value);
      if (current.benchmark != null) marker(secondary, current.benchmark);
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(screen);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme", "data-tone", "data-design"]});
    return () => { observer.disconnect(); theme.disconnect(); };
  }, [samples, cursor, index, top, bottom, current, comparing]);

  if (samples.length < 2) return <p className="wm-chart-empty">거래일 데이터가 충분히 들어오면 추이를 표시합니다.</p>;
  const inspect = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - rect.left - 8) / Math.max(1, rect.width - 16);
    setCursor(Math.max(0, Math.min(samples.length - 1, Math.round(position * (samples.length - 1)))));
  };
  return <div className="wm-plot">
    <output className="wm-plot-reading" aria-live="polite">
      <time dateTime={current.date}>{current.date}</time>
      <strong className="wm-key">{label} {format(current.value)}</strong>
      {current.benchmark != null && <strong className="wm-key wm-key-peer">{benchmark?.label} {signed(current.benchmark)}</strong>}
    </output>
    <div className="wm-plot-interaction" tabIndex={0} role="group"
      aria-label={label + " 지수 차트. 좌우 방향키로 거래일을 이동할 수 있습니다."} onBlur={() => setCursor(null)}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? samples.length - 1
          : index + (event.key === "ArrowLeft" ? -1 : 1);
        setCursor(Math.max(0, Math.min(samples.length - 1, next)));
      }}>
      <div className="wm-plot-grid">
        <canvas ref={canvas} aria-hidden="true" onClick={inspect}
          onPointerMove={event => { if (event.pointerType === "mouse") inspect(event); }}
          onPointerLeave={event => { if (event.pointerType === "mouse") setCursor(null); }} />
        <div className="wm-plot-axis" aria-hidden="true">
          {[0, 1, 2, 3, 4].map(step => <span key={step}>{format(top - (top - bottom) * step / 4)}</span>)}
        </div>
      </div>
      <div className="wm-chart-axis"><time>{first.date}</time><span>{samples.length - 1}거래일</span><time>{last?.date}</time></div>
    </div>
    <p className="wm-note">{comparing ? "첫 공통 거래일을 0%로 환산합니다. 최신 값에는 장중 시세가 포함될 수 있습니다."
      : benchmark ? "공통 거래일의 데이터가 부족해 선택한 지수만 표시합니다."
      : <>표시 구간 수익률 <b data-tone={trend}>{signed((last!.value / first.value - 1) * 100)}</b></>}</p>
  </div>;
}
