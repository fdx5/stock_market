import { useEffect, useId, useMemo, useState } from "react";
import { api, type AssetDailyPoint, type AssetHistoryResponse } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { MARKET_ASSETS, type MarketAsset } from "../marketAssets";
import { Link } from "../router";
import { useMarketTicker } from "../useMarketTicker";
import { useBroadsheet } from "../desk2/shell";
import { pct, toneOf } from "../desk2/lib";
import "./assetPrices.css";

const RANGE_DAYS = { "1M": 30, "3M": 90, "6M": 180, "1Y": 366 };
type Range = keyof typeof RANGE_DAYS;
const dayTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

function HistoryChart({ points, asset, range }: { points: AssetDailyPoint[]; asset: MarketAsset; range: Range }) {
  const { lang } = useLanguage();
  const [cursor, setCursor] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => setCursor(null), [points]);
  const format = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits });
  const low = Math.min(...points.map(p => p.close)), high = Math.max(...points.map(p => p.close));
  const span = high - low || Math.abs(high) * .01 || 1;
  const firstTime = dayTime(points[0].date), lastTime = dayTime(points[points.length - 1].date);
  const x = (point: AssetDailyPoint) => 14 + (dayTime(point.date) - firstTime) / Math.max(1, lastTime - firstTime) * 846;
  const y = (value: number) => 224 - (value - low) / span * 190;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(point).toFixed(2)},${y(point.close).toFixed(2)}`).join(" ");
  const current = points[Math.min(cursor ?? points.length - 1, points.length - 1)];
  const choose = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const time = firstTime + Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 880 - 14) / 846)) * (lastTime - firstTime);
    let closest = 0;
    points.forEach((point, index) => { if (Math.abs(dayTime(point.date) - time) < Math.abs(dayTime(points[closest].date) - time)) closest = index; });
    setCursor(closest);
  };
  return <div className="ap-chart" data-points={points.length}>
    <output className="ap-chart-reading" aria-live="polite"><time dateTime={current.date}>{current.date}</time><strong>{format(current.close)}</strong><span>{asset.unit}</span><b className={`is-${toneOf(current.change_pct ?? undefined)}`}>{pct(current.change_pct ?? undefined)}</b></output>
    <div className="ap-chart-interaction" tabIndex={0} role="group" aria-label={lang === "ko" ? `${asset.ko} ${range} 일별 종가 차트. 좌우 방향키로 날짜 탐색` : `${asset.en} ${range} daily close chart. Use arrow keys to explore dates`} onFocus={() => setCursor(points.length - 1)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();setCursor(value => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (value ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
    }}>
      <div className="ap-plot"><svg viewBox="0 0 880 250" preserveAspectRatio="none" aria-hidden="true" onPointerMove={choose} onPointerDown={choose} onPointerLeave={event => { if (event.pointerType === "mouse") setCursor(null); }}>
        <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--ap-accent)" stopOpacity=".25" /><stop offset="1" stopColor="var(--ap-accent)" stopOpacity="0" /></linearGradient></defs>
        {[0,1,2,3,4].map(row => <line key={row} x1="14" x2="860" y1={34 + row * 47.5} y2={34 + row * 47.5} stroke="var(--rule)" strokeDasharray="3 6" />)}
        <path d={`${line} L${x(points[points.length - 1])},240 L14,240 Z`} fill={`url(#${id}-fill)`} />
        <path className="ap-price-line" d={line} fill="none" stroke="var(--ap-accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        <circle cx={x(current)} cy={y(current.close)} r="3.5" fill="var(--ap-accent)" />
        {cursor != null && <line x1={x(current)} x2={x(current)} y1="16" y2="240" stroke="var(--text-secondary)" strokeDasharray="3 4" />}
      </svg><div className="ap-price-axis" aria-hidden="true">{[0,1,2,3,4].map(row => <span key={row}>{format(high - span * row / 4)}</span>)}</div></div>
      <div className="ap-date-axis" aria-hidden="true">{[0,.25,.5,.75,1].map(ratio => <time key={ratio}>{points[Math.round((points.length - 1) * ratio)].date.slice(2)}</time>)}</div>
    </div>
  </div>;
}

