import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "../../router";
import { useLanguage } from "../../i18n/LanguageContext";
import { toggleDeskBgmPlay, useDeskBgm } from "../deskBgmStore";
import { useEditorial, dateText, formatViews, percent, compactDollars, type InvestmentVideo, type Investor, type InvestorEdition, type VideoEdition } from "./api";
import "./discovery.css";

export function Portrait({ investor, large = false }: { investor: Investor; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [investor.photo_url]);
  return <span className={`ed-portrait${large ? " is-large" : ""}`} style={{ "--person-color": investor.color } as CSSProperties}>
    {investor.photo_url && !failed ? <img src={investor.photo_url} alt={investor.name} decoding="async" loading="lazy" onError={() => setFailed(true)} /> : <span aria-label={`${investor.name} 사진 확인 중`}>{investor.name_en.split(" ").map(s => s[0]).join("").slice(0, 2)}</span>}
  </span>;
}

export function EditionNote({ edition, stale, noun }: { edition?: string | null; stale?: boolean; noun: string }) {
  return <span className={`ed-edition-note${stale ? " is-stale" : ""}`}><i aria-hidden="true" />{edition ? `${edition.slice(5).replace("-", ".")} · 08:00 ${noun}` : `${noun} 확인 중`}{stale && " · 이전 회차"}</span>;
}

export function PhotoCredit({ investor }: { investor: Investor }) {
  return <><a href={investor.photo_source} target="_blank" rel="noreferrer">사진: {investor.photo_credit}</a> · {investor.photo_license_url ? <a href={investor.photo_license_url} target="_blank" rel="noreferrer">{investor.photo_license}</a> : investor.photo_license}</>;
}

export function InvestorCard({ investor }: { investor: Investor }) {
  return <Link to={`/investors/${investor.id}`} className="ed-investor-card" style={{ "--person-color": investor.color } as CSSProperties}>
    <div className="ed-person-top"><Portrait investor={investor} /><span className="ed-person-arrow" aria-hidden="true">↗</span></div>
    <span className="ed-person-style">{investor.style}</span>
    <h3 className="d2-title">{investor.name}</h3><p className="ed-person-en">{investor.name_en}</p><p className="ed-person-firm">{investor.firm}</p>
    <div className="ed-person-holdings">{investor.available ? investor.top_holdings.map((holding, i) => <span key={holding.position_id ?? holding.code}><b>{holding.code || holding.cusip}{holding.asset_type === "put" ? " PUT" : holding.asset_type === "call" ? " CALL" : ""}</b><i style={{ width: `${Math.min(100, holding.weight_pct)}%`, opacity: 1 - i * .2 }} /><em>{holding.weight_pct.toFixed(1)}%</em></span>) : <span className="ed-person-wait">공시 보유 내역 확인 중</span>}</div>
    <div className="ed-person-foot"><span>{investor.period ?? "공시 확인 중"}</span><b>{investor.available ? `${investor.holding_count}종목` : "살펴보기"}</b></div>
  </Link>;
}

export function InvestorShowcase({ id = "ed-investors" }: { id?: string }) {
  const { data, error } = useEditorial<InvestorEdition>("investors");
  const { lang } = useLanguage();
  const profiles = data?.items ?? [];
  return <section id={id} className="ed-discovery-section ed-investor-section" aria-labelledby={`${id}-title`}>
    <div className="ed-section-heading"><div><p className="ed-eyebrow">THE CAPITAL NOTE <span>01</span></p><h2 className="d2-title" id={`${id}-title`}>{lang === "ko" ? "거물들의 선택" : "Read the capital behind the names"}</h2><p>사람으로 시작해, 보유 종목까지. 공시에서 발견하는 큰 자금의 생각.</p></div><Link to="/investors" className="ed-more">전체 포트폴리오 <span>↗</span></Link></div>
    <div className="ed-investor-grid">{profiles.slice(0, 6).map(investor => <InvestorCard key={investor.id} investor={investor} />)}{!profiles.length && Array.from({ length: 6 }, (_, i) => <div className="ed-investor-skeleton" key={i}><i /><span /><span /></div>)}</div>
    {!!data?.consensus.length && <div className="ed-consensus"><div><span className="ed-small-icon" aria-hidden="true">◎</span><b>겹치는 확신</b><small>같은 공시분기에 함께 담은 종목</small></div><div>{data.consensus.slice(0, 4).map(item => <Link key={item.code} to={`/investors?stock=${encodeURIComponent(item.code)}`}><b>{item.code}</b><span>{item.count}명 보유</span><i>↗</i></Link>)}</div></div>}
    <div className="ed-section-foot"><span>운용사 공시 주식 보유분 · 개인 계좌 또는 전체 자산이 아닙니다.</span><EditionNote edition={data?.edition} stale={data?.stale} noun="공시 확인" /></div>
    {error && !data && <p className="ed-state">포트폴리오를 잠시 불러오지 못했습니다. 자동으로 다시 확인합니다.</p>}
  </section>;
}

