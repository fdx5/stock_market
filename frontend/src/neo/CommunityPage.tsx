import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { HoloPanel, NeoEmptyState } from "./NeoComponents";
import NeoIcon from "./NeoIcon";
import "./community.css";

type Board = "kr" | "global" | "property";
type AttachmentImage = { url: string; alt: string };
type YouTubeBlock = { type: "youtube"; video_id: string; title: string; portrait?: boolean };
type BodyBlock = { type: "paragraph"; text: string } | ({ type: "image" } & AttachmentImage) | YouTubeBlock;
type RelatedPost = { id: string; title: string; source: string; url: string; published_at: string };
type Post = { id: string; title: string; published_at: string; url: string; source_id: string; source: string; language: string; topic: string; comments: number | null; excerpt: string; excerpt_kind: string; duplicate_count?: number; related_posts?: RelatedPost[] };
type Feed = { snapshot: string; items: Post[]; total: number; page: number; pages: number; collected_at: string | null; checked_at: string; refreshing?: boolean; grouped_duplicates?: number; sources: { id: string; name: string; status: string; count: number }[] };
const BOARDS: { id: Board; title: string; code: string; description: string; link: string; linkLabel: string }[] = [
  { id: "kr", title: "국내 증시", code: "KOREA", description: "오늘의 시장을 바라보는 투자자들의 생각", link: "/desk", linkLabel: "국내 시세" },
  { id: "global", title: "해외 증시", code: "GLOBAL", description: "국경 너머 시장과 투자자들의 다양한 관점", link: "/global", linkLabel: "해외 시세" },
  { id: "property", title: "부동산", code: "PROPERTY", description: "집값과 전세, 정책과 실거주에 관한 이야기", link: "/realestate-map", linkLabel: "실거래 지도" },
];
const TOPICS = ["", "시황", "시세·거래", "정책·금리", "의견", "질문"];
const stamp = (date: string) => new Date(date).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
const relative = (date: string) => { const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000)); return minutes < 1 ? "방금" : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : `${Math.floor(minutes / 1440)}일 전`; };

function LinkedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, i) => {
    if (!/^https?:\/\//i.test(part)) return part;
    const url = part.replace(/[.,;!\])}]+$/, "");
    return <span key={i}><a className="cf-body-link" href={url} target="_blank" rel="noopener noreferrer">{url}<span className="cf-link-label"> ↗</span></a>{part.slice(url.length)}</span>;
  })}</>;
}

function Attachment({ image, index, original }: { image: AttachmentImage; index: number; original: string }) {
  const [failed, setFailed] = useState(false);
  return <figure className="cf-attachment">{failed ? <div className="cf-image-failed"><span>이미지를 불러올 수 없습니다.</span><a href={original} target="_blank" rel="noopener noreferrer">원문에서 첨부 이미지 보기 ↗</a></div> : <a href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`첨부 이미지 ${index + 1} 크게 보기 (새 탭)`}><img src={image.url} alt={image.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></a>}<figcaption><span>첨부 {index + 1}</span>{!failed && <a href={image.url} target="_blank" rel="noopener noreferrer">크게 보기 ↗</a>}</figcaption></figure>;
}

function FullPost({ blocks, original }: { blocks: BodyBlock[]; original: string }) {
  let imageIndex = 0;
  return <>{blocks.map((block, i) => block.type === "youtube" ? <YouTubeVideo key={block.video_id} video={block} /> : block.type === "image" ? <Attachment key={block.url} image={block} index={imageIndex++} original={original} /> : <p className="cf-body-paragraph" key={i}><LinkedText text={block.text} /></p>)}</>;
}

function YouTubeVideo({ video }: { video: YouTubeBlock }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video.video_id)) return null;
  return <figure className={`cf-video${video.portrait ? " cf-video-portrait" : ""}`}><div className="cf-video-player"><iframe src={`https://www.youtube-nocookie.com/embed/${video.video_id}?playsinline=1&rel=0`} title={video.title || "유튜브 영상"} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div><figcaption><span>YouTube</span><a href={`https://www.youtube.com/watch?v=${video.video_id}`} target="_blank" rel="noopener noreferrer">YouTube에서 보기 ↗</a></figcaption></figure>;
}

