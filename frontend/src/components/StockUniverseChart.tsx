import { useMemo, useRef, useState } from "react";
import type { OhlcvPoint } from "../api/client";
import { Tone, formatPrice, shortDateTime } from "../stocks/market";

/* The detail panel's price chart.
 *
 * Hand-drawn SVG rather than the `lightweight-charts` instance PriceChart.tsx uses,
 * for two reasons that both come from where it sits. It is one element inside a panel
 * that re-renders every ten seconds, and a canvas chart has to be imperatively
 * re-fed on each of those; and it has to inherit the panel's palette — its gradient,
 * its up/down tone, its grid weight — which means styling a third-party theme object
 * to match CSS variables that the panel already owns. A path and a fill are less code
 * than either, and they scale with the panel instead of needing a resize observer.
 *
 * Deliberately closes-only, no candles or volume. This chart answers "what has this
 * done lately" beside a discussion thread; /stock/{code} is one click away and has
 * the full instrument.
 */

const RANGES = [
  { key: "1M", label: "1개월", sessions: 21 },
  { key: "3M", label: "3개월", sessions: 63 },
  { key: "6M", label: "6개월", sessions: 126 },
  { key: "1Y", label: "1년", sessions: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

// A viewBox, not pixels: the SVG scales to whatever width the panel gives it, and
// these numbers only set the aspect ratio and the internal geometry.
const W = 720;
const H = 260;
const PAD_LEFT = 8;
const PAD_RIGHT = 76;
const PAD_TOP = 18;
const PAD_BOTTOM = 32;

/** Four horizontal guides. Enough to read a level against, few enough not to become
 *  the loudest thing in a panel whose subject is the line. */
const GRID_LINES = 4;

interface Props {
  points: OhlcvPoint[];
  tone: Tone;
  currency: "KRW" | "USD";
  loading: boolean;
}

export default function StockUniverseChart({ points, tone, currency, loading }: Props) {
  const [range, setRange] = useState<RangeKey>("3M");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const series = useMemo(() => {
    const sessions = RANGES.find((r) => r.key === range)?.sessions ?? 0;
    const sliced = sessions > 0 ? points.slice(-sessions) : points;
    return sliced.filter((p) => Number.isFinite(p.close));
  }, [points, range]);

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const closes = series.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // A flat series has no range to divide by; give it one so the line lands mid-box
    // instead of on an axis or at Infinity.
    const span = max - min || Math.abs(max) * 0.02 || 1;
    const innerW = W - PAD_LEFT - PAD_RIGHT;
    const innerH = H - PAD_TOP - PAD_BOTTOM;
    const x = (index: number) => PAD_LEFT + (index / (series.length - 1)) * innerW;
    const y = (value: number) => PAD_TOP + innerH - ((value - min) / span) * innerH;
    const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join("");
    return {
      min,
      max,
      x,
      y,
      line,
      area: `${line}L${x(series.length - 1).toFixed(2)},${H - PAD_BOTTOM}L${PAD_LEFT},${H - PAD_BOTTOM}Z`,
      // Where the first close sits — the line is above it for a gain over the window
      // and below it for a loss, which is the one reference the eye needs.
      baseY: y(series[0].close),
    };
  }, [series]);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !geometry || series.length < 2) return;
    const box = svg.getBoundingClientRect();
    const pointerX = ((event.clientX - box.left) / box.width) * W;
    const ratio = (pointerX - PAD_LEFT) / (W - PAD_LEFT - PAD_RIGHT);
    const index = Math.round(ratio * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, index)));
  };

  const active = hover != null ? series[hover] : null;
  const windowChange =
    series.length >= 2 ? ((series[series.length - 1].close - series[0].close) / series[0].close) * 100 : null;

  return (
    <div className={`su-chart su-chart--${tone}`}>
      <header className="su-chart-head">
        <div className="su-chart-readout">
          {active ? (
            <>
              <span className="su-chart-readout-date">{shortDateTime(active.date)}</span>
              <strong>{formatPrice(active.close, currency)}</strong>
            </>
          ) : (
            <>
              <span className="su-chart-readout-date">
                {RANGES.find((r) => r.key === range)?.label} 수익률
              </span>
              <strong className={windowChange != null && windowChange < 0 ? "is-down" : "is-up"}>
                {windowChange == null ? "—" : `${windowChange > 0 ? "+" : ""}${windowChange.toFixed(2)}%`}
              </strong>
            </>
          )}
        </div>
        <div className="su-chart-ranges" role="group" aria-label="차트 기간">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={range === option.key ? "is-active" : ""}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {option.key}
            </button>
          ))}
        </div>
      </header>

      <div className="su-chart-canvas">
        {loading && <div className="su-chart-veil"><i />차트를 불러오는 중</div>}
        {!loading && !geometry && <div className="su-chart-veil">차트 데이터가 없습니다.</div>}
        {geometry && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="기간별 종가 추이"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {/* Unique per tone rather than per instance: two charts of the same tone
                  can share a gradient, and an id derived from a random/instance value
                  would defeat SVG's own reuse for no benefit. */}
              <linearGradient id={`su-fill-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>

            {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
              const y = PAD_TOP + ((H - PAD_TOP - PAD_BOTTOM) / GRID_LINES) * i;
              return <line key={i} className="su-chart-grid" x1={PAD_LEFT} x2={W - PAD_RIGHT} y1={y} y2={y} />;
            })}

            <line
              className="su-chart-base"
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={geometry.baseY}
              y2={geometry.baseY}
            />
            <path className="su-chart-area" d={geometry.area} fill={`url(#su-fill-${tone})`} />
            <path className="su-chart-line" d={geometry.line} />

            {active && hover != null && (
              <g className="su-chart-cursor">
                <line x1={geometry.x(hover)} x2={geometry.x(hover)} y1={PAD_TOP} y2={H - PAD_BOTTOM} />
                <circle cx={geometry.x(hover)} cy={geometry.y(active.close)} r="4.5" />
              </g>
            )}
          </svg>
        )}
        {geometry && (
          <>
            <div className="su-chart-y-axis" aria-hidden="true">
              <span>{formatPrice(geometry.max, currency)}</span>
              <span>{formatPrice((geometry.max + geometry.min) / 2, currency)}</span>
              <span>{formatPrice(geometry.min, currency)}</span>
            </div>
            <div className="su-chart-x-axis" aria-hidden="true">
              <span>{shortDateTime(series[0].date)}</span>
              <span>{shortDateTime(series[Math.floor((series.length - 1) / 2)].date)}</span>
              <span>{shortDateTime(series[series.length - 1].date)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
