import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { HoloPanel, HUDSectionTitle } from "../neo/NeoComponents";
import { MARKET_NAMES, publicMarket, type PublicMarket } from "./publicLinks";
import ShareButton from "./ShareButton";
import { reportGrowthAction } from "../useActivityTracking";
import "./market-pulse.css";

type Row = { code: string; name: string; close: number; change_pct: number | null; sector: string; turnover: number | null; turnover_kind: "estimate" | "reported" };
type Snapshot = { market: PublicMarket; name: string; currency: string; map_path: string; count: number; known_count: number; up: number; down: number; flat: number; missing_change: number; average_change: number | null; advance_ratio: number | null; collected_at: string; basis: string; gainers: Row[]; losers: Row[]; turnover: Row[]; sectors: { name: string; count: number; average_change: number }[] };
const pct = (n: number | null) => n === null ? "미제공" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
function useSnapshot(market: PublicMarket) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true, loading = false;
    setData(null); setError("");
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const response = await fetch(`/market-snapshot/${market}.json`, { signal: controller.signal });
        if (!response.ok) throw new Error("not ready");
        const value: Snapshot = await response.json();
        if (value.market !== market || !value.count) throw new Error("empty market");
        if (active) { setData(value); setError(""); }
      } catch { if (active) setError("새 시세를 가져오지 못했습니다. 잠시 후 다시 확인해 주세요."); }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 60000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [market, revision]);
  return { data: data?.market === market ? data : null, error, retry: () => setRevision(v => v + 1) };
}
export function ReturnTools() {
  return <HoloPanel className="pulse-return"><HUDSectionTitle code="DAILY CHECK" title="다음 장에도 이어서 확인하세요" /><p>시장 지도로 흐름을 확인하고, 장이 끝난 뒤 브리핑으로 다시 정리하세요.</p><div className="ng-setting-actions pulse-actions"><a href="/market-feed.xml" onClick={() => reportGrowthAction("rss_open")}>장마감 브리핑 RSS 구독 ↗</a><a href="/market-check.ics" download onClick={() => reportGrowthAction("reminder_download")}>평일 16:30 확인 알림 받기 ↓</a><Link to="/market-brief">오늘 브리핑 →</Link></div><small>RSS 주소를 구독 앱에 추가하거나 달력 파일을 가져오세요. 달력 알림은 한국시간 기준이며 휴장일에도 표시될 수 있습니다.</small></HoloPanel>;
}
export function TodayEntry() {
  return <section className="pulse-home-entry ng-panel" aria-label="오늘 증시와 재방문"><div><span className="ng-kicker">TODAY / SHARE / RETURN</span><h2>오늘 시장, 상승과 하락을 한눈에</h2><p>시장 분포를 확인하고 카드로 공유하세요. 다음 장은 RSS와 달력 알림으로 이어집니다.</p></div><div className="ng-setting-actions pulse-actions"><Link to="/today">오늘 증시 보기 →</Link><Link to="/share-market">시장 카드·퍼가기 ↗</Link></div></section>;
}
function Rows({ title, rows, data, turnover = false }: { title: string; rows: Row[]; data: Snapshot; turnover?: boolean }) {
  return <HoloPanel><HUDSectionTitle code={turnover ? "ACTIVITY" : "MOVERS"} title={title} /><div className="pulse-table-wrap"><table><caption>{data.name} 지도 표본 내 순위</caption><thead><tr><th scope="col">종목</th><th scope="col">{turnover ? `거래규모 (${data.currency})` : `가격 (${data.currency})`}</th><th scope="col">등락률</th></tr></thead><tbody>{rows.map(row => <tr key={row.code}><th scope="row"><Link to={`/stock/${row.code}`}>{row.name}<small>{row.code}</small></Link></th><td>{turnover ? `${row.turnover?.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) ?? "—"}${row.turnover_kind === "estimate" ? " ≈" : ""}` : row.close.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}</td><td className={(row.change_pct ?? 0) > 0 ? "pulse-up" : (row.change_pct ?? 0) < 0 ? "pulse-down" : ""}>{pct(row.change_pct)}</td></tr>)}</tbody></table>{!rows.length && <p>해당 조건의 종목이 없습니다.</p>}</div>{turnover && <small>≈ 표시는 현재가×거래량 근사치입니다. 실제 누적 거래대금과 차이가 있습니다.</small>}</HoloPanel>;
}
function CopyEmbed({ value }: { value: string }) {
  const [status, setStatus] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  return <div className="pulse-embed-code"><label htmlFor="market-embed-code">사이트에 넣을 HTML</label><textarea id="market-embed-code" ref={field} readOnly value={value} onFocus={e => e.currentTarget.select()} /><div className="ng-setting-actions"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setStatus("퍼가기 코드를 복사했습니다."); reportGrowthAction("embed_copy"); } catch { field.current?.focus(); field.current?.select(); setStatus("선택된 코드를 직접 복사해 주세요."); } }}>퍼가기 코드 복사</button><span role="status">{status}</span></div></div>;
}
export default function MarketPulsePage({ sharing = false }: { sharing?: boolean }) {
  const market = publicMarket(window.location.search);
  const { data, error, retry } = useSnapshot(market);
  const search = market === "kospi" ? "" : `?market=${market}`;
  const widget = `https://kospimap.com/embed/market/${market}`;
  return <main className="ng-market-pulse" lang="ko"><header className="ng-page-heading"><span className="ng-kicker">KOSPIMAP / {sharing ? "SHARE THE MARKET" : "MARKET SNAPSHOT"}</span><h1>{sharing ? "시장 카드 공유 · 위젯 퍼가기" : `${MARKET_NAMES[market]} 오늘 증시 한눈에`}</h1><p>{sharing ? "지금의 시장 분포를 카드와 링크로 나누고, 내 사이트에 시장 위젯을 연결하세요." : "지도에 담긴 주요 종목의 상승·하락, 거래 집중, 업종 흐름을 같은 기준으로 비교하세요."}</p></header><nav className="pulse-tabs" aria-label="시장 선택">{Object.entries(MARKET_NAMES).map(([key, name]) => <Link key={key} to={`${sharing ? "/share-market" : "/today"}${key === "kospi" ? "" : `?market=${key}`}`} aria-current={key === market ? "page" : undefined}>{name}</Link>)}</nav>
    <div className="ng-setting-actions pulse-actions"><ShareButton path="/today" search={search} title={`${MARKET_NAMES[market]} 오늘 시장 한눈에`} /><Link to={sharing ? `/today${search}` : `/share-market${search}`}>{sharing ? "시장 수치 보기 →" : "카드·위젯 공유 ↗"}</Link>{data && <Link to={data.map_path}>시장 지도 →</Link>}</div>
    {error && <p role="status">{error} <button type="button" onClick={retry}>다시 시도</button></p>}{!data && !error && <p role="status">시장 데이터를 불러오는 중입니다…</p>}
    {data && <><p className="pulse-timestamp">화면 집계 <time dateTime={data.collected_at}>{new Date(data.collected_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST</time> · 화면이 보일 때 1분마다 확인</p><div className="pulse-counts">{[["상승", data.up, "pulse-up"], ["하락", data.down, "pulse-down"], ["보합", data.flat, ""], ["상승 비율", data.advance_ratio === null ? "—" : `${data.advance_ratio.toFixed(1)}%`, ""]].map(([label, value, cls]) => <HoloPanel key={label}><span>{label}</span><strong className={String(cls)}>{value}</strong></HoloPanel>)}</div><p className="pulse-basis">{data.basis} 등락률 확인 {data.known_count}/{data.count}종목 · 미제공 {data.missing_change}종목 · 표본 단순평균 {pct(data.average_change)}</p></>}
    {sharing ? <div className="pulse-grid"><HoloPanel><HUDSectionTitle code="MARKET CARD" title="시장 요약 이미지" />{data && <><img className="pulse-card" src={`/market-card/${market}.png`} alt={`${data.name} 시장 분포 카드. 표본 ${data.count}종목, 상승 ${data.up}, 하락 ${data.down}, 보합 ${data.flat}. 카드와 화면의 집계 시점은 다를 수 있습니다.`} /><div className="ng-setting-actions"><a href={`/market-card/${market}.png`} download={`kospimap-${market}.png`} onClick={() => reportGrowthAction("card_download")}>카드 내려받기 ↓</a></div></>}<p>카드와 함께 위의 공유 링크를 붙이면 최신 시장으로 바로 연결됩니다. 카드 자체에도 집계 시각과 출처가 표시됩니다.</p></HoloPanel><HoloPanel><HUDSectionTitle code="EMBED" title="내 사이트에 시장 위젯 넣기" /><iframe title={`${MARKET_NAMES[market]} 시장 위젯 미리보기`} src={`/embed/market/${market}`} loading="lazy" className="pulse-widget" referrerPolicy="no-referrer" /><CopyEmbed value={`<iframe src="${widget}" title="${MARKET_NAMES[market]} 시장 요약 · KOSPIMAP" width="100%" height="460" loading="lazy" referrerpolicy="no-referrer" style="border:0;max-width:560px"></iframe>`} /><p>iframe을 허용하는 사이트에서 사용할 수 있습니다. 위젯의 종목·시장 링크는 KOSPIMAP으로 연결됩니다.</p></HoloPanel></div> : data && <><div className="pulse-grid"><Rows title="상승 상위" rows={data.gainers} data={data} /><Rows title="하락 상위" rows={data.losers} data={data} /><Rows title="거래 집중" rows={data.turnover} data={data} turnover /><HoloPanel><HUDSectionTitle code="SECTORS" title="표본 업종 흐름" /><p>등락률이 제공된 종목의 업종별 단순평균 상위입니다.</p><ul className="pulse-sectors">{data.sectors.map(sector => <li key={sector.name}><span>{sector.name} <small>{sector.count}종목</small></span><strong className={sector.average_change > 0 ? "pulse-up" : sector.average_change < 0 ? "pulse-down" : ""}>{pct(sector.average_change)}</strong></li>)}</ul></HoloPanel></div></>}
    <ReturnTools /><p className="pulse-basis">제공 시세는 지연되거나 일부 누락될 수 있습니다. 시장 전체 지수나 투자 추천이 아닌, 지도 표본의 가격 정보입니다.</p></main>;
}