type SourceComment = { id: string; parent_id: string | null; published_at: string | null; blocks: BodyBlock[] };
function CommentSection({ board, snapshot, post }: { board: Board; snapshot: string; post: Post }) {
  const [items, setItems] = useState<SourceComment[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setFailed(false);
    fetch(`/api/community/${board}/comments?${new URLSearchParams({ snapshot, post_id: post.id, page: String(page) })}`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.status !== "ok") throw new Error();
        setItems(current => page === 1 ? data.items : [...new Map([...current, ...data.items].map((c: SourceComment) => [c.id, c])).values()] as SourceComment[]);
        setTotal(data.total); setMore(data.has_more);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [board, snapshot, post.id, page, revision]);
  return <section className="cf-comments" aria-label="원문 댓글" aria-busy={busy}>
    <header><h3>댓글 <span>{total ?? items.length}</span></h3><button type="button" disabled={busy} onClick={() => { setPage(1); setRevision(n => n + 1); }} aria-label="댓글 새로고침">↻</button></header>
    {busy && <p className="cf-comment-status" role="status">댓글을 불러오는 중…</p>}
    {!busy && !failed && !items.length && <p className="cf-comment-status">아직 공개 댓글이 없습니다.</p>}
    {items.map((comment, i) => <article key={comment.id} className={`cf-comment${comment.parent_id ? " is-reply" : ""}`}>
      <div className="cf-comment-meta"><span className="cf-comment-number">{i + 1}</span><strong>{comment.parent_id ? "답글" : "댓글"} {i + 1}</strong>{comment.published_at && <time dateTime={comment.published_at}>{stamp(comment.published_at)}</time>}</div>
      <div className="cf-comment-body"><FullPost blocks={comment.blocks} original={post.url} /></div>
    </article>)}
    {failed && <div className="cf-comment-status" role="status"><span>댓글을 불러오지 못했습니다.</span><button type="button" disabled={busy} onClick={() => setRevision(n => n + 1)}>다시 시도</button><a href={`${post.url}#cmt-list`} target="_blank" rel="noopener noreferrer">원문 댓글 ↗</a></div>}
    {more && !failed && <button className="cf-comments-more" type="button" disabled={busy} onClick={() => setPage(p => p + 1)}>{busy ? "불러오는 중…" : "댓글 더 보기"}</button>}
  </section>;
}

