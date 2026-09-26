import { ReactNode, useEffect, useRef, useState } from "react";
import { daysSince } from "./realEstateTools";
import { RealEstateFacts, RealEstateItem, RealEstateTradeHistory } from "../api/client";
import { pct } from "../mapTile";
import AptBrandIcon, { brandLabel } from "./AptBrandIcon";

/* The 부동산 맵's hover card: everything a reader wants to know about one complex
 * before deciding whether to look further — its price and move, where that price sits
 * in its past year, the trades behind it, how busy it is, and what its other 평형 go
 * for. Every figure comes from the map response (see realestate_map._detail). */

const PYEONG = 3.3058;

/** 만원 → "23억 5,000만원". */
export function fullPrice(manwon: number): string {
  const eok = Math.floor(manwon / 10_000);
  const rest = manwon % 10_000;
  if (!eok) return `${rest.toLocaleString()}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString()}만원` : `${eok}억원`;
}

/** 만원 → "23.5억" / "8,500만". */
export function shortPrice(manwon: number): string {
  if (manwon >= 10_000) {
    const eok = manwon / 10_000;
    return `${eok >= 100 ? Math.round(eok) : eok.toFixed(1).replace(/\.0$/, "")}억`;
  }
  return `${manwon.toLocaleString()}만`;
}

function dots(iso: string | null | undefined): string {
  return iso ? iso.replace(/-/g, ".") : "—";
}

