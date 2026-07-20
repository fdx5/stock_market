import { useEffect, useState } from "react";
import { GlobalIndexPoint, GlobalIndexWidget, api } from "../api/client";

function formatIndexValue(v: number, unit: "index" | "usd"): string {
  const formatted = v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit === "usd" ? `$${formatted}` : formatted;
}

function changeClass(pct: number): string {
  if (pct > 0) return "change-up";
  if (pct < 0) return "change-down";
  return "change-flat";
}

/** A decorative trend indicator riding a stat tile, not a primary chart — no axes,
 * gridlines, or hover; a 2px line + a light area wash in the same up/down status color
 * the rest of the app already uses for price direction (--up-color/--down-color). */
function Sparkline({ points, colorVar }: { points: GlobalIndexPoint[]; colorVar: string }) {
  if (points.length < 2) return <div className="global-index-spark global-index-spark--empty" />;

  const width = 120;
  const height = 40;
  const values = points.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = values.map((v, i) => [i * stepX, height - ((v - min) / range) * height] as const);
  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="global-index-spark" preserveAspectRatio="none" aria-hidden="true">
      <path d={areaPath} fill={colorVar} opacity={0.1} stroke="none" />
      <path d={linePath} fill="none" stroke={colorVar} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IndexTile({ item }: { item: GlobalIndexWidget }) {
  const pct = item.change_pct ?? 0;
  const cls = changeClass(pct);
  const colorVar = pct < 0 ? "var(--down-color)" : "var(--up-color)";
  return (
    <div className="global-index-tile">
      <div className="global-index-tile-info">
        <span className="global-index-tile-label">{item.label}</span>
        {item.close !== null ? (
          <>
            <span className="global-index-tile-value">{formatIndexValue(item.close, item.unit)}</span>
            <span className={`global-index-tile-change ${cls}`}>
              {pct > 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="global-index-tile-value global-index-tile-value--empty">-</span>
        )}
      </div>
      <Sparkline points={item.points} colorVar={colorVar} />
    </div>
  );
}

export default function GlobalIndexGrid() {
  const [items, setItems] = useState<GlobalIndexWidget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .globalIndices()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="global-index-grid">
      {items === null &&
        [0, 1, 2, 3].map((i) => <div key={i} className="global-index-tile global-index-tile--skeleton" />)}
      {items?.map((item) => (
        <IndexTile key={item.key} item={item} />
      ))}
    </div>
  );
}
