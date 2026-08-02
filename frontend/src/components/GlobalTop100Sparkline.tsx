import { PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/LanguageContext";

/** Same SVG geometry as StockBoardPage's Sparkline (polyline + area + dashed opening-
 * price baseline + hover crosshair/readout) but currency-generic: the TOP 100 roster
 * trades in USD/KRW/SAR/CNY/EUR/... and StockBoardPage's formatPrice only knows
 * "KRW"|"USD", so this copies the geometry rather than adding a currency union to a
 * component three other pages already depend on. */

export function formatPrice(value: number, currency: string | null): string {
  if (!currency) return value.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: value >= 1000 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unrecognized ISO currency code (shouldn't happen, but Intl throws rather
    // than degrading) falls back to a bare number with the raw code prefixed.
    return `${currency} ${value.toLocaleString()}`;
  }
}

function formatSparkDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}`;
}

export default function GlobalTop100Sparkline({
  points,
  dates,
  currency,
  trend,
}: {
  points: number[];
  dates: string[];
  currency: string | null;
  trend: "up" | "down" | "flat";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const x = (i: number) => (i / (points.length - 1)) * 100;
    const y = (v: number) => 94 - ((v - min) / span) * 88;
    const coords = points.map((v, i) => [x(i), y(v)] as const);
    return {
      coords,
      line: coords.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" "),
      area: `0,100 ${coords.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" ")} 100,100`,
      base: y(points[0]),
    };
  }, [points]);

  if (!geometry) {
    return <div className="gt100-spark gt100-spark--empty">{t("차트 데이터 없음")}</div>;
  }

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };

  const index = hover ?? points.length - 1;
  const [hx, hy] = geometry.coords[index];
  const dateOffset = dates.length - points.length;
  const hoverDate =
    index === points.length - 1 ? t("현재") : formatSparkDate(dates[dateOffset + index] ?? "");

  return (
    <div className="gt100-spark" data-trend={trend}>
      <svg
        ref={svgRef}
        className="gt100-spark-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("최근 시세 추이")}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <polyline className="gt100-spark-area" points={geometry.area} />
        <line className="gt100-spark-base" x1="0" x2="100" y1={geometry.base} y2={geometry.base} />
        <polyline className="gt100-spark-line" points={geometry.line} vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line
            className="gt100-spark-crosshair"
            x1={hx}
            x2={hx}
            y1="0"
            y2="100"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="gt100-spark-dot" style={{ left: `${hx}%`, top: `${hy}%` }} />
      <span className="gt100-spark-readout" data-active={hover !== null}>
        <b>{formatPrice(points[index], currency)}</b>
        <i>{hoverDate}</i>
      </span>
    </div>
  );
}
