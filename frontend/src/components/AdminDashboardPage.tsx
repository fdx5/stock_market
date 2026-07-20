import { useEffect, useMemo, useState } from "react";
import {
  ActiveSession,
  ActivityEvent,
  AdminAuthError,
  AdminComment,
  AdminSummary,
  AdminTrendRange,
  CommentSource,
  PageCount,
  StockSearchCount,
  TrendPoint,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { Link, navigate } from "../router";
import { pageLabel } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";

// Fixed categorical order (never cycled) — reuses this app's existing series
// tokens (styles.css :root), which already implement the validated dataviz
// palette. A page past this many falls into a muted "기타" series.
const SERIES_VARS = [
  "--series-blue",
  "--series-aqua",
  "--series-yellow",
  "--series-violet",
  "--series-red",
  "--series-pink",
  "--series-orange",
];

const TYPE_META: Record<string, { label: string; colorVar: string }> = {
  page_view: { label: "이동", colorVar: "--series-blue" },
  click: { label: "클릭", colorVar: "--series-violet" },
  stock_view: { label: "종목조회", colorVar: "--series-aqua" },
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(epochSeconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 60) return `${Math.floor(diff)}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  return `${Math.floor(diff / 3600)}시간 전`;
}

function shortSession(id: string): string {
  return id.slice(0, 8);
}

function initials(id: string): string {
  return id.slice(0, 2).toUpperCase();
}

// Not a data series — a stable per-visitor avatar tint, so the same session
// always gets the same color across polls. Pulled from the same fixed
// categorical set the trend chart uses, purely as a recognizable identity cue.
function avatarColorVar(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SERIES_VARS[hash % SERIES_VARS.length];
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const COMMENT_PREVIEW_LEN = 20;

/** Truncates to a fixed character count (not CSS ellipsis, which truncates by
 * rendered width) so every row's preview is the same length regardless of the
 * comment's actual content — the fixed-width column then never has to reflow. */
function truncateComment(text: string): { preview: string; truncated: boolean } {
  if (text.length <= COMMENT_PREVIEW_LEN) return { preview: text, truncated: false };
  return { preview: `${text.slice(0, COMMENT_PREVIEW_LEN)}...`, truncated: true };
}

function formatBucket(bucket: string): string {
  // Minute bucket "2026-07-20T14:05" (24h view) or daily bucket "2026-07-20" (7d/30d).
  if (bucket.length > 10) return bucket.slice(11, 16);
  return bucket.slice(5).replace("-", "/");
}

const RANGE_OPTIONS: { value: AdminTrendRange; label: string }[] = [
  { value: "1h", label: "1시간" },
  { value: "3h", label: "3시간" },
  { value: "6h", label: "6시간" },
  { value: "12h", label: "12시간" },
  { value: "24h", label: "24시간" },
  { value: "3d", label: "3일" },
  { value: "7d", label: "7일" },
  { value: "30d", label: "30일" },
];

const RANGE_MINUTES: Partial<Record<AdminTrendRange, number>> = {
  "1h": 60,
  "3h": 180,
  "6h": 360,
  "12h": 720,
  "24h": 1440,
};

const RANGE_DAYS: Partial<Record<AdminTrendRange, number>> = {
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Shifts a real instant by the KST offset before formatting, so the digits read
 * as Korea wall-clock time (`Date.toISOString()` is otherwise always UTC). Must
 * match the backend's `strftime(fmt, created_at, '+9 hours')` bucketing exactly
 * (see page_view_store.counts_by_bucket) or points won't line up with the
 * timeline's bucket keys. */
function kstIso(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString();
}

/** A full, evenly-spaced KST timeline for the requested range — independent of
 * which buckets actually have data. Backfilling every minute/day (not just the
 * ones with events) is what makes the line read as a continuous trend instead
 * of jumping between whatever sparse timestamps happened to have traffic. */
function buildTimeline(range: AdminTrendRange, now: Date): string[] {
  const buckets: string[] = [];
  const minutes = RANGE_MINUTES[range];
  if (minutes !== undefined) {
    const end = new Date(now);
    end.setUTCSeconds(0, 0);
    for (let i = minutes - 1; i >= 0; i--) {
      buckets.push(kstIso(new Date(end.getTime() - i * 60_000)).slice(0, 16));
    }
  } else {
    const days = RANGE_DAYS[range] ?? 30;
    // Truncate to KST midnight — the boundary of "today" in Korea, not UTC.
    const endOfDayKst = new Date(`${kstIso(now).slice(0, 10)}T00:00:00.000Z`);
    for (let i = days - 1; i >= 0; i--) {
      buckets.push(new Date(endOfDayKst.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    }
  }
  return buckets;
}

/** A stacked-bar segment with a rounded top edge (the mark's "data end") and a
 * square baseline-side edge — only the topmost, outward-facing segment of a stack
 * gets the rounded corners; interior segments stay square and rely on the 2px
 * surface gap to read as distinct. */
function roundedTopRectPath(x: number, yTop: number, width: number, height: number, radius: number): string {
  if (height <= 0) return "";
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r === 0) return `M ${x},${yTop} h ${width} v ${height} h ${-width} Z`;
  return (
    `M ${x},${yTop + height} L ${x},${yTop + r} Q ${x},${yTop} ${x + r},${yTop} ` +
    `L ${x + width - r},${yTop} Q ${x + width},${yTop} ${x + width},${yTop + r} ` +
    `L ${x + width},${yTop + height} Z`
  );
}

function IconPulse({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12h4l2 8 4-16 2 8h8" />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-6 5.5-6" />
      <circle cx="17" cy="9.5" r="2.6" />
      <path d="M14.5 14.2c2.6.3 4.5 2.5 4.5 5.3" />
    </svg>
  );
}

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconTrophy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a3 3 0 0 0 3.5 5.5M17 5h3a3 3 0 0 1-3.5 5.5" />
      <path d="M12 13v3M9 20h6M10 17h4v3h-4z" />
    </svg>
  );
}

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === "page_view") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    );
  }
  if (type === "click") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 3l6 16 2.5-6.5L20 10 5 3Z" />
      </svg>
    );
  }
  if (type === "stock_view") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-9" />
        <path d="M15 6h6v6" />
      </svg>
    );
  }
  return null;
}

interface Series {
  path: string;
  label: string;
  colorVar: string;
  values: number[];
  total: number;
}

const RANK_MEDAL: Record<number, { fill: string; glow: string }> = {
  1: { fill: "#f4c53a", glow: "rgba(244, 197, 58, 0.45)" },
  2: { fill: "#c7ccd6", glow: "rgba(199, 204, 214, 0.4)" },
  3: { fill: "#d38a53", glow: "rgba(211, 138, 83, 0.4)" },
};

function MedalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h10l-3.3 8.4h-3.4L7 2Z" fill="currentColor" opacity="0.5" />
      <circle cx="12" cy="15" r="7.2" fill="currentColor" />
      <circle cx="12" cy="15" r="3.6" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
    </svg>
  );
}

export default function AdminDashboardPage() {
  useDocumentTitle("관리자 대시보드 | K-Stock Hub");
  const [authed] = useState(() => !!getStoredSession());
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [range, setRange] = useState<AdminTrendRange>("3h");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [pagesTop, setPagesTop] = useState<PageCount[] | null>(null);
  const [stocksTop, setStocksTop] = useState<StockSearchCount[] | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [tail, setTail] = useState<ActivityEvent[] | null>(null);
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeLegend, setActiveLegend] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  function handleAuthError(err: unknown) {
    if (err instanceof AdminAuthError) {
      clearStoredSession();
      navigate("/admin");
    }
  }

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .summary()
        .then((s) => !cancelled && setSummary(s))
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .trend(range)
        .then((r) => {
          if (cancelled) return;
          setTrendPoints(r.points);
          setTrendLoaded(true);
        })
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, range]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      Promise.all([adminApi.pagesTop(10), adminApi.stocksTop(10)])
        .then(([pages, stocks]) => {
          if (cancelled) return;
          setPagesTop(pages.items);
          setStocksTop(stocks.items);
        })
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .sessions()
        .then((r) => !cancelled && setSessions(r.sessions))
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .tail(150)
        .then((r) => {
          if (cancelled) return;
          setTail(r.events);
          setLastUpdated(new Date());
        })
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 3_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .comments(200)
        .then((r) => !cancelled && setComments(r.items))
        .catch(handleAuthError);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  function handleDeleteComment(c: AdminComment) {
    const key = `${c.source}-${c.id}`;
    if (deletingKey === key) return;
    if (!window.confirm("이 댓글을 삭제하시겠습니까? 삭제한 댓글은 복구할 수 없습니다.")) return;
    setDeletingKey(key);
    adminApi
      .deleteComment(c.source as CommentSource, c.id)
      .then(() => setComments((prev) => (prev ? prev.filter((x) => !(x.source === c.source && x.id === c.id)) : prev)))
      .catch(handleAuthError)
      .finally(() => setDeletingKey(null));
  }

  function handleToggleVisibility(c: AdminComment) {
    const key = `${c.source}-${c.id}`;
    if (deletingKey === key) return;
    const nextVisible = !c.visible;
    setComments((prev) =>
      prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: nextVisible } : x)) : prev
    );
    adminApi.setCommentVisibility(c.source as CommentSource, c.id, nextVisible).catch((err) => {
      handleAuthError(err);
      // Roll back the optimistic flip if the request failed.
      setComments((prev) =>
        prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: c.visible } : x)) : prev
      );
    });
  }

  function toggleCommentExpanded(key: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const { series, categories, maxCount } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of trendPoints) totals.set(p.path, (totals.get(p.path) ?? 0) + p.count);
    const orderedPaths = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
    const topPaths = orderedPaths.slice(0, SERIES_VARS.length);
    const otherPaths = orderedPaths.slice(SERIES_VARS.length);
    const buckets = buildTimeline(range, new Date());

    // O(1) per-point lookup — the 24h view backfills 1,440 one-minute buckets,
    // so an O(n) `.find()` per (path, bucket) pair would mean over a million
    // scans across a handful of series.
    const valueMap = new Map<string, number>();
    for (const p of trendPoints) valueMap.set(`${p.path} ${p.bucket}`, p.count);
    const valueOf = (path: string, bucket: string) => valueMap.get(`${path} ${bucket}`) ?? 0;

    const seriesData: Series[] = topPaths.map((path, i) => ({
      path,
      label: pageLabel(path),
      colorVar: SERIES_VARS[i],
      values: buckets.map((b) => valueOf(path, b)),
      total: totals.get(path) ?? 0,
    }));
    if (otherPaths.length > 0) {
      const otherTotal = otherPaths.reduce((sum, path) => sum + (totals.get(path) ?? 0), 0);
      seriesData.push({
        path: "__other__",
        label: "기타",
        colorVar: "--text-muted",
        values: buckets.map((b) => otherPaths.reduce((sum, path) => sum + valueOf(path, b), 0)),
        total: otherTotal,
      });
    }
    // Stacked-bar max is the tallest *summed* bucket, not the tallest single series —
    // otherwise stacked bars would overflow the chart's top edge.
    const maxCount = Math.max(1, ...buckets.map((_, i) => seriesData.reduce((sum, s) => sum + s.values[i], 0)));
    return { series: seriesData, categories: buckets, maxCount };
  }, [trendPoints, range]);

  if (!authed) return null;

  const visibleSeries = series.filter((s) => !hiddenSeries.has(s.path));

  // Fixed 1-week ranking (see adminApi.pagesTop/stocksTop) — independent of the
  // chart's own `range` toggle, and colored from the same fixed categorical set
  // as the chart for a consistent page-identity language across the dashboard.
  const rankedPages = (pagesTop ?? []).map((p, i) => ({
    key: p.path,
    label: pageLabel(p.path),
    colorVar: SERIES_VARS[i % SERIES_VARS.length],
    count: p.count,
  }));
  const topPageCount = rankedPages[0]?.count ?? 0;
  const topStockCount = stocksTop?.[0]?.count ?? 0;

  // A 2:1 canvas — close to how wide the 60%-width chart column ends up next to
  // the trend panel's flexed height (~50% of the page, see .admin-panel--trend /
  // .admin-trend-chart-wrap) at typical desktop sizes, so the chart fills that
  // tall wrapper with only slight letterboxing rather than a lot of dead space
  // above/below it.
  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 16, bottom: 32, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const xStep = categories.length > 1 ? innerW / (categories.length - 1) : 0;
  const xAt = (i: number) => padding.left + i * xStep;
  // 8% headroom at the top so the tallest stacked bar never touches the chart edge.
  const yAt = (v: number) => padding.top + innerH * (1 - (v / maxCount) * 0.92);
  const yTicks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCount * f)))];
  const tickStride = Math.max(1, Math.ceil(categories.length / 6));

  // Bar mark spec: capped at 24px thick, with a 2px surface gap separating adjacent
  // bars — dropped once a bucket's slot is too narrow to fit a visible gap (dense
  // per-minute ranges), where bars simply sit flush like a fine-grained histogram.
  const barSlot = xStep > 0 ? xStep : innerW;
  const barGapPx = barSlot > 6 ? 2 : 0;
  const barWidth = Math.max(1, Math.min(24, barSlot - barGapPx));
  const barCornerR = barWidth >= 6 ? Math.min(4, barWidth / 2) : 0;

  return (
    <div className="admin-dash-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          <Link to="/sp500-map" className="kospi-map-nav-link kospi-map-nav-link--sp500">
            <MarketIcon /> S&P500
          </Link>
          <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq">
            <MarketIcon /> NASDAQ100
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> 시총대결
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
        </div>
      </header>

      <header className="admin-dash-header">
        <div>
          <h1 className="admin-dash-title">
            <span className="admin-dash-title-icon">⚙</span> Admin Dashboard
          </h1>
          <p className="admin-dash-subtitle">
            K-Stock Hub 방문자 · 페이지 · 종목 조회 현황
            {lastUpdated && (
              <span className="admin-dash-updated">
                <span className="admin-live-dot" /> {formatClock(lastUpdated.toISOString())} 갱신
              </span>
            )}
          </p>
        </div>
        <button
          className="admin-logout-btn"
          onClick={() => {
            clearStoredSession();
            navigate("/admin");
          }}
        >
          로그아웃
        </button>
      </header>

      <div className="admin-stats-row">
        <div className="admin-stat-tile admin-stat-tile--good">
          <span className="admin-stat-icon">
            <IconPulse />
          </span>
          <div className="admin-stat-body">
            <span className="admin-stat-label">현재 접속중</span>
            {summary ? (
              <span className="admin-stat-value">{summary.online_now.toLocaleString()}</span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
        <div className="admin-stat-tile admin-stat-tile--blue">
          <span className="admin-stat-icon">
            <IconUsers />
          </span>
          <div className="admin-stat-body">
            <span className="admin-stat-label">누적 방문</span>
            {summary ? (
              <span className="admin-stat-value">{summary.total_visits.toLocaleString()}</span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
        <div className="admin-stat-tile admin-stat-tile--aqua">
          <span className="admin-stat-icon">
            <IconEye />
          </span>
          <div className="admin-stat-body">
            <span className="admin-stat-label">최근 24시간 조회수</span>
            {summary ? (
              <span className="admin-stat-value">{summary.views_last_24h.toLocaleString()}</span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
        <div className="admin-stat-tile admin-stat-tile--violet">
          <span className="admin-stat-icon">
            <IconTrophy />
          </span>
          <div className="admin-stat-body">
            <span className="admin-stat-label">TOP 페이지</span>
            {summary ? (
              <span className="admin-stat-value admin-stat-value--sm">
                {summary.top_pages[0] ? pageLabel(summary.top_pages[0].path) : "-"}
              </span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
      </div>

      <section className="admin-panel admin-panel--trend">
        <div className="admin-panel-head">
          <h2>페이지별 접속 추이</h2>
          <div className="admin-range-toggle">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={range === opt.value ? "active" : ""}
                onClick={() => setRange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-trend-layout">
        <div className="admin-trend-main">
        {!trendLoaded ? (
          <div className="admin-skeleton admin-skeleton--chart" />
        ) : series.length === 0 ? (
          <p className="admin-empty">아직 수집된 데이터가 없습니다.</p>
        ) : (
          <div className="admin-trend-chart-wrap">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="admin-trend-svg"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = ((e.clientX - rect.left) / rect.width) * width;
                const idx = xStep > 0 ? Math.round((mouseX - padding.left) / xStep) : 0;
                setHoverIndex(Math.min(Math.max(idx, 0), categories.length - 1));
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={yAt(t)}
                    y2={yAt(t)}
                    stroke="var(--gridline)"
                    strokeWidth={1}
                  />
                  <text x={padding.left - 8} y={yAt(t) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                    {formatCount(t)}
                  </text>
                </g>
              ))}
              {categories.map(
                (c, i) =>
                  i % tickStride === 0 && (
                    <text key={c} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                      {formatBucket(c)}
                    </text>
                  )
              )}
              {hoverIndex !== null && (
                <rect
                  x={xAt(hoverIndex) - barWidth / 2 - 3}
                  y={padding.top}
                  width={barWidth + 6}
                  height={innerH}
                  rx={4}
                  fill="color-mix(in srgb, var(--text-primary) 6%, transparent)"
                />
              )}
              {categories.map((c, i) => {
                const stack = visibleSeries.filter((s) => s.values[i] > 0);
                if (stack.length === 0) return null;
                const x = xAt(i) - barWidth / 2;
                let cumulative = 0;
                return (
                  <g key={c} className="admin-trend-series">
                    {stack.map((s, si) => {
                      const y0 = yAt(cumulative);
                      cumulative += s.values[i];
                      const y1 = yAt(cumulative);
                      const isTop = si === stack.length - 1;
                      const topY = isTop ? y1 : y1 + barGapPx;
                      const segH = Math.max(0, y0 - topY);
                      const dimmed = activeLegend !== null && activeLegend !== s.path;
                      const d = isTop
                        ? roundedTopRectPath(x, topY, barWidth, segH, barCornerR)
                        : `M ${x},${topY} h ${barWidth} v ${segH} h ${-barWidth} Z`;
                      return <path key={s.path} d={d} fill={`var(${s.colorVar})`} opacity={dimmed ? 0.18 : 1} />;
                    })}
                  </g>
                );
              })}
            </svg>
            {hoverIndex !== null && visibleSeries.length > 0 && (
              <div
                className="admin-trend-tooltip"
                style={{
                  left: `${(xAt(hoverIndex) / width) * 100}%`,
                  transform:
                    hoverIndex / categories.length > 0.7 ? "translateX(-100%)" : "translateX(-8px)",
                }}
              >
                <div className="admin-trend-tooltip-date">{categories[hoverIndex]}</div>
                {[...visibleSeries]
                  .sort((a, b) => b.values[hoverIndex] - a.values[hoverIndex])
                  .map((s) => (
                    <div key={s.path} className="admin-trend-tooltip-row">
                      <span className="admin-trend-tooltip-key" style={{ background: `var(${s.colorVar})` }} />
                      <span className="admin-trend-tooltip-value">{s.values[hoverIndex]}</span>
                      <span className="admin-trend-tooltip-label">{s.label}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        {series.length > 0 && (
          <div className="admin-trend-legend">
            {series.map((s) => {
              const hidden = hiddenSeries.has(s.path);
              return (
                <button
                  key={s.path}
                  className={`admin-trend-legend-item${hidden ? " admin-trend-legend-item--hidden" : ""}`}
                  onMouseEnter={() => setActiveLegend(s.path)}
                  onMouseLeave={() => setActiveLegend(null)}
                  onClick={() =>
                    setHiddenSeries((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.path)) next.delete(s.path);
                      else next.add(s.path);
                      return next;
                    })
                  }
                >
                  <span className="admin-trend-legend-dot" style={{ background: `var(${s.colorVar})` }} />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
        </div>

        <div className="admin-trend-toppages">
          <h3 className="admin-trend-toppages-title">TOP 10 페이지 (7일 누적)</h3>
          {pagesTop === null ? (
            <div className="admin-toppages-list">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="admin-toppages-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            </div>
          ) : rankedPages.length === 0 ? (
            <p className="admin-empty">아직 수집된 데이터가 없습니다.</p>
          ) : (
            <div className="admin-toppages-list">
              {rankedPages.map((p, i) => {
                const rank = i + 1;
                const medal = RANK_MEDAL[rank];
                const pct = topPageCount > 0 ? (p.count / topPageCount) * 100 : 0;
                return (
                  <div key={p.key} className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}>
                    {medal ? (
                      <span
                        className="admin-toppages-rank admin-toppages-rank--medal"
                        style={{ color: medal.fill, filter: `drop-shadow(0 0 4px ${medal.glow})` }}
                      >
                        <MedalIcon />
                      </span>
                    ) : (
                      <span className="admin-toppages-rank">{rank}</span>
                    )}
                    <div className="admin-toppages-info">
                      <span className="admin-toppages-label">{p.label}</span>
                      <div className="admin-toppages-bar-track">
                        <div
                          className="admin-toppages-bar-fill"
                          style={{ width: `${Math.max(pct, 3)}%`, background: `var(${p.colorVar})` }}
                        />
                      </div>
                    </div>
                    <span className="admin-toppages-count">{p.count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="admin-trend-topstocks">
          <h3 className="admin-trend-toppages-title">TOP 10 종목검색 (7일 누적)</h3>
          {stocksTop === null ? (
            <div className="admin-toppages-list">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="admin-toppages-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            </div>
          ) : stocksTop.length === 0 ? (
            <p className="admin-empty">아직 검색 기록이 없습니다.</p>
          ) : (
            <div className="admin-toppages-list">
              {stocksTop.map((s, i) => {
                const rank = i + 1;
                const medal = RANK_MEDAL[rank];
                const pct = topStockCount > 0 ? (s.count / topStockCount) * 100 : 0;
                return (
                  <div key={s.code} className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}>
                    {medal ? (
                      <span
                        className="admin-toppages-rank admin-toppages-rank--medal"
                        style={{ color: medal.fill, filter: `drop-shadow(0 0 4px ${medal.glow})` }}
                      >
                        <MedalIcon />
                      </span>
                    ) : (
                      <span className="admin-toppages-rank">{rank}</span>
                    )}
                    <div className="admin-toppages-info">
                      <span className="admin-toppages-label admin-toppages-label--stock">
                        <StockIcon code={s.code} className="admin-toppages-stock-icon" />
                        {s.name}
                        <span className="admin-toppages-stock-code">({s.code})</span>
                      </span>
                      <div className="admin-toppages-bar-track">
                        <div
                          className="admin-toppages-bar-fill"
                          style={{ width: `${Math.max(pct, 3)}%`, background: "var(--series-aqua)" }}
                        />
                      </div>
                    </div>
                    <span className="admin-toppages-count">{s.count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </section>

      <div className="admin-panels-grid">
        <div className="admin-left-col">
        <section className="admin-panel admin-panel--sessions">
          <h2>
            <span className="admin-live-dot" /> 실시간 세션 {sessions !== null && `(${sessions.length})`}
          </h2>
          <div className="admin-sessions-table">
            <div className="admin-sessions-row admin-sessions-row--head">
              <span>세션</span>
              <span>현재 페이지</span>
              <span>조회 종목</span>
              <span>마지막 활동</span>
            </div>
            {sessions === null &&
              [0, 1, 2].map((i) => (
                <div key={i} className="admin-sessions-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            {sessions?.map((s) => (
              <div key={s.session_id} className="admin-sessions-row">
                <span className="admin-session-id">
                  <span
                    className="admin-session-avatar"
                    style={{ background: `var(${avatarColorVar(s.session_id)})` }}
                  >
                    {initials(s.session_id)}
                  </span>
                  {shortSession(s.session_id)}
                </span>
                <span>{pageLabel(s.path)}</span>
                <span className="admin-session-stock">
                  {s.stock_code ? (
                    <>
                      <StockIcon code={s.stock_code} className="admin-session-stock-icon" />
                      {s.stock_name}
                      <span className="admin-session-stock-code">({s.stock_code})</span>
                    </>
                  ) : (
                    <span className="admin-session-stock-none">-</span>
                  )}
                </span>
                <span className="admin-session-time">{timeAgo(s.last_seen)}</span>
              </div>
            ))}
            {sessions?.length === 0 && <p className="admin-empty">활성 세션이 없습니다.</p>}
          </div>
        </section>

        <section className="admin-panel admin-panel--comments">
          <h2>댓글 관리 {comments !== null && `(${comments.length})`}</h2>
          <div className="admin-comments-table">
            <div className="admin-comments-row admin-comments-row--head">
              <span>번호</span>
              <span>종목명</span>
              <span>댓글 내용</span>
              <span>작성일시</span>
              <span>전시여부</span>
              <span></span>
            </div>
            {comments === null &&
              [0, 1, 2].map((i) => (
                <div key={i} className="admin-comments-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            {comments?.map((c) => {
              const key = `${c.source}-${c.id}`;
              const { preview, truncated } = truncateComment(c.text);
              const expanded = expandedComments.has(key);
              return (
                <div key={key} className="admin-comments-row-group">
                  <div className="admin-comments-row">
                    <span className="admin-comments-id">{c.id}</span>
                    <span className="admin-comments-stock">{c.stock_name}</span>
                    {truncated ? (
                      <button
                        type="button"
                        className="admin-comments-text admin-comments-text--clickable"
                        aria-expanded={expanded}
                        onClick={() => toggleCommentExpanded(key)}
                      >
                        {preview}
                      </button>
                    ) : (
                      <span className="admin-comments-text">{preview}</span>
                    )}
                    <span className="admin-comments-time">{formatDateTime(c.created_at)}</span>
                    <button
                      type="button"
                      className={`admin-comments-visibility-btn${c.visible ? "" : " admin-comments-visibility-btn--hidden"}`}
                      onClick={() => handleToggleVisibility(c)}
                    >
                      {c.visible ? "전시" : "미전시"}
                    </button>
                    <button
                      type="button"
                      className="admin-comments-delete-btn"
                      disabled={deletingKey === key}
                      onClick={() => handleDeleteComment(c)}
                    >
                      삭제
                    </button>
                  </div>
                  {expanded && <div className="admin-comments-detail-row">{c.text}</div>}
                </div>
              );
            })}
            {comments?.length === 0 && <p className="admin-empty">등록된 댓글이 없습니다.</p>}
          </div>
        </section>
        </div>

        <section className="admin-panel admin-panel--tail">
          <h2>
            <span className="admin-live-dot" /> 실시간 로그
          </h2>
          <div className="admin-tail-list">
            {tail === null &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="admin-tail-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            {tail?.map((e) => {
              const meta = TYPE_META[e.type] ?? { label: e.type, colorVar: "--text-muted" };
              return (
                <div key={e.id} className="admin-tail-row">
                  <span className="admin-tail-time">{formatClock(e.created_at)}</span>
                  <span className="admin-tail-session">{shortSession(e.session_id)}</span>
                  <span className="admin-tail-badge" style={{ color: `var(${meta.colorVar})`, borderColor: `var(${meta.colorVar})` }}>
                    <TypeIcon type={e.type} className="admin-tail-badge-icon" />
                    {meta.label}
                  </span>
                  <span className="admin-tail-detail">
                    {e.type === "stock_view" && e.stock_code ? (
                      <>
                        <StockIcon code={e.stock_code} className="admin-tail-stock-icon" />
                        {e.stock_name} ({e.stock_code})
                      </>
                    ) : e.label ? (
                      `${pageLabel(e.path)} · ${e.label}`
                    ) : (
                      pageLabel(e.path)
                    )}
                  </span>
                </div>
              );
            })}
            {tail?.length === 0 && <p className="admin-empty">이벤트를 기다리는 중...</p>}
          </div>
        </section>
      </div>

      <Footer />
    </div>
  );
}
