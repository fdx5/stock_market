import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdminAuthError,
  AdminSummary,
  AdminTrendRange,
  HubAction,
  HubObjectCount,
  HubSummary,
  HubTrendPoint,
  PageCount,
  StockSearchCount,
  TrendPoint,
  VisitorTrendPoint,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { Link, navigate } from "../router";
import { pageLabel } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import AdminCommentsPanel from "./AdminCommentsPanel";
import AdminOpsPanel from "./AdminOpsPanel";
import DbIcon from "./DbIcon";
import LiveSessionsAndLog, { LiveStatus } from "./LiveSessionsAndLog";
import MonitorIcon from "./MonitorIcon";
import StockLogo from "./StockLogo";
import "./adminLive.css";
import "./adminDashboard.css";

/* Admin dashboard — 실시간 / 운영 / 댓글 3탭. 실시간 세션·로그는 LiveSessionsAndLog로
 * 위임하고, 운영(배치·메일·카카오)은 AdminOpsPanel, 댓글은 AdminCommentsPanel이 각자의
 * 데이터·폴링을 소유한다. 이 파일은 탭 셸과 요약 지표 + 방문 추이 차트만 갖는다. */

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

/** Minimum searches for a stock to appear in the ranking at all. */
const STOCK_RANK_MIN_COUNT = 10;

/* What each kind of main-page interaction is called on screen. The keys are
   activity.py's _VALID_HUB_ACTIONS — anything added there and not here falls
   back to the raw key, which reads as obviously missing rather than quietly
   mislabelled. */
const HUB_ACTION_LABEL: Record<HubAction, string> = {
  object_click: "천체 클릭",
  control: "조작",
  bgm: "BGM",
  focus: "주목",
  dwell: "체류",
  exit: "이동",
};

/** Bar colour per action, so a kind of interaction keeps the same colour
 * wherever it appears — the chart's series and this ranking's bars. */
const HUB_ACTION_COLOR: Record<HubAction, string> = {
  object_click: "--series-violet",
  control: "--series-blue",
  bgm: "--series-aqua",
  focus: "--series-amber",
  dwell: "--text-muted",
  exit: "--series-green",
};

const HUB_RANK_FILTERS: { key: HubAction | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "object_click", label: "천체" },
  { key: "control", label: "조작" },
  { key: "focus", label: "주목" },
  { key: "bgm", label: "BGM" },
  { key: "exit", label: "이동" },
];

/** Seconds as something a person reads at a glance. Under a minute stays in
 * seconds — "0분 42초" is worse than "42초" — and past an hour the seconds stop
 * carrying information. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}분 ${total % 60}초`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
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

type Pt = { x: number; y: number };

/** Monotone cubic (Fritsch–Carlson) interpolation through the points — the same
 * curve d3's `curveMonotoneX` draws. Chosen over a plain Catmull-Rom because it's
 * shape-preserving: the smoothed line never overshoots below a local minimum, so
 * stacked-area boundaries can't dip past their own data and cross into the band
 * beneath them. Returns an SVG path starting with a single `M`. */
