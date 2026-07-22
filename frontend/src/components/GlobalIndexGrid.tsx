import { useEffect, useState } from "react";
import { GlobalIndexPoint, GlobalIndexWidget, api } from "../api/client";
import { startVisibilityAwareInterval } from "../pollVisibility";

/** How long each face of a rotating tile is held still before the next slide. */
const ROTATE_HOLD_MS = 5000;
/** Must stay in sync with the .global-index-track transition in styles.css. */
const ROTATE_SLIDE_MS = 600;
/** Whether a KOSPI futures session is open — and so whether the SOXL tile has a
 * partner to rotate with at all — changes on the clock, so the grid can't be a
 * fetch-once widget. A minute of lag on a session boundary is invisible. */
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

/** One slot of the grid. Normally a single static face; when the backend hands the
 * tile an `alt` (the SOXL slot during a KOSPI 200 futures session) the two take turns,
 * the incoming one entering from the right and pushing the outgoing one off to the
 * left.
 *
 * The two faces sit side by side in a track twice the slot's width. A rotation slides
 * the track one full face left, then — with the transition off — swaps which face is
 * rendered first and resets the offset to zero. That snap is invisible because the
 * face now sitting at offset zero is the same one that just finished sliding into
 * view, and it's what keeps every rotation running right-to-left instead of the second
 * one reversing back the way it came. */
function IndexTile({ item }: { item: GlobalIndexWidget }) {
  const alt = item.alt;
  // Keyed on identity, not the object: the grid refetches every minute and would
  // otherwise restart the rotation clock mid-cycle on every refresh.
  const altKey = alt?.key;
  const [flips, setFlips] = useState(0);
  const [sliding, setSliding] = useState(false);

  useEffect(() => {
    if (!altKey) return;
    let slideId: number | undefined;
    const holdId = window.setInterval(() => {
      setSliding(true);
      slideId = window.setTimeout(() => {
        setFlips((n) => n + 1);
        setSliding(false);
      }, ROTATE_SLIDE_MS);
    }, ROTATE_HOLD_MS + ROTATE_SLIDE_MS);
    return () => {
      window.clearInterval(holdId);
      window.clearTimeout(slideId);
      // A session that just closed takes the partner face with it; landing back on the
      // primary face keeps the slot from being stranded mid-slide showing a stale one.
      setSliding(false);
    };
  }, [altKey]);

  if (!alt) {
    return (
      <div className="global-index-tile">
        <TileFace item={item} />
      </div>
    );
  }

  const [front, back] = flips % 2 === 0 ? [item, alt] : [alt, item];
  return (
    <div className="global-index-tile global-index-tile--rotating">
      <div className={`global-index-track ${sliding ? "is-sliding" : ""}`}>
        <TileFace item={front} />
        <TileFace item={back} />
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
