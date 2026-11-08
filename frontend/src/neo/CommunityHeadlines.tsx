import { API_POLL_MS } from "../apiPolling";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import NeoIcon from "./NeoIcon";
import { COMMUNITY_BOARDS, communityPostUrl, latestHeadlines, type CommunityBoard, type CommunityHeadline } from "./headlineFeedModel";
import "./communityHeadlines.css";

type BoardFeed = { items: CommunityHeadline[]; snapshot: string; settled: boolean; delayed: boolean; recent: number };
const empty = (): BoardFeed => ({ items: [], snapshot: "", settled: false, delayed: false, recent: 0 });

function useHeadlines() {
  const [feeds, setFeeds] = useState<Record<CommunityBoard, BoardFeed>>({ kr: empty(), global: empty(), property: empty() });
  const reload = useRef<(board: CommunityBoard) => void>(() => {});
  useEffect(() => {
    let disposed = false;
    const pending = new Map<CommunityBoard, AbortController>();
    const retries = new Map<CommunityBoard, number>();
    async function load(board: CommunityBoard) {
      if (disposed || document.hidden || pending.has(board)) return;
      window.clearTimeout(retries.get(board));
      const controller = new AbortController();
      pending.set(board, controller);
      const deadline = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(`/api/community/${board}?page=1&background=true`, { signal: controller.signal });
        if (!response.ok) throw new Error("Headlines unavailable");
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error("Invalid headline feed");
        const items = latestHeadlines(data.items);
        if (disposed) return;
        setFeeds(previous => ({ ...previous, [board]: { items: items.length || !data.refreshing ? items : previous[board].items, snapshot: items.length || !data.refreshing ? data.snapshot : previous[board].snapshot, settled: true, delayed: false, recent: Number.isFinite(data.recent_hour_count) ? data.recent_hour_count : 0 } }));
        // A restarting server can return an empty snapshot while collecting posts.
        if (data.refreshing) retries.set(board, window.setTimeout(() => void load(board), API_POLL_MS));
      } catch {
        if (!disposed) setFeeds(previous => ({ ...previous, [board]: { ...previous[board], settled: true, delayed: true } }));
      } finally {
        window.clearTimeout(deadline);
        pending.delete(board);
      }
    }
    reload.current = board => { void load(board); };
    COMMUNITY_BOARDS.forEach(board => void load(board.id));
    const stop = startVisibilityAwareInterval(() => COMMUNITY_BOARDS.forEach(board => void load(board.id)), 60_000);
    return () => {
      disposed = true; stop();
      pending.forEach(controller => controller.abort());
      retries.forEach(timer => window.clearTimeout(timer));
    };
  }, []);
  return { feeds, reload: (board: CommunityBoard) => reload.current(board) };
}

function HeadlineReel({ items, step, lang, board, snapshot }: { items: CommunityHeadline[]; step: number; lang: string; board: CommunityBoard; snapshot: string }) {
  const post = items[step % items.length];
  const last = useRef(post);
  const outgoing = last.current.id !== post.id ? last.current : null;
  useEffect(() => { last.current = post; }, [post]);
  return <Link className="ng-headline-story" to={communityPostUrl(board, post.id, snapshot)}
    aria-label={`${post.title} · ${lang === "ko" ? "사이트에서 게시글 읽기" : "Read this post"}`}
    title={`${post.title}${post.source ? ` · ${post.source}` : ""}`}>
    <span className="ng-headline-window" aria-hidden="true">
      {outgoing && <span key={`out-${step}-${outgoing.id}`} className="ng-headline-slide is-outgoing"><strong>{outgoing.title}</strong><small>{outgoing.source}</small></span>}
      <span key={`in-${step % items.length}-${post.id}`} className={`ng-headline-slide${step && items.length > 1 ? " is-incoming" : ""}`}><strong>{post.title}</strong><small>{post.source || (lang === "ko" ? "커뮤니티 원문" : "Community original")}</small></span>
    </span>
    <span className="ng-headline-open" aria-hidden="true">↗</span>
  </Link>;
}