export default function AssetPricePage({ asset }: { asset: MarketAsset }) {
  useBroadsheet();
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [history, setHistory] = useState<AssetHistoryResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<Range>("1Y");
  const [page, setPage] = useState(0);
  const ticker = useMarketTicker();
  const quote = ticker.find(item => item.symbol === asset.symbol && Number.isFinite(item.price));
  const format = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits });
  useEffect(() => {
    let alive = true;setError(false);setHistory(null);
    api.assetHistory(asset.key).then(data => {
      if (!data.points.length) throw new Error("Empty daily history");
      if (alive) setHistory(data);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [asset.key, attempt]);
  const points = history?.points ?? [];
  const shown = useMemo(() => {
    if (range === "1Y") return points;
    const end = points[points.length - 1]?.date;if (!end) return [];
    const start = dayTime(end) - RANGE_DAYS[range] * 86400000;
    return points.filter(point => dayTime(point.date) >= start);
  }, [points, range]);
  const latest = points[points.length - 1], first = points[0];
  const yearlyChange = latest && first && first.close !== 0 ? (latest.close / first.close - 1) * 100 : undefined;
  const highs = points.map(p => p.high ?? p.close), lows = points.map(p => p.low ?? p.close);
  const daily = [...points].reverse(), totalPages = Math.ceil(daily.length / 20);
  const stamp = quote?.quote_time ? new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-GB", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" }).format(new Date(quote.quote_time * 1000)) + " KST" : null;
  const sameGroup = MARKET_ASSETS.filter(item => item.group === asset.group);
  return <main className="d2 ap-page" data-asset={asset.key} data-asset-group={asset.group} lang={lang}>
    <nav className="ap-all-assets" aria-label={L("환율·암호화폐·원자재 상세", "FX, crypto and commodities")}>
      {MARKET_ASSETS.map(item => <Link key={item.key} to={`/prices/${item.key}`} aria-current={item.key === asset.key ? "page" : undefined}>{L(item.ko, item.en)}</Link>)}
    </nav>
    <header className="ap-hero"><div className="ap-identity"><img src={asset.icon} alt="" width="48" height="48" /><div><span className="ng-kicker">{asset.group === "fx" ? "FOREIGN EXCHANGE" : asset.group === "crypto" ? "DIGITAL ASSETS" : "COMMODITY FUTURES"} / {asset.symbol}</span><h1>{L(asset.ko, asset.en)}</h1><p>{asset.code} <span>· {asset.unit}</span></p></div></div><div className="ap-head-quote"><small>{quote ? L("최근 제공 시세", "Latest supplied quote") : L("최근 일봉 종가", "Latest daily close")}</small><strong>{format(quote?.price ?? latest?.close)}</strong><b className={`is-${toneOf(quote?.change_pct ?? latest?.change_pct ?? undefined)}`}>{pct(quote?.change_pct ?? latest?.change_pct ?? undefined)}</b><time>{quote ? stamp ?? L("시세 시각 확인 중", "Quote time unavailable") : history?.latest_date ?? "—"}</time></div></header>
    {sameGroup.length > 1 && <nav className="ap-group-switch" aria-label={asset.group === "crypto" ? L("암호화폐 전환", "Switch cryptocurrency") : L("원자재 전환", "Switch commodity")}>{sameGroup.map(item => <Link key={item.key} to={`/prices/${item.key}`} aria-current={item.key === asset.key ? "page" : undefined}><img src={item.icon} alt="" />{L(item.ko, item.en)}<span aria-hidden="true">↗</span></Link>)}</nav>}
    <div className="ap-summary"><div><span>{L("1년 가격 변화", "1-year price change")}</span><strong className={`is-${toneOf(yearlyChange)}`}>{pct(yearlyChange)}</strong></div><div><span>{L("1년 최고가", "1-year high")}</span><strong>{points.length ? format(Math.max(...highs)) : "—"}</strong></div><div><span>{L("1년 최저가", "1-year low")}</span><strong>{points.length ? format(Math.min(...lows)) : "—"}</strong></div><div><span>{L("일별 가격 기준", "Daily prices through")}</span><strong className="ap-summary-date">{history?.latest_date ?? "—"}</strong></div></div>
    <section className="ap-chart-panel" aria-labelledby="ap-chart-title"><div className="ap-section-head"><div><span className="ng-kicker">PRICE HISTORY</span><h2 id="ap-chart-title">{L("가격의 흐름", "Price history")}</h2></div><div className="ap-ranges" role="group" aria-label={L("차트 기간", "Chart range")}>{(Object.keys(RANGE_DAYS) as Range[]).map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value === "1Y" ? L("1년", "1Y") : value.replace("M", L("개월", "M"))}</button>)}</div></div>
      {error ? <div className="ap-state" role="alert"><h3>{L("일별 시세를 불러오지 못했습니다", "Daily prices are unavailable")}</h3><p>{L("시세 제공처 연결을 다시 시도해 주세요.", "Try connecting to the price provider again.")}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{L("다시 불러오기", "Retry")}</button></div> : !history ? <div className="ap-state" role="status">{L("최근 1년 시세를 불러오는 중…", "Loading the last year of prices…")}</div> : shown.length > 0 ? <HistoryChart points={shown} asset={asset} range={range} /> : <div className="ap-state">{L("이 기간에 제공된 시세가 없습니다.", "No supplied prices in this range.")}</div>}
      {history && <p className="ap-basis">{L("일별 종가 차트", "Daily closing prices")} · {shown[0]?.date} — {shown[shown.length - 1]?.date} · {asset.unit} · {history.source}</p>}
    </section>
    <section className="ap-daily-panel" aria-labelledby="ap-daily-title"><div className="ap-section-head"><div><span className="ng-kicker">DAILY RECORD</span><h2 id="ap-daily-title">{L("일자별 시세 · 변동", "Daily prices & changes")}</h2></div><span>{points.length} {L("거래일", "daily records")}</span></div>
      {history ? <><div className="ap-table-scroll" tabIndex={0} role="region" aria-label={L("일별 시세 표, 좌우 스크롤 가능", "Daily price table, scroll horizontally")}><table><caption>{L(asset.ko, asset.en)} · {asset.unit} · {L("최근 1년 일별 시세", "Last year of daily prices")}</caption><thead><tr>{[L("일자", "Date"), L("종가", "Close"), L("등락", "Change"), L("등락률", "Change %"), L("시가", "Open"), L("고가", "High"), L("저가", "Low")].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{daily.slice(page * 20, page * 20 + 20).map(point => <tr key={point.date}><th scope="row"><time dateTime={point.date}>{point.date}</time></th><td>{format(point.close)}</td><td className={`is-${toneOf(point.change ?? undefined)}`}>{point.change == null ? "—" : `${point.change > 0 ? "+" : ""}${format(point.change)}`}</td><td className={`is-${toneOf(point.change_pct ?? undefined)}`}>{pct(point.change_pct ?? undefined)}</td><td>{format(point.open)}</td><td>{format(point.high)}</td><td>{format(point.low)}</td></tr>)}</tbody></table></div><nav className="ap-pagination" aria-label={L("일별 시세 페이지", "Daily price pages")}><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{L("이전", "Previous")}</button><span aria-live="polite">{page + 1} / {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage(value => value + 1)}>{L("다음", "Next")}</button></nav></> : <p className="ap-basis">{error ? L("데이터가 연결되면 일별 시세를 표시합니다.", "Daily records appear when data is available.") : L("일별 시세 확인 중…", "Loading daily records…")}</p>}
    </section>
    <footer className="ap-source"><p>{L("출처: Yahoo Finance · 등락은 제공된 직전 일봉 종가 대비입니다. 최신 일봉은 거래 중 변동될 수 있습니다.", "Source: Yahoo Finance · Changes compare with the previous supplied daily close. The latest daily bar may change during trading.")}</p><p>{history && <>{L("일봉 날짜 기준", "Daily date timezone")}: {history.timezone} · </>}{L("현재 시세와 일별 차트의 기준 시각은 다를 수 있습니다.", "Quote timestamps and daily chart timestamps may differ.")}</p>{asset.group === "commodity" && <p>{L("최근월 연속 선물 시세로, 계약 교체 시 가격 차이가 반영될 수 있습니다. 금·은 단위는 트로이온스입니다.", "Continuous front-month futures; contract rolls may create price gaps. Gold and silver are quoted per troy ounce.")}</p>}{asset.group === "fx" && <p>{L("미국 달러 1달러당 원화 가격입니다. 은행의 환전·송금 적용 환율과는 다를 수 있습니다.", "Korean won per US dollar. Bank conversion and remittance rates can differ.")}</p>}</footer>
  </main>;
}
