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

function ymdTime(n: number): number {
  return Date.UTC(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, n % 100);
}

/** "1억 / 월 250만" — a 월세 as it is quoted. */
function wolseText(deposit: number, rent: number): string {
  return `${shortPrice(deposit)} / 월 ${rent.toLocaleString()}만`;
}

/** The 전세 deposits of the past two years, 신규 as filled dots, 갱신 hollow. */
function LeaseChart({ rows }: { rows: [number, number, number, number, number, number, number][] }) {
  const pts = rows.slice().reverse();
  if (pts.length < 2) return <div className="re-pop-chart re-pop-chart--empty">거래가 1건뿐이라 추이를 그릴 수 없습니다</div>;
  const W = 300;
  const H = 58;
  const PAD = 6;
  const t0 = ymdTime(pts[0][0]);
  const t1 = ymdTime(pts[pts.length - 1][0]);
  const lo = Math.min(...pts.map((p) => p[1]));
  const hi = Math.max(...pts.map((p) => p[1]));
  const x = (d: number) => PAD + ((ymdTime(d) - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const fresh = pts.filter((p) => p[4] !== 2);
  const line = (fresh.length > 1 ? fresh : pts).map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="re-pop-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="re-pop-chart-line is-flat re-lease-line" d={line} />
        {pts.map((p, i) => (
          <circle key={i} className={p[4] === 2 ? "re-pop-chart-dot is-direct" : "re-pop-chart-dot"} cx={x(p[0])} cy={y(p[1])} r={2.2} />
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
}: {
  mode: LeaseMode;
  data: RealEstateRentResponse | null;
  failed: boolean;
  /** The 평형 on the card (rounded 전용㎡), whose leases are shown. */
  typeKey: number;
  area: number;
  /** The sale price of that 평형 now, for the 전세가율. */
  salePrice: number;
}) {
  const label = mode === "jeonse" ? "전세" : "월세";
  if (failed) return <div className="re-lease-note">전월세 정보를 불러오지 못했습니다.</div>;
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
          {status.collecting ? `${label} 거래를 찾는 중입니다.` : `전용 ${Math.round(area)}㎡의 최근 2년 ${label} 거래가 없습니다.`}
        </div>
      </>
    );
  }
  const j = t!.jeonse;
  const w = t!.wolse;
  const ratio = mode === "jeonse" && j.price && salePrice ? (j.price / salePrice) * 100 : null;
  return (
    <>
      {collecting}
      <div className="re-pop-hero">
        <div className="re-pop-hero-price">
          <small>
            {label} 시세 · 전용 {Math.round(area)}㎡
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
