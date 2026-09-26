import { RealEstateRentResponse, RealEstateRentType } from "../api/client";
import { fullPrice, shortPrice } from "./RealEstatePopup";

/* The complex card's 전세 and 월세 views: in place of the sale figures, the lease
 * price now and over the past year, its trend, and every lease held for the 평형
 * shown, 신규 and 갱신 marked. Data from /api/realestate/rent (realestate_rent.py). */

export type LeaseMode = "jeonse" | "wolse";

function ymdDots(n: number): string {
  const s = String(n);
  return `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
}

function dots(iso: string | null): string {
  return iso ? iso.replace(/-/g, ".") : "—";
}

/** "1억 / 월 250만" — a 월세 as it is quoted. */
function wolseText(deposit: number, rent: number): string {
  return `${shortPrice(deposit)} / 월 ${rent.toLocaleString()}만`;
}

/** The 전세 of the past two years as a monthly median — hundreds of leases a year
 * in a large complex are a cloud as dots. Each month is priced from its 신규 leases
 * (a 갱신 is capped at +5% and lags the market), from all of them if it had none. */
function LeaseChart({ rows }: { rows: [number, number, number, number, number, number, number][] }) {
  const byMonth = new Map<number, { fresh: number[]; all: number[] }>();
  for (const r of rows) {
    const ym = Math.floor(r[0] / 100);
    const m = byMonth.get(ym) ?? { fresh: [], all: [] };
    m.all.push(r[1]);
    if (r[4] !== 2) m.fresh.push(r[1]);
    byMonth.set(ym, m);
  }
  const median = (xs: number[]) => {
    const v = xs.slice().sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };
  const pts = [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ym, m]) => ({ ym, v: median(m.fresh.length ? m.fresh : m.all), n: m.all.length }));
  if (pts.length < 2) return <div className="re-pop-chart re-pop-chart--empty">거래가 한 달뿐이라 추이를 그릴 수 없습니다</div>;
  const W = 300;
  const H = 58;
  const PAD = 6;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const label = (ym: number) => `${String(ym).slice(2, 4)}.${String(ym).slice(4, 6)}`;
  return (
    <div className="re-pop-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="re-pop-chart-line is-flat re-lease-line" d={line} />
        {pts.map((p, i) => (
          <circle key={p.ym} className="re-pop-chart-dot" cx={x(i)} cy={y(p.v)} r={2.2}>
            <title>{`${label(p.ym)} 중간값 ${shortPrice(p.v)} · ${p.n}건`}</title>
          </circle>
        ))}
        <circle className="re-pop-chart-last" cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].v)} r={4} />
      </svg>
      <div className="re-pop-chart-axis">
        <span>{label(pts[0].ym)}</span>
        <span>
          월별 중간값 {shortPrice(lo)} ~ {shortPrice(hi)}
        </span>
        <span>{label(pts[pts.length - 1].ym)}</span>
      </div>
    </div>
  );
}

function LeaseLog({ rows, mode }: { rows: RealEstateRentType["deals"]; mode: LeaseMode }) {
  const years: { year: number; rows: RealEstateRentType["deals"] }[] = [];
  for (const r of rows) {
    const year = Math.floor(r[0] / 10000);
    if (!years.length || years[years.length - 1].year !== year) years.push({ year, rows: [] });
    years[years.length - 1].rows.push(r);
  }
  return (
    <div className="re-pop-log-scroll" tabIndex={0} aria-label={mode === "jeonse" ? "전세 실거래 전체" : "월세 실거래 전체"}>
      {years.map(({ year, rows: ys }) => (
        <section key={year}>
          <h5>
            <b>{year}</b>
            <span>
              {ys.length}건
              {mode === "jeonse" && ` · 최고 ${shortPrice(Math.max(...ys.map((r) => r[1])))}`}
            </span>
          </h5>
          <table className="re-pop-trades">
            <tbody>
              {ys.map(([day, deposit, rent, floor, kind, preDeposit, preRent], i) => {
                const move = kind === 2 && preDeposit > 0 && mode === "jeonse" ? deposit - preDeposit : null;
                return (
                  <tr key={`${day}-${i}`}>
                    <td>{ymdDots(day)}</td>
                    <td>{floor}층</td>
                    <td>{kind === 2 ? <i title={preDeposit ? `종전 ${mode === "jeonse" ? shortPrice(preDeposit) : wolseText(preDeposit, preRent)}` : undefined}>갱신</i> : kind === 1 ? <i className="is-new">신규</i> : null}</td>
                    <td>
                      {mode === "jeonse" ? fullPrice(deposit) : wolseText(deposit, rent)}
                      {move !== null && move !== 0 && (
                        <small className={`is-${move > 0 ? "up" : "down"}`}>
                          {move > 0 ? "▲" : "▼"}
                          {shortPrice(Math.abs(move))}
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export default function RealEstateRentView({
  mode,
  data,
  failed,
  typeKey,
  area,
  salePrice,
  saleDate,
  onRetry,
}: {
  mode: LeaseMode;
  data: RealEstateRentResponse | null;
  failed: boolean;
  /** The 평형 on the card (rounded 전용㎡), whose leases are shown. */
  typeKey: number;
  area: number;
  /** The sale price of that 평형 now, for the 전세가율. */
  salePrice: number;
  saleDate: string;
  onRetry: () => void;
}) {
  const label = mode === "jeonse" ? "전세" : "월세";
  if (failed) return <div className="re-lease-note" role="alert">전월세 정보를 불러오지 못했습니다. <button type="button" onClick={onRetry}>다시 시도</button></div>;
  if (!data) return <div className="re-lease-note is-loading">{label} 실거래를 불러오는 중…</div>;
  const status = data.status;
  if (status.error && status.error.includes("NOT_REGISTERED")) {
    return <div className="re-lease-note">전월세 정보는 준비 중입니다. 곧 이 자리에서 볼 수 있습니다.</div>;
  }
  const t = data.types.find((x) => x.key === typeKey);
  const rows = (t?.deals ?? []).filter((r) => (mode === "jeonse" ? r[2] === 0 : r[2] > 0));
  const collecting = status.collecting ? (
    <p className="re-lease-collecting">
      <span className="re-lease-spinner" aria-hidden="true" />이 지역의 전월세 실거래를 모으는 중입니다 ({Math.round(status.coverage * 100)}%) ·
      자동으로 채워집니다
    </p>
  ) : null;
  if (!rows.length) {
    return (
      <>
        {collecting}
        <div className="re-lease-note">
          {status.collecting ? `${label} 거래를 찾는 중입니다.` : !status.configured ? `이 평형의 저장된 ${label} 자료가 없습니다. 자료 연결 상태에 따라 거래가 표시되지 않을 수 있습니다.` : status.error ? "전월세 자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." : `전용 ${Math.round(area)}㎡의 수집된 자료에서 최근 2년 ${label} 거래를 찾지 못했습니다.`}
        </div>
      </>
    );
  }
  const j = t!.jeonse;
  const w = t!.wolse;
  const ratio = mode === "jeonse" && j.price && salePrice ? (j.price / salePrice) * 100 : null;
  const dateGap = j.date ? Math.abs(new Date(j.date).getTime() - new Date(saleDate).getTime()) / 86400000 : 0;
  return (
    <>
      {collecting}
      <div className="re-pop-hero">
        <div className="re-pop-hero-price">
          <small>
            {label} 실거래 기준 · 전용 {Math.round(area)}㎡
          </small>
          <b>{mode === "jeonse" ? (j.price ? fullPrice(j.price) : "—") : w.deposit !== null && w.rent !== null ? wolseText(w.deposit, w.rent) : "—"}</b>
          <span>최근 계약 {dots(mode === "jeonse" ? j.date : w.date)}</span>
        </div>
        {mode === "jeonse" && (
          <div className="re-pop-badge is-flat re-lease-ratio">
            <small>전세가율</small>
            <b>{ratio === null ? "—" : `${ratio.toFixed(1)}%`}</b>
            <em>매매 {shortPrice(salePrice)} 대비</em>
          </div>
        )}
      </div>

      {mode === "jeonse" && <p className="re-detail-note">전세 기준 {dots(j.date)} / 매매 기준 {dots(saleDate)}.{dateGap > 90 ? " 두 가격의 기준일이 90일 이상 달라 전세가율은 참고값입니다." : " 서로 다른 계약의 가격을 비교한 참고 비율입니다."}</p>}

      {mode === "jeonse" && <LeaseChart rows={rows} />}

      <div className="re-pop-kpis">
        <div>
          <small>1년 {label} 거래</small>
          <b>{(mode === "jeonse" ? j.trades_1y : w.trades_1y).toLocaleString()}건</b>
        </div>
        {mode === "jeonse" ? (
          <>
            <div>
              <small>1년 최고</small>
              <b>{j.high_1y ? shortPrice(j.high_1y) : "—"}</b>
            </div>
            <div>
              <small>1년 최저</small>
              <b>{j.low_1y ? shortPrice(j.low_1y) : "—"}</b>
            </div>
          </>
        ) : (
          <>
            <div>
              <small>신규 / 갱신</small>
              <b>
                {rows.filter((r) => r[4] === 1).length} / {rows.filter((r) => r[4] === 2).length}
              </b>
            </div>
            <div>
              <small>최근 월세</small>
              <b>{w.rent !== null ? `${w.rent.toLocaleString()}만` : "—"}</b>
            </div>
          </>
        )}
      </div>

      <div className="re-pop-section re-pop-log">
        <h4>
          {label} 실거래 전체 · 전용 {Math.round(area)}㎡ <b>{rows.length.toLocaleString()}건</b>
          <span>{status.from.replace("-", ".")} 이후</span>
        </h4>
        <LeaseLog rows={rows} mode={mode} />
      </div>
    </>
  );
}
