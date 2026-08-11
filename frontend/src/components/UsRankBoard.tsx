import { useMemo, useState } from "react";
import { MarketMapItem, StockSearchResult } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useUsMarketSnapshot } from "../useUsMarketSnapshot";
import StockLogo from "./StockLogo";

/* The global desk's answer to the KR desk's 수급 · 순위 band.
 *
 * It is deliberately not the same board. The KR one leads on investor flows —
 * 개인/외국인/기관 net buying, the weekly foreign top twenty — and none of that
 * exists on the US side: no free feed breaks US volume out by participant, and
 * this app has no endpoint that pretends to. Putting an empty tab there labelled
 * 수급 would be worse than not having one.
 *
 * So the band is the two things a US constituent snapshot genuinely supports:
 * which names moved most in each direction, and which sectors carried the index.
 * Both are derived from the maps that are already loaded for the breadth gauge
 * and the spotlight, so the whole board costs nothing beyond what the page above
 * it has already fetched.
 */

const ROWS = 15;
/** Below this the percentage is a rounding artefact on a mega cap rather than a
 * move, and a "top gainers" list full of +0.02% reads as broken. */
const MIN_MOVE = 0.01;

type Tab = "gainers" | "losers" | "sectors";
type Scope = "all" | "sp500" | "nasdaq";

interface SectorRow {
  sector: string;
  change: number;
  members: number;
}

/** Cap-weighted, like every other sector figure on this site — an equal-weighted
 * average lets the smallest constituent count as much as Apple. */
function sectorRows(items: MarketMapItem[]): SectorRow[] {
  const acc = new Map<string, { sum: number; cap: number; members: number }>();
  for (const item of items) {
    const sector = item.sector?.trim();
    if (!sector) continue;
    const cap = Math.max(item.market_cap ?? item.marcap, 0);
    const bucket = acc.get(sector);
    if (bucket) {
      bucket.sum += item.change_pct * cap;
      bucket.cap += cap;
      bucket.members += 1;
    } else {
      acc.set(sector, { sum: item.change_pct * cap, cap, members: 1 });
    }
  }
  return [...acc.entries()]
    .filter(([, b]) => b.cap > 0)
    .map(([sector, b]) => ({ sector, change: b.sum / b.cap, members: b.members }))
    .sort((a, b) => b.change - a.change);
}

export default function UsRankBoard({
  onSelect,
  activeCode,
}: {
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
}) {
  const t = useT();
  const snapshot = useUsMarketSnapshot();
  const [tab, setTab] = useState<Tab>("gainers");
  const [scope, setScope] = useState<Scope>("all");

  const universe = useMemo(() => {
    if (scope === "sp500") return snapshot.sp500;
    if (scope === "nasdaq") return snapshot.nasdaq;
    return snapshot.all;
  }, [scope, snapshot]);

  const gainers = useMemo(
    () =>
      [...universe]
        .filter((i) => i.change_pct >= MIN_MOVE)
        .sort((a, b) => b.change_pct - a.change_pct)
        .slice(0, ROWS),
    [universe]
  );
  const losers = useMemo(
    () =>
      [...universe]
        .filter((i) => i.change_pct <= -MIN_MOVE)
        .sort((a, b) => a.change_pct - b.change_pct)
        .slice(0, ROWS),
    [universe]
  );
  const sectors = useMemo(() => sectorRows(universe), [universe]);

  const loading = snapshot.generatedAt === null;
  const rows = tab === "gainers" ? gainers : losers;
  const sectorSpan = Math.max(0.4, ...sectors.map((s) => Math.abs(s.change)));

  return (
    <div className="desk-usrank">
      <div className="desk-usrank-bar">
        <div className="desk-seg" role="tablist" aria-label={t("순위")}>
          {(
            [
              ["gainers", "상승 TOP"],
              ["losers", "하락 TOP"],
              ["sectors", "업종별 등락"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "is-on" : ""}
              onClick={() => setTab(key)}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {/* Which universe the ranking is over. The two indices overlap heavily,
            so "전체" is the deduplicated union rather than the two concatenated —
            see useUsMarketSnapshot. */}
        <div className="desk-seg desk-seg--scope" role="tablist" aria-label={t("범위")}>
          {(
            [
              ["all", "전체"],
              ["sp500", "S&P 500"],
              ["nasdaq", "나스닥 100"],
            ] as [Scope, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={scope === key}
              className={scope === key ? "is-on" : ""}
              onClick={() => setScope(key)}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="desk-usrank-skeleton">
          {Array.from({ length: 8 }, (_, i) => (
            <span className="skeleton" style={{ height: 26 }} key={i} />
          ))}
        </div>
      ) : tab === "sectors" ? (
        <ul className="desk-usrank-sectors">
          {sectors.map((row) => (
            <li key={row.sector}>
              <span className="desk-usrank-sector-name">{row.sector}</span>
              <span className="desk-usrank-sector-count">{row.members}</span>
              <span className="desk-sector-track">
                <span
                  className={`desk-sector-fill ${row.change >= 0 ? "is-up" : "is-down"}`}
                  style={{ width: `${Math.min(100, (Math.abs(row.change) / sectorSpan) * 100)}%` }}
                />
              </span>
              <span className={`desk-sector-pct ${row.change >= 0 ? "change-up" : "change-down"}`}>
                {row.change >= 0 ? "+" : ""}
                {row.change.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="desk-usrank-list">
          {rows.map((item, index) => {
            const tone = item.change_pct > 0 ? "up" : item.change_pct < 0 ? "down" : "flat";
            return (
              <li key={item.code}>
                <button
                  type="button"
                  className={`desk-usrank-row ${activeCode === item.code ? "is-active" : ""}`}
                  onClick={() => onSelect({ code: item.code, name: item.name, market: "US" })}
                  title={`${item.name} (${item.code})`}
                >
                  <span className="desk-usrank-rank">{index + 1}</span>
                  <StockLogo code={item.code} className="desk-usrank-logo" />
                  <span className="desk-usrank-code">{item.code}</span>
                  <span className="desk-usrank-name">{item.name}</span>
                  <span className="desk-usrank-sector">{item.sector}</span>
                  <span className="desk-usrank-price">
                    ${item.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span className={`desk-usrank-pct change-${tone}`}>
                    {item.change_pct >= 0 ? "+" : ""}
                    {item.change_pct.toFixed(2)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
