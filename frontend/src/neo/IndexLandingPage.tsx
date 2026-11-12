import { useEffect, useMemo, useState } from "react";
import { api, type IndexLanding, type IndexLandingStock } from "../api/client";
import MarketChart from "../charts/MarketChart";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { pct, toneOf } from "../desk2/lib";
import { HoloPanel, HUDSectionTitle, NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import { useEnglishNames } from "./useEnglishNames";
import "./indexLanding.css";

type Key = "kospi" | "kosdaq" | "nasdaq";
const TITLES: Record<Key, { ko: string; en: string }> = {
  kospi: { ko: "코스피 지수 시세·차트 — 오늘 코스피 등락과 수급 | KOSPIMAP", en: "KOSPI index today — level, chart and flows | KOSPIMAP" },
  kosdaq: { ko: "코스닥 지수 시세·차트 — 오늘 코스닥 등락과 수급 | KOSPIMAP", en: "KOSDAQ index today — level, chart and flows | KOSPIMAP" },
  nasdaq: { ko: "나스닥 지수 시세·차트 — 나스닥 종합·나스닥100 오늘 등락 | KOSPIMAP", en: "NASDAQ today — Composite and NASDAQ 100 | KOSPIMAP" },
};
const POLL_MS = 30_000;
const PERIODS = [{ days: 21, ko: "1개월", en: "1M" }, { days: 63, ko: "3개월", en: "3M" }, { days: 120, ko: "6개월", en: "6M" }] as const;
const num = (value: number | null | undefined, digits = 2) => value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number | null | undefined, digits = 2) => value == null ? "—" : `${value > 0 ? "+" : ""}${num(value, digits)}`;

/** The index itself: what people searching "코스피", "코스닥" or "나스닥" came for.
 *  Same payload as the server-rendered HTML (index_landing.py). */
