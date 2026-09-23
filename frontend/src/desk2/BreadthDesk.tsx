import { MarketMapItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Link, navigate } from "../router";
import StockLogo from "../components/StockLogo";
import { Skel } from "./parts";
import { Breadth, HISTOGRAM_BINS, STRONG_PCT, SectorHeat, num, openStock, pct, signed, useL } from "./lib";

/* 02 시장 폭.
 *
 * The index is a cap-weighted average, and a cap-weighted average is one stock's
 * opinion when that stock is a fifth of the market. This section is everything
 * the index number hides, drawn from the same 700-name snapshot:
 *
 *  - 등락 분포 (new): how today's moves are spread, in eleven buckets. An index
 *    +0.2% can be a quiet day with everything near zero or a split one with
 *    fat tails both ways, and only the shape says which.
 *  - 업종 지도 (new): every sector as a strip, width by size, colour by move —
 *    a treemap flattened into one line, so it fits under the histogram.
 *  - 지수 쏠림: the same moves averaged by size and averaged plainly, and the
 *    gap between them.
 *  - 주도 / 부진 업종 and — new — the names at the daily price limit. */

function Histogram({ breadth }: { breadth: Breadth }) {
  const L = useL();
  const max = Math.max(1, ...breadth.histogram);
  return (
    <figure className="d2-hist">
      <div className="d2-block-head">
        <h3>{L("등락률 분포", "Distribution of moves")}</h3>
        <small>
          {num(breadth.total)}
          {L("종목", " names")}
        </small>
      </div>
      <div className="d2-hist-plot" role="img" aria-label={HISTOGRAM_BINS.map((b, i) => `${b.label}% ${breadth.histogram[i]}`).join(", ")}>
        {HISTOGRAM_BINS.map((bin, i) => {
          const n = breadth.histogram[i];
          return (
            <div key={bin.label} className={`d2-hist-col is-${bin.tone}`}>
              <b>{n}</b>
              <span className="d2-hist-bar" style={{ height: `${(n / max) * 100}%` }} />
              <small>{bin.label}</small>
            </div>
          );
        })}
      </div>
      <figcaption>
        {L("가로축은 오늘 등락률(%) 구간, 세로축은 종목 수. 가운데 '0'은 보합.", "Buckets of today's move (%); bar height is the number of names. '0' is unchanged.")}
      </figcaption>
    </figure>
  );
}

function SectorStrip({ sectors }: { sectors: SectorHeat[] }) {
  const L = useL();
  // Ordered by size so the strip reads like the map it stands in for.
  const bySize = [...sectors].sort((a, b) => b.cap - a.cap);
  const total = bySize.reduce((s, x) => s + x.cap, 0) || 1;
  return (
    <div className="d2-strip">
      <div className="d2-block-head">
        <h3>{L("업종 지도", "Sector strip")}</h3>
        <Link to="/map" className="d2-more">
          {L("시가총액 맵 전체", "Full market map")} →
        </Link>
      </div>
      <div className="d2-strip-row">
        {bySize.map((s) => {
          const share = (s.cap / total) * 100;
          const intensity = Math.min(1, Math.abs(s.change) / 3);
          return (
            <button
              key={s.sector}
              type="button"
              className={`d2-strip-cell is-${s.change > 0 ? "up" : s.change < 0 ? "down" : "flat"}`}
              style={{ flexGrow: share, ["--heat" as string]: intensity.toFixed(2) }}
              data-narrow={share < 12 ? "" : undefined}
              title={`${s.sector} ${pct(s.change)} · ${s.members}${L("종목", " names")}`}
              onClick={() => navigate("/map")}
            >
              {share > 4.5 && (
                <>
                  <span>{s.sector}</span>
                  <b>{pct(s.change, 1)}</b>
                </>
              )}
            </button>
          );
        })}
      </div>
      <p className="d2-strip-legend">
        <span className="is-down">−3%</span>
        <i aria-hidden="true" />
        <span className="is-up">+3%</span>
        <small>{L("폭은 업종 시가총액 비중", "Width is the sector's share of market cap")}</small>
      </p>
    </div>
  );
}