export default function CommunityHeadlines() {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const { feeds, reload } = useHeadlines();
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [inView, setInView] = useState(false);
  const hasMultiple = COMMUNITY_BOARDS.some(board => feeds[board.id].items.length > 1);
  const running = hasMultiple && !paused && !hovered && !focused && !pressed && visible && inView;
  useEffect(() => {
    const observeVisibility = () => setVisible(!document.hidden);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (reducedMotion.matches) setPaused(true); };
    document.addEventListener("visibilitychange", observeVisibility);
    reducedMotion.addEventListener("change", reduce);
    const observer = new IntersectionObserver(entries => setInView(entries[0].isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", observeVisibility); reducedMotion.removeEventListener("change", reduce); };
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setStep(value => value + 1), 1_500);
    return () => window.clearInterval(timer);
  }, [running]);
  return <section ref={root} className="ng-headlines" aria-labelledby="ng-headlines-h" data-running={running} data-reading={hovered || focused || pressed}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => { setHovered(false); setPressed(false); }}
    onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <header className="ng-headlines-heading"><div><span className="ng-headlines-live"><i />COMMUNITY LIVE</span><h2 id="ng-headlines-h">{L("지금, 커뮤니티에서", "Across the community")}</h2></div>
      <div className="ng-headlines-controls"><span>{paused ? L("일시정지", "PAUSED") : hovered || focused || pressed ? L("읽는 중", "READING") : L("1.5초 롤링 · 각 10건", "1.5 SEC · 10 EACH")}</span>
        <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? L("최신글 자동 롤링 재생", "Play headlines") : L("최신글 자동 롤링 일시정지", "Pause headlines")} aria-pressed={paused} title={paused ? L("재생", "Play") : L("일시정지", "Pause")}><svg viewBox="0 0 20 20" aria-hidden="true">{paused ? <path d="m7 4 9 6-9 6Z" fill="currentColor" /> : <path d="M7 4v12m6-12v12" stroke="currentColor" strokeWidth="2" />}</svg></button>
        <button type="button" onClick={() => setStep(value => value + 1)} disabled={!hasMultiple} aria-label={L("다음 최신글 보기", "Next headlines")} title={L("다음 글", "Next")}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 7 5-7 5Zm10 0v10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>
      </div>
    </header>
    <div className="ng-headlines-grid" aria-live="off">{COMMUNITY_BOARDS.map((board, index) => {
      const feed = feeds[board.id], count = feed.items.length;
      return <article className="ng-headline-card" key={board.id} data-board={board.id} style={{ "--headline-order": index } as CSSProperties}>
        <div className="ng-headline-board"><Link to={`/community/${board.id}`} aria-label={`${L(board.ko, board.en)} ${L("커뮤니티 전체 보기", "community")} `}><NeoIcon name={board.icon} /><b>{L(board.ko, board.en)}</b><span>{L("커뮤니티", "COMMUNITY")}</span></Link><span className="ng-headline-count" aria-label={L(`${count ? step % count + 1 : 0}번째, 총 ${count}개`, `${count ? step % count + 1 : 0} of ${count}`)}><b>{String(count ? step % count + 1 : 0).padStart(2, "0")}</b><i>/</i>{String(count).padStart(2, "0")}</span></div>
        {count ? <HeadlineReel items={feed.items} step={step} lang={lang} board={board.id} snapshot={feed.snapshot} /> : <div className="ng-headline-empty"><span>{feed.delayed ? L("최신글을 불러오지 못했습니다", "Headlines unavailable") : feed.settled ? L("새 이야기를 확인하고 있습니다", "Checking for new stories") : L("최신 이야기를 모으는 중", "Gathering the latest stories")}</span>{feed.delayed && <button type="button" onClick={() => reload(board.id)}>{L("다시 시도", "Retry")} ↻</button>}</div>}
        {feed.settled && <span className="ng-headline-freshness">{L(`최근 1시간 ${feed.recent}건`, `${feed.recent} in the past hour`)}</span>}
        {feed.delayed && count > 0 && <span className="ng-headline-delayed">{L("갱신 지연 · 최근 목록", "Delayed · last available")}</span>}
        <div className="ng-headline-track" aria-hidden="true"><i key={`${step}-${running}`} style={{ animationPlayState: running && count > 1 ? "running" : "paused" }} /></div>
      </article>;
    })}</div>
  </section>;
}