function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const tan: number[] = new Array(n);
  tan[0] = slope[0];
  tan[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tan[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tan[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d +=
      ` C ${pts[i].x + h},${pts[i].y + tan[i] * h}` +
      ` ${pts[i + 1].x - h},${pts[i + 1].y - tan[i + 1] * h}` +
      ` ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/** A filled stacked-area band: the smooth upper boundary drawn left→right, then the
 * smooth lower boundary drawn right→left and closed — so the two curves enclose the
 * band without a straight seam. */
function areaBandPath(upper: Pt[], lower: Pt[]): string {
  if (upper.length === 0) return "";
  const top = monotonePath(upper);
  const bottomReversed = monotonePath([...lower].reverse());
  // Swap the reversed lower path's leading `M` for an `L` so it continues the top
  // path instead of starting a new subpath.
  return `${top} L${bottomReversed.slice(1)} Z`;
}

function IconArea({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15l5-6 4 3 4-6 5 4v8H3z" />
    </svg>
  );
}

function IconBars({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 20V10M12 20V4M19 20v-7" />
    </svg>
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

type Tab = "live" | "ops" | "comments";
const TABS: { key: Tab; label: string }[] = [
  { key: "live", label: "실시간" },
  { key: "ops", label: "운영" },
  { key: "comments", label: "댓글" },
];

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
}

export default function AdminDashboardPage() {
  useDocumentTitle("Admin Dashboard · K-Stock Hub");
  const [authed] = useState(() => !!getStoredSession());
  const [tab, setTab] = useState<Tab>("live");

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  function handleAuthError(err: unknown) {
    if (err instanceof AdminAuthError) {
      clearStoredSession();
      navigate("/admin");
    }
  }

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [range, setRange] = useState<AdminTrendRange>("3h");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [visitorPoints, setVisitorPoints] = useState<VisitorTrendPoint[]>([]);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [trendMetric, setTrendMetric] = useState<"pages" | "visitors" | "hub">("pages");
  const [hubPoints, setHubPoints] = useState<HubTrendPoint[]>([]);
  const [hubSummary, setHubSummary] = useState<HubSummary | null>(null);
  const [hubObjects, setHubObjects] = useState<HubObjectCount[] | null>(null);
  const [hubRankAction, setHubRankAction] = useState<HubAction | "all">("all");
  const [pagesTop, setPagesTop] = useState<PageCount[] | null>(null);
  const [stocksTop, setStocksTop] = useState<StockSearchCount[] | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeLegend, setActiveLegend] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [chartMode, setChartMode] = useState<"area" | "bars">("area");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ lastUpdated: null, connectionOk: true });

  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState({ width: 760, height: 247 });
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setChartSize((prev) =>
          Math.round(width) === prev.width && Math.round(height) === prev.height ? prev : { width: Math.round(width), height: Math.round(height) }
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi.summary().then((s) => !cancelled && setSummary(s)).catch(handleAuthError);
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
      Promise.all([adminApi.trend(range), adminApi.visitorTrend(range), adminApi.hubTrend(range), adminApi.hubSummary(range)])
        .then(([pages, visitors, hub, hubStats]) => {
          if (cancelled) return;
          setTrendPoints(pages.points);
          setVisitorPoints(visitors.points);
          setHubPoints(hub.points);
          setHubSummary(hubStats);
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
      Promise.all([adminApi.pagesTop(200), adminApi.stocksTop(500), adminApi.hubObjectsTop(300)])
        .then(([pages, stocks, hub]) => {
          if (cancelled) return;
          setPagesTop(pages.items);
          setStocksTop(stocks.items);
          setHubObjects(hub.items);
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

  const { series, categories, maxCount } = useMemo(() => {
    const buckets = buildTimeline(range, new Date());

    if (trendMetric === "visitors") {
      const valueMap = new Map<string, number>();
      for (const p of visitorPoints) valueMap.set(p.bucket, p.count);
      const values = buckets.map((b) => valueMap.get(b) ?? 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      const seriesData: Series[] = [{ path: "__visitors__", label: "방문자수", colorVar: "--series-violet", values, total }];
      return { series: seriesData, categories: buckets, maxCount: Math.max(1, ...values) };
    }

    if (trendMetric === "hub") {
      const valueMap = new Map<string, number>();
      const totals = new Map<HubAction, number>();
      for (const p of hubPoints) {
        if (p.action === "dwell") continue;
        valueMap.set(`${p.action}${p.bucket}`, p.count);
        totals.set(p.action, (totals.get(p.action) ?? 0) + p.count);
      }
      const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([action]) => action);
      const seriesData: Series[] = ordered.map((action, i) => ({
        path: action,
        label: HUB_ACTION_LABEL[action] ?? action,
        colorVar: SERIES_VARS[i % SERIES_VARS.length],
        values: buckets.map((b) => valueMap.get(`${action}${b}`) ?? 0),
        total: totals.get(action) ?? 0,
      }));
      const maxCount = Math.max(1, ...buckets.map((_, i) => seriesData.reduce((sum, s) => sum + s.values[i], 0)));
      return { series: seriesData, categories: buckets, maxCount };
    }

    const totals = new Map<string, number>();
    for (const p of trendPoints) totals.set(p.path, (totals.get(p.path) ?? 0) + p.count);
    const orderedPaths = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
    const topPaths = orderedPaths.slice(0, SERIES_VARS.length);
    const otherPaths = orderedPaths.slice(SERIES_VARS.length);

    const valueMap = new Map<string, number>();
    for (const p of trendPoints) valueMap.set(`${p.path}${p.bucket}`, p.count);
    const valueOf = (path: string, bucket: string) => valueMap.get(`${path}${bucket}`) ?? 0;

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
    const maxCount = Math.max(1, ...buckets.map((_, i) => seriesData.reduce((sum, s) => sum + s.values[i], 0)));
    return { series: seriesData, categories: buckets, maxCount };
  }, [trendPoints, visitorPoints, hubPoints, range, trendMetric]);

  const { width, height } = chartSize;
  const padding = { top: 22, right: 16, bottom: 32, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const xStep = categories.length > 1 ? innerW / (categories.length - 1) : 0;
  const xAt = (i: number) => padding.left + i * xStep;
  const yAt = (v: number) => padding.top + innerH * (1 - (v / maxCount) * 0.92);
  const yTicks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCount * f)))];
  const tickStride = Math.max(1, Math.ceil(categories.length / 6));

  const barSlot = xStep > 0 ? xStep : innerW;
  const barGapPx = barSlot > 6 ? 2 : 0;
  const barWidth = Math.max(1, Math.min(24, barSlot - barGapPx));
  const barCornerR = barWidth >= 6 ? Math.min(4, barWidth / 2) : 0;

  const chartGeom = useMemo(() => {
    const n = categories.length;
    const vis = series.filter((s) => !hiddenSeries.has(s.path));
    const totals = categories.map((_, i) => vis.reduce((sum, s) => sum + s.values[i], 0));
    let peakIdx = 0;
    for (let i = 1; i < n; i++) if (totals[i] > totals[peakIdx]) peakIdx = i;
    const grandTotal = totals.reduce((a, b) => a + b, 0);

    const bands: { path: string; label: string; colorVar: string; fill: string; stroke: string; topPts: Pt[]; values: number[] }[] = [];
    if (chartMode === "area") {
      const cum = new Array(n).fill(0);
      for (const s of vis) {
        const upper: Pt[] = [];
        const lower: Pt[] = [];
        for (let i = 0; i < n; i++) {
          const lo = cum[i];
          const hi = lo + s.values[i];
          cum[i] = hi;
          lower.push({ x: xAt(i), y: yAt(lo) });
          upper.push({ x: xAt(i), y: yAt(hi) });
        }
        bands.push({ path: s.path, label: s.label, colorVar: s.colorVar, fill: areaBandPath(upper, lower), stroke: monotonePath(upper), topPts: upper, values: s.values });
      }
    }

    const bars: { path: string; colorVar: string; d: string }[] = [];
    if (chartMode === "bars") {
      for (let i = 0; i < n; i++) {
        const stack = vis.filter((s) => s.values[i] > 0);
        const x = xAt(i) - barWidth / 2;
        let cumulative = 0;
        stack.forEach((s, si) => {
          const y0 = yAt(cumulative);
          cumulative += s.values[i];
          const y1 = yAt(cumulative);
          const isTop = si === stack.length - 1;
          const topY = isTop ? y1 : y1 + barGapPx;
          const segH = Math.max(0, y0 - topY);
          const d = isTop ? roundedTopRectPath(x, topY, barWidth, segH, barCornerR) : `M ${x},${topY} h ${barWidth} v ${segH} h ${-barWidth} Z`;
          bars.push({ path: s.path, colorVar: s.colorVar, d });
        });
      }
    }

    return { bands, bars, totals, peakIdx, grandTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, hiddenSeries, categories, maxCount, chartMode, width, height]);

  if (!authed) return null;

  const visibleSeries = series.filter((s) => !hiddenSeries.has(s.path));
  const gradientVars = [...new Set(visibleSeries.map((s) => s.colorVar))];
  const gradId = (colorVar: string) => `admtg-${colorVar.replace(/[^a-z0-9]/gi, "")}`;
  const peakTotal = chartGeom.totals[chartGeom.peakIdx] ?? 0;

  const rankedPages = (pagesTop ?? []).map((p, i) => ({
    key: p.path,
    label: pageLabel(p.path),
    colorVar: SERIES_VARS[i % SERIES_VARS.length],
    count: p.count,
  }));
  const topPageCount = rankedPages[0]?.count ?? 0;

  const rankedStocks = (stocksTop ?? []).filter((s) => s.count >= STOCK_RANK_MIN_COUNT);
  const topStockCount = rankedStocks[0]?.count ?? 0;

  const rankedHub = (hubObjects ?? [])
    .filter((h) => h.action !== "dwell" && (hubRankAction === "all" || h.action === hubRankAction))
    .sort((a, b) => b.sessions - a.sessions || b.count - a.count);
  const topHubSessions = rankedHub[0]?.sessions ?? 0;

  return (
    <div className="admin-dash-page">
      <header className="admin-dash-header">
        <Link to="/" className="admin-dash-brand">
          K-Stock Hub Admin
        </Link>
        <nav className="admin-dash-subnav">
          <Link to="/admin/growth">📈 성장 통계</Link>
          <Link to="/admin/db">
            <DbIcon /> DB 조회
          </Link>
          <Link to="/admin/monitor">
            <MonitorIcon /> 모니터링
          </Link>
        </nav>
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

      <nav className="admin-dash-tabs" role="tablist" aria-label="관리자 화면">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "live" && (
        <div className="admin-live-tab">
          <div className="admin-stats-row">
            <div className="admin-stat-tile admin-stat-tile--good">
              <span className="admin-stat-icon">
                <IconPulse />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">현재 접속중</span>
                {summary ? <span className="admin-stat-value">{summary.online_now.toLocaleString()}</span> : <span className="admin-skeleton admin-skeleton--value" />}
              </div>
            </div>
            <div className="admin-stat-tile admin-stat-tile--blue">
              <span className="admin-stat-icon">
                <IconUsers />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">누적 방문</span>
                {summary ? <span className="admin-stat-value">{summary.total_visits.toLocaleString()}</span> : <span className="admin-skeleton admin-skeleton--value" />}
              </div>
            </div>
            <div className="admin-stat-tile admin-stat-tile--aqua">
              <span className="admin-stat-icon">
                <IconEye />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">최근 24시간 조회수</span>
                {summary ? <span className="admin-stat-value">{summary.views_last_24h.toLocaleString()}</span> : <span className="admin-skeleton admin-skeleton--value" />}
              </div>
            </div>
            <div className="admin-stat-tile admin-stat-tile--violet">
              <span className="admin-stat-icon">
                <IconTrophy />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">TOP 페이지</span>
                {summary ? (
                  <span className="admin-stat-value admin-stat-value--sm">{summary.top_pages[0] ? pageLabel(summary.top_pages[0].path) : "-"}</span>
                ) : (
                  <span className="admin-skeleton admin-skeleton--value" />
                )}
              </div>
            </div>
          </div>

          <div className="admin-stats-row admin-stats-row--hub">
            <div className="admin-stats-rowlabel">
              메인 페이지 행동
              <span className="admin-stats-rowlabel-hint">{RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range} 기준</span>
            </div>
            <div className="admin-stat-tile admin-stat-tile--aqua">
              <span className="admin-stat-icon">
                <IconUsers />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">메인 세션</span>
                {hubSummary ? <span className="admin-stat-value">{hubSummary.sessions.toLocaleString()}</span> : <span className="admin-skeleton admin-skeleton--value" />}
              </div>
            </div>
            <div className="admin-stat-tile admin-stat-tile--good">
              <span className="admin-stat-icon">
                <IconPulse />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">평균 체류 (중앙값)</span>
                {hubSummary ? (
                  <span className="admin-stat-value admin-stat-value--sm">
                    {formatDuration(hubSummary.dwell.median_seconds)}
                    <span className="admin-stat-sub">평균 {formatDuration(hubSummary.dwell.avg_seconds)}</span>
                  </span>
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
                <span className="admin-stat-label">세션당 클릭</span>
                {hubSummary ? (
                  <span className="admin-stat-value admin-stat-value--sm">
                    {hubSummary.clicks_per_session.toFixed(1)}
                    <span className="admin-stat-sub">천체 {(hubSummary.totals.object_click ?? 0).toLocaleString()}회</span>
                  </span>
                ) : (
                  <span className="admin-skeleton admin-skeleton--value" />
                )}
              </div>
            </div>
            <div className="admin-stat-tile admin-stat-tile--blue">
              <span className="admin-stat-icon">
                <IconEye />
              </span>
              <div className="admin-stat-body">
                <span className="admin-stat-label">BGM 재생</span>
                {hubSummary ? (
                  <span className="admin-stat-value admin-stat-value--sm">
                    {hubSummary.bgm_sessions.toLocaleString()}
                    <span className="admin-stat-sub">{hubSummary.sessions > 0 ? `세션의 ${((hubSummary.bgm_sessions / hubSummary.sessions) * 100).toFixed(0)}%` : "-"}</span>
                  </span>
                ) : (
                  <span className="admin-skeleton admin-skeleton--value" />
                )}
              </div>
            </div>
          </div>

          <section className="admin-panel admin-panel--trend">
            <div className="admin-panel-head">
              <h2>{trendMetric === "visitors" ? "방문자수 추이" : trendMetric === "hub" ? "메인 행동 추이" : "페이지별 접속 추이"}</h2>
              <div className="admin-panel-controls">
                <div className="admin-trend-mode-toggle" role="group" aria-label="표시 항목">
                  <button type="button" className={trendMetric === "pages" ? "active" : ""} onClick={() => setTrendMetric("pages")} aria-pressed={trendMetric === "pages"} title="페이지별 접속 추이">
                    <IconPulse className="admin-trend-mode-icon" />
                    페이지별
                  </button>
                  <button type="button" className={trendMetric === "visitors" ? "active" : ""} onClick={() => setTrendMetric("visitors")} aria-pressed={trendMetric === "visitors"} title="일자별 방문자수">
                    <IconUsers className="admin-trend-mode-icon" />
                    방문자수
                  </button>
                  <button type="button" className={trendMetric === "hub" ? "active" : ""} onClick={() => setTrendMetric("hub")} aria-pressed={trendMetric === "hub"} title="메인 페이지에서 일어난 행동을 시간대별로">
                    <IconTrophy className="admin-trend-mode-icon" />
                    메인 행동
                  </button>
                </div>
                <div className="admin-trend-mode-toggle" role="group" aria-label="차트 형태">
                  <button type="button" className={chartMode === "area" ? "active" : ""} onClick={() => setChartMode("area")} aria-pressed={chartMode === "area"} title="영역 차트">
                    <IconArea className="admin-trend-mode-icon" />
                    영역
                  </button>
                  <button type="button" className={chartMode === "bars" ? "active" : ""} onClick={() => setChartMode("bars")} aria-pressed={chartMode === "bars"} title="막대 차트">
                    <IconBars className="admin-trend-mode-icon" />
                    막대
                  </button>
                </div>
                <div className="admin-range-toggle">
                  {RANGE_OPTIONS.map((opt) => (
                    <button key={opt.value} className={range === opt.value ? "active" : ""} onClick={() => setRange(opt.value)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="admin-trend-layout">
              <div className="admin-trend-main">
                {!trendLoaded ? (
                  <div className="admin-skeleton admin-skeleton--chart" />
                ) : series.length === 0 ? (
                  <p className="admin-empty">아직 수집된 데이터가 없습니다.</p>
                ) : (
                  <>
                    <div className="admin-trend-summary">
                      <div className="admin-trend-summary-item">
                        <span className="admin-trend-summary-label">범위 합계</span>
                        <span className="admin-trend-summary-value">{formatCount(chartGeom.grandTotal)}</span>
                      </div>
                      <span className="admin-trend-summary-divider" />
                      <div className="admin-trend-summary-item">
                        <span className="admin-trend-summary-label">피크</span>
                        <span className="admin-trend-summary-value">{formatCount(peakTotal)}</span>
                        {categories[chartGeom.peakIdx] && <span className="admin-trend-summary-sub">{formatBucket(categories[chartGeom.peakIdx])}</span>}
                      </div>
                    </div>
                    <div className="admin-trend-chart-wrap" ref={chartWrapRef}>
                      <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className={`admin-trend-svg admin-trend-svg--${chartMode}`}
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const mouseX = ((e.clientX - rect.left) / rect.width) * width;
                          const idx = xStep > 0 ? Math.round((mouseX - padding.left) / xStep) : 0;
                          setHoverIndex(Math.min(Math.max(idx, 0), categories.length - 1));
                        }}
                        onMouseLeave={() => setHoverIndex(null)}
                      >
                        <defs>
                          {chartMode === "area" &&
                            gradientVars.map((cv) => (
                              <linearGradient key={cv} id={gradId(cv)} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={`var(${cv})`} stopOpacity={0.5} />
                                <stop offset="55%" stopColor={`var(${cv})`} stopOpacity={0.22} />
                                <stop offset="100%" stopColor={`var(${cv})`} stopOpacity={0.06} />
                              </linearGradient>
                            ))}
                        </defs>

                        {yTicks.map((t) => (
                          <g key={t}>
                            <line x1={padding.left} x2={width - padding.right} y1={yAt(t)} y2={yAt(t)} stroke="var(--gridline)" strokeWidth={1} />
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

                        {hoverIndex === null && peakTotal > 0 && categories.length > 1 && (
                          <g className="admin-trend-peak">
                            <circle cx={xAt(chartGeom.peakIdx)} cy={yAt(peakTotal)} r={11} className="admin-trend-peak-halo" />
                            <circle cx={xAt(chartGeom.peakIdx)} cy={yAt(peakTotal)} r={3} className="admin-trend-peak-dot" />
                          </g>
                        )}

                        {hoverIndex !== null && (
                          <>
                            {chartMode === "bars" && (
                              <rect x={xAt(hoverIndex) - barWidth / 2 - 3} y={padding.top} width={barWidth + 6} height={innerH} rx={4} fill="color-mix(in srgb, var(--text-primary) 6%, transparent)" />
                            )}
                            <line className="admin-trend-crosshair" x1={xAt(hoverIndex)} x2={xAt(hoverIndex)} y1={padding.top} y2={padding.top + innerH} />
                          </>
                        )}

                        <g key={`${chartMode}-${range}`} className="admin-trend-marks">
                          {chartMode === "area"
                            ? chartGeom.bands.map((b) => {
                                const dimmed = activeLegend !== null && activeLegend !== b.path;
                                return (
                                  <g key={b.path} className="admin-trend-band" opacity={dimmed ? 0.2 : 1}>
                                    <path d={b.fill} fill={`url(#${gradId(b.colorVar)})`} />
                                    <path d={b.stroke} fill="none" stroke={`var(${b.colorVar})`} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" className="admin-trend-band-stroke" />
                                  </g>
                                );
                              })
                            : chartGeom.bars.map((seg, i) => {
                                const dimmed = activeLegend !== null && activeLegend !== seg.path;
                                return <path key={i} d={seg.d} fill={`var(${seg.colorVar})`} opacity={dimmed ? 0.18 : 1} />;
                              })}
                        </g>

                        {hoverIndex !== null &&
                          chartMode === "area" &&
                          chartGeom.bands.map((b) => {
                            if ((b.values[hoverIndex] ?? 0) <= 0) return null;
                            const pt = b.topPts[hoverIndex];
                            if (!pt) return null;
                            const dimmed = activeLegend !== null && activeLegend !== b.path;
                            return <circle key={b.path} className="admin-trend-dot" cx={pt.x} cy={pt.y} r={3.4} fill={`var(${b.colorVar})`} opacity={dimmed ? 0.25 : 1} />;
                          })}
                      </svg>
                      {hoverIndex !== null && visibleSeries.length > 0 && (
                        <div
                          className="admin-trend-tooltip"
                          style={{ left: `${(xAt(hoverIndex) / width) * 100}%`, transform: hoverIndex / categories.length > 0.7 ? "translateX(-100%)" : "translateX(-8px)" }}
                        >
                          <div className="admin-trend-tooltip-date">{categories[hoverIndex]}</div>
                          {[...visibleSeries]
                            .filter((s) => s.values[hoverIndex] > 0)
                            .sort((a, b) => b.values[hoverIndex] - a.values[hoverIndex])
                            .map((s) => (
                              <div key={s.path} className="admin-trend-tooltip-row">
                                <span className="admin-trend-tooltip-key" style={{ background: `var(${s.colorVar})` }} />
                                <span className="admin-trend-tooltip-value">{s.values[hoverIndex]}</span>
                                <span className="admin-trend-tooltip-label">{s.label}</span>
                              </div>
                            ))}
                          <div className="admin-trend-tooltip-row admin-trend-tooltip-row--total">
                            <span className="admin-trend-tooltip-key admin-trend-tooltip-key--total" />
                            <span className="admin-trend-tooltip-value">{visibleSeries.reduce((sum, s) => sum + s.values[hoverIndex], 0)}</span>
                            <span className="admin-trend-tooltip-label">합계</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
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
                <h3 className="admin-trend-toppages-title">
                  페이지 순위 (7일 누적)
                  <span className="admin-toppages-hint">스크롤하면 전체</span>
                </h3>
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
                  <div className="admin-toppages-list admin-toppages-list--scroll">
                    {rankedPages.map((p, i) => {
                      const rank = i + 1;
                      const medal = RANK_MEDAL[rank];
                      const pct = topPageCount > 0 ? (p.count / topPageCount) * 100 : 0;
                      return (
                        <div key={p.key} className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}>
                          {medal ? (
                            <span className="admin-toppages-rank admin-toppages-rank--medal" style={{ color: medal.fill, filter: `drop-shadow(0 0 4px ${medal.glow})` }}>
                              <MedalIcon />
                            </span>
                          ) : (
                            <span className="admin-toppages-rank">{rank}</span>
                          )}
                          <div className="admin-toppages-info">
                            <span className="admin-toppages-label">{p.label}</span>
                            <div className="admin-toppages-bar-track">
                              <div className="admin-toppages-bar-fill" style={{ width: `${Math.max(pct, 3)}%`, background: `var(${p.colorVar})` }} />
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
                <h3 className="admin-trend-toppages-title">
                  종목검색 순위 (7일 누적)
                  <span className="admin-toppages-hint">10회 이상 · 스크롤하면 전체</span>
                </h3>
                {stocksTop === null ? (
                  <div className="admin-toppages-list">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="admin-toppages-row">
                        <span className="admin-skeleton admin-skeleton--row" />
                      </div>
                    ))}
                  </div>
                ) : rankedStocks.length === 0 ? (
                  <p className="admin-empty">{stocksTop.length === 0 ? "아직 검색 기록이 없습니다." : `${STOCK_RANK_MIN_COUNT}회 이상 검색된 종목이 아직 없습니다.`}</p>
                ) : (
                  <div className="admin-toppages-list admin-toppages-list--scroll">
                    {rankedStocks.map((s, i) => {
                      const rank = i + 1;
                      const medal = RANK_MEDAL[rank];
                      const pct = topStockCount > 0 ? (s.count / topStockCount) * 100 : 0;
                      return (
                        <div key={s.code} className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}>
                          {medal ? (
                            <span className="admin-toppages-rank admin-toppages-rank--medal" style={{ color: medal.fill, filter: `drop-shadow(0 0 4px ${medal.glow})` }}>
                              <MedalIcon />
                            </span>
                          ) : (
                            <span className="admin-toppages-rank">{rank}</span>
                          )}
                          <div className="admin-toppages-info">
                            <span className="admin-toppages-label admin-toppages-label--stock">
                              <StockLogo code={s.code} className="admin-toppages-stock-icon" />
                              {s.name}
                              <span className="admin-toppages-stock-code">({s.code})</span>
                            </span>
                            <div className="admin-toppages-bar-track">
                              <div className="admin-toppages-bar-fill" style={{ width: `${Math.max(pct, 3)}%`, background: "var(--series-aqua)" }} />
                            </div>
                          </div>
                          <span className="admin-toppages-count">{s.count.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="admin-trend-tophub">
                <h3 className="admin-trend-toppages-title">
                  메인 반응 순위 (7일 누적)
                  <span className="admin-toppages-hint">순위는 세션 수 기준 · 스크롤하면 전체</span>
                </h3>
                <div className="admin-hub-rank-filter" role="group" aria-label="반응 종류">
                  {HUB_RANK_FILTERS.map((f) => (
                    <button key={f.key} type="button" className={hubRankAction === f.key ? "active" : ""} onClick={() => setHubRankAction(f.key)} aria-pressed={hubRankAction === f.key}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {hubObjects === null ? (
                  <div className="admin-toppages-list">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="admin-toppages-row">
                        <span className="admin-skeleton admin-skeleton--row" />
                      </div>
                    ))}
                  </div>
                ) : rankedHub.length === 0 ? (
                  <p className="admin-empty">아직 메인 페이지 반응 기록이 없습니다.</p>
                ) : (
                  <div className="admin-toppages-list admin-toppages-list--scroll">
                    {rankedHub.map((h, i) => {
                      const rank = i + 1;
                      const medal = RANK_MEDAL[rank];
                      const pct = topHubSessions > 0 ? (h.sessions / topHubSessions) * 100 : 0;
                      return (
                        <div key={`${h.action}:${h.object_key}`} className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}>
                          {medal ? (
                            <span className="admin-toppages-rank admin-toppages-rank--medal" style={{ color: medal.fill, filter: `drop-shadow(0 0 4px ${medal.glow})` }}>
                              <MedalIcon />
                            </span>
                          ) : (
                            <span className="admin-toppages-rank">{rank}</span>
                          )}
                          <div className="admin-toppages-info">
                            <span className="admin-toppages-label">
                              {h.label}
                              <span className="admin-hub-rank-kind">{HUB_ACTION_LABEL[h.action] ?? h.action}</span>
                            </span>
                            <div className="admin-toppages-bar-track">
                              <div className="admin-toppages-bar-fill" style={{ width: `${Math.max(pct, 3)}%`, background: `var(${HUB_ACTION_COLOR[h.action] ?? "--series-violet"})` }} />
                            </div>
                          </div>
                          <span className="admin-toppages-count">
                            {h.sessions.toLocaleString()}
                            <span className="admin-hub-rank-total">/{h.count.toLocaleString()}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="admin-panel admin-panel--live">
            <div className="admin-panel-head">
              <h2>
                <span className={`admin-live-dot${liveStatus.connectionOk ? "" : " admin-live-dot--off"}`} /> 실시간 세션 · 로그
              </h2>
              <span className="admin-dash-updated">
                {liveStatus.lastUpdated ? (liveStatus.connectionOk ? `${formatClock(liveStatus.lastUpdated.toISOString())} 갱신` : "연결 끊김 · 재시도 중") : "연결 중..."}
              </span>
            </div>
            <LiveSessionsAndLog className="admin-panel--live-embed" onStatus={setLiveStatus} />
          </section>
        </div>
      )}

      {tab === "ops" && <AdminOpsPanel />}
      {tab === "comments" && <AdminCommentsPanel />}
    </div>
  );
}
