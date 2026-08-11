import { useEffect, useState } from "react";
import { GlobalIndexWidget, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";

/* The US majors, compact, in the global desk's sticky command bar.
 *
 * Same job as DeskIndexStrip does for KOSPI/KOSDAQ and the same justification:
 * the deck stays on screen and the pulse row does not, so this is the index
 * context that survives a scroll down into the chart.
 *
 * Two filters decide what appears, and the second one is the point of this
 * component rather than a detail. `group === "us"` is the backend's own split
 * between the US majors and the overseas markets. `flag !== "kr"` then removes
 * KORU — a Korea leverage ETF that trades in New York, so the backend files it
 * under the US group, correctly. It is still a Korean-market instrument, and the
 * brief for this page is that no KR market information appears on it.
 */

const REFRESH_MS = 30_000;
/** Three fit the bar. The full grid below carries the rest. */
const SHOWN = 3;

export default function UsIndexStrip() {
  const t = useT();
  const [items, setItems] = useState<GlobalIndexWidget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .globalIndices()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
        })
        .catch(() => {
          // A missed refresh keeps the last print rather than blanking the bar.
        });
    };
    load();
    const stop = startVisibilityAwareInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const us = (items ?? [])
    .filter((item) => item.group === "us" && item.flag !== "kr")
    .slice(0, SHOWN);

  if (items === null) {
    return (
      <div className="desk-idx" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="desk-idx-cell" key={i}>
            <span className="skeleton" style={{ width: 44, height: 10 }} />
            <span className="skeleton" style={{ width: 78, height: 17 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="desk-idx" role="group" aria-label={t("미국 지수")}>
      {us.map((item, index) => {
        const pct = item.change_pct ?? 0;
        const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
        return (
          <div className="desk-idx-cell" key={item.key}>
            {index > 0 && <span className="desk-idx-sep" aria-hidden="true" />}
            <span className="desk-idx-label">{item.label}</span>
            <span className="desk-idx-value">
              {item.close === null
                ? "—"
                : item.close.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </span>
            <span className={`desk-idx-delta change-${tone}`}>
              <i aria-hidden="true">{pct > 0 ? "▲" : pct < 0 ? "▼" : "—"}</i>
              {Math.abs(item.change ?? 0).toFixed(2)} ({pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}
