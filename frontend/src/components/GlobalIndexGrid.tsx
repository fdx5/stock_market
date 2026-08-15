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
  const values = item.points.map((point) => point.close).filter(Number.isFinite);
  const periodHigh = values.length ? Math.max(...values) : null;
  const periodLow = values.length ? Math.min(...values) : null;
  const previousClose = item.close !== null && item.change !== null ? item.close - item.change : null;
  const latestDate = item.points[item.points.length - 1]?.date?.slice(5).replace("-", ".") ?? "-";
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
            <div className="global-index-tile-extra">
              <span><small>전일</small><b>{previousClose === null ? "-" : formatIndexValue(previousClose, item.unit)}</b></span>
              <span><small>기간 고가</small><b>{periodHigh === null ? "-" : formatIndexValue(periodHigh, item.unit)}</b></span>
              <span><small>기간 저가</small><b>{periodLow === null ? "-" : formatIndexValue(periodLow, item.unit)}</b></span>
            </div>
          </>
        ) : (
          <span className="global-index-tile-value global-index-tile-value--empty">-</span>
        )}
      </div>
      <div className="global-index-chart-side"><Sparkline points={item.points} colorVar={colorVar} /><span>{latestDate} 기준 · {item.points.length}개 구간</span></div>
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

export default function GlobalIndexGrid({ excludeKr = false }: { excludeKr?: boolean }) {
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
  /* `excludeKr` drops anything flagged as a Korean instrument. That is one entry
     today — KORU, a Korea leverage ETF that trades in New York, so the backend
     files it under the US group, correctly. It is still a Korean-market product,
     and the global desk's brief is that no KR market information appears there.
     The KR desk passes nothing and keeps it. */
  const visible = excludeKr ? (items ?? []).filter((it) => it.flag !== "kr") : (items ?? []);
  const usMembers = visible.filter((it) => it.group !== "overseas");
  const overseasMembers = visible.filter((it) => it.group === "overseas");

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
