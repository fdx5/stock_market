import { useMemo, useRef, useState } from "react";
import type { OhlcvPoint } from "../../api/client";
import { Tone, formatPrice, shortDateTime } from "../../stocks/market";
import { Skel } from "../parts";
import { pct, useL } from "../lib";

/* The preview panel's price line — StockUniverseChart's geometry, printed in the
 * paper's inks. Closes only: this answers "what has it done lately" beside a list;
 * the full instrument is one click away on the company page. */

const RANGES = [
  { key: "1M", sessions: 21 },
  { key: "3M", sessions: 63 },
  { key: "6M", sessions: 126 },
  { key: "1Y", sessions: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const W = 640;
const H = 220;
const PAD = { l: 4, r: 64, t: 12, b: 22 };

export default function PreviewChart({ points, tone, currency, loading }: { points: OhlcvPoint[]; tone: Tone; currency: "KRW" | "USD"; loading: boolean }) {
  const L = useL();
  const [range, setRange] = useState<RangeKey>("3M");
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  const series = useMemo(() => {
    const n = RANGES.find((r) => r.key === range)?.sessions ?? 0;
    return (n > 0 ? points.slice(-n) : points).filter((p) => Number.isFinite(p.close));
  }, [points, range]);

  const g = useMemo(() => {
    if (series.length < 2) return null;
    const closes = series.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || Math.abs(max) * 0.02 || 1;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (i: number) => PAD.l + (i / (series.length - 1)) * iw;
    const y = (v: number) => PAD.t + ih - ((v - min) / span) * ih;
    const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
    return { min, max, x, y, line, area: `${line}L${x(series.length - 1)},${H - PAD.b}L${PAD.l},${H - PAD.b}Z`, base: y(series[0].close) };
  }, [series]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svg.current || !g) return;
    const b = svg.current.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };

  const at = hover != null ? series[hover] : null;
  const windowChg = series.length >= 2 ? (series[series.length - 1].close / series[0].close - 1) * 100 : null;

  return (
    <figure className={`st-chart is-${tone}`}>
      <div className="st-chart-head">
        <span className="st-chart-read">
          {at ? (
            <>
              <time>{shortDateTime(at.date)}</time>
              <b className="d2-num">{formatPrice(at.close, currency)}</b>
            </>
          ) : (
            <>
              <time>
                {range} {L("수익률", "return")}
              </time>
              <b className={`d2-num is-${windowChg != null && windowChg < 0 ? "down" : "up"}`}>{pct(windowChg)}</b>
            </>
          )}
        </span>
        <span className="sk-seg" role="group" aria-label={L("기간", "Range")}>
          {RANGES.map((r) => (
            <button key={r.key} type="button" className={range === r.key ? "is-on" : ""} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
        </span>
      </div>
      <div className="st-chart-canvas">
        {loading && <Skel h={200} />}
        {!loading && !g && <p className="d2-empty">{L("차트 데이터가 없습니다.", "No chart data.")}</p>}
        {g && (
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={L("기간별 종가 추이", "Closing prices")} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {[0, 1, 2, 3].map((i) => {
              const yy = PAD.t + ((H - PAD.t - PAD.b) / 3) * i;
              return <line key={i} className="st-guide" x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} vectorEffect="non-scaling-stroke" />;
            })}
            <line className="st-base" x1={PAD.l} x2={W - PAD.r} y1={g.base} y2={g.base} vectorEffect="non-scaling-stroke" />
            <path className="st-area" d={g.area} />
            <path className="st-line" d={g.line} vectorEffect="non-scaling-stroke" />
            {at && hover != null && (
              <g className="st-cursor">
                <line x1={g.x(hover)} x2={g.x(hover)} y1={PAD.t} y2={H - PAD.b} vectorEffect="non-scaling-stroke" />
                <circle cx={g.x(hover)} cy={g.y(at.close)} r="4" />
              </g>
            )}
          </svg>
        )}
        {g && (
          <>
            <span className="st-y">
              <i>{formatPrice(g.max, currency)}</i>
              <i>{formatPrice((g.max + g.min) / 2, currency)}</i>
              <i>{formatPrice(g.min, currency)}</i>
            </span>
            <span className="st-x">
              <i>{shortDateTime(series[0].date)}</i>
              <i>{shortDateTime(series[series.length - 1].date)}</i>
            </span>
          </>
        )}
      </div>
    </figure>
  );
}
