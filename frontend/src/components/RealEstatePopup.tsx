import { RealEstateItem } from "../api/client";
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

/** The 대표 평형's trades over the last two years: a line through the brokered ones,
 * hollow marks for 직거래 (shown, but not what the price is taken from), a dashed rule
 * at the price the period is compared against, and the latest trade ringed. */
function TradeChart({ item }: { item: RealEstateItem }) {
  const pts = item.history;
  if (pts.length < 2) return <div className="re-pop-chart re-pop-chart--empty">거래가 1건뿐이라 추이를 그릴 수 없습니다</div>;
  const W = 300;
  const H = 58;
  const PAD = 6;
  const t0 = ymdTime(pts[0][0]);
  const t1 = ymdTime(pts[pts.length - 1][0]);
  const prices = pts.map((p) => p[1]).concat(item.base_price ? [item.base_price] : []);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const x = (d: number) => PAD + ((ymdTime(d) - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (p: number) => H - PAD - ((p - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const brokered = pts.filter((p) => !p[3]);
  const line = (brokered.length > 1 ? brokered : pts).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="re-pop-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {item.base_price && (
          <line className="re-pop-chart-base" x1={PAD} x2={W - PAD} y1={y(item.base_price)} y2={y(item.base_price)} />
        )}
        <path className={`re-pop-chart-line is-${tone(item.change_pct)}`} d={line} />
        {pts.map((p, i) => (
          <circle key={i} className={p[3] ? "re-pop-chart-dot is-direct" : "re-pop-chart-dot"} cx={x(p[0])} cy={y(p[1])} r={2.2} />
        ))}
        <circle className="re-pop-chart-last" cx={x(last[0])} cy={y(last[1])} r={4} />
      </svg>
      <div className="re-pop-chart-axis">
        <span>{ymdDots(pts[0][0])}</span>
        <span>
          {shortPrice(lo)} ~ {shortPrice(hi)}
        </span>
        <span>{ymdDots(last[0])}</span>
      </div>
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

export default function RealEstatePopup({ item, ctx }: { item: RealEstateItem; ctx: PopupContext }) {
  const brand = brandLabel(item.brand);
  const age = item.built ? new Date().getFullYear() - item.built + 1 : null;
  const perPyeong = Math.round((item.price / item.area) * PYEONG);
  const fromHigh = item.high_1y ? ((item.price - item.high_1y.price) / item.high_1y.price) * 100 : null;
  const recent = item.history.slice(-4).reverse();
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

      <div className="re-pop-hero">
        <div className="re-pop-hero-price">
          <small>
            시세 · 전용 {Math.round(item.area)}㎡ ({item.pyeong}평)
          </small>
          <b>{fullPrice(item.price)}</b>
          <span>
            최근 계약 {dots(item.deal_date)}
            {item.floor !== null && ` · ${item.floor}층`}
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

      <TradeChart item={item} />

      <div className="re-pop-kpis">
        <div>
          <small>3.3㎡당 (전용)</small>
          <b>{shortPrice(perPyeong)}</b>
        </div>
        <div>
          <small>기간 전 시세</small>
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
          <small>거래량 (전 평형)</small>
          <b>1년 {item.trades_1y}건</b>
          <span>
            {ctx.periodLabel} {item.trades_all}건
          </span>
        </div>
      </div>

      {recent.length > 0 && (
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

      {item.types.length > 0 && (
        <div className="re-pop-section">
          <h4>다른 평형</h4>
          <div className="re-pop-types">
            {item.types.map((t) => (
              <span key={t.area} title={`${dots(t.date)} 계약 · 최근 1년 ${t.trades_1y}건`}>
                {Math.round(t.area)}㎡ <b>{shortPrice(t.price)}</b>
                <small>{t.trades_1y}건</small>
              </span>
            ))}
          </div>
        </div>
      )}

      <footer className="re-pop-foot">
        <span>
          {ctx.regionLabel} 시세 <b>{ctx.regionRank}위</b> / {ctx.regionCount}
          {ctx.groupCount > 1 && ctx.groupCount !== ctx.regionCount && ` · 그룹 내 ${ctx.groupRank}위`}
          {` · 면적 ${ctx.share.toFixed(2)}%`}
        </span>
        {ctx.clickHint && <span className="re-pop-hint">{ctx.clickHint} ›</span>}
      </footer>
    </div>
  );
}
