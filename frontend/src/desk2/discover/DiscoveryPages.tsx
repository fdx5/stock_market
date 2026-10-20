import { useMemo, useState } from "react";
import { Link } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Masthead from "../Masthead";
import { useBroadsheet } from "../shell";
import { EditionNote, InvestorCard, PhotoCredit, Portrait, VideoCard, VideoPlayer } from "./DiscoverySections";
import { compactDollars, dateText, dollars, percent, useEditorial, type Holding, type InvestmentVideo, type InvestorEdition, type PortfolioEdition, type VideoEdition } from "./api";
import "./discovery.css";

function PageHeading({ label, title, description, back = "/desk" }: { label: string; title: string; description: string; back?: string }) {
  return <header className="ed-page-heading"><Link to={back} className="ed-back">← 시장으로</Link><p className="ed-eyebrow">{label}</p><h1>{title}</h1><p>{description}</p></header>;
}

export function InvestmentVideosPage() {
  useBroadsheet();
  const market = new URLSearchParams(window.location.search).get("market") === "us" ? "us" : "kr";
  useDocumentTitle(`${market === "us" ? "나스닥" : "국내 주식"} 투자 영상 TOP20 · K-Stock Hub`);
  const { data, error } = useEditorial<VideoEdition>(`videos?market=${market}`);
  const [topic, setTopic] = useState("전체");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"views" | "recent">("views");
  const [playing, setPlaying] = useState<InvestmentVideo | null>(null);
  const all = data?.items ?? [];
  const topics = ["전체", ...new Set(all.map(video => video.topic))];
  const videos = all.filter(video => (topic === "전체" || video.topic === topic) && `${video.title} ${video.channel}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "views" ? b.views - a.views : new Date(b.published_at).valueOf() - new Date(a.published_at).valueOf());
  return <div className="d2 ed-page ed-videos-page"><Masthead onPrint={() => window.print()} rail={false} section={{ ko: "투자 영상", en: "The Watchlist", taglineKo: "어제부터 오늘 아침까지, 많이 본 투자 이야기", taglineEn: "An 08:00 KST edition of investment videos" }} /><main className="d2-main">
    <PageHeading label="THE WATCHLIST / DAILY 08:00" title={market === "us" ? "한국어로 읽는 나스닥의 밤" : "오늘, 함께 보는 국내 증시"} description="어제부터 오늘 오전 8시까지 공개된 영상. 수집 후보에서 조회수로 정렬한 스무 가지 이야기." back={market === "us" ? "/global" : "/desk"} />
    <div className="ed-video-market-tabs" role="group" aria-label="영상 시장 선택"><Link to="/investment-videos?market=kr" aria-current={market === "kr" ? "page" : undefined}>국내 주식 <span>SEOUL</span></Link><Link to="/investment-videos?market=us" aria-current={market === "us" ? "page" : undefined}>나스닥·미국 주식 <span>NEW YORK</span></Link></div>
    <div className="ed-page-toolbar"><div className="ed-filter-chips" role="group" aria-label="영상 주제">{topics.map(value => <button key={value} type="button" className={topic === value ? "is-on" : ""} aria-pressed={topic === value} onClick={() => setTopic(value)}>{value}</button>)}</div><label className="ed-search"><span>검색</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="제목 또는 채널" aria-label="영상 제목 또는 채널 검색" /></label><label className="ed-select"><span className="sr-only">영상 정렬</span><select value={sort} onChange={event => setSort(event.target.value as "views" | "recent")}><option value="views">많이 본 순</option><option value="recent">최근 공개 순</option></select></label></div>
    <div className="ed-list-context"><span>{all.length ? `${all.length}개 선정 · ${videos.length}개 표시` : "이번 회차 영상을 확인하고 있습니다"}</span><EditionNote edition={data?.edition} stale={data?.stale} noun="선정" /></div>
    <div className="ed-video-grid">{videos.map(video => <VideoCard video={video} key={video.id} onPlay={setPlaying} />)}</div>
    {!videos.length && <div className="ed-empty"><span aria-hidden="true">▷</span><h2>{all.length ? "검색 결과가 없습니다" : error || data?.status === "unavailable" ? "이번 회차를 확인하고 있습니다" : "오늘 아침의 이야기를 모으는 중"}</h2><p>{all.length ? "다른 제목이나 채널로 검색해 보세요." : "공개 시각과 조회수가 확인된 영상만 표시합니다. 이전 회차가 있으면 그대로 보존합니다."}</p>{all.length > 0 && <button type="button" onClick={() => { setTopic("전체"); setQuery(""); }}>필터 초기화</button>}</div>}
    <aside className="ed-source-note"><b>이 목록의 기준</b><p>매일 08:00 KST에 전일 00:00부터 당일 08:00 이전까지 공개된 한국어 투자 영상을 수집합니다. 주제별로 발견한 후보의 조회수 상위 20개이며 YouTube 전체의 공식 순위는 아닙니다. 조회수는 {data?.collected_at ? dateText(data.collected_at, true) : "수집"} 시점 기준입니다. 수집 가능한 영상이 20개보다 적으면 확인된 영상만 표시합니다.</p></aside>
  </main><Colophon />{playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}</div>;
}

export function InvestorsPage() {
  useBroadsheet(); useDocumentTitle("거물들의 선택 · 공개 포트폴리오 · K-Stock Hub");
  const { data, error } = useEditorial<InvestorEdition>("investors");
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState("전체");
  const [stock, setStock] = useState(new URLSearchParams(window.location.search).get("stock") ?? "");
  const selected = data?.consensus.find(item => item.code === stock);
  const profiles = (data?.items ?? []).filter(item => `${item.name} ${item.name_en} ${item.firm}`.toLowerCase().includes(query.toLowerCase()) && (lens === "전체" || (lens === "집중 투자" ? item.top3_weight >= 50 : lens === "신규 편입" ? item.new_count > 0 : item.style.includes("가치"))) && (!stock || selected?.investors.includes(item.id)));
  return <div className="d2 ed-page"><Masthead onPrint={() => window.print()} rail={false} section={{ ko: "거물 포트폴리오", en: "The Capital Note", taglineKo: "공개된 보유 종목에서 큰 자금의 생각을 읽다", taglineEn: "Read disclosed equity holdings" }} /><main className="d2-main">
    <PageHeading label="THE CAPITAL NOTE / DISCLOSED EQUITY" title="이름 뒤의 자금을 읽다." description="익숙한 얼굴에서 시작해, 그들이 담은 기업까지. 공시를 바탕으로 서로 다른 투자자의 선택을 비교하세요." />
    <div className="ed-catalog-intro"><p><b>{data?.available_count ?? "—"}</b><span>확인된 운용사 포트폴리오</span></p><p><b>13F</b><span>미국 상장 주식 보유 공시 기준</span></p><p><b>08:00</b><span>매일 새로운 공시 확인 · KST</span></p><EditionNote edition={data?.edition} stale={data?.stale} noun="공시 확인" /></div>
    {!!data?.consensus.length && <section className="ed-consensus-panel"><div><p className="ed-eyebrow">SHARED CONVICTION</p><h2>다른 생각이 만나는 종목</h2><p>같은 공시분기에 여러 운용사가 함께 보유한 기업. 누르면 해당 투자자만 볼 수 있습니다.</p></div><div>{data.consensus.slice(0, 8).map(item => <button type="button" className={stock === item.code ? "is-on" : ""} key={item.code} aria-pressed={stock === item.code} onClick={() => setStock(stock === item.code ? "" : item.code)}><b>{item.code}</b><span>{item.count}명 보유</span><i>↗</i></button>)}</div></section>}
    <div className="ed-page-toolbar"><div className="ed-filter-chips" role="group" aria-label="투자 성향 선택">{["전체", "가치 투자", "집중 투자", "신규 편입"].map(value => <button type="button" key={value} className={lens === value ? "is-on" : ""} onClick={() => setLens(value)} aria-pressed={lens === value}>{value}</button>)}</div><label className="ed-search"><span>검색</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="투자자 또는 운용사" aria-label="투자자 또는 운용사 검색" /></label></div>
    {stock && <p className="ed-active-filter"><b>{stock} 공통 보유</b><button type="button" onClick={() => setStock("")}>해제 ×</button></p>}
    <div className="ed-investor-grid ed-catalog-grid">{profiles.map(investor => <InvestorCard key={investor.id} investor={investor} />)}</div>
    {!profiles.length && <div className="ed-empty"><h2>{data?.items.length ? "조건에 맞는 투자자가 없습니다" : "공개 포트폴리오를 확인하는 중"}</h2><p>{error ? "연결이 복구되면 자동으로 다시 확인합니다." : "투자 성향이나 검색 조건을 바꿔 볼 수 있습니다."}</p><button type="button" onClick={() => { setStock(""); setQuery(""); setLens("전체"); }}>전체 보기</button></div>}
    <aside className="ed-source-note"><b>사람의 이름, 운용사의 공시</b><p>인물은 해당 운용사를 이해하기 위한 대표·연관 인물입니다. 개인 자산이나 개인 계좌가 아니며, 실제 현재 운용 책임자와 다를 수 있습니다. 주식 보유 공시는 분기말 기준으로 지연 공개됩니다. 현금·채권·비상장 자산 등 전체 운용 자산과는 다릅니다. 실제 매입단가는 공개되지 않습니다.</p><p>공시 집계: <a href="https://www.dataroma.com/" target="_blank" rel="noreferrer">DATAROMA ↗</a> · <a href="https://www.sec.gov/answers/form13f.htm" target="_blank" rel="noreferrer">SEC 13F 안내 ↗</a></p><details><summary>인물 사진 출처</summary>{(data?.items ?? []).filter(item => item.photo_source).map(item => <p key={item.id}>{item.name} · <PhotoCredit investor={item} /></p>)}<p>사진은 원형으로 크롭하고 흑백으로 표시합니다.</p></details></aside>
  </main><Colophon /></div>;
}

const COLORS = ["#568879", "#c99864", "#697fa4", "#b77a7d", "#8d83aa", "#86a5aa", "#a8ad76", "#b49d8d", "#757b7c"];
const activityLabel = (holding: Holding) => holding.activity === "new" ? "신규 편입" : holding.activity === "add" ? `보유 +${holding.shares_change_pct?.toFixed(1) ?? ""}%` : holding.activity === "reduce" ? `보유 −${holding.shares_change_pct?.toFixed(1) ?? ""}%` : "유지";

export function InvestorPortfolioPage({ investorId }: { investorId: string }) {
  useBroadsheet();
  const { data, error } = useEditorial<PortfolioEdition>(`investors/${encodeURIComponent(investorId)}`);
  const investor = data?.investor;
  useDocumentTitle(`${investor?.name ?? "투자자"} 공개 포트폴리오 · K-Stock Hub`);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("weight");
  const [selected, setSelected] = useState("");
  const holdings = data?.holdings ?? [];
  const rows = holdings.filter(row => `${row.code} ${row.name}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || row.activity === filter)).sort((a, b) => sort === "return" ? (b.reference_return_pct ?? -Infinity) - (a.reference_return_pct ?? -Infinity) : sort === "name" ? a.code.localeCompare(b.code) : b.weight_pct - a.weight_pct);
  const chartRows = useMemo(() => { const top = holdings.slice(0, 8); const rest = holdings.slice(8).reduce((sum, row) => sum + row.weight_pct, 0); return rest > 0 ? [...top, { code: "OTHERS", name: "기타", weight_pct: rest }] : top; }, [holdings]);
  const totalWeight = chartRows.reduce((sum, row) => sum + row.weight_pct, 0) || 1;
  let cursor = 0;
  const stops = chartRows.map((row, i) => { const start = cursor; cursor += row.weight_pct / totalWeight * 100; return `${COLORS[i % COLORS.length]} ${start}% ${cursor}%`; });
  const focusHolding = (code: string) => { if (code === "OTHERS") return; setSelected(code); setFilter("all"); setQuery(""); window.setTimeout(() => document.getElementById(`ed-holding-${code}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0); };
  return <div className="d2 ed-page ed-portfolio-page"><Masthead onPrint={() => window.print()} rail={false} section={{ ko: "공개 포트폴리오", en: "Portfolio Note", taglineKo: "보유 비중, 변화를 읽는 한 장의 지도", taglineEn: "A map of disclosed equity holdings" }} /><main className="d2-main">
    <Link to="/investors" className="ed-back">← 거물 포트폴리오 전체</Link>
    {investor && <header className="ed-portfolio-hero"><Portrait investor={investor} large /><div><p className="ed-eyebrow">{investor.style} / DISCLOSED EQUITY</p><h1>{investor.name}<span>{investor.name_en}</span></h1><p>{investor.firm}</p><div className="ed-portfolio-tags"><span>{investor.period ?? "공시 확인 중"}</span><span>{investor.report_date ? `${investor.report_date} 보유 기준` : "보유 기준일 확인 중"}</span><span>실제 매입단가 미공개</span></div></div><Link to="/investors" className="ed-more">다른 투자자와 비교 ↗</Link></header>}
    {investor && holdings.length > 0 ? <>
      <div className="ed-portfolio-stats"><div><span>공시 주식 평가액</span><b>{compactDollars(investor.reported_value)}</b></div><div><span>공시 보유 종목</span><b>{holdings.length}<small>개</small></b></div><div><span>상위 3종목 집중도</span><b>{percent(investor.top3_weight)}</b></div><div><span>신규 편입 / 비중 확대</span><b>{investor.new_count}<small> / </small>{investor.add_count}<small>개</small></b></div></div>
      <section className="ed-allocation-panel"><div className="ed-allocation-chart"><div className="ed-donut" style={{ background: `conic-gradient(${stops.join(",")})` }} role="img" aria-label={`공시 포트폴리오 구성: ${chartRows.map(row => `${row.code} ${percent(row.weight_pct)}`).join(", ")}`}><span><small>PORTFOLIO</small><b>{investor.period}</b><em>공시 비중</em></span></div></div><div className="ed-allocation-content"><p className="ed-eyebrow">THE WEIGHT OF CONVICTION</p><h2>무엇을, 얼마나 담았을까.</h2><p>큰 비중부터 읽어보세요. 종목을 누르면 보유 내역으로 이동합니다.</p><div className="ed-allocation-legend">{chartRows.map((row, i) => <button type="button" key={row.code} onClick={() => focusHolding(row.code)} disabled={row.code === "OTHERS"}><i style={{ background: COLORS[i % COLORS.length] }} /><b>{row.code === "OTHERS" ? "기타" : row.code}</b><span>{percent(row.weight_pct)}</span></button>)}</div></div></section>
      <div className="ed-holdings-heading"><div><p className="ed-eyebrow">HOLDINGS / FROM DISCLOSURE TO NOW</p><h2>보유 내역과 공시 이후의 변화</h2></div><EditionNote edition={data?.edition} stale={data?.stale} noun="공시 확인" /></div>
      <div className="ed-page-toolbar"><div className="ed-filter-chips" role="group" aria-label="보유 변화 필터">{[{ key: "all", label: "전체" }, { key: "new", label: "신규 편입" }, { key: "add", label: "보유 확대" }, { key: "reduce", label: "보유 축소" }].map(item => <button type="button" key={item.key} className={filter === item.key ? "is-on" : ""} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div><label className="ed-search"><span>종목</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="티커 또는 기업명" aria-label="보유 종목 검색" /></label><select aria-label="보유 종목 정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="weight">공시 비중 순</option><option value="return">기준가 대비 등락 순</option><option value="name">티커 순</option></select></div>
      <div className="ed-holdings-scroll" tabIndex={0} role="region" aria-label="보유 종목 표, 좌우로 스크롤 가능"><table className="ed-holdings-table"><thead><tr><th scope="col">기업 / 티커</th><th scope="col">공시 비중</th><th scope="col">추정 현재 비중</th><th scope="col">공시 보유 주수</th><th scope="col">보유 변화</th><th scope="col" title="분기말 평가단가. 실제 매입단가가 아닙니다.">공시 기준가 ⓘ</th><th scope="col">현재가</th><th scope="col">기준가 대비</th></tr></thead><tbody>{rows.map(row => <tr key={row.code} id={`ed-holding-${row.code}`} className={selected === row.code ? "is-selected" : ""}><th scope="row"><a href={`https://finance.yahoo.com/quote/${encodeURIComponent(row.code.replace(/\./g, "-"))}/`} target="_blank" rel="noreferrer" title="Yahoo Finance에서 종목 시세 보기"><b>{row.code} ↗</b><small>{row.name}</small></a></th><td><span className="ed-weight-number">{percent(row.weight_pct)}</span><i className="ed-weight-bar" style={{ width: `${Math.max(2, row.weight_pct)}%` }} /></td><td>{percent(row.current_weight_pct)}</td><td>{row.shares.toLocaleString("en-US")}</td><td><span className={`ed-activity is-${row.activity}`}>{activityLabel(row)}</span></td><td>{dollars(row.reference_price)}</td><td>{dollars(row.current_price)}<small className="ed-price-time">{row.quote_time ? `${dateText(new Date(row.quote_time * 1000).toISOString(), true)} 체결` : "일일 확인값"}</small></td><td className={(row.reference_return_pct ?? 0) >= 0 ? "is-up" : "is-down"}>{percent(row.reference_return_pct, true)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="ed-empty">조건에 맞는 보유 종목이 없습니다.</p>}
      <aside className="ed-source-note"><b>숫자를 읽기 전에</b><p>실제 매입단가는 13F에 공개되지 않아 표시하지 않습니다. 공시 기준가는 분기말 평가단가이며, ‘기준가 대비’는 이 가격과 현재가의 단순 등락률입니다. 투자자의 실제 수익률, 실현 손익 또는 추천 수익률이 아닙니다. 배당·후속 매매·세금·환율은 반영하지 않습니다. 추정 현재 비중은 공시 주수를 유지했다고 가정한 가격 재평가입니다.</p><p>운용사의 공시 주식 보유분만 다룹니다. 현금·채권·비상장 자산을 포함한 전체 자산배분이 아닙니다. 실시간 시세를 받지 못한 종목은 일일 확인값을 표시합니다.</p><p><a href={investor.source_url} target="_blank" rel="noreferrer">보유 공시 집계 원문 ↗</a>{investor.cik && <> · <a href={`https://www.sec.gov/edgar/browse/?CIK=${investor.cik}&owner=exclude`} target="_blank" rel="noreferrer">SEC 원문 ↗</a></>}</p>{investor.photo_source && <p><PhotoCredit investor={investor} /> · 원형 크롭·흑백 표시</p>}</aside>
    </> : <div className="ed-empty"><h2>{error ? "포트폴리오를 불러오지 못했습니다" : "공개된 보유 내역을 확인하고 있습니다"}</h2><p>원문에서 확인한 공시만 제공합니다. 확인이 끝나면 자동으로 표시합니다.</p><Link to="/investors">투자자 목록으로 돌아가기 ↗</Link></div>}
  </main><Colophon /></div>;
}
