import { useEffect, useMemo, useState } from "react";
import { MarketMapItem, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";

/* How wide the market is up or down, and which 업종 is carrying it.
 *
 * Every number here is derived, not fetched. The two market maps are already
 * warmed in the backend's cache for the KOSPI and KOSDAQ treemap pages and are
 * already a full per-stock snapshot — code, sector, cap and today's move for
 * seven hundred names — so the whole widget costs two cached GETs that most
 * visitors' browsers have made anyway.
 *
 * The reason it is worth drawing at all: an index is a cap-weighted average,
 * and a cap-weighted average is one stock's opinion when that stock is fifteen
 * per cent of the market. "코스피 +0.4%" and "상승 210 / 하락 480" are both true
 * on the same afternoon, and only the second one tells the reader that their
 * own holding is probably red. That gap is what breadth measures, and it is the
 * single most useful thing on this page that the classic desk never showed. */

const REFRESH_MS = 60_000;
/** A move this size or bigger counts as a real one rather than noise. */
const STRONG_PCT = 5;
/** Sectors shown on each side of the heat list. */
const SECTOR_SHOWN = 5;
/** A sector needs this many names before its average means anything. */
const SECTOR_MIN_MEMBERS = 3;

interface Breadth {
  up: number;
  down: number;
  flat: number;
  strongUp: number;
  strongDown: number;
  /** 0 = everything down, 100 = everything up. */
  temperature: number;
  sectors: SectorHeat[];
  total: number;
}

interface SectorHeat {
  sector: string;
  /** Cap-weighted mean move, in per cent. */
  change: number;
  members: number;
}

function measure(items: MarketMapItem[]): Breadth {
  let up = 0;
  let down = 0;
  let strongUp = 0;
  let strongDown = 0;

  /* Cap-weighted rather than a plain mean of the members' percentages. A
     sector's move is what its money did, and an equal-weighted average lets the
     smallest listed name in 반도체 count for as much as Samsung — which makes
     the list read as a survey of micro caps rather than as where the market
     went. Both sums are carried so the division happens once at the end. */
  const weighted = new Map<string, { sum: number; cap: number; members: number }>();

  for (const item of items) {
    if (item.change_pct > 0) up += 1;
    else if (item.change_pct < 0) down += 1;
    if (item.change_pct >= STRONG_PCT) strongUp += 1;
    else if (item.change_pct <= -STRONG_PCT) strongDown += 1;

    const sector = item.sector?.trim();
    if (!sector) continue;
    const cap = Math.max(item.marcap, 0);
    const bucket = weighted.get(sector);
    if (bucket) {
      bucket.sum += item.change_pct * cap;
      bucket.cap += cap;
      bucket.members += 1;
    } else {
      weighted.set(sector, { sum: item.change_pct * cap, cap, members: 1 });
    }
  }

  const sectors: SectorHeat[] = [];
  for (const [sector, bucket] of weighted) {
    if (bucket.members < SECTOR_MIN_MEMBERS || bucket.cap <= 0) continue;
    sectors.push({ sector, change: bucket.sum / bucket.cap, members: bucket.members });
  }
  sectors.sort((a, b) => b.change - a.change);

  const decisive = up + down;
  return {
    up,
    down,
    flat: items.length - up - down,
    strongUp,
    strongDown,
    temperature: decisive > 0 ? (up / decisive) * 100 : 50,
    sectors,
    total: items.length,
  };
}

/** What the temperature reads as, in words. The bands are deliberately wide:
 *  breadth is a mood, and reporting it to one decimal place would claim a
 *  precision that a count of stocks does not have. */
function moodFor(temperature: number): { key: string; tone: "hot" | "warm" | "even" | "cool" | "cold" } {
  if (temperature >= 70) return { key: "강한 매수 우위", tone: "hot" };
  if (temperature >= 56) return { key: "매수 우위", tone: "warm" };
  if (temperature > 44) return { key: "혼조", tone: "even" };
  if (temperature > 30) return { key: "매도 우위", tone: "cool" };
  return { key: "강한 매도 우위", tone: "cold" };
}

export default function MarketBreadthGauge({
  onOpenSector,
}: {
  onOpenSector?: (sector: string) => void;
}) {
  const t = useT();
  const [items, setItems] = useState<MarketMapItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      /* Both boards, because breadth across one of them is not breadth across
         the market — KOSDAQ is where most of the listed names are and where a
         retail reader's holdings mostly sit, and a KOSPI-only count would say
         the opposite thing on plenty of days. */
      Promise.all([api.marketMap(500, false), api.kosdaqMap(200, false)])
        .then(([kospi, kosdaq]) => {
          if (cancelled) return;
          setItems([...kospi.items, ...kosdaq.items]);
        })
        .catch(() => {
          // A missed refresh keeps the last reading rather than blanking it.
        });
    };

    load();
    const stop = startVisibilityAwareInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const breadth = useMemo(() => (items ? measure(items) : null), [items]);

  if (!breadth) {
    return (
      <section className="desk-breadth desk-breadth--loading" aria-busy="true">
        <div className="desk-card-head">
          <h3>{t("시장 폭")}</h3>
        </div>
        <div className="desk-breadth-skeleton">
          <span className="skeleton" style={{ height: 58 }} />
          <span className="skeleton" style={{ height: 22 }} />
          <span className="skeleton" style={{ height: 96 }} />
        </div>
      </section>
    );
  }

  const mood = moodFor(breadth.temperature);
  const decisive = Math.max(breadth.up + breadth.down + breadth.flat, 1);
  const upPct = (breadth.up / decisive) * 100;
  const flatPct = (breadth.flat / decisive) * 100;
  const downPct = (breadth.down / decisive) * 100;

  const leaders = breadth.sectors.slice(0, SECTOR_SHOWN);
  const laggards = breadth.sectors.slice(-SECTOR_SHOWN).reverse();
  // The widest move on either side sets the bar scale, so the longest bar always
  // fills its track and the rest are read against it rather than against a
  // fixed percentage that most days would leave every bar a stub.
  const span = Math.max(
    0.4,
    ...leaders.map((s) => Math.abs(s.change)),
    ...laggards.map((s) => Math.abs(s.change))
  );

  return (
    <section className="desk-breadth" aria-labelledby="desk-breadth-title">
      <div className="desk-card-head">
        <h3 id="desk-breadth-title">{t("시장 폭")}</h3>
        <span className="desk-card-note">
          {t("코스피+코스닥")} {breadth.total.toLocaleString()}
          {t("종목")}
        </span>
      </div>

      {/* The reading itself. The number is the share of decisive stocks that are
          up, so 50 is a genuinely even tape and the two ends are unambiguous. */}
      <div className={`desk-temp desk-temp--${mood.tone}`}>
        <div className="desk-temp-dial" role="img" aria-label={`${t("시장 체온")} ${Math.round(breadth.temperature)}`}>
          <span className="desk-temp-value">{Math.round(breadth.temperature)}</span>
          <span className="desk-temp-unit">°</span>
        </div>
        <div className="desk-temp-read">
          <strong className="desk-temp-mood">{t(mood.key)}</strong>
          <span className="desk-temp-sub">
            {t("상승")} {breadth.up.toLocaleString()} · {t("하락")} {breadth.down.toLocaleString()}
          </span>
          <span className="desk-temp-strong">
            <em className="is-up">
              +{STRONG_PCT}% {t("이상")} {breadth.strongUp}
            </em>
            <em className="is-down">
              −{STRONG_PCT}% {t("이하")} {breadth.strongDown}
            </em>
          </span>
        </div>
      </div>

      {/* One bar, three segments, in the order a reader scans: gains on the left
          in the market's own up colour. Percentages go straight into flex-grow
          so the bar needs no measurement and reflows with the card. */}
      <div className="desk-adline" role="img" aria-label={`${t("상승")} ${breadth.up} ${t("하락")} ${breadth.down}`}>
        <span className="desk-adline-seg is-up" style={{ flexGrow: upPct }}>
          {upPct > 12 && <b>{breadth.up}</b>}
        </span>
        <span className="desk-adline-seg is-flat" style={{ flexGrow: Math.max(flatPct, 0.6) }}>
          {flatPct > 12 && <b>{breadth.flat}</b>}
        </span>
        <span className="desk-adline-seg is-down" style={{ flexGrow: downPct }}>
          {downPct > 12 && <b>{breadth.down}</b>}
        </span>
      </div>

      <div className="desk-sectors">
        <SectorColumn
          title={t("주도 업종")}
          rows={leaders}
          span={span}
          tone="up"
          onOpenSector={onOpenSector}
        />
        <SectorColumn
          title={t("부진 업종")}
          rows={laggards}
          span={span}
          tone="down"
          onOpenSector={onOpenSector}
        />
      </div>
    </section>
  );
}

