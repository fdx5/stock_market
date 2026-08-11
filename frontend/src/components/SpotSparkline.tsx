import { DailyPricePoint } from "../api/client";

/* Twenty sessions of closes, drawn small, in the card's spare width.
 *
 * The reason it belongs on this card rather than being decoration: a spotlight
 * board is a list of stocks that moved a lot today, and "moved a lot today" is
 * two completely different situations that the percentage cannot tell apart. A
 * name that has been climbing for three weeks and a name that was flat until
 * this morning both print +12%, and which one it is changes what the number
 * means more than any other single fact about it. That shape is the one thing a
 * line can say and a figure cannot.
 *
 * Deliberately not a chart. No axes, no grid, no tooltip, no library — those
 * belong on the detail page one click away, and six of them on a front-page
 * band would be six canvases fighting for the main thread. It is a path, a
 * translucent fill under it, and a dot on today.
 */

const W = 132;
const H = 40;
/** Keeps the stroke's own width inside the viewBox at both extremes, so the
 * high and low of the series are not clipped in half by the edge. */
const PAD = 3;

export default function SpotSparkline({
  points,
  tone,
}: {
  /** Newest first, as the daily endpoint returns them. */
  points: DailyPricePoint[];
  tone: "up" | "down" | "flat";
}) {
  // Two points is the minimum that has a direction; one is a dot and none is
  // nothing, and both should draw as absent rather than as a flat line, which
  // would read as "this stock did not move".
  if (points.length < 2) return null;

  const closes = [...points].reverse().map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min;

  const x = (i: number) => (i / (closes.length - 1)) * (W - PAD * 2) + PAD;
  /* A flat series has no range to scale against, so it is pinned to the middle
     rather than divided by zero. */
  const y = (v: number) =>
    span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = closes.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(closes.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const lastX = x(closes.length - 1);
  const lastY = y(closes[closes.length - 1]);
  const id = `spot-fill-${tone}`;

  return (
    <svg
      className={`desk-spot-spark is-${tone}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`최근 ${closes.length}거래일 종가 추이`}
    >
      <defs>
        {/* Fades to nothing at the baseline so the fill reads as depth under the
            line rather than as a filled shape with an edge of its own. */}
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        /* The viewBox is stretched non-uniformly to fit the card, which would
           otherwise stretch the stroke with it and leave the line thicker on one
           axis than the other. */
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="2.2" fill="currentColor" />
    </svg>
  );
}
