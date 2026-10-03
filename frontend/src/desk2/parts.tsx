import MarketChart from "../charts/MarketChart";
import { ReactNode } from "react";
import { Tone } from "./lib";

/* The small furniture every section of the broadsheet shares. */

/** Responsive ECharts trend; drawing starts when its tile enters the viewport. */
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
  return <MarketChart className={`d2-spark is-${tone} ${className}`} compact baseline={baseline} label="Price trend"
    series={[{name:"Price",values:points.map(v=>Number.isFinite(v)?v:null),color:tone==="down"?"var(--down)":tone==="up"?"var(--up)":"var(--ink-3)",fill}]} />;
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
