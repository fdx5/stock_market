import { Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import AdZone, { InArticleAd } from "../neo/AdZone";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { navigate } from "../router";
import { reportDiscussionPostClick } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import DiscussionPulseBar from "./discussion/DiscussionPulseBar";
import ReaderPane from "./discussion/ReaderPane";
import StockBriefCard from "./discussion/StockBriefCard";
import {
  AssetKind,
  AssetQuoteSnapshot,
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
  discussionHref,
  extractHotKeywords,
  isHotPost,
  normalizeDomesticStream,
  normalizeGlobalDiscussion,
} from "./discussion/types";
import "../discussionExplorer.css";

const BATCH_SIZE = 50;
const DESKTOP_SPLIT_MIN = 1024;

function readAssetFromUrl(): { asset: AssetTarget; initialNid: string | null } {
  const params = new URLSearchParams(window.location.search);
  const rawCode = (params.get("code") || "005930").trim();
  const inferredUs = /^[A-Za-z][A-Za-z0-9.-]{0,15}$/.test(rawCode);
  const marketParam = params.get("market")?.toUpperCase();
  const market: MarketKind = marketParam === "US" ? "US" : marketParam === "KR" ? "KR" : inferredUs ? "US" : "KR";
  const kind: AssetKind = params.get("asset")?.toUpperCase() === "ETF" ? "ETF" : "STOCK";
  const name = params.get("name")?.trim() || (rawCode === "005930" ? "삼성전자" : rawCode);
  const initialNid = params.get("nid");
  return { asset: { code: rawCode, name, market, kind }, initialNid };
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const val = localStorage.getItem(key) as T | null;
    if (val && allowed.includes(val)) return val;
  } catch {
    // ignore storage restriction
  }
  return fallback;
}

function highlightText(text: string, term: string): ReactNode {
  const q = term.trim();
  if (!q || q.length < 1) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, idx) =>
    idx % 2 === 1 ? <mark key={idx} className="dr-mark">{part}</mark> : part,
  );
}