export default function CommunityPage({ board }: { board: Board }) {
  const info = BOARDS.find(b => b.id === board)!;
  const initial = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(initial.get("q") || "");
  const [search, setSearch] = useState(query);
  const [source, setSource] = useState(initial.get("source") || "");
  const [topic, setTopic] = useState(initial.get("topic") || "");
  const [snapshot, setSnapshot] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [pending, setPending] = useState<Feed | null>(null);
  const [selected, setSelected] = useState<Post | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [auto, setAuto] = useState(true);
  const [large, setLarge] = useState(false);
  const [blocks, setBlocks] = useState<BodyBlock[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const reader = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const jumpToReader = useRef(0);
  const selectedIndex = feed?.items.findIndex(p => p.id === selected?.id) ?? -1;

  useEffect(() => {
    setBlocks([]); setPreviewId("");
    if (!selected || !feed) return;
    const controller = new AbortController();
    setPreviewBusy(true);
    fetch(`/api/community/${board}/post?${new URLSearchParams({ snapshot: feed.snapshot, post_id: selected.id })}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : { blocks: [] }).then(data => { if (!controller.signal.aborted) { setBlocks(Array.isArray(data.blocks) ? data.blocks : []); setPreviewId(selected.id); } })
      .catch(() => { if (!controller.signal.aborted) setPreviewId(selected.id); }).finally(() => { if (!controller.signal.aborted) setPreviewBusy(false); });
    return () => controller.abort();
  }, [board, selected, feed]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    const params = new URLSearchParams({ page: String(page), q: query, source, topic, background: "true" });
    if (snapshot) params.set("snapshot", snapshot);
    else params.set("refresh", "true");
    fetch(`/api/community/${board}?${params}`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error(r.status === 409 ? "읽던 목록이 만료되었습니다. 최신 목록을 불러와 주세요." : "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return r.json() as Promise<Feed>;
    }).then(data => {
      setFeed(data);
      const url = new URL(window.location.href);
      for (const [k, v] of Object.entries({ page: String(page), q: query, source, topic, snapshot: data.snapshot })) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); }
      window.history.replaceState(window.history.state, "", url);
      if (jumpToReader.current && data.items.length) { setSelected(data.items[jumpToReader.current < 0 ? data.items.length - 1 : 0]); jumpToReader.current = 0; }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [board, page, query, source, topic, snapshot, revision]);

  useEffect(() => {
    if (!feed?.refreshing) return;
    const controller = new AbortController();
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const r = await fetch(`/api/community/${board}?${new URLSearchParams({ q: query, source, topic, background: "true" })}`, { signal: controller.signal });
        if (!r.ok) return;
        const data: Feed = await r.json();
        if (data.refreshing && !selected && page === 1) { setFeed(current => !current || data.items.length > current.items.length ? data : current); }
        if (!data.refreshing) {
          if (!selected && page === 1) {
            setFeed(data); setSnapshot(data.snapshot);
          } else {
            setPending(data); setFeed(current => current ? { ...current, refreshing: false } : current);
          }
        }
      } catch { /* The verified list remains readable during refresh. */ }
      finally { checking = false; }
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [board, feed?.refreshing, selected, page, query, source, topic]);

  useEffect(() => {
    if (!auto || !feed) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/community/${board}?${new URLSearchParams({ q: query, source, topic, background: "true" })}`, { signal: controller.signal });
        if (!r.ok) return;
        const data: Feed = await r.json();
        if (data.refreshing) setFeed(current => current ? { ...current, refreshing: true } : current);
        else if (data.snapshot !== feed.snapshot) setPending(data);
      } catch { /* Reading position stays intact during a polling failure. */ }
    }, 60000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [auto, board, feed, query, source, topic]);

  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    const portrait = matchMedia("(max-width: 699px) and (orientation: portrait)");
    const rotate = () => { document.body.style.overflow = portrait.matches ? "hidden" : previous; };
    rotate(); portrait.addEventListener("change", rotate);
    reader.current?.focus({ preventScroll: true });
    reader.current?.scrollTo(0, 0);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelected(null); returnTo.current?.focus(); }
      if (e.key !== "Tab" || !portrait.matches) return;
      const els = [...(reader.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]") || [])];
      if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els[els.length - 1]?.focus(); }
      else if (!e.shiftKey && document.activeElement === els[els.length - 1]) { e.preventDefault(); els[0]?.focus(); }
    };
    window.addEventListener("keydown", keys);
    return () => { document.body.style.overflow = previous; portrait.removeEventListener("change", rotate); window.removeEventListener("keydown", keys); };
  }, [selected]);

  const reset = () => { setPage(1); setSelected(null); setPending(null); };
  const fresh = () => { reset(); setSnapshot(""); setRevision(n => n + 1); };
  const changePage = (n: number, continueReading = false) => { if (!feed) return; setSnapshot(feed.snapshot); setPage(n); if (!continueReading) setSelected(null); jumpToReader.current = continueReading ? n < page ? -1 : 1 : 0; };
  const open = (post: Post, element?: HTMLElement) => { if (element) returnTo.current = element; setSelected(post); };
  const navigatePost = (direction: number) => {
    const next = feed?.items[selectedIndex + direction];
    if (next) open(next);
    else if (direction > 0 && feed && page < feed.pages) changePage(page + 1, true);
    else if (direction < 0 && page > 1) changePage(page - 1, true);
  };
  const pagination = <nav className="cf-pagination" aria-label="게시글 페이지"><button disabled={busy || page <= 1} onClick={() => changePage(page - 1)}>← 이전</button><div>{feed && Array.from({ length: Math.min(5, feed.pages) }, (_, i) => Math.min(Math.max(1, page - 2), Math.max(1, feed.pages - 4)) + i).map(n => <button key={n} aria-current={n === page ? "page" : undefined} disabled={busy} onClick={() => changePage(n)}>{n}</button>)}</div><button disabled={busy || !feed || page >= feed.pages} onClick={() => changePage(page + 1)}>다음 →</button></nav>;

  return <main className={`cf-page${large ? " cf-large" : ""}`}>
    <header className="cf-hero"><div><span className="ng-kicker">COMMUNITY SIGNAL / {info.code}</span><h1>{info.title} <span>커뮤니티</span></h1><p>{info.description}</p></div><Link className="cf-market-link" to={info.link}><NeoIcon name="chart" />{info.linkLabel} ↗</Link></header>
    <nav className="cf-boards" aria-label="커뮤니티 게시판">{BOARDS.map(b => <Link key={b.id} to={`/community/${b.id}`} aria-current={board === b.id ? "page" : undefined}><div className="cf-board-art" aria-hidden="true"><img src={`/img/community/${b.id}-v2.png`} alt="" width="112" height="112" decoding="async" /></div><div className="cf-board-copy"><span>{b.code}</span><strong>{b.title}</strong><small>{b.id === "kr" ? "코스피 · 코스닥" : b.id === "global" ? "미국 · 글로벌 주식" : "매매 · 전세 · 정책"}</small></div><NeoIcon name="chevron" /></Link>)}</nav>
    <div className="cf-status"><span><i className={feed?.sources.some(s => s.status === "ok") ? "cf-dot" : "cf-dot cf-dot-wait"} />{feed?.refreshing ? "새 글 확인 중 · 목록은 계속 읽을 수 있습니다" : auto ? "60초마다 새 글 확인" : "자동 확인 일시정지"}</span><span>최근 수집 {feed?.collected_at ? stamp(feed.collected_at) : "대기 중"} · KST</span><button onClick={() => setAuto(v => !v)} aria-pressed={auto}>{auto ? "일시정지" : "자동 확인"}</button><button onClick={fresh} disabled={busy}>↻ {busy ? "불러오는 중" : "새로고침"}</button></div>
    <HoloPanel className="cf-toolbar"><form onSubmit={e => { e.preventDefault(); reset(); setQuery(search.trim()); }}><NeoIcon name="search" /><input aria-label="게시글 제목 검색" placeholder="관심 키워드로 제목 검색" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} /><button type="submit">검색</button></form><label className="cf-source"><span>출처</span><select aria-label="게시글 출처" value={source} onChange={e => { reset(); setSource(e.target.value); }}><option value="">모든 출처</option>{feed?.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="cf-font" aria-pressed={large} onClick={() => setLarge(v => !v)} title="목록과 읽기 글자 크기">가<span>가</span></button><div className="cf-topics" aria-label="제목 기준 주제 분류">{TOPICS.map(t => <button key={t} aria-pressed={topic === t} onClick={() => { reset(); setTopic(t); }}>{t || "전체"}</button>)}</div></HoloPanel>
    {pending && <button className="cf-update" onClick={fresh}>{pending.items[0]?.id !== feed?.items[0]?.id ? "새 글이 도착했습니다 · 최신 목록 보기 ↑" : "최근 확인 완료 · 최신 목록 보기 ↑"}</button>}
    <div className="cf-layout"><HoloPanel className="cf-list"><div className="cf-list-head"><h2>최신 이야기 <span>{feed?.total.toLocaleString() ?? "—"}</span></h2><span>최신순 · 페이지당 50개</span></div>
      {error && <NeoEmptyState title={error} error><button className="cf-retry" onClick={fresh}>최신 목록 다시 불러오기</button></NeoEmptyState>}
      {!error && busy && (!feed || feed.page !== page) && <div className="cf-loading" role="status" aria-live="polite">커뮤니티의 최신 이야기를 모으고 있습니다…<div />{[1, 2, 3, 4, 5].map(n => <div className="cf-skeleton" key={n} />)}</div>}
      {!error && !busy && feed && !feed.items.length && <NeoEmptyState title={feed.refreshing ? "새 글의 본문과 첨부를 확인하고 있습니다" : feed.total ? "이 페이지에 글이 없습니다" : feed.sources.every(s => s.status !== "ok") ? "현재 원천 수집이 지연되고 있습니다" : "조건에 맞는 글이 없습니다"}>{feed.refreshing ? "확인이 끝난 글부터 표시합니다." : "검색어와 출처를 바꾸거나 새로고침해 주세요."}</NeoEmptyState>}
      {(!busy || feed?.page === page) && <div className="cf-posts">{feed?.items.map((p, i) => <button className="cf-post" key={p.id} aria-pressed={selected?.id === p.id} onClick={e => open(p, e.currentTarget)}><span className="cf-number">{String((page - 1) * 50 + i + 1).padStart(2, "0")}</span><span className="cf-post-main"><span className="cf-post-meta"><span>{p.source}</span><span className="cf-tag">{p.topic}</span>{p.language === "en" && <span>EN</span>}{!!p.duplicate_count && <span className="cf-duplicate">같은 제목 {p.duplicate_count + 1}건 묶음</span>}</span><strong>{p.title}</strong><span className="cf-post-bottom"><time dateTime={p.published_at} title={stamp(p.published_at)}>{relative(p.published_at)}<span> · {stamp(p.published_at)}</span></time>{p.comments != null && <span>댓글 {p.comments}</span>}</span></span><span className="cf-post-arrow" aria-hidden="true">↗</span></button>)}</div>}{pagination}</HoloPanel>
      <aside className={`cf-reader${selected ? " is-open" : ""}`} ref={reader} tabIndex={-1} aria-label="선택한 게시글 읽기"><div className="cf-reader-top"><span>READING ROOM</span>{selected && <div className="cf-reader-shortcuts"><button disabled={busy || (selectedIndex <= 0 && page <= 1)} onClick={() => navigatePost(-1)} aria-label="이전 글 바로 읽기">←</button><button disabled={busy || !feed || (selectedIndex >= feed.items.length - 1 && page >= feed.pages)} onClick={() => navigatePost(1)} aria-label="다음 글 바로 읽기">→</button></div>}<button onClick={() => { setSelected(null); returnTo.current?.focus(); }} aria-label="읽기 닫고 목록으로 돌아가기">목록으로 ✕</button></div>{selected ? <><div className="cf-reader-meta"><span className="cf-tag">{selected.topic}</span><span>{selected.source}</span></div><h2>{selected.title}</h2><time dateTime={selected.published_at}>{stamp(selected.published_at)} KST{selected.comments != null ? ` · 댓글 ${selected.comments}` : ""}</time><div className="cf-reader-content" aria-busy={previewBusy}>{previewBusy || previewId !== selected.id ? <p role="status">본문을 불러오는 중…</p> : blocks.length ? <FullPost blocks={blocks} original={selected.url} /> : <p className="cf-content-unavailable">원문 사이트에서 본문을 가져오지 못했습니다. 아래 원문 링크에서 확인해 주세요.</p>}<div className="cf-original-row"><a className="cf-original" href={selected.url} target="_blank" rel="noopener noreferrer">원문 보기 ↗</a></div></div>{previewId === selected.id && !previewBusy && <CommentSection key={selected.id} board={board} snapshot={feed!.snapshot} post={selected} />}{!!selected.related_posts?.length && <details className="cf-related"><summary>같은 제목으로 묶인 원문 {selected.duplicate_count}건</summary><p>동일한 제목의 반복 등록 글을 묶었습니다. 본문 내용은 다를 수 있습니다.</p>{selected.related_posts.map(p => <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"><span>{p.source} · {stamp(p.published_at)}</span><strong>{p.title} ↗</strong></a>)}</details>}<div className="cf-reader-nav"><button disabled={busy || (selectedIndex <= 0 && page <= 1)} onClick={() => navigatePost(-1)}>← 이전 글</button><span>{selectedIndex + 1} / {feed?.items.length}</span><button disabled={busy || !feed || (selectedIndex >= feed.items.length - 1 && page >= feed.pages)} onClick={() => navigatePost(1)}>다음 글 →</button></div>{feed?.items[selectedIndex + 1] && <button className="cf-up-next" onClick={() => navigatePost(1)}><span>다음 이야기</span><strong>{feed.items[selectedIndex + 1].title}</strong>→</button>}</> : <div className="cf-reader-empty"><NeoIcon name="news" /><span>여러 관점, 하나의 흐름.</span><h2>궁금한 이야기를<br />선택해 보세요.</h2><div>01 선택 <i>→</i> 02 원문 읽기 <i>→</i> 03 다음 글</div></div>}</aside>
    </div><footer className="cf-footnote"><details><summary>수집 출처와 갱신 상태</summary><div>{feed?.sources.map(s => <p key={s.id}><span>{s.name}</span><b>{s.status === "ok" ? `${s.count}개 확인` : s.status === "empty" ? "공개 글 없음" : "수집 지연 · 기존 목록 유지"}</b></p>)}</div><p>공개 제목 색인 · 같은 원문과 동일 제목의 반복 글은 묶어 표시합니다. 주제는 제목의 키워드 기준입니다. 검색은 현재 수집 목록에 적용됩니다. 페이지 이동 중에는 같은 수집 시점의 순서를 유지합니다. 서버 재시작 시 목록을 새로 수집합니다.</p></details><p>커뮤니티 글은 작성자의 의견입니다. 실제 시세와 거래 정보는 상단 시장 링크에서 함께 확인하세요.</p></footer>
  </main>;
}
