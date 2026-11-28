import { Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { Link } from "../../router";
import { reportDiscussionPostClick } from "../../useActivityTracking";
import DiscussionPulseBar from "./DiscussionPulseBar";
import ReaderPane from "./ReaderPane";
import { fetchStockDiscussionBatch } from "./stockDiscussionFeed";
import {
  AssetKind,
  AssetTarget,
  CachedDetailEntry,
  DiscussionPost,
  FilterMode,
  FontScale,
  MarketKind,
  SortMode,
  UsSourceMode,
  ViewMode,
  dedupePosts,
  extractHotKeywords,
  isHotPost,
} from "./types";
import "../../discussionExplorer.css";

const BATCH_SIZE = 50;
const DESKTOP_SPLIT_MIN = 1024;
const INITIAL_STREAM_SLICE = 12;
const INITIAL_COMPACT_SLICE = 20;

function highlightText(text: string, term: string): ReactNode {
  const q = term.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length <= 1) return text;
  return parts.map((part, idx) => (idx % 2 === 1 ? <mark key={idx} className="dr-mark">{part}</mark> : part));
}

export default function StockDiscussionRoom({
  code,
  name,
  market,
  kind,
  explorerHref,
  initialPost,
}: {
  code: string;
  name: string;
  market: MarketKind;
  kind: AssetKind;
  explorerHref: string;
  initialPost?: DiscussionPost | null;
}) {
  const asset = useMemo<AssetTarget>(() => ({ code, name: name || code, market, kind }), [code, kind, market, name]);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_SPLIT_MIN);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    window.innerWidth >= DESKTOP_SPLIT_MIN ? "split" : "stream",
  );
  const [fontScale, setFontScale] = useState<FontScale>("md");

  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [nextOffset, setNextOffset] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [usSource, setUsSource] = useState<UsSourceMode>("toss");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [newArrivals, setNewArrivals] = useState(0);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [inlineQuery, setInlineQuery] = useState("");
  const [activeKeyword, setActiveKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [visibleSlice, setVisibleSlice] = useState(INITIAL_STREAM_SLICE);

  const [detailMap, setDetailMap] = useState<Record<string, CachedDetailEntry>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const hoverTimerRef = useRef<number | null>(null);
  const splitListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_SPLIT_MIN}px)`);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const effectiveView: ViewMode = !isDesktop && viewMode === "split" ? "stream" : viewMode;

  const fetchBatch = useCallback(
    (
      offset: string | null,
      fresh: boolean,
      preferredUs: UsSourceMode,
      signal?: AbortSignal,
    ) => fetchStockDiscussionBatch(code, market, kind, { limit: BATCH_SIZE, offset, fresh, source: preferredUs, signal }),
    [code, kind, market],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const requested = market === "KR" || usSource === "toss" ? initialPost : null;
    setLoading(!requested);
    setError("");
    setPosts(requested ? [requested] : []);
    setSelectedId(requested?.id ?? null);
    setNextOffset(null);
    setNewArrivals(0);
    setFilterMode("all");
    setSortMode("latest");
    setInlineQuery("");
    setActiveKeyword("");
    setExpandedIds(new Set());
    setReadIds(new Set(requested ? [requested.id] : []));
    setSheetOpen(Boolean(requested && window.innerWidth < DESKTOP_SPLIT_MIN));
    setVisibleSlice(INITIAL_STREAM_SLICE);

    fetchBatch(null, true, usSource, controller.signal)
      .then((res) => {
        if (cancelled) return;
        setPosts(requested ? dedupePosts([...res.items, requested]) : res.items);
        setNextOffset(res.nextOffset);
        setSourceLabel(res.sourceLabel);
        setSourceUrl(res.sourceUrl);
        if (!requested) setSelectedId(res.items[0]?.id ?? null);
      })
      .catch((err: Error) => {
        if (!cancelled && !requested && err.name !== "AbortError") {
          setError(err.message || "종목토론을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchBatch, initialPost, market, usSource]);

  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const ensureDetail = useCallback(
    (post: DiscussionPost) => {
      if (market !== "KR") return;
      const cacheKey = `${code}:${post.id}`;
      if (inFlightRef.current.has(cacheKey)) return;
      if (detailMap[cacheKey]?.status === "ready") return;

      inFlightRef.current.add(cacheKey);
      setDetailMap((prev) => ({ ...prev, [cacheKey]: { status: "loading" } }));
      Promise.all([api.boardDetail(code, post.id), api.boardComments(code, post.id)])
        .then(([detail, commentsRes]) => {
          setDetailMap((prev) => ({
            ...prev,
            [cacheKey]: { status: "ready", detail, comments: commentsRes.items },
          }));
        })
        .catch((err: Error) => {
          setDetailMap((prev) => ({
            ...prev,
            [cacheKey]: { status: "error", error: err.message || "본문을 불러오지 못했습니다." },
          }));
        })
        .finally(() => {
          inFlightRef.current.delete(cacheKey);
        });
    },
    [code, detailMap, market],
  );

  const handleRefresh = async () => {
    if (refreshing || loading) return;
    setRefreshing(true);
    try {
      const res = await fetchBatch(null, true, usSource);
      setPosts((current) => {
        const seen = new Set(current.map((p) => p.id));
        const arrivals = res.items.filter((p) => !seen.has(p.id));
        if (arrivals.length > 0) setNewArrivals((n) => n + arrivals.length);
        return dedupePosts([...res.items, ...current]);
      });
      if (!nextOffset && res.nextOffset) setNextOffset(res.nextOffset);
    } catch {
      // Keep current list readable
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadMore = async () => {
    if (effectiveView !== "split" && visibleSlice < visiblePosts.length) {
      setVisibleSlice((prev) => prev + 20);
      return;
    }
    if (loadingMore || !nextOffset) return;
    setLoadingMore(true);
    try {
      const res = await fetchBatch(nextOffset, false, usSource);
      setPosts((current) => dedupePosts([...current, ...res.items]));
      setNextOffset(res.nextOffset);
      setVisibleSlice((prev) => prev + 25);
    } catch {
      // Ignore transient error
    } finally {
      setLoadingMore(false);
    }
  };

  const pulseStats = useMemo(() => {
    let holderCount = 0;
    let imageCount = 0;
    let totalLikes = 0;
    let totalDislikes = 0;
    let unreadCount = 0;
    for (const p of posts) {
      if (p.holderVerified) holderCount += 1;
      if (p.imageCount > 0) imageCount += 1;
      totalLikes += p.likes;
      totalDislikes += p.dislikes;
      if (!readIds.has(p.id)) unreadCount += 1;
    }
    const votes = totalLikes + totalDislikes;
    const likeRatio = votes >= 5 ? Math.round((totalLikes / votes) * 100) : null;
    const keywords = extractHotKeywords(posts, asset.name, asset.code, 8);
    return { holderCount, imageCount, likeRatio, unreadCount, keywords };
  }, [asset.code, asset.name, posts, readIds]);

  const activeSearchTerm = (activeKeyword || inlineQuery).trim();

  const visiblePosts = useMemo(() => {
    const q = activeSearchTerm.toLowerCase();
    const filtered = posts.filter((post) => {
      if (filterMode === "hot" && !isHotPost(post)) return false;
      if (filterMode === "holder" && !post.holderVerified) return false;
      if (filterMode === "images" && post.imageCount <= 0) return false;
      if (filterMode === "unread" && readIds.has(post.id)) return false;
      if (q) {
        const hay = `${post.title} ${post.preview} ${post.author}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sortMode === "views") return [...filtered].sort((a, b) => b.views - a.views || b.likes - a.likes);
    if (sortMode === "likes") return [...filtered].sort((a, b) => b.likes - a.likes || b.views - a.views);
    return filtered;
  }, [activeSearchTerm, filterMode, posts, readIds, sortMode]);

  const selectedPost = useMemo(
    () => visiblePosts.find((p) => p.id === selectedId) ?? (effectiveView === "split" ? visiblePosts[0] ?? null : null),
    [effectiveView, selectedId, visiblePosts],
  );

  useEffect(() => {
    if (!selectedPost) return;
    if (effectiveView === "split" || sheetOpen) {
      ensureDetail(selectedPost);
    }
  }, [effectiveView, ensureDetail, selectedPost, sheetOpen]);

  const activeIndex = selectedPost ? visiblePosts.findIndex((p) => p.id === selectedPost.id) : -1;

  const openPost = useCallback(
    (post: DiscussionPost, openSheet = false) => {
      setSelectedId(post.id);
      setReadIds((prev) => {
        if (prev.has(post.id)) return prev;
        const next = new Set(prev);
        next.add(post.id);
        return next;
      });
      ensureDetail(post);
      if (openSheet) setSheetOpen(true);
      reportDiscussionPostClick({
        code: asset.code,
        name: asset.name,
        title: post.title,
        postId: post.id,
        market: asset.market,
        assetKind: asset.kind,
      });
    },
    [asset.code, asset.kind, asset.market, asset.name, ensureDetail],
  );

  const toggleInlineExpand = useCallback(
    (post: DiscussionPost) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(post.id)) {
          next.delete(post.id);
        } else {
          next.add(post.id);
          ensureDetail(post);
          setReadIds((r) => {
            if (r.has(post.id)) return r;
            const nr = new Set(r);
            nr.add(post.id);
            return nr;
          });
          reportDiscussionPostClick({
            code: asset.code,
            name: asset.name,
            title: post.title,
            postId: post.id,
            market: asset.market,
            assetKind: asset.kind,
          });
        }
        return next;
      });
    },
    [asset.code, asset.kind, asset.market, asset.name, ensureDetail],
  );

  const stepPost = (delta: number) => {
    if (visiblePosts.length === 0) return;
    const base = activeIndex >= 0 ? activeIndex : 0;
    const nextIdx = Math.max(0, Math.min(visiblePosts.length - 1, base + delta));
    const target = visiblePosts[nextIdx];
    if (!target) return;
    openPost(target, sheetOpen);
    const row = splitListRef.current?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(target.id)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const handleViewChange = (next: ViewMode) => {
    setViewMode(next);
    setExpandedIds(new Set());
    if (next === "compact") setVisibleSlice(Math.max(visibleSlice, INITIAL_COMPACT_SLICE));
  };

  const schedulePrefetch = (post: DiscussionPost) => {
    if (market !== "KR") return;
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => ensureDetail(post), 160);
  };

  const cancelPrefetch = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const shownPosts = effectiveView === "split" ? visiblePosts : visiblePosts.slice(0, visibleSlice);
  const canLoadMore = effectiveView === "split" ? Boolean(nextOffset) : (visibleSlice < visiblePosts.length || Boolean(nextOffset));
  const selectedEntry = selectedPost ? detailMap[`${code}:${selectedPost.id}`] : undefined;

  return (
    <div className="dr-embedded dr-discussion-room">
      {/* Embedded Header Strip: Source + Refresh + Full-page Discussion Explorer link */}
      <div className="dr-room-actionbar">
        <div className="dr-room-source">
          {sourceLabel && <span className="dr-press-pill">{sourceLabel}</span>}
          <span className="dr-room-hint">최신 {posts.length}건 즉시 스캔 · 본문·댓글 바로 읽기</span>
        </div>
        <div className="dr-room-btns">
          <button
            type="button"
            className="dr-mini-refresh"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            <span className={refreshing ? "is-spinning" : ""} aria-hidden="true">↻</span>
            <span>새 글</span>
          </button>
          <Link to={explorerHref} className="dr-btn dr-btn--accent dr-btn--compact">
            종목토론 전체 화면 ↗
          </Link>
        </div>
      </div>

      {/* Pulse + Hot Keywords + Filters + View Mode */}
      <DiscussionPulseBar
        market={market}
        totalLoaded={posts.length}
        visibleCount={visiblePosts.length}
        unreadCount={pulseStats.unreadCount}
        holderCount={pulseStats.holderCount}
        imageCount={pulseStats.imageCount}
        likeRatio={pulseStats.likeRatio}
        newArrivals={newArrivals}
        keywords={pulseStats.keywords}
        activeKeyword={activeKeyword}
        onToggleKeyword={(w) => setActiveKeyword((prev) => (prev === w ? "" : w))}
        viewMode={effectiveView}
        onChangeViewMode={handleViewChange}
        filterMode={filterMode}
        onChangeFilterMode={setFilterMode}
        sortMode={sortMode}
        onChangeSortMode={setSortMode}
        query={inlineQuery}
        onChangeQuery={(val) => {
          setInlineQuery(val);
          if (val.trim()) setActiveKeyword("");
        }}
        usSource={usSource}
        onChangeUsSource={setUsSource}
        isDesktop={isDesktop}
        onClearNewArrivals={() => setNewArrivals(0)}
      />

      {/* Reading Workspace */}
      {loading ? (
        <div className="dr-skeleton-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="dr-skeleton-card">
              <span className="w-30" />
              <span className="w-85" />
              <span className="w-65" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="dr-state is-error" role="alert">
          <strong>종목토론을 불러오지 못했습니다</strong>
          <p>{error}</p>
          <button type="button" className="dr-btn dr-btn--accent" onClick={handleRefresh}>
            다시 시도
          </button>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="dr-state">
          <strong>조건에 맞는 게시글이 없습니다</strong>
          <p>
            {activeSearchTerm || filterMode !== "all"
              ? "필터나 검색어를 초기화하면 전체 토론을 다시 볼 수 있습니다."
              : "현재 표시할 최근 토론 게시글이 없습니다."}
          </p>
          {(activeSearchTerm || filterMode !== "all") && (
            <button
              type="button"
              className="dr-btn dr-btn--ghost"
              onClick={() => {
                setFilterMode("all");
                setInlineQuery("");
                setActiveKeyword("");
              }}
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : effectiveView === "split" ? (
        <div className="dr-split-layout dr-split-layout--embedded">
          <div className="dr-split-list dr-split-list--bounded" ref={splitListRef} role="listbox" aria-label="종목토론 목록">
            {visiblePosts.map((post, idx) => {
              const isSelected = selectedPost?.id === post.id;
              const isRead = readIds.has(post.id);
              const hot = isHotPost(post);
              return (
                <button
                  key={post.id}
                  type="button"
                  data-post-id={post.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`dr-split-row ${isSelected ? "is-selected" : ""} ${isRead ? "is-read" : ""} ${hot ? "is-hot" : ""}`}
                  onClick={() => openPost(post, false)}
                  onMouseEnter={() => schedulePrefetch(post)}
                  onMouseLeave={cancelPrefetch}
                >
                  <div className="dr-row-top">
                    <span className="dr-row-num">{String(idx + 1).padStart(2, "0")}</span>
                    {post.holderVerified && <span className="dr-tag is-holder">주주</span>}
                    {hot && <span className="dr-tag is-hot">HOT</span>}
                    {post.imageCount > 0 && <span className="dr-tag is-img">사진{post.imageCount > 1 ? ` ${post.imageCount}` : ""}</span>}
                    <span className="dr-row-time" title={post.dateLabel}>{post.relativeLabel}</span>
                  </div>
                  <strong className="dr-row-title">{highlightText(post.title, activeSearchTerm)}</strong>
                  {post.preview && post.preview !== post.title && (
                    <p className="dr-row-preview">{highlightText(post.preview, activeSearchTerm)}</p>
                  )}
                  <div className="dr-row-foot">
                    <span className="dr-row-author">{post.author}</span>
                    <span className="dr-row-stats">
                      <em>조회 {post.views.toLocaleString()}</em>
                      {post.likes > 0 && <b className="is-like">▲ {post.likes}</b>}
                      {post.dislikes > 0 && <b className="is-dislike">▼ {post.dislikes}</b>}
                    </span>
                  </div>
                </button>
              );
            })}

            {nextOffset && (
              <div className="dr-load-more">
                <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? "불러오는 중…" : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
                </button>
              </div>
            )}
          </div>

          <div className="dr-split-reader dr-split-reader--bounded">
            <ReaderPane
              post={selectedPost}
              asset={asset}
              entry={selectedEntry}
              sourceUrl={sourceUrl}
              currentIndex={activeIndex}
              totalCount={visiblePosts.length}
              fontScale={fontScale}
              onChangeFontScale={setFontScale}
              onPrev={() => stepPost(-1)}
              onNext={() => stepPost(1)}
              mode="split"
            />
          </div>
        </div>
      ) : effectiveView === "stream" ? (
        <div className="dr-stream-wrap">
          <div className="dr-stream-grid">
            {shownPosts.map((post, idx) => {
              const isExpanded = expandedIds.has(post.id);
              const isRead = readIds.has(post.id);
              const hot = isHotPost(post);
              const entry = detailMap[`${code}:${post.id}`];
              return (
                <article
                  key={post.id}
                  className={`dr-stream-card ${isExpanded ? "is-expanded" : ""} ${isRead ? "is-read" : ""} ${hot ? "is-hot" : ""}`}
                >
                  <header className="dr-stream-card-head">
                    <div className="dr-stream-card-badges">
                      <span className="dr-row-num">{String(idx + 1).padStart(2, "0")}</span>
                      {post.holderVerified && <span className="dr-tag is-holder">주주인증</span>}
                      {hot && <span className="dr-tag is-hot">HOT</span>}
                      {post.imageCount > 0 && <span className="dr-tag is-img">사진 {post.imageCount}</span>}
                    </div>
                    <time className="dr-row-time" title={`${post.dateLabel} KST`}>{post.relativeLabel}</time>
                  </header>

                  <h3 className="dr-stream-title">
                    <button type="button" onClick={() => (market === "KR" ? toggleInlineExpand(post) : openPost(post, !isDesktop))}>
                      {highlightText(post.title, activeSearchTerm)}
                    </button>
                  </h3>

                  {!isExpanded && post.preview && (
                    <div className="dr-stream-body-preview">
                      <p>{highlightText(post.preview, activeSearchTerm)}</p>
                      {post.thumbnail && (
                        <img
                          src={post.thumbnail}
                          alt="첨부 썸네일"
                          loading="lazy"
                          decoding="async"
                          className="dr-stream-thumb"
                          onClick={() => toggleInlineExpand(post)}
                        />
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="dr-stream-inline-reader">
                      <ReaderPane
                        post={post}
                        asset={asset}
                        entry={entry}
                        sourceUrl={sourceUrl}
                        currentIndex={idx}
                        totalCount={visiblePosts.length}
                        fontScale={fontScale}
                        onChangeFontScale={setFontScale}
                        onPrev={() => {}}
                        onNext={() => {}}
                        mode="inline"
                      />
                    </div>
                  )}

                  <footer className="dr-stream-foot">
                    <div className="dr-stream-meta">
                      <span className="dr-row-author">{post.author}</span>
                      <span>조회 {post.views.toLocaleString()}</span>
                      <span className="is-like">공감 {post.likes}</span>
                      {post.dislikes > 0 && <span className="is-dislike">비공감 {post.dislikes}</span>}
                    </div>
                    <div className="dr-stream-actions">
                      {market === "KR" ? (
                        <button
                          type="button"
                          className="dr-expand-btn"
                          onClick={() => toggleInlineExpand(post)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? "접기 ▴" : "본문·댓글 펼치기 ▾"}
                        </button>
                      ) : (
                        <button type="button" className="dr-expand-btn" onClick={() => openPost(post, true)}>
                          크게 읽기 ↗
                        </button>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>

          {canLoadMore && (
            <div className="dr-load-more">
              <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore
                  ? "불러오는 중…"
                  : visibleSlice < visiblePosts.length
                    ? `토론 더 보기 (${shownPosts.length} / ${visiblePosts.length}건)`
                    : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="dr-compact-wrap">
          <div className="dr-compact-head" aria-hidden="true">
            <span>#</span>
            <span>제목 · 미리보기</span>
            <span>작성자</span>
            <span>시간</span>
            <span>조회</span>
            <span>공감</span>
          </div>

          <div className="dr-compact-list">
            {shownPosts.map((post, idx) => {
              const isExpanded = expandedIds.has(post.id);
              const isRead = readIds.has(post.id);
              const hot = isHotPost(post);
              const entry = detailMap[`${code}:${post.id}`];
              return (
                <Fragment key={post.id}>
                  <div className={`dr-compact-item ${isExpanded ? "is-expanded" : ""} ${isRead ? "is-read" : ""} ${hot ? "is-hot" : ""}`}>
                    <button
                      type="button"
                      className="dr-compact-row"
                      onClick={() => toggleInlineExpand(post)}
                      aria-expanded={isExpanded}
                    >
                      <span className="dr-compact-no">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="dr-compact-main">
                        <span className="dr-compact-title-line">
                          {post.holderVerified && <span className="dr-tag is-holder">주주</span>}
                          {hot && <span className="dr-tag is-hot">HOT</span>}
                          {post.imageCount > 0 && <span className="dr-tag is-img">IMG</span>}
                          <strong>{highlightText(post.title, activeSearchTerm)}</strong>
                        </span>
                        {post.preview && post.preview !== post.title && (
                          <span className="dr-compact-snippet">{highlightText(post.preview, activeSearchTerm)}</span>
                        )}
                      </span>
                      <span className="dr-compact-author">{post.author}</span>
                      <span className="dr-compact-time" title={post.dateLabel}>{post.relativeLabel}</span>
                      <span className="dr-compact-views">{post.views.toLocaleString()}</span>
                      <span className="dr-compact-likes">
                        <b className={post.likes > 0 ? "is-like" : ""}>{post.likes}</b>
                        {post.dislikes > 0 && <em className="is-dislike">/{post.dislikes}</em>}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="dr-compact-detail">
                        <ReaderPane
                          post={post}
                          asset={asset}
                          entry={entry}
                          sourceUrl={sourceUrl}
                          currentIndex={idx}
                          totalCount={visiblePosts.length}
                          fontScale={fontScale}
                          onChangeFontScale={setFontScale}
                          onPrev={() => {}}
                          onNext={() => {}}
                          mode="inline"
                        />
                      </div>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>

          {canLoadMore && (
            <div className="dr-load-more">
              <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore
                  ? "불러오는 중…"
                  : visibleSlice < visiblePosts.length
                    ? `토론 더 보기 (${shownPosts.length} / ${visiblePosts.length}건)`
                    : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile Slide-Up Discussion Reader Sheet (portalled to body to sit above floating docks) */}
      {sheetOpen && selectedPost && createPortal(
        <div className="dr-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div className="dr-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="토론 상세 읽기">
            <ReaderPane
              post={selectedPost}
              asset={asset}
              entry={selectedEntry}
              sourceUrl={sourceUrl}
              currentIndex={activeIndex}
              totalCount={visiblePosts.length}
              fontScale={fontScale}
              onChangeFontScale={setFontScale}
              onPrev={() => stepPost(-1)}
              onNext={() => stepPost(1)}
              onClose={() => setSheetOpen(false)}
              mode="sheet"
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