function Tilt({ breadth }: { breadth: Breadth }) {
  const L = useL();
  const gap = breadth.capWeighted - breadth.equalWeighted;
  const verdict = gap >= 0.25 ? L("대형주 우위", "Large caps ahead") : gap <= -0.25 ? L("중소형주 우위", "Small caps ahead") : L("고른 흐름", "Even");
  const reach = Math.min(1, Math.abs(gap) / 1.5) * 50;
  return (
    <div className="d2-tilt">
      <div className="d2-block-head">
        <h3>{L("지수 쏠림", "Index tilt")}</h3>
        <em>{verdict}</em>
      </div>
      <dl>
        <div>
          <dt>{L("시총가중", "Cap-weighted")}</dt>
          <dd className={breadth.capWeighted >= 0 ? "is-up" : "is-down"}>{pct(breadth.capWeighted)}</dd>
        </div>
        <div>
          <dt>{L("동일가중", "Equal-weighted")}</dt>
          <dd className={breadth.equalWeighted >= 0 ? "is-up" : "is-down"}>{pct(breadth.equalWeighted)}</dd>
        </div>
        <div>
          <dt>{L("격차", "Gap")}</dt>
          <dd>{signed(gap)}%p</dd>
        </div>
      </dl>
      <div className="d2-tilt-track" aria-hidden="true">
        <span>{L("중소형", "Small")}</span>
        <i className="d2-tilt-bar">
          <i className="d2-tilt-mid" />
          <i className="d2-tilt-fill" style={gap >= 0 ? { left: "50%", width: `${reach}%` } : { right: "50%", width: `${reach}%` }} />
        </i>
        <span>{L("대형", "Large")}</span>
      </div>
      <div className="d2-tilt-counts">
        <span className="is-up">
          +{STRONG_PCT}% {L("이상", "or more")} <b>{breadth.strongUp}</b>
        </span>
        <span className="is-down">
          −{STRONG_PCT}% {L("이하", "or less")} <b>{breadth.strongDown}</b>
        </span>
      </div>
    </div>
  );
}

function SectorBars({ title, rows, span, tone }: { title: string; rows: SectorHeat[]; span: number; tone: "up" | "down" }) {
  return (
    <div className={`d2-sectors is-${tone}`}>
      <h4>{title}</h4>
      <ol>
        {rows.map((r) => (
          <li key={r.sector}>
            <span className="d2-sectors-name">{r.sector}</span>
            <span className="d2-sectors-track">
              <i className={r.change >= 0 ? "is-up" : "is-down"} style={{ width: `${Math.min(100, (Math.abs(r.change) / span) * 100)}%` }} />
            </span>
            <b className={r.change >= 0 ? "is-up" : "is-down"}>{pct(r.change)}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LimitList({ title, items, tone }: { title: string; items: MarketMapItem[]; tone: "up" | "down" }) {
  const L = useL();
  return (
    <div className={`d2-limits is-${tone}`}>
      <h4>
        {title} <b>{items.length}</b>
      </h4>
      {items.length === 0 ? (
        <p>{L("해당 종목 없음", "None today")}</p>
      ) : (
        <ul>
          {items.slice(0, 6).map((item) => (
            <li key={item.code}>
              <button type="button" onClick={() => openStock({ code: item.code, name: item.name, market: "KOSPI" })}>
                <StockLogo code={item.code} name={item.name} className="d2-limits-logo" />
                <span>{item.name}</span>
                <b>{pct(item.change_pct)}</b>
              </button>
            </li>
          ))}
          {items.length > 6 && <li className="d2-limits-more">+{items.length - 6}</li>}
        </ul>
      )}
    </div>
  );
}

export default function BreadthDesk({ breadth }: { breadth: Breadth | null }) {
  const { lang } = useLanguage();
  const L = useL();
  if (!breadth) {
    return (
      <div className="d2-breadth-grid">
        <Skel h={220} />
        <Skel h={220} />
        <Skel h={220} />
      </div>
    );
  }
  const leaders = breadth.sectors.slice(0, 5);
  const laggards = breadth.sectors.slice(-5).reverse();
  const span = Math.max(0.4, ...leaders.map((s) => Math.abs(s.change)), ...laggards.map((s) => Math.abs(s.change)));
  return (
    <div className="d2-breadth-grid">
      <Histogram breadth={breadth} />
      <Tilt breadth={breadth} />
      <SectorStrip sectors={breadth.sectors} />
      <div className="d2-sector-pair">
        <SectorBars title={L("주도 업종", "Leading sectors")} rows={leaders} span={span} tone="up" />
        <SectorBars title={L("부진 업종", "Lagging sectors")} rows={laggards} span={span} tone="down" />
      </div>
      <div className="d2-limit-pair" lang={lang}>
        <LimitList title={L("상한가", "Limit-up")} items={breadth.limitUp} tone="up" />
        <LimitList title={L("하한가", "Limit-down")} items={breadth.limitDown} tone="down" />
      </div>
    </div>
  );
}
