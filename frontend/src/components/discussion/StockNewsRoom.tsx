import { Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NewsItem, TossNewsItem, api } from "../../api/client";
import { shortDateTime } from "../../stocks/market";
import { reportStocksEvent } from "../../useActivityTracking";
import { FontScale, ViewMode, decodeHtmlEntities, formatRelativeTime } from "./types";
import "../../discussionExplorer.css";

const DESKTOP_SPLIT_MIN = 1024;
const TOSS_PAGE_SIZE = 20;
const INITIAL_STREAM_SHOW = 10;
const INITIAL_COMPACT_SHOW = 16;

interface UnifiedNewsRow {
  key: string;
  id: string | null;
  title: string;
  press: string;
  rawDate: string;
  dateLabel: string;
  relativeLabel: string;
  summary: string;
  link: string;
  image: string | null;
}

interface CachedArticleEntry {
  status: "loading" | "ready" | "error";
  paragraphs: string[] | null;
  digest: string[];
  link: string;
}

function stripHtml(raw: string): string {
  return decodeHtmlEntities((raw || "").replace(/<[^>]*>/g, "")).trim();
}

function fromNaver(item: NewsItem, idx: number): UnifiedNewsRow {
  const title = stripHtml(item.title || "");
  const summary = stripHtml(item.summary || "").replace(/\s+/g, " ").trim();
  return {
    key: item.link || `nv-${idx}`,
    id: null,
    title,
    press: stripHtml(item.press || "") || "언론사",
    rawDate: item.date || "",
    dateLabel: item.date || "",
    relativeLabel: formatRelativeTime(item.date || "") || item.date || "",
    summary,
    link: item.link || "",
    image: null,
  };
}

function fromToss(item: TossNewsItem): UnifiedNewsRow {
  const title = stripHtml(item.title || "");
  const summary = stripHtml(item.summary || "").replace(/\s+/g, " ").trim();
  const formatted = shortDateTime(item.date);
  return {
    key: item.id,
    id: item.id,
    title,
    press: stripHtml(item.press || "") || "뉴스",
    rawDate: item.date || "",
    dateLabel: formatted,
    relativeLabel: formatRelativeTime(item.date || "") || formatted,
    summary,
    link: "",
    image: item.image_url || null,
  };
}

function cleanLine(raw: string): string {
  return stripHtml(raw).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function highlightTerm(text: string, term: string): ReactNode {
  const q = term.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length <= 1) return text;
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="dr-mark">{part}</mark> : part));
}