function ymdDots(n: number): string {
  const s = String(n);
  return `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

function ymdTime(n: number): number {
  return Date.UTC(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
}

function tone(v: number | null | undefined): "up" | "down" | "flat" {
  if (v === null || v === undefined || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

const DAY = 86400000;

/** The trend through a complex's trades, as runs of [time, price] to draw.
 *
 * One trade is one flat — its floor and view move the price as much as the market
 * does — so joining every dot only zigzags. Each point here is instead the median of
 * the brokered trades around it: within a window scaled to the span on screen (a
 * month on a year's chart, up to half a year on twenty), and never fewer than the
 * three nearest in its run (two trades are simply joined). 직거래 stay out, as they
 * stay out of the reference price. Same-day trades are one point. A stretch with no
 * trades breaks the line rather than being bridged, and no median reaches across it:
 * the chart does not invent prices for months nobody traded. */
export function tradeTrend(deals: [number, number, number, number][]): [number, number][][] {
  const trades = deals.filter(d => !d[3]).map(d => [ymdTime(d[0]), d[1]] as const).sort((a, b) => a[0] - b[0]);
  if (trades.length < 2) return [];
  const span = trades[trades.length - 1][0] - trades[0][0];
  const half = Math.min(180 * DAY, Math.max(30 * DAY, span / 16));
  const gap = Math.max(4 * half, 120 * DAY);
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  // Runs first, so no median ever borrows a price from the far side of a gap.
  const groups: (readonly [number, number])[][] = [];
  trades.forEach((d, i) => { if (!i || d[0] - trades[i - 1][0] > gap) groups.push([]); groups[groups.length - 1].push(d); });
  return groups.map(group => {
    const days = [...new Set(group.map(d => d[0]))];
    // Too few trades to take a middle of: join the prices themselves.
    if (group.length < 3) return days.map(t => [t, median(group.filter(d => d[0] === t).map(d => d[1]))] as [number, number]);
    return days.map(t => {
      let near = group.filter(d => Math.abs(d[0] - t) <= half);
      if (near.length < 3) near = [...group].sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t)).slice(0, 3);
      return [t, median(near.map(d => d[1]))] as [number, number];
    });
  }).filter(run => run.length > 1);
}

/** A monotone cubic through the points (Fritsch–Carlson): smooth, but never bulging
 * above or below the prices it passes through the way a plain spline would. */
function monotonePath(p: [number, number][]): string {
  const n = p.length;
  const dx = p.slice(1).map((q, i) => q[0] - p[i][0]);
  const m = p.slice(1).map((q, i) => (q[1] - p[i][1]) / (dx[i] || 1));
  const t = p.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(p[i][0] + h)},${f(p[i][1] + t[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - t[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
  }
  return d;
}

/** The 대표 평형's trades: each contract a dot (hollow for 직거래, shown but not what
 * the price is taken from), the trend of the brokered ones as a line, a dashed rule at
 * the price the period is compared against, and the latest (or chosen) trade ringed.
 * The SVG is drawn at its real pixel size so the dots stay round. */
function TradeChart({ item, deals, expanded }: { item: RealEstateItem; deals?: [number, number, number, number][]; expanded: boolean }) {
  const [range, setRange] = useState("1y");
  const [point, setPoint] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<[number, number] | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width && r.height) setBox([r.width, r.height]); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const all = expanded && deals?.length ? [...deals].reverse() : item.history;
  const cutoff = Date.now() - (range === "1y" ? 365 : 730) * DAY;
  const filtered = expanded && range !== "all" ? all.filter(p => ymdTime(p[0]) >= cutoff) : all;
  const pts = filtered;
  const [W, H] = box ?? [300, expanded ? 160 : 58];
  const PAD = 6;
  const t0 = pts.length ? ymdTime(pts[0][0]) : 0;
  const t1 = pts.length ? ymdTime(pts[pts.length - 1][0]) : 1;
  const prices = pts.map((p) => p[1]).concat(item.base_price ? [item.base_price] : []);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const xt = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const x = (d: number) => xt(ymdTime(d));
  const y = (p: number) => H - PAD - ((p - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const trend = tradeTrend(pts);
  const last = pts[pts.length - 1];
  const chosen = pts.length ? pts[Math.min(point ?? pts.length - 1, pts.length - 1)] : null;
  const r = expanded ? 3 : 2.2;
  return (
    <div className={`re-pop-chart${expanded ? " re-chart-expanded" : ""}`}>
      {expanded && <div className="re-chart-toolbar"><strong>개별 실거래 추이</strong><label>기간 <select value={range} onChange={e => { setRange(e.target.value); setPoint(null); }}><option value="1y">최근 1년</option><option value="2y">최근 2년</option><option value="all">수집된 전체</option></select></label></div>}
      {!pts.length ? <p>선택한 기간의 거래가 없습니다. 기간을 넓혀 보세요.</p> : <><svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {item.base_price && (
          <line className="re-pop-chart-base" x1={PAD} x2={W - PAD} y1={y(item.base_price)} y2={y(item.base_price)} />
        )}
        {trend.map((run, i) => (
          <path key={i} className={`re-pop-chart-line is-${tone(item.change_pct)}`} d={monotonePath(run.map(([t, v]) => [xt(t), y(v)]))} />
        ))}
        {pts.map((p, i) => (
          <circle key={i} className={p[3] ? "re-pop-chart-dot is-direct" : "re-pop-chart-dot"} cx={x(p[0])} cy={y(p[1])} r={r} />
        ))}
        <circle className="re-pop-chart-last" cx={x((chosen ?? last)[0])} cy={y((chosen ?? last)[1])} r={r + 2.5} />
      </svg>
      <div className="re-pop-chart-axis">
        <span>{ymdDots(pts[0][0])}</span>
        <span>
          {shortPrice(lo)} ~ {shortPrice(hi)}
        </span>
        <span>{ymdDots(last[0])}</span>
      </div>
      {expanded && <div className="re-chart-legend" aria-hidden="true"><span><i className={`is-line is-${tone(item.change_pct)}`} />추세</span><span><i className="is-dot" />중개거래</span><span><i className="is-direct" />직거래</span>{item.base_price && <span><i className="is-base" />비교 기준가</span>}</div>}</>}
      {expanded && chosen && <div className="re-chart-inspect"><label htmlFor="re-trade-point">거래 선택 · {pts.length}건</label><input id="re-trade-point" type="range" min={0} max={Math.max(0, pts.length - 1)} value={Math.min(point ?? pts.length - 1, pts.length - 1)} onChange={e => setPoint(Number(e.target.value))} aria-valuetext={`${ymdDots(chosen[0])}, ${fullPrice(chosen[1])}, ${chosen[2]}층`} /><output>{ymdDots(chosen[0])} · <b>{fullPrice(chosen[1])}</b> · {chosen[2]}층 · {chosen[3] ? "직거래" : "중개거래"}</output><small>점은 개별 계약, 선은 주변 중개거래의 중간값으로 이은 추세입니다(직거래 제외). 거래가 끊긴 기간은 잇지 않습니다.</small></div>}
    </div>
  );
}

/** 세대수, 주차대수 and 세대당 주차 (to one decimal), from K-apt. */
function FactsRow({ facts }: { facts: RealEstateFacts | null }) {
  const missing = facts === null ? "…" : "—";
  const note =
    facts === null
      ? null
      : facts.error
        ? facts.error.includes("NOT_REGISTERED")
          ? "정보 준비 중"
          : "불러오지 못함"
        : !facts.matched
          ? "K-apt 미등록"
          : null;
  const under = facts?.parking_under ?? null;
  return (
    <div className="re-pop-kpis re-pop-facts">
      <div>
        <small>세대수</small>
        <b>{facts?.households ? `${facts.households.toLocaleString()}세대` : missing}</b>
        {note && <span>{note}</span>}
      </div>
      <div>
        <small>주차 가능</small>
        <b>{facts?.parking !== null && facts?.parking !== undefined ? `${facts.parking.toLocaleString()}대` : missing}</b>
        {under !== null && facts?.parking ? <span>지하 {under.toLocaleString()}대</span> : null}
      </div>
      <div>
        <small>세대당 주차</small>
        <b>{facts?.parking_per_household !== null && facts?.parking_per_household !== undefined ? `${facts.parking_per_household.toFixed(1)}대` : missing}</b>
      </div>
    </div>
  );
}

/** "2006.01" from "2006-01". */
function ymLabel(ym: string): string {
  return ym.replace("-", ".");
}

/** The pinned card's record of one 평형: every trade held, newest first, grouped by
 * year under a heading that stays in view, each with its move from the trade
 * before it (brokered trades only — a 직거래 is often off-market). */
function TradeLog({
  deals,
  area,
  history,
}: {
  deals: [number, number, number, number][];
  area: number;
  history?: RealEstateTradeHistory;
}) {
  const years: { year: number; rows: { d: [number, number, number, number]; move: number | null }[] }[] = [];
  // The previous (older) brokered trade of each row, walking from the oldest.
  const moves = new Map<number, number | null>();
  let last: number | null = null;
  for (let i = deals.length - 1; i >= 0; i--) {
    const [, price, , direct] = deals[i];
    moves.set(i, last !== null && !direct ? price - last : null);
    if (!direct) last = price;
  }
  deals.forEach((d, i) => {
    const year = Math.floor(d[0] / 10000);
    if (!years.length || years[years.length - 1].year !== year) years.push({ year, rows: [] });
    years[years.length - 1].rows.push({ d, move: moves.get(i) ?? null });
  });
  const first = deals[deals.length - 1][0];
  const span = `${String(first).slice(0, 4)}.${String(first).slice(4, 6)} ~ ${String(deals[0][0]).slice(0, 4)}.${String(deals[0][0]).slice(4, 6)}`;
  return (
    <div className="re-pop-section re-pop-log">
      <h4>
        실거래 전체 · 전용 {Math.round(area)}㎡ <b>{deals.length.toLocaleString()}건</b>
        <span>{span}</span>
      </h4>
      <div className="re-pop-log-scroll" tabIndex={0} aria-label="실거래 전체 목록">
        {years.map(({ year, rows }) => {
          const brokered = rows.filter((r) => !r.d[3]);
          const high = Math.max(...(brokered.length ? brokered : rows).map((r) => r.d[1]));
          return (
            <section key={year}>
              <h5>
                <b>{year}</b>
                <span>
                  {rows.length}건 · 최고 {shortPrice(high)}
                </span>
              </h5>
              <table className="re-pop-trades">
                <tbody>
                  {rows.map(({ d: [day, price, floor, direct], move }, i) => (
                    <tr key={`${day}-${i}`}>
                      <td>{ymdDots(day)}</td>
                      <td>{floor}층</td>
                      <td>{direct ? <i>직거래</i> : null}</td>
                      <td>
                        {fullPrice(price)}
                        {move !== null && move !== 0 && (
                          <small className={`is-${move > 0 ? "up" : "down"}`}>
                            {move > 0 ? "▲" : "▼"}
                            {shortPrice(Math.abs(move))}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      {history && (
        <p className="re-pop-log-note">
          {history.complete
            ? `국토교통부 실거래가 ${ymLabel(history.target)} 이후 전체 자료입니다.`
            : `${ymLabel(history.from)} 이후 자료 · ${ymLabel(history.target)}까지의 과거 자료를 수집하고 있습니다.`}
        </p>
      )}
    </div>
  );
}

export interface PopupContext {
  periodLabel: string;
  /** e.g. "서울특별시" / "강남구" — the region the map is showing. */
  regionLabel: string;
  regionRank: number;
  regionCount: number;
  groupRank: number;
  groupCount: number;
  share: number;
  /** What a click on the tile does, or null when it does nothing more. */
  clickHint: string | null;
}

/** A 평형 chip in the 다른 평형 row. `key` is set when the chip can switch the card to
 * that 평형 (the pinned card); the hover preview only lists them. */
export interface OtherType {
  key?: number;
  area: number;
  price: number;
  date: string;
  trades_1y: number;
}

export default function RealEstatePopup({
  item,
  ctx,
  selector,
  others,
  onPickType,
  facts,
  deals,
  history,
  modeSwitch,
  replaceBody,
}: {
  item: RealEstateItem;
  ctx: PopupContext;
  /** The 평형 select box, shown under the name when the card is pinned. */
  selector?: ReactNode;
  /** Overrides item.types: the 평형 other than the one shown. */
  others?: OtherType[];
  onPickType?: (key: number) => void;
  /** 세대수·주차 — null while loading; left out (the hover preview) hides the row. */
  facts?: RealEstateFacts | null;
  /** Every trade of the 평형 shown (the pinned card): replaces the last-four list
   * with the whole record, in a scrolling list. */
  deals?: [number, number, number, number][];
  history?: RealEstateTradeHistory;
  /** 매매·전세·월세 buttons, under the 평형 selector on the pinned card. */
  modeSwitch?: ReactNode;
  /** Shown instead of the sale figures (the card's 전세 or 월세 view). */
  replaceBody?: ReactNode;
}) {
  const otherTypes: OtherType[] = others ?? item.types;
  const brand = brandLabel(item.brand);
  const age = item.built ? new Date().getFullYear() - item.built + 1 : null;
  const perPyeong = Math.round((item.price / item.area) * PYEONG);
  const fromHigh = item.high_1y ? ((item.price - item.high_1y.price) / item.high_1y.price) * 100 : null;
  const recent = item.history.slice(-4).reverse();
  // This 평형's trades in the past year, counted from its own history (the item's
  // trades_1y is the whole complex's).
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAgoN = yearAgo.getFullYear() * 10000 + (yearAgo.getMonth() + 1) * 100 + yearAgo.getDate();
  const typeYear = item.type_trades_1y ?? (deals ? deals.filter(h => h[0] >= yearAgoN).length : null);
  const move = item.base_price ? item.price - item.base_price : null;

  return (
    <div className="re-pop">
      <header className="re-pop-head">
        {item.brand && <AptBrandIcon brand={item.brand} size={22} />}
        <div className="re-pop-title">
          <strong>{item.name}</strong>
          <small>
            {item.sgg} {item.dong}
            {brand && ` · ${brand}`}
            {item.built && ` · ${item.built}년 준공 (${age}년차)`}
          </small>
        </div>
      </header>

      {selector}

      {modeSwitch}

      {replaceBody ?? (
        <>
        <div className="re-pop-hero">
          <div className="re-pop-hero-price">
            <small>
              실거래 기준가 · 전용 {Math.round(item.area)}㎡ ({item.pyeong}평)
            </small>
            <b>{fullPrice(item.price)}</b>
            <span>
              마지막 기준 거래 {dots(item.deal_date)}
            </span>
          </div>
          <div className={`re-pop-badge is-${tone(item.change_pct)}`}>
            <small>{ctx.periodLabel}</small>
            {item.change_pct === null ? (
              <b className="re-pop-none">{item.trades ? "비교 거래 없음" : "거래 없음"}</b>
            ) : (
              <>
                <b>{pct(item.change_pct)}</b>
                {move !== null && move !== 0 && <em>{`${move > 0 ? "▲" : "▼"} ${shortPrice(Math.abs(move))}`}</em>}
              </>
            )}
          </div>
        </div>

        <div className="re-price-evidence"><div className="re-evidence-badges">
          <span>{item.price_sample_count ? `${item.price_sample_count}건 중간값` : "산정 근거 확인 중"}</span>
          {item.price_basis === "direct" && <span className="is-caution">직거래 참고값</span>}
          {daysSince(item.deal_date) > 180 && <span className="is-caution">마지막 거래 {daysSince(item.deal_date)}일 전</span>}
          {item.baseline_kind === "within_period" && <span className="is-caution">기간 내 최초 거래 대비</span>}
        </div>{selector && <details><summary>기준가격은 어떻게 계산하나요?</summary><p>마지막 유효 거래일 이전 90일 안의 최대 3건 중간값입니다. 현재 매물의 호가와 다르며, 층·향 등의 차이를 보정한 감정가격이 아닙니다.</p><p>{item.price_basis === "direct" ? "중개거래 자료가 없어 직거래를 사용한 참고값입니다." : "중개거래를 사용하며 직거래는 기준가격에서 제외합니다."}</p>{item.price_samples?.map((t, i) => <div className="re-evidence-trade" key={i}><span>{dots(t.date)} · {t.floor}층</span><b>{fullPrice(t.price)}</b></div>)}<p>비교가격 {item.base_price ? `${fullPrice(item.base_price)} (${dots(item.base_date)})` : "없음"}{item.baseline_kind === "within_period" ? " · 기간 이전 자료가 없어 기간 내 최초 거래일과 비교합니다." : " · 기간 시작 전 거래 기준입니다."}</p></details>}</div>

        <TradeChart key={`${item.id}:${item.area}`} item={item} deals={deals} expanded={!!selector} />

        <div className="re-pop-kpis">
          <div>
            <small>3.3㎡당 (전용)</small>
            <b>{shortPrice(perPyeong)}</b>
          </div>
          <div>
            <small>{item.baseline_kind === "within_period" ? "기간 내 첫 거래 기준" : "기간 전 기준가"}</small>
            <b>{item.base_price ? shortPrice(item.base_price) : "—"}</b>
            {item.base_date && <span>{dots(item.base_date).slice(2)}</span>}
          </div>
          <div>
            <small>1년 최고가 대비</small>
            <b className={`is-${tone(fromHigh)}`}>{fromHigh === null ? "—" : pct(fromHigh)}</b>
          </div>
          <div>
            <small>1년 최고</small>
            <b>{item.high_1y ? shortPrice(item.high_1y.price) : "—"}</b>
            {item.high_1y && <span>{dots(item.high_1y.date).slice(2)}</span>}
          </div>
          <div>
            <small>1년 최저</small>
            <b>{item.low_1y ? shortPrice(item.low_1y.price) : "—"}</b>
            {item.low_1y && <span>{dots(item.low_1y.date).slice(2)}</span>}
          </div>
          <div>
            <small>1년 거래</small>
            <b>이 평형 {typeYear === null ? "확인 중" : `${typeYear}건`}</b>
            <span>전 평형 {item.trades_1y}건</span>
          </div>
        </div>

        {facts !== undefined && <FactsRow facts={facts} />}

        {deals && deals.length > 0 ? (
          <TradeLog deals={deals} area={item.area} history={history} />
        ) : recent.length > 0 && (
          <div className="re-pop-section">
            <h4>최근 실거래 · 전용 {Math.round(item.area)}㎡</h4>
            <table className="re-pop-trades">
              <tbody>
                {recent.map(([day, price, floor, direct], i) => (
                  <tr key={`${day}-${i}`}>
                    <td>{ymdDots(day)}</td>
                    <td>{floor}층</td>
                    <td>{direct ? <i>직거래</i> : null}</td>
                    <td>{fullPrice(price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {otherTypes.length > 0 && (
          <div className="re-pop-section">
            <h4>다른 평형{onPickType && " · 눌러서 전환"}</h4>
            <div className="re-pop-types">
              {otherTypes.map((t) =>
                onPickType && t.key !== undefined ? (
                  <button
                    type="button"
                    key={t.area}
                    className="re-pop-type-chip"
                    onClick={() => onPickType(t.key as number)}
                    title={`${dots(t.date)} 계약 · 최근 1년 ${t.trades_1y}건`}
                  >
                    {Math.round(t.area)}㎡ <b>{shortPrice(t.price)}</b>
                    <small>{t.trades_1y}건</small>
                  </button>
                ) : (
                  <span key={t.area} title={`${dots(t.date)} 계약 · 최근 1년 ${t.trades_1y}건`}>
                    {Math.round(t.area)}㎡ <b>{shortPrice(t.price)}</b>
                    <small>{t.trades_1y}건</small>
                  </span>
                )
              )}
            </div>
          </div>
        )}
        </>
      )}

      <footer className="re-pop-foot">
        <span>
          {item.sgg} {item.dong} · 전용면적 기준 비교
        </span>
        {ctx.clickHint && <span className="re-pop-hint">{ctx.clickHint} ›</span>}
      </footer>
    </div>
  );
}