export default function DiscussionExplorerPage() {
  const [{ asset, initialNid }, setRouteState] = useState(readAssetFromUrl);
  const [resolvedName, setResolvedName] = useState(asset.name);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_SPLIT_MIN);

  // Reading preferences
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    readStored<ViewMode>("dr.viewMode", ["split", "stream", "compact"], window.innerWidth >= DESKTOP_SPLIT_MIN ? "split" : "stream"),
  );
  const [fontScale, setFontScale] = useState<FontScale>(() =>
    readStored<FontScale>("dr.fontScale", ["sm", "md", "lg"], "md"),
  );

  // Feed state
  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [nextOffset, setNextOffset] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [usSource, setUsSource] = useState<UsSourceMode>("toss");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [newArrivals, setNewArrivals] = useState(0);

  // Quote state
  const [quote, setQuote] = useState<AssetQuoteSnapshot | null>(null);

  // Filters, search, selection & read tracking
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [inlineQuery, setInlineQuery] = useState("");
  const [activeKeyword, setActiveKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialNid);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  // Detail & comments cache (keyed by `${asset.code}:${postId}`)
  const [detailMap, setDetailMap] = useState<Record<string, CachedDetailEntry>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const hoverTimerRef = useRef<number | null>(null);
  const splitListRef = useRef<HTMLDivElement>(null);

  const displayAsset = useMemo<AssetTarget>(
    () => ({ ...asset, name: resolvedName || asset.name }),
    [asset, resolvedName],
  );

  useDocumentTitle(`${displayAsset.name} 종목토론 · K-Stock Hub`);

  // Sync URL popstate (browser Back/Forward or SPA navigate)
  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname !== "/discussion-explorer") return;
      const next = readAssetFromUrl();
      setRouteState(next);
      setResolvedName(next.asset.name);
      setSelectedId(next.initialNid);
      setSheetOpen(Boolean(next.initialNid));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Track responsive desktop split capability
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_SPLIT_MIN}px)`);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Effective view mode: on <1024px, fall back from split to stream
  const effectiveView: ViewMode = !isDesktop && viewMode === "split" ? "stream" : viewMode;

  const handleViewChange = (next: ViewMode) => {
    setViewMode(next);
    setExpandedIds(new Set());
    try {
      localStorage.setItem("dr.viewMode", next);
    } catch {
      // ignore
    }
  };

  const handleFontScaleChange = (next: FontScale) => {
    setFontScale(next);
    try {
      localStorage.setItem("dr.fontScale", next);
    } catch {
      // ignore
    }
  };

  // Switch asset via SPA navigation
  const handleSelectAsset = useCallback((next: AssetTarget) => {
    setRouteState({ asset: next, initialNid: null });
    setResolvedName(next.name);
    setSelectedId(null);
    setSheetOpen(false);
    setFilterMode("all");
    setSortMode("latest");
    setInlineQuery("");
    setActiveKeyword("");
    setExpandedIds(new Set());
    setNewArrivals(0);
    navigate(discussionHref(next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Live quote polling (every 10s, visibility-aware)
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    const poll = () => {
      if (asset.kind === "ETF") {
        api
          .etfQuote(asset.code, asset.market)
          .then((res) => {
            if (cancelled) return;
            if (res.name && asset.name === asset.code) setResolvedName(res.name);
            setQuote({
              close: res.close,
              change: res.change,
              change_pct: res.change_pct,
              volume: res.volume,
              turnover: res.turnover,
              session: res.session,
              benchmark: res.benchmark,
              category: res.category,
              week52_high: res.week52_high,
              week52_low: res.week52_low,
              returns_d20: res.returns?.d20 ?? null,
              returns_ytd: res.returns?.ytd ?? null,
              sparkline: res.sparkline,
            });
          })
          .catch(() => {});
      } else if (asset.market === "US") {
        api
          .usStockQuote(asset.code)
          .then((res) => {
            if (cancelled) return;
            if (res.name && asset.name === asset.code) setResolvedName(res.name);
            setQuote({
              close: res.close,
              change: res.change,
              change_pct: res.change_pct,
              session: res.session,
            });
          })
          .catch(() => {});
      } else {
        api
          .quote(asset.code)
          .then((res) => {
            if (cancelled) return;
            if (res.name && asset.name === asset.code) setResolvedName(res.name);
            setQuote({
              close: res.close,
              change: res.change,
              change_pct: res.change_pct,
              marcap: res.marcap,
            });
          })
          .catch(() => {});
      }
    };
    poll();
    const stop = startVisibilityAwareInterval(poll, 10_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [asset.code, asset.kind, asset.market, asset.name]);

  // Unified discussion batch fetcher
  const fetchDiscussionBatch = useCallback(
    async (
      target: AssetTarget,
      offset: string | null,
      fresh: boolean,
      preferredUsSource: UsSourceMode,
      signal?: AbortSignal,
    ): Promise<{
      items: DiscussionPost[];
      nextOffset: string | null;
      sourceLabel: string;
      sourceUrl: string | null;
      resolvedName?: string;
    }> => {
      if (target.market === "KR") {
        const res = await api.boardStream(target.code, BATCH_SIZE, offset, fresh, signal);
        return {
          items: res.items.map(normalizeDomesticStream),
          nextOffset: res.next_offset,
          sourceLabel: res.source_label || "네이버페이 증권",
          sourceUrl: res.source_url || `https://m.stock.naver.com/domestic/stock/${target.code}/discussion`,
          resolvedName: res.name,
        };
      }

      if (preferredUsSource === "naver") {
        const dtype = target.kind === "ETF" ? "foreignEtf" : "foreignStock";
        const res = await api.globalDiscussion(target.code, BATCH_SIZE, offset, dtype);
        return {
          items: res.items.map(normalizeGlobalDiscussion),
          nextOffset: res.next_offset,
          sourceLabel: res.source_label || "네이버페이 증권",
          sourceUrl: res.source_url || null,
        };
      }

      // US Toss (with automatic backend fallback to Naver): pull up to ~50 items cleanly in 2 calls max
      let cursor = offset;
      let collected: DiscussionPost[] = [];
      let finalLabel = "토스증권";
      let finalUrl: string | null = null;
      for (let round = 0; round < 2 && collected.length < BATCH_SIZE; round++) {
        const want = Math.min(30, BATCH_SIZE - collected.length);
        const res =
          target.kind === "ETF"
            ? await api.tossEtfDiscussion(target.code, want, cursor)
            : await api.tossDiscussion(target.code, want, cursor);
        if (res.source_label) finalLabel = res.source_label;
        if (res.source_url) finalUrl = res.source_url;
        const normalized = res.items.map(normalizeGlobalDiscussion);
        collected = dedupePosts([...collected, ...normalized]);
        cursor = res.next_offset;
        if (!cursor || res.items.length === 0) break;
      }
      return {
        items: collected,
        nextOffset: cursor,
        sourceLabel: finalLabel,
        sourceUrl: finalUrl,
      };
    },
    [],
  );

  // Initial load on asset or US source change
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPosts([]);
    setNextOffset(null);
    setNewArrivals(0);
    setExpandedIds(new Set());

    fetchDiscussionBatch(asset, null, true, usSource, controller.signal)
      .then((result) => {
        if (cancelled) return;
        setPosts(result.items);
        setNextOffset(result.nextOffset);
        setSourceLabel(result.sourceLabel);
        setSourceUrl(result.sourceUrl);
        if (result.resolvedName && asset.name === asset.code) {
          setResolvedName(result.resolvedName);
        }
        if (initialNid && result.items.some((p) => p.id === initialNid)) {
          setSelectedId(initialNid);
          if (!isDesktop) setSheetOpen(true);
        } else if (result.items.length > 0) {
          setSelectedId(result.items[0].id);
        } else {
          setSelectedId(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled && err.name !== "AbortError") {
          setError(err.message || "토론 게시글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [asset, fetchDiscussionBatch, initialNid, usSource]);

  // Fetch & cache full KR post detail + comments on demand
  const ensureDetail = useCallback(
    (post: DiscussionPost) => {
      if (asset.market !== "KR") return;
      const cacheKey = `${asset.code}:${post.id}`;
      if (inFlightRef.current.has(cacheKey)) return;
      setDetailMap((prev) => {
        const existing = prev[cacheKey];
        if (existing && (existing.status === "ready" || existing.status === "loading")) return prev;
        return { ...prev, [cacheKey]: { status: "loading" } };
      });
      if (detailMap[cacheKey]?.status === "ready") return;

      inFlightRef.current.add(cacheKey);
      Promise.all([api.boardDetail(asset.code, post.id), api.boardComments(asset.code, post.id)])
        .then(([detail, commentsRes]) => {
          setDetailMap((prev) => {
            const keys = Object.keys(prev);
            const next = keys.length > 120 ? Object.fromEntries(keys.slice(-80).map((k) => [k, prev[k]])) : { ...prev };
            next[cacheKey] = { status: "ready", detail, comments: commentsRes.items };
            return next;
          });
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
    [asset.code, asset.market, detailMap],
  );

  // Load detail whenever selected post changes in split or sheet view
  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedId) ?? null,
    [posts, selectedId],
  );

  useEffect(() => {
    if (!selectedPost) return;
    if (effectiveView === "split" || sheetOpen) {
      ensureDetail(selectedPost);
    }
  }, [effectiveView, ensureDetail, selectedPost, sheetOpen]);

  // Refresh latest posts and prepend arrivals
  const handleRefresh = async () => {
    if (refreshing || loading) return;
    setRefreshing(true);
    try {
      const result = await fetchDiscussionBatch(asset, null, true, usSource);
      setPosts((current) => {
        const existingIds = new Set(current.map((p) => p.id));
        const arrivals = result.items.filter((p) => !existingIds.has(p.id));
        if (arrivals.length > 0) setNewArrivals((n) => n + arrivals.length);
        return dedupePosts([...result.items, ...current]);
      });
      if (!nextOffset && result.nextOffset) setNextOffset(result.nextOffset);
    } catch {
      // Keep existing feed readable on transient error
    } finally {
      setRefreshing(false);
    }
  };

  // Load next 50 posts
  const handleLoadMore = async () => {
    if (loadingMore || !nextOffset) return;
    setLoadingMore(true);
    try {
      const result = await fetchDiscussionBatch(asset, nextOffset, false, usSource);
      setPosts((current) => dedupePosts([...current, ...result.items]));
      setNextOffset(result.nextOffset);
    } catch {
      // Ignore transient load-more failure
    } finally {
      setLoadingMore(false);
    }
  };

  // Pulse stats & hot keywords
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
    const keywords = extractHotKeywords(posts, displayAsset.name, displayAsset.code, 8);
    return { holderCount, imageCount, likeRatio, unreadCount, keywords };
  }, [displayAsset.code, displayAsset.name, posts, readIds]);

  // Filtered & sorted posts
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

    if (sortMode === "views") {
      return [...filtered].sort((a, b) => b.views - a.views || b.likes - a.likes);
    }
    if (sortMode === "likes") {
      return [...filtered].sort((a, b) => b.likes - a.likes || b.views - a.views);
    }
    return filtered;
  }, [activeSearchTerm, filterMode, posts, readIds, sortMode]);

  // Keep selected post valid inside filtered list for split mode
  const activeIndex = useMemo(
    () => visiblePosts.findIndex((p) => p.id === selectedId),
    [selectedId, visiblePosts],
  );

  const openPost = useCallback(
    (post: DiscussionPost, openSheetOnMobile = false) => {
      setSelectedId(post.id);
      setReadIds((prev) => {
        if (prev.has(post.id)) return prev;
        const next = new Set(prev);
        next.add(post.id);
        return next;
      });
      ensureDetail(post);
      if (openSheetOnMobile) setSheetOpen(true);
      reportDiscussionPostClick({
        code: displayAsset.code,
        name: displayAsset.name,
        title: post.title,
        postId: post.id,
        market: displayAsset.market,
        assetKind: displayAsset.kind,
      });
    },
    [displayAsset.code, displayAsset.kind, displayAsset.market, displayAsset.name, ensureDetail],
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
            code: displayAsset.code,
            name: displayAsset.name,
            title: post.title,
            postId: post.id,
            market: displayAsset.market,
            assetKind: displayAsset.kind,
          });
        }
        return next;
      });
    },
    [displayAsset.code, displayAsset.kind, displayAsset.market, displayAsset.name, ensureDetail],
  );

  const stepPost = useCallback(
    (delta: number) => {
      if (visiblePosts.length === 0) return;
      const base = activeIndex >= 0 ? activeIndex : 0;
      const nextIdx = Math.max(0, Math.min(visiblePosts.length - 1, base + delta));
      const target = visiblePosts[nextIdx];
      if (!target) return;
      openPost(target, sheetOpen);
      const row = splitListRef.current?.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(target.id)}"]`);
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [activeIndex, openPost, sheetOpen, visiblePosts],
  );

  // Keyboard shortcuts for effortless rapid reading (J/K, ↑/↓, Escape)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.matches("input, textarea, select")) return;
      if (event.key === "Escape" && sheetOpen) {
        setSheetOpen(false);
        event.preventDefault();
        return;
      }
      if (effectiveView === "split" || sheetOpen) {
        if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
          stepPost(1);
          event.preventDefault();
        } else if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
          stepPost(-1);
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [effectiveView, sheetOpen, stepPost]);

  // Lock body scroll while mobile detail sheet is open
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const schedulePrefetch = (post: DiscussionPost) => {
    if (asset.market !== "KR") return;
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      ensureDetail(post);
    }, 160);
  };

  const cancelPrefetch = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleToggleKeyword = (word: string) => {
    setActiveKeyword((prev) => (prev === word ? "" : word));
  };

  const selectedDetailEntry = selectedPost ? detailMap[`${asset.code}:${selectedPost.id}`] : undefined;

  return (
    <div className="dr-page">
      {/* 1. Stock Brief + Instant Switcher Search + Quick Presets */}
      <StockBriefCard
        asset={displayAsset}
        quote={quote}
        sourceLabel={sourceLabel}
        postCount={posts.length}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onSelectAsset={handleSelectAsset}
      />

      {/* 2. Dedicated Top Horizontal Ad Banner Zone (collapses cleanly when unfilled / wide rail active) */}
      <div className="dr-ad-band">
        <AdZone kind="break" ready={!loading} className="dr-ad-top" />
      </div>

      {/* 3. Discussion Pulse + Hot Keywords + View/Filter/Sort Controls */}
      <DiscussionPulseBar
        market={asset.market}
        totalLoaded={posts.length}
        visibleCount={visiblePosts.length}
        unreadCount={pulseStats.unreadCount}
        holderCount={pulseStats.holderCount}
        imageCount={pulseStats.imageCount}
        likeRatio={pulseStats.likeRatio}
        newArrivals={newArrivals}
        keywords={pulseStats.keywords}
        activeKeyword={activeKeyword}
        onToggleKeyword={handleToggleKeyword}
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

      {/* 4. Main Discussion Reading Workspace */}
      <section className="dr-workspace" aria-label={`${displayAsset.name} 종목토론 게시글 목록`}>
        {loading ? (
          <div className="dr-skeleton-grid" aria-busy="true" aria-label="토론 게시글 불러오는 중">
            {Array.from({ length: 10 }, (_, idx) => (
              <div key={idx} className="dr-skeleton-card">
                <span className="w-30" />
                <span className="w-85" />
                <span className="w-65" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="dr-state is-error" role="alert">
            <strong>토론을 불러오지 못했습니다</strong>
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
          /* ── VIEW A: DESKTOP SPLIT READING DESK ── */
          <div className="dr-split-layout">
            <div className="dr-split-list" ref={splitListRef} role="listbox" aria-label="게시글 목록">
              {visiblePosts.map((post, idx) => {
                const isSelected = selectedPost?.id === post.id;
                const isRead = readIds.has(post.id);
                const hot = isHotPost(post);
                return (
                  <Fragment key={post.id}>
                    <button
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
                    {(idx === 14 || idx === 44) && idx < visiblePosts.length - 1 && (
                      <div className="dr-infeed-ad-slot">
                        <InArticleAd className="dr-ad-infeed" />
                      </div>
                    )}
                  </Fragment>
                );
              })}

              {nextOffset && (
                <div className="dr-load-more">
                  <button
                    type="button"
                    className="dr-load-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "불러오는 중…" : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
                  </button>
                </div>
              )}
            </div>

            <div className="dr-split-reader">
              <ReaderPane
                post={selectedPost}
                asset={displayAsset}
                entry={selectedDetailEntry}
                sourceUrl={sourceUrl}
                currentIndex={activeIndex}
                totalCount={visiblePosts.length}
                fontScale={fontScale}
                onChangeFontScale={handleFontScaleChange}
                onPrev={() => stepPost(-1)}
                onNext={() => stepPost(1)}
                mode="split"
              />
            </div>
          </div>
        ) : effectiveView === "stream" ? (
          /* ── VIEW B: STREAM / BULK OPEN READING FEED (Great on both Desktop & Mobile!) ── */
          <div className="dr-stream-wrap">
            <div className="dr-stream-grid">
              {visiblePosts.map((post, idx) => {
                const isExpanded = expandedIds.has(post.id);
                const isRead = readIds.has(post.id);
                const hot = isHotPost(post);
                const entry = detailMap[`${asset.code}:${post.id}`];
                return (
                  <Fragment key={post.id}>
                    <article className={`dr-stream-card ${isExpanded ? "is-expanded" : ""} ${isRead ? "is-read" : ""} ${hot ? "is-hot" : ""}`}>
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
                        <button
                          type="button"
                          onClick={() => (asset.market === "KR" ? toggleInlineExpand(post) : openPost(post, !isDesktop))}
                        >
                          {highlightText(post.title, activeSearchTerm)}
                        </button>
                      </h3>

                      {/* Immediate open body preview — read dozens of posts without a single click! */}
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

                      {/* Inline full detail + images + comments when expanded */}
                      {isExpanded && (
                        <div className="dr-stream-inline-reader">
                          <ReaderPane
                            post={post}
                            asset={displayAsset}
                            entry={entry}
                            sourceUrl={sourceUrl}
                            currentIndex={idx}
                            totalCount={visiblePosts.length}
                            fontScale={fontScale}
                            onChangeFontScale={handleFontScaleChange}
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
                          {asset.market === "KR" ? (
                            <button
                              type="button"
                              className="dr-expand-btn"
                              onClick={() => toggleInlineExpand(post)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? "접기 ▴" : "본문·댓글 펼치기 ▾"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="dr-expand-btn"
                              onClick={() => openPost(post, true)}
                            >
                              크게 읽기 ↗
                            </button>
                          )}
                        </div>
                      </footer>
                    </article>

                    {(idx === 13 || idx === 43) && idx < visiblePosts.length - 1 && (
                      <div className="dr-stream-ad-span">
                        <InArticleAd className="dr-ad-infeed" />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>

            {nextOffset && (
              <div className="dr-load-more">
                <button
                  type="button"
                  className="dr-load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "불러오는 중…" : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── VIEW C: ULTRA-HIGH-DENSITY COMPACT LIST WITH INLINE ACCORDION ── */
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
              {visiblePosts.map((post, idx) => {
                const isExpanded = expandedIds.has(post.id);
                const isRead = readIds.has(post.id);
                const hot = isHotPost(post);
                const entry = detailMap[`${asset.code}:${post.id}`];
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
                            asset={displayAsset}
                            entry={entry}
                            sourceUrl={sourceUrl}
                            currentIndex={idx}
                            totalCount={visiblePosts.length}
                            fontScale={fontScale}
                            onChangeFontScale={handleFontScaleChange}
                            onPrev={() => {}}
                            onNext={() => {}}
                            mode="inline"
                          />
                        </div>
                      )}
                    </div>

                    {(idx === 17 || idx === 47) && idx < visiblePosts.length - 1 && (
                      <div className="dr-infeed-ad-slot">
                        <InArticleAd className="dr-ad-infeed" />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>

            {nextOffset && (
              <div className="dr-load-more">
                <button
                  type="button"
                  className="dr-load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "불러오는 중…" : `이전 토론 +${BATCH_SIZE}건 더 불러오기`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Mobile & Quick-Open Slide-Up Reader Sheet */}
      {sheetOpen && selectedPost && (
        <div className="dr-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div className="dr-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="게시글 상세 읽기">
            <ReaderPane
              post={selectedPost}
              asset={displayAsset}
              entry={selectedDetailEntry}
              sourceUrl={sourceUrl}
              currentIndex={activeIndex}
              totalCount={visiblePosts.length}
              fontScale={fontScale}
              onChangeFontScale={handleFontScaleChange}
              onPrev={() => stepPost(-1)}
              onNext={() => stepPost(1)}
              onClose={() => setSheetOpen(false)}
              mode="sheet"
            />
          </div>
        </div>
      )}
    </div>
  );
}