function NewsArticleReader({
  row,
  entry,
  currentIndex,
  totalCount,
  fontScale,
  onChangeFontScale,
  onPrev,
  onNext,
  onClose,
  mode,
}: {
  row: UnifiedNewsRow | null;
  entry?: CachedArticleEntry;
  currentIndex: number;
  totalCount: number;
  fontScale: FontScale;
  onChangeFontScale: (next: FontScale) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose?: () => void;
  mode: "split" | "sheet" | "inline";
}) {
  const [copied, setCopied] = useState(false);

  if (!row) {
    return (
      <div className="dr-reader-empty">
        <span className="dr-reader-empty-icon" aria-hidden="true">▤</span>
        <strong>읽을 기사를 선택하세요</strong>
        <p>왼쪽 목록에서 기사를 선택하면 본문과 핵심 요약을 이 자리에서 바로 읽을 수 있습니다.</p>
      </div>
    );
  }

  const loading = !entry || entry.status === "loading";
  const paragraphs = (entry?.paragraphs ?? []).map(cleanLine).filter(Boolean);
  const digest = (entry?.digest ?? []).map(cleanLine).filter(Boolean);
  const resolvedLink = entry?.link || row.link;

  const copyLink = () => {
    if (!resolvedLink) return;
    navigator.clipboard?.writeText(resolvedLink).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <article className={`dr-reader dr-reader--${mode} dr-font-${fontScale}`} aria-label="관련 기사 본문">
      {mode !== "inline" && (
        <header className="dr-reader-bar">
          <div className="dr-reader-nav">
            <button type="button" onClick={onPrev} disabled={currentIndex <= 0} aria-label="이전 기사">
              ‹ 이전
            </button>
            <span className="dr-reader-pos">
              {currentIndex >= 0 ? `${currentIndex + 1} / ${totalCount}` : `— / ${totalCount}`}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex < 0 || currentIndex >= totalCount - 1}
              aria-label="다음 기사"
            >
              다음 ›
            </button>
          </div>

          <div className="dr-reader-tools">
            <div className="dr-font-switch" role="group" aria-label="기사 글자 크기">
              {(["sm", "md", "lg"] as const).map((scale, idx) => (
                <button
                  key={scale}
                  type="button"
                  className={fontScale === scale ? "is-active" : ""}
                  onClick={() => onChangeFontScale(scale)}
                  aria-pressed={fontScale === scale}
                >
                  {idx === 0 ? "가-" : idx === 1 ? "가" : "가+"}
                </button>
              ))}
            </div>
            {resolvedLink && (
              <>
                <button type="button" className="dr-tool-btn" onClick={copyLink}>
                  {copied ? "복사됨 ✓" : "링크"}
                </button>
                <a href={resolvedLink} target="_blank" rel="noopener noreferrer" className="dr-tool-btn">
                  원문 ↗
                </a>
              </>
            )}
            {onClose && (
              <button type="button" className="dr-tool-close" onClick={onClose} aria-label="닫기">
                ×
              </button>
            )}
          </div>
        </header>
      )}

      <div className="dr-reader-scroll">
        {mode !== "inline" && (
          <div className="dr-reader-head">
            <div className="dr-reader-badges">
              <span className="dr-press-pill">{row.press}</span>
              <time>{row.dateLabel}</time>
            </div>
            <h2>{row.title}</h2>
          </div>
        )}

        {mode === "inline" && resolvedLink && (
          <div className="dr-inline-meta-bar">
            <a href={resolvedLink} target="_blank" rel="noopener noreferrer" className="dr-tool-btn">
              원문 기사 열기 ↗
            </a>
          </div>
        )}

        <div className="dr-reader-body">
          {row.image && mode !== "inline" && (
            <figure className="dr-reader-figure dr-news-hero-img">
              <img src={row.image} alt="" loading="lazy" decoding="async" />
            </figure>
          )}

          {loading && (
            <>
              {row.summary && <p className="dr-reader-paragraph">{row.summary}</p>}
              <div className="dr-reader-loading">
                <i className="dr-spinner" aria-hidden="true" />
                <span>기사 본문을 불러오는 중…</span>
              </div>
            </>
          )}

          {!loading && digest.length > 0 && (
            <div className="dr-digest-box" aria-label="기사 핵심 요약">
              <span className="dr-digest-kicker">핵심 요약</span>
              <ul>
                {digest.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {!loading &&
            paragraphs.map((p, idx) => (
              <p key={idx} className="dr-reader-paragraph">
                {p}
              </p>
            ))}

          {!loading && paragraphs.length === 0 && (
            <div className="dr-news-fallback">
              {digest.length === 0 && row.summary && <p className="dr-reader-paragraph">{row.summary}</p>}
              <p className="dr-reader-muted">
                {resolvedLink
                  ? "언론사 정책으로 전문을 직접 표시할 수 없는 기사입니다. 원문 링크에서 전체 내용을 확인해 주세요."
                  : "표시할 기사 본문이 없습니다."}
              </p>
              {resolvedLink && (
                <a href={resolvedLink} target="_blank" rel="noopener noreferrer" className="dr-btn dr-btn--accent">
                  원문 기사 보러 가기 ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function StockNewsRoom({
  code,
  name,
  us,
  track,
}: {
  code: string;
  name: string;
  us: boolean;
  track?: string;
}) {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_SPLIT_MIN);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    window.innerWidth >= DESKTOP_SPLIT_MIN ? "split" : "stream",
  );
  const [fontScale, setFontScale] = useState<FontScale>("md");

  const [items, setItems] = useState<UnifiedNewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tossPage, setTossPage] = useState(1);
  const [hasMoreToss, setHasMoreToss] = useState(false);
  const [usingToss, setUsingToss] = useState(us);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_STREAM_SHOW);

  const [selectedPress, setSelectedPress] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set());
  const [articleMap, setArticleMap] = useState<Record<string, CachedArticleEntry>>({});

  const inFlightRef = useRef<Set<string>>(new Set());
  const hoverTimerRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_SPLIT_MIN}px)`);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const effectiveView: ViewMode = !isDesktop && viewMode === "split" ? "stream" : viewMode;

  const loadInitial = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        if (us) {
          const res = await api.tossNews(code, TOSS_PAGE_SIZE, 1);
          if (res.items.length > 0) {
            const rows = res.items.map(fromToss);
            setItems(rows);
            setUsingToss(true);
            setTossPage(1);
            setHasMoreToss(res.has_next);
            if (!isRefresh && rows.length > 0) setSelectedKey(rows[0].key);
            return;
          }
          // Fallback to Naver US search news if Toss has no coverage
          const fallback = await api.usNews(code, 24);
          const rows = fallback.items.map(fromNaver);
          setItems(rows);
          setUsingToss(false);
          setHasMoreToss(false);
          if (!isRefresh && rows.length > 0) setSelectedKey(rows[0].key);
        } else {
          const res = await api.news(code);
          const rows = res.items.map(fromNaver);
          setItems(rows);
          setUsingToss(false);
          setHasMoreToss(false);
          if (!isRefresh && rows.length > 0) setSelectedKey(rows[0].key);
        }
      } catch {
        setError("관련 기사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [code, us],
  );

  useEffect(() => {
    setItems([]);
    setSelectedKey(null);
    setSelectedPress("ALL");
    setQuery("");
    setExpandedKeys(new Set());
    setReadKeys(new Set());
    setSheetOpen(false);
    setVisibleLimit(INITIAL_STREAM_SHOW);
    loadInitial(false);
  }, [code, us, loadInitial]);

  // Lock body scroll when mobile sheet is open
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const ensureArticle = useCallback(
    (row: UnifiedNewsRow) => {
      const cacheKey = `${code}:${row.key}`;
      if (inFlightRef.current.has(cacheKey)) return;
      if (articleMap[cacheKey]?.status === "ready") return;

      inFlightRef.current.add(cacheKey);
      setArticleMap((prev) => ({
        ...prev,
        [cacheKey]: { status: "loading", paragraphs: null, digest: [], link: row.link },
      }));

      const req = row.id
        ? api.tossNewsArticle(row.id).then((a) => ({
            paragraphs: a.paragraphs,
            digest: a.summary_sentences ?? [],
            link: a.link || row.link,
          }))
        : api.newsArticle(row.link).then((r) => ({
            paragraphs: r.paragraphs,
            digest: [] as string[],
            link: row.link,
          }));

      req
        .then((data) => {
          setArticleMap((prev) => ({
            ...prev,
            [cacheKey]: { status: "ready", paragraphs: data.paragraphs, digest: data.digest, link: data.link },
          }));
        })
        .catch(() => {
          setArticleMap((prev) => ({
            ...prev,
            [cacheKey]: { status: "error", paragraphs: null, digest: [], link: row.link },
          }));
        })
        .finally(() => {
          inFlightRef.current.delete(cacheKey);
        });
    },
    [articleMap, code],
  );

  // Top press outlets for quick pill filters
  const topPresses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of items) {
      if (!row.press) continue;
      counts.set(row.press, (counts.get(row.press) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 7);
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((row) => {
      if (selectedPress !== "ALL" && row.press !== selectedPress) return false;
      if (q) {
        const hay = `${row.title} ${row.press} ${row.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, selectedPress]);

  const selectedRow = useMemo(
    () => filteredItems.find((r) => r.key === selectedKey) ?? (effectiveView === "split" ? filteredItems[0] ?? null : null),
    [effectiveView, filteredItems, selectedKey],
  );

  useEffect(() => {
    if (!selectedRow) return;
    if (effectiveView === "split" || sheetOpen) {
      ensureArticle(selectedRow);
    }
  }, [effectiveView, ensureArticle, selectedRow, sheetOpen]);

  const activeIndex = selectedRow ? filteredItems.findIndex((r) => r.key === selectedRow.key) : -1;

  const openArticle = useCallback(
    (row: UnifiedNewsRow, openSheet = false) => {
      setSelectedKey(row.key);
      setReadKeys((prev) => {
        if (prev.has(row.key)) return prev;
        const next = new Set(prev);
        next.add(row.key);
        return next;
      });
      ensureArticle(row);
      if (openSheet) setSheetOpen(true);
      if (track) reportStocksEvent({ action: "news_article", market: track, code, name, detail: row.title });
    },
    [code, ensureArticle, name, track],
  );

  const toggleInline = useCallback(
    (row: UnifiedNewsRow) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) {
          next.delete(row.key);
        } else {
          next.add(row.key);
          ensureArticle(row);
          setReadKeys((r) => {
            if (r.has(row.key)) return r;
            const nr = new Set(r);
            nr.add(row.key);
            return nr;
          });
          if (track) reportStocksEvent({ action: "news_article", market: track, code, name, detail: row.title });
        }
        return next;
      });
    },
    [code, ensureArticle, name, track],
  );

  const stepArticle = (delta: number) => {
    if (filteredItems.length === 0) return;
    const base = activeIndex >= 0 ? activeIndex : 0;
    const nextIdx = Math.max(0, Math.min(filteredItems.length - 1, base + delta));
    const target = filteredItems[nextIdx];
    if (!target) return;
    openArticle(target, sheetOpen);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-news-key="${CSS.escape(target.key)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const handleLoadMore = async () => {
    if (visibleLimit < filteredItems.length) {
      setVisibleLimit((prev) => prev + 12);
      return;
    }
    if (!usingToss || !hasMoreToss || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = tossPage + 1;
      const res = await api.tossNews(code, TOSS_PAGE_SIZE, next);
      setTossPage(next);
      setHasMoreToss(res.has_next && res.items.length > 0);
      setItems((old) => {
        const seen = new Set(old.map((r) => r.key));
        const additions = res.items.map(fromToss).filter((r) => !seen.has(r.key));
        return [...old, ...additions];
      });
      setVisibleLimit((prev) => prev + TOSS_PAGE_SIZE);
    } catch {
      setHasMoreToss(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleViewChange = (next: ViewMode) => {
    setViewMode(next);
    setExpandedKeys(new Set());
    if (next === "compact") setVisibleLimit(Math.max(visibleLimit, INITIAL_COMPACT_SHOW));
  };

  const schedulePrefetch = (row: UnifiedNewsRow) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => ensureArticle(row), 160);
  };

  const cancelPrefetch = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const shownRows = effectiveView === "split" ? filteredItems : filteredItems.slice(0, visibleLimit);
  const canShowMore = effectiveView !== "split" && (visibleLimit < filteredItems.length || (usingToss && hasMoreToss));
  const selectedEntry = selectedRow ? articleMap[`${code}:${selectedRow.key}`] : undefined;

  return (
    <div className="dr-embedded dr-news-room">
      {/* Control & Press Filter Shell */}
      <div className="dr-controls-shell">
        <div className="dr-pulse-row">
          <div className="dr-pulse-stats">
            <span className="dr-pulse-pill is-live">
              <i aria-hidden="true" />
              <strong>{filteredItems.length}</strong>
              <em>건의 관련 기사</em>
            </span>
            <button
              type="button"
              className="dr-mini-refresh"
              onClick={() => loadInitial(true)}
              disabled={refreshing || loading}
              title="관련 기사 새로고침"
            >
              <span className={refreshing ? "is-spinning" : ""} aria-hidden="true">↻</span>
              <span>새로고침</span>
            </button>
          </div>

          {topPresses.length > 1 && (
            <div className="dr-keywords" aria-label="언론사별 필터">
              <span className="dr-keywords-label">언론사</span>
              <div className="dr-keywords-list">
                <button
                  type="button"
                  className={`dr-keyword-chip ${selectedPress === "ALL" ? "is-active" : ""}`}
                  onClick={() => setSelectedPress("ALL")}
                >
                  전체 <small>{items.length}</small>
                </button>
                {topPresses.map(([press, count]) => (
                  <button
                    key={press}
                    type="button"
                    className={`dr-keyword-chip ${selectedPress === press ? "is-active" : ""}`}
                    onClick={() => setSelectedPress((cur) => (cur === press ? "ALL" : press))}
                  >
                    {press} <small>{count}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dr-toolbar">
          <div className="dr-view-switcher" role="group" aria-label="기사 보기 모드">
            {isDesktop && (
              <button
                type="button"
                className={effectiveView === "split" ? "is-active" : ""}
                onClick={() => handleViewChange("split")}
                aria-pressed={effectiveView === "split"}
              >
                분할 리딩
              </button>
            )}
            <button
              type="button"
              className={effectiveView === "stream" ? "is-active" : ""}
              onClick={() => handleViewChange("stream")}
              aria-pressed={effectiveView === "stream"}
            >
              카드 펼쳐보기
            </button>
            <button
              type="button"
              className={effectiveView === "compact" ? "is-active" : ""}
              onClick={() => handleViewChange("compact")}
              aria-pressed={effectiveView === "compact"}
            >
              컴팩트 목록
            </button>
          </div>

          <div className="dr-toolbar-right">
            <label className="dr-inline-filter dr-inline-filter--wide">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="기사 제목·언론사 검색"
                aria-label="관련 기사 검색"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기">
                  ×
                </button>
              )}
            </label>
          </div>
        </div>
      </div>

      {/* News Content Area */}
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
          <strong>관련 기사를 불러오지 못했습니다</strong>
          <p>{error}</p>
          <button type="button" className="dr-btn dr-btn--accent" onClick={() => loadInitial(false)}>
            다시 시도
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="dr-state">
          <strong>표시할 관련 기사가 없습니다</strong>
          <p>{query || selectedPress !== "ALL" ? "검색어나 언론사 필터를 초기화해 보세요." : "최근 등록된 관련 기사가 없습니다."}</p>
          {(query || selectedPress !== "ALL") && (
            <button
              type="button"
              className="dr-btn dr-btn--ghost"
              onClick={() => {
                setQuery("");
                setSelectedPress("ALL");
              }}
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : effectiveView === "split" ? (
        <div className="dr-split-layout dr-split-layout--embedded dr-split-layout--news">
          <div className="dr-split-list dr-split-list--bounded" ref={listRef} role="listbox" aria-label="관련 기사 목록">
            {filteredItems.map((row, idx) => {
              const isSelected = selectedRow?.key === row.key;
              const isRead = readKeys.has(row.key);
              return (
                <button
                  key={row.key}
                  type="button"
                  data-news-key={row.key}
                  role="option"
                  aria-selected={isSelected}
                  className={`dr-split-row ${isSelected ? "is-selected" : ""} ${isRead ? "is-read" : ""}`}
                  onClick={() => openArticle(row, false)}
                  onMouseEnter={() => schedulePrefetch(row)}
                  onMouseLeave={cancelPrefetch}
                >
                  <div className="dr-row-top">
                    <span className="dr-row-num">{String(idx + 1).padStart(2, "0")}</span>
                    <span className="dr-press-pill">{row.press}</span>
                    <span className="dr-row-time" title={row.dateLabel}>{row.relativeLabel}</span>
                  </div>
                  <strong className="dr-row-title">{highlightTerm(row.title, query)}</strong>
                  {row.summary && <p className="dr-row-preview">{highlightTerm(row.summary, query)}</p>}
                </button>
              );
            })}

            {usingToss && hasMoreToss && (
              <div className="dr-load-more">
                <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? "불러오는 중…" : "이전 기사 더 불러오기"}
                </button>
              </div>
            )}
          </div>

          <div className="dr-split-reader dr-split-reader--bounded">
            <NewsArticleReader
              row={selectedRow}
              entry={selectedEntry}
              currentIndex={activeIndex}
              totalCount={filteredItems.length}
              fontScale={fontScale}
              onChangeFontScale={setFontScale}
              onPrev={() => stepArticle(-1)}
              onNext={() => stepArticle(1)}
              mode="split"
            />
          </div>
        </div>
      ) : effectiveView === "stream" ? (
        <div className="dr-stream-wrap">
          <div className="dr-stream-grid">
            {shownRows.map((row, idx) => {
              const isExpanded = expandedKeys.has(row.key);
              const isRead = readKeys.has(row.key);
              const entry = articleMap[`${code}:${row.key}`];
              return (
                <article
                  key={row.key}
                  className={`dr-stream-card ${isExpanded ? "is-expanded" : ""} ${isRead ? "is-read" : ""}`}
                >
                  <header className="dr-stream-card-head">
                    <div className="dr-stream-card-badges">
                      <span className="dr-row-num">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="dr-press-pill">{row.press}</span>
                    </div>
                    <time className="dr-row-time" title={row.dateLabel}>{row.relativeLabel}</time>
                  </header>

                  <h3 className="dr-stream-title">
                    <button type="button" onClick={() => toggleInline(row)}>
                      {highlightTerm(row.title, query)}
                    </button>
                  </h3>

                  {!isExpanded && (row.summary || row.image) && (
                    <div className="dr-stream-body-preview">
                      {row.summary && <p>{highlightTerm(row.summary, query)}</p>}
                      {row.image && (
                        <img
                          src={row.image}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="dr-stream-thumb"
                          onClick={() => toggleInline(row)}
                        />
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="dr-stream-inline-reader">
                      <NewsArticleReader
                        row={row}
                        entry={entry}
                        currentIndex={idx}
                        totalCount={filteredItems.length}
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
                      <span>{row.dateLabel}</span>
                    </div>
                    <div className="dr-stream-actions">
                      <button
                        type="button"
                        className="dr-expand-btn"
                        onClick={() => toggleInline(row)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "접기 ▴" : "본문 읽기 ▾"}
                      </button>
                      {!isDesktop && (
                        <button
                          type="button"
                          className="dr-tool-btn"
                          onClick={() => openArticle(row, true)}
                        >
                          크게
                        </button>
                      )}
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>

          {canShowMore && (
            <div className="dr-load-more">
              <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore
                  ? "불러오는 중…"
                  : visibleLimit < filteredItems.length
                    ? `기사 더 보기 (${shownRows.length} / ${filteredItems.length}건)`
                    : "이전 기사 더 불러오기"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="dr-compact-wrap">
          <div className="dr-compact-head dr-compact-head--news" aria-hidden="true">
            <span>#</span>
            <span>기사 제목 · 요약</span>
            <span>언론사</span>
            <span>시간</span>
          </div>

          <div className="dr-compact-list">
            {shownRows.map((row, idx) => {
              const isExpanded = expandedKeys.has(row.key);
              const isRead = readKeys.has(row.key);
              const entry = articleMap[`${code}:${row.key}`];
              return (
                <Fragment key={row.key}>
                  <div className={`dr-compact-item ${isExpanded ? "is-expanded" : ""} ${isRead ? "is-read" : ""}`}>
                    <button
                      type="button"
                      className="dr-compact-row dr-compact-row--news"
                      onClick={() => toggleInline(row)}
                      aria-expanded={isExpanded}
                    >
                      <span className="dr-compact-no">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="dr-compact-main">
                        <span className="dr-compact-title-line">
                          <strong>{highlightTerm(row.title, query)}</strong>
                        </span>
                        {row.summary && <span className="dr-compact-snippet">{highlightTerm(row.summary, query)}</span>}
                      </span>
                      <span className="dr-compact-author">{row.press}</span>
                      <span className="dr-compact-time" title={row.dateLabel}>{row.relativeLabel}</span>
                    </button>

                    {isExpanded && (
                      <div className="dr-compact-detail">
                        <NewsArticleReader
                          row={row}
                          entry={entry}
                          currentIndex={idx}
                          totalCount={filteredItems.length}
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

          {canShowMore && (
            <div className="dr-load-more">
              <button type="button" className="dr-load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore
                  ? "불러오는 중…"
                  : visibleLimit < filteredItems.length
                    ? `기사 더 보기 (${shownRows.length} / ${filteredItems.length}건)`
                    : "이전 기사 더 불러오기"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile Slide-Up Article Sheet (portalled to body to sit above floating docks) */}
      {sheetOpen && selectedRow && createPortal(
        <div className="dr-sheet-scrim" onClick={() => setSheetOpen(false)}>
          <div className="dr-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="관련 기사 상세">
            <NewsArticleReader
              row={selectedRow}
              entry={selectedEntry}
              currentIndex={activeIndex}
              totalCount={filteredItems.length}
              fontScale={fontScale}
              onChangeFontScale={setFontScale}
              onPrev={() => stepArticle(-1)}
              onNext={() => stepArticle(1)}
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