export function VideoPlayer({ video, onClose }: { video: InvestmentVideo; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const music = useDeskBgm();
  // A deliberate video click pauses the desk music so voices stay audible.
  const pauseMusic = useRef(music.playing);
  useEffect(() => { if (pauseMusic.current) { pauseMusic.current = false; toggleDeskBgmPlay(); } }, []);
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  return <dialog ref={dialog} className="ed-video-dialog" onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }} aria-labelledby="ed-playing-title">
    <header><h2 className="d2-title" id="ed-playing-title">{video.title}</h2><button type="button" onClick={onClose} aria-label="영상 닫기">×</button></header>
    <iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`} title={video.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    <footer><span>{video.channel}</span><a href={video.url} target="_blank" rel="noopener noreferrer">YouTube에서 보기 ↗</a></footer>
  </dialog>;
}

export function VideoCard({ video, onPlay }: { video: InvestmentVideo; onPlay: (video: InvestmentVideo) => void }) {
  const duration = video.duration_seconds;
  const durationText = duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}` : null;
  return <article className="ed-video-card"><button type="button" className="ed-video-open" onClick={() => onPlay(video)} aria-label={`${video.title} 재생`}>
    <span className="ed-video-image"><img src={video.thumbnail} alt="" loading="lazy" /><span className="ed-video-rank">{String(video.rank).padStart(2, "0")}</span><span className="ed-play" aria-hidden="true">▶</span>{durationText && <span className="ed-video-duration">{durationText}</span>}</span>
    <span className="ed-video-topic">{video.topic}</span><h3 className="d2-title">{video.title}</h3>
  </button><p className="ed-video-channel">{video.channel}</p><div className="ed-video-meta"><b>조회 {formatViews(video.views)}회</b><time dateTime={video.published_at}>{dateText(video.published_at)} 공개</time></div></article>;
}

export function VideoShowcase({ market, id = "ed-videos" }: { market: "kr" | "us"; id?: string }) {
  const { data, error } = useEditorial<VideoEdition>(`videos?market=${market}`);
  const [playing, setPlaying] = useState<InvestmentVideo | null>(null);
  const ready = !!data?.items.length;
  return <section id={id} className="ed-discovery-section ed-video-section" aria-labelledby={`${id}-title`}>
    <div className="ed-section-heading"><div><p className="ed-eyebrow">THE WATCHLIST <span>02</span></p><h2 className="d2-title" id={`${id}-title`}>{market === "kr" ? "오늘, 함께 보는 국내 증시" : "오늘, 함께 보는 미국 증시"}</h2><p>{market === "kr" ? "어제부터 오늘 아침까지, 국내 주식 영상 중 많이 본 이야기." : "나스닥·미국 주식 영상에서 많이 본 이야기. 한국어 콘텐츠로 골랐습니다."}</p></div><Link to={`/investment-videos?market=${market}`} className="ed-more">영상 20개 더보기 <span>↗</span></Link></div>
    <div className="ed-video-grid">{data?.items.slice(0, 4).map(video => <VideoCard key={video.id} video={video} onPlay={setPlaying} />)}{!ready && Array.from({ length: 4 }, (_, i) => <div className="ed-video-skeleton" key={i}><i /><span /><span /></div>)}</div>
    <div className="ed-section-foot"><span>전일 00:00 ~ 당일 08:00(KST) 공개 · 수집 후보 내 조회수 순{data?.collected_at ? ` · ${dateText(data.collected_at, true)} 집계` : ""}</span><EditionNote edition={data?.edition} stale={data?.stale} noun="선정" /></div>
    {(!ready && (error || data?.status === "unavailable")) && <p className="ed-state">이번 회차의 확인된 영상을 아직 가져오지 못했습니다. 임의 영상으로 채우지 않고 다시 확인합니다.</p>}
    {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
  </section>;
}