function SectorColumn({
  title,
  rows,
  span,
  tone,
  onOpenSector,
}: {
  title: string;
  rows: SectorHeat[];
  span: number;
  tone: "up" | "down";
  onOpenSector?: (sector: string) => void;
}) {
  return (
    <div className={`desk-sector-col desk-sector-col--${tone}`}>
      <h4>{title}</h4>
      <ul>
        {rows.map((row) => {
          const width = Math.min(100, (Math.abs(row.change) / span) * 100);
          const label = `${row.sector} ${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)}%`;
          return (
            <li key={row.sector}>
              {/* A button only when there is somewhere to go — the column is
                  readable on its own and should not present a dozen dead
                  controls to a keyboard just because it could. */}
              {onOpenSector ? (
                <button type="button" onClick={() => onOpenSector(row.sector)} aria-label={label}>
                  <SectorRow row={row} width={width} />
                </button>
              ) : (
                <SectorRow row={row} width={width} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SectorRow({ row, width }: { row: SectorHeat; width: number }) {
  return (
    <>
      <span className="desk-sector-name">{row.sector}</span>
      <span className="desk-sector-track">
        <span
          className={`desk-sector-fill ${row.change >= 0 ? "is-up" : "is-down"}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={`desk-sector-pct ${row.change >= 0 ? "change-up" : "change-down"}`}>
        {row.change >= 0 ? "+" : ""}
        {row.change.toFixed(2)}%
      </span>
    </>
  );
}