export default function IndexLandingPage({ index }: { index: Key }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const [data, setData] = useState<IndexLanding | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<number>(120);
  useDocumentTitle(L(TITLES[index].ko, TITLES[index].en));
  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    const load = () => api.indexLanding(index).then(value => { if (live) { setData(value); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [index]);
  const b = data?.breadth;
  const plot = useMemo(() => {
    const rows = (data?.chart ?? []).slice(-period);
    const values = rows.map(row => row.close);
    if (values.length < 2) return null;
    const change = (values[values.length - 1] / values[0] - 1) * 100;
    return { dates: rows.map(row => row.date), values, lo: Math.min(...values), hi: Math.max(...values), change };
  }, [data, period]);
  const en = useEnglishNames([...(b?.gainers ?? []), ...(b?.losers ?? []), ...(b?.largest ?? [])].flatMap(item => [item.name, item.sector]).concat((b?.sectors ?? []).map(s => s.name)));
  const others = (["kospi", "kosdaq", "nasdaq"] as const).filter(key => key !== index);
  const names: Record<Key, [string, string]> = { kospi: ["코스피", "KOSPI"], kosdaq: ["코스닥", "KOSDAQ"], nasdaq: ["나스닥", "NASDAQ"] };
  const name = L(...names[index]);
  if (!data) return <main className="il-page">{failed ? <NeoEmptyState title={L("지수 데이터를 불러오지 못했습니다", "Index data is unavailable")} error /> : <NeoSkeleton rows={6} />}</main>;
  const live = data.live, s = data.stats, inv = data.investor;
  const table = (title: string, items: IndexLandingStock[]) => <div className="il-movers"><h3>{title}</h3><ol>{items.map(item => <li key={item.code}><Link to={`/stock/${encodeURIComponent(item.code)}`}><span><b>{index === "nasdaq" ? item.code : en(item.name)}</b><small>{index === "nasdaq" ? item.name : item.code} · {en(item.sector)}</small></span><span>{num(item.close, index === "nasdaq" ? 2 : 0)}</span><em className={`is-${toneOf(item.change_pct)}`}>{pct(item.change_pct)}</em></Link></li>)}</ol></div>;
  return <main className="il-page" lang={lang}>
    <header className="il-hero">
      <span className="ng-kicker">{data.en} / INDEX</span>
      <h1>{L(`${data.name} 지수`, `${names[index][1]} index`)}</h1>
      {live ? <div className="il-quote">
        <strong>{num(live.close)}</strong>
        <b className={`is-${toneOf(live.change_pct)}`}>{signed(live.change)} ({pct(live.change_pct)})</b>
        <small>{L("기준", "As of")} {live.as_of?.replace("T", " ").slice(0, 16) ?? "—"}{live.status ? ` · ${live.status}` : ""}</small>
      </div> : <p>{L("현재 지수를 확인하고 있습니다.", "Waiting for the current level.")}</p>}
      {live?.partner && <p className="il-partner">{data.partner_name === "나스닥 100" ? L("나스닥 100", "NASDAQ 100") : data.partner_name} <b>{num(live.partner.close)}</b> <em className={`is-${toneOf(live.partner.change_pct)}`}>{pct(live.partner.change_pct)}</em></p>}
      <p className="il-lead">{L(data.description, `${names[index][1]} level, daily change, recent closes, 52-week range${index === "nasdaq" ? "" : ", foreign and institutional flows"} and today's biggest movers on one page.`)}</p>
    </header>

    <div className="il-grid">
      <HoloPanel className="il-chart">
        <HUDSectionTitle code="TREND" title={L(`${name} 지수 추이`, `${names[index][1]} trend`)} action={<div className="il-periods" role="group" aria-label={L("기간", "Period")}>{PERIODS.map(p => <button type="button" key={p.days} aria-pressed={period === p.days} onClick={() => setPeriod(p.days)}>{L(p.ko, p.en)}</button>)}</div>} />
        {plot ? <>
          <div className="il-chart-read"><span>{L("기간 등락", "Period change")} <b className={`is-${toneOf(plot.change)}`}>{pct(plot.change)}</b></span><span>{L("최고", "High")} <b>{num(plot.hi)}</b></span><span>{L("최저", "Low")} <b>{num(plot.lo)}</b></span></div>
          <MarketChart className="il-chart-plot" height={300} label={L(`${name} 지수 종가 추이`, `${names[index][1]} closing levels`)} dates={plot.dates} baseline={plot.values[0]} tooltipDecimals={2}
            series={[{ name: L("종가", "Close"), values: plot.values, color: plot.change >= 0 ? "var(--up)" : "var(--down)", fill: true }]} />
        </> : <p>{L("차트 데이터를 준비 중입니다.", "Chart data is not ready.")}</p>}
      </HoloPanel>
      <HoloPanel className="il-stats">
        <HUDSectionTitle code="RANGE" title={L("기간 수익률·52주 범위", "Returns and 52-week range")} />
        <dl>
          {[[L("1주", "1W"), s.return_1w], [L("1개월", "1M"), s.return_1m], [L("3개월", "3M"), s.return_3m], [L("연초 대비", "YTD"), s.return_ytd]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd className={`is-${toneOf(value as number | null)}`}>{pct(value as number | null)}</dd></div>)}
          <div><dt>{L("52주 최고", "52W high")}</dt><dd>{num(s.high_52w)}</dd></div>
          <div><dt>{L("52주 최저", "52W low")}</dt><dd>{num(s.low_52w)}</dd></div>
          <div><dt>{L("20일 이동평균", "20-day MA")}</dt><dd>{num(s.ma20)}</dd></div>
          <div><dt>{L("60일 이동평균", "60-day MA")}</dt><dd>{num(s.ma60)}</dd></div>
        </dl>
        {inv && <><h3>{L("투자자별 순매수 (억원)", "Net buying by investor (KRW 100M)")}</h3><dl className="il-flows">
          {[[L("개인", "Individuals"), inv.individual_amount], [L("외국인", "Foreigners"), inv.foreign_amount], [L("기관", "Institutions"), inv.institution_amount]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd className={`is-${toneOf(value as number | null)}`}>{signed(value as number | null, 0)}</dd></div>)}
        </dl></>}
      </HoloPanel>
    </div>

    {b && <HoloPanel className="il-breadth">
      <HUDSectionTitle code="MOVERS" title={L(`오늘 ${name} 상승·하락 종목`, `Today's ${names[index][1]} movers`)} description={L(`시가총액 상위 ${b.count}종목 중 상승 ${b.up} · 하락 ${b.down} · 보합 ${b.flat}`, `${b.count} largest names: ${b.up} up · ${b.down} down · ${b.flat} flat`)} action={<Link to={data.map}>{L(data.map_label, "Full market map")} ↗</Link>} />
      <div className="il-breadth-bar" role="img" aria-label={`${b.up} up, ${b.flat} flat, ${b.down} down`}><i className="is-up" style={{ flex: b.up }} /><i className="is-flat" style={{ flex: b.flat }} /><i className="is-down" style={{ flex: b.down }} /></div>
      <div className="il-mover-grid">{table(L("많이 오른 종목", "Top gainers"), b.gainers)}{table(L("많이 내린 종목", "Top losers"), b.losers)}{table(L("시가총액 상위", "Largest"), b.largest)}</div>
      {b.sectors.length > 0 && <div className="il-sectors"><h3>{L("업종별 평균 등락", "Sector average change")}</h3><ul>{b.sectors.map(sector => <li key={sector.name}><span>{en(sector.name)}</span><em className={`is-${toneOf(sector.average_change)}`}>{pct(sector.average_change)}</em></li>)}</ul></div>}
    </HoloPanel>}

    {data.history.length > 0 && <HoloPanel className="il-history">
      <HUDSectionTitle code="CLOSES" title={L(`${name} 최근 거래일 종가`, `${names[index][1]} recent closes`)} />
      <div className="il-table-wrap"><table><thead><tr><th scope="col">{L("날짜", "Date")}</th><th scope="col">{L("시가", "Open")}</th><th scope="col">{L("고가", "High")}</th><th scope="col">{L("저가", "Low")}</th><th scope="col">{L("종가", "Close")}</th><th scope="col">{L("전일 대비", "Change")}</th></tr></thead>
        <tbody>{[...data.history].reverse().slice(0, 20).map((row, i, rows) => { const prev = rows[i + 1]?.close; const change = prev ? (row.close / prev - 1) * 100 : null; return <tr key={row.date}><th scope="row">{row.date}</th><td>{num(row.open)}</td><td>{num(row.high)}</td><td>{num(row.low)}</td><td>{num(row.close)}</td><td className={`is-${toneOf(change)}`}>{pct(change)}</td></tr>; })}</tbody></table></div>
    </HoloPanel>}

    <HoloPanel className="il-faq">
      <HUDSectionTitle code="FAQ" title={L("자주 묻는 질문", "Frequently asked questions")} />
      {data.faq.map(item => <details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}
    </HoloPanel>

    <nav className="il-links" aria-label={L("관련 페이지", "Related pages")}>
      <Link to={data.map}>{L(data.map_label, "Market map")} ↗</Link>
      {others.map(key => <Link key={key} to={`/${key}`}>{L(`${names[key][0]} 지수`, `${names[key][1]} index`)} ↗</Link>)}
      <Link to="/today">{L("오늘 증시 한눈에", "Today's market")} ↗</Link>
      <Link to="/market-brief">{L("오늘 브리핑", "Daily briefing")} ↗</Link>
    </nav>
  </main>;
}
