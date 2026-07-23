import { useEffect, useState } from "react";
import { GlobalIndexPoint, GlobalIndexWidget, api } from "../api/client";
import { startVisibilityAwareInterval } from "../pollVisibility";

/** Whether a KOSPI futures session is open — and so how many members the US flip-tile
 * cycles through — changes on the clock, so the grid can't be a fetch-once widget. A
 * minute of lag on a session boundary is invisible. */
const REFRESH_MS = 60_000;

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

function TileFace({ item }: { item: GlobalIndexWidget }) {
  const pct = item.change_pct ?? 0;
  const cls = changeClass(pct);
  const colorVar = pct < 0 ? "var(--down-color)" : "var(--up-color)";
  return (
    <div className="global-index-face">
      <div className="global-index-tile-info">
        <span className="global-index-tile-label">
          {item.flag && (
            <img className="global-index-tile-flag" src={`/img/flag/${item.flag}.svg`} alt="" loading="lazy" />
          )}
          <span className="global-index-tile-name">{item.label}</span>
        </span>
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

/** One slot of the grid: a viewport exactly one face tall that rolls a vertical stack
 * of its members upward, one at a time, on a CSS clock — the same bottom-to-top flip
 * the FX/commodity strip uses. The first member is repeated at the end of the track so
 * the wrap from the last member back to the first is seamless (the duplicate sits where
 * the original starts). The keyframes are picked by member count (`--3`…`--6`) so the
 * dwell-then-slide cadence stays even however many indices the group holds — the US
 * group grows by one while a KOSPI 200 futures session is open. */
function FlipTile({ members }: { members: GlobalIndexWidget[] }) {
  // A lone member (or none) has nothing to roll to, so it sits still — no duplicate,
  // no animation class — rather than sliding a tile into a copy of itself.
  if (members.length <= 1) {
    return (
      <div className="global-index-tile">{members[0] && <TileFace item={members[0]} />}</div>
    );
  }

  return (
    <div className="global-index-tile global-index-tile--rotating">
      <div className={`global-index-flip-track global-index-flip-track--${members.length}`}>
        {[...members, members[0]].map((item, idx) => (
          <TileFace key={`${item.key}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

export default function GlobalIndexGrid() {
  const [items, setItems] = useState<GlobalIndexWidget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (isFirst: boolean) =>
      api
        .globalIndices()
        .then((res) => {
          if (!cancelled) setItems(res.items);
        })
        .catch(() => {
          // A failed refresh keeps whatever is already on screen; only the first load
          // has nothing to fall back to and has to resolve the skeletons.
          if (!cancelled && isFirst) setItems([]);
        });

    load(true);
    const stop = startVisibilityAwareInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // Two rolling tiles, split by the group the backend tags each index with — US majors
  // (plus the live KOSPI futures print when its session is open) in one, the overseas
  // markets in the other. Order within each group is preserved as sent.
  const usMembers = items?.filter((it) => it.group !== "overseas") ?? [];
  const overseasMembers = items?.filter((it) => it.group === "overseas") ?? [];

  return (
    <div className="global-index-grid">
      {items === null ? (
        [0, 1].map((i) => <div key={i} className="global-index-tile global-index-tile--skeleton" />)
      ) : (
        <>
          <FlipTile members={usMembers} />
          <FlipTile members={overseasMembers} />
        </>
      )}
    </div>
  );
}
