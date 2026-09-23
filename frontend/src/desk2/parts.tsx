import { ReactNode } from "react";
import { Tone } from "./lib";

/* The small furniture every section of the broadsheet shares. */

/** A trend line, nothing more. `vector-effect` keeps the stroke one weight at
 * any stretch, so the same component serves a 60px tape cell and a 300px tile. */
export function Spark({
  points,
  tone,
  className = "",
  fill = true,
  baseline,
}: {
  points: number[];
  tone: Tone;
  className?: string;
  fill?: boolean;
  /** Draws a dashed reference at this value — the previous close, usually. */
  baseline?: number | null;
}) {
  const clean = points.filter((p) => Number.isFinite(p));
  if (clean.length < 2) return <span className={`d2-spark d2-spark--empty ${className}`} aria-hidden="true" />;
  const W = 100;
  const H = 32;
  const pad = 2;
  const lo = Math.min(...clean, baseline ?? Infinity);
  const hi = Math.max(...clean, baseline ?? -Infinity);
  const range = hi - lo || 1;
  const x = (i: number) => (i / (clean.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  const line = clean.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg className={`d2-spark is-${tone} ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {fill && <path className="d2-spark-area" d={`${line} L${W},${H} L0,${H} Z`} />}
      {baseline !== undefined && baseline !== null && (
        <line className="d2-spark-base" x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} vectorEffect="non-scaling-stroke" />
      )}
      <path className="d2-spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A numbered section head, set like a newspaper's section flag: the number in
 * the margin, the name in the serif, a short standfirst and a rule. */
export function SectionHead({
  no,
  title,
  kicker,
  note,
  aside,
  id,
}: {
  no: string;
  title: string;
  kicker?: string;
  note?: ReactNode;
  aside?: ReactNode;
  id: string;
}) {
  return (
    <header className="d2-sec-head">
      <span className="d2-sec-no" aria-hidden="true">
        {no}
      </span>
      <div className="d2-sec-titles">
        {kicker && <span className="d2-sec-kicker">{kicker}</span>}
        <h2 id={id}>{title}</h2>
        {note && <p className="d2-sec-note">{note}</p>}
      </div>
      {aside && <div className="d2-sec-aside">{aside}</div>}
    </header>
  );
}

export function Skel({ w = "100%", h = 14, className = "" }: { w?: number | string; h?: number; className?: string }) {
  return <span className={`d2-skel ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

/** A segmented control drawn as a row of highlighter marks: the chosen option
 * is struck through with a marker, the rest are plain type. */
export function Marker<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`d2-marker ${className}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          className={o.id === value ? "is-on" : ""}
          onClick={() => onChange(o.id)}
        >
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Delta({ value, digits = 2, className = "" }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`d2-delta is-flat ${className}`}>—</span>;
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span className={`d2-delta is-${tone} ${className}`}>
      {sign}
      {Math.abs(value).toFixed(digits)}%
    </span>
  );
}
