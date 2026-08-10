import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActiveSession,
  ActivityEvent,
  AdminAuthError,
  AdminComment,
  AdminSummary,
  AdminTrendRange,
  BatchRegion,
  CommentSource,
  DramPriceStatus,
  HubAction,
  HubObjectCount,
  HubSessionEvent,
  HubSummary,
  HubTrendPoint,
  KakaoDramPriceStatus,
  KakaoPredictionStatus,
  MailSend,
  MailStatus,
  KakaoVisitorStatus,
  PageCount,
  PredictionStatus,
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
import BattleIcon from "./BattleIcon";
import DbIcon from "./DbIcon";
import MonitorIcon from "./MonitorIcon";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import RankIcon from "./RankIcon";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import StockLogo from "./StockLogo";
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

/** Minimum searches for a stock to appear in the ranking at all. */
const STOCK_RANK_MIN_COUNT = 10;

const TYPE_META: Record<string, { label: string; colorVar: string }> = {
  page_view: { label: "이동", colorVar: "--series-blue" },
  click: { label: "클릭", colorVar: "--series-violet" },
  stock_view: { label: "종목조회", colorVar: "--series-aqua" },
};

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

/** How the 60% qualitative layer was produced, as reported per market by
 * ai_analyst (SOURCE_CLAUDE / SOURCE_HEURISTIC). The distinction is the panel's
 * whole reason for showing this: a heuristic run is a *successful* run of a
 * degraded pipeline, so it gets the warning ramp rather than the failure one —
 * nothing is broken, but the analysis is the offline lexicon engine, not Claude. */
const AI_SOURCE_META: Record<string, { label: string; tone: string }> = {
  claude: { label: "Claude", tone: "claude" },
  heuristic: { label: "휴리스틱", tone: "heuristic" },
};

/** A run that skipped a dozen thin-history names would otherwise push the second
 * region's row out of this short panel entirely. */
const WARNING_PREVIEW_COUNT = 2;

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

const PANEL_HEIGHT_KEY_PREFIX = "admin_panel_height:";

/* The width at which the dashboard stops being a multi-column desktop layout and
   becomes one stacked column (see the @media (max-width: 900px) block in
   styles.css). Kept here as well because two behaviours below are not styling and
   cannot live in a media query: a saved panel height is an inline style, which no
   stylesheet rule can outrank, and the per-list drag handle only exists in the
   stacked layout. */
const STACKED_LAYOUT_QUERY = "(max-width: 900px)";

/** Tracks the stacked (phone/tablet) layout so JS-driven sizing can follow the same
 * breakpoint the stylesheet does, and can follow it live — a rotation from portrait
 * to landscape crosses this line without a reload. */
function useStackedLayout() {
  const [stacked, setStacked] = useState(
    () => typeof window !== "undefined" && window.matchMedia(STACKED_LAYOUT_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(STACKED_LAYOUT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setStacked(e.matches);
    setStacked(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return stacked;
}

/** A manually-dragged panel height, persisted to localStorage, driven by a small
 * handle rendered at the panel's own bottom edge (`.admin-panel-resize-handle`) —
 * NOT native CSS `resize`, which a first pass used and which turned out to only work
 * on the one panel (trend) that isn't itself a flex item of a height-distributing
 * parent. Sessions/comments/tail/batch all live inside flex columns
 * (`.admin-left-col`/`.admin-tail-col`) sized by `flex: N 1 0` so siblings split a
 * shared height budget — and a flex item's `flex-grow` keeps recomputing its size on
 * every layout pass, which fights a `resize` drag (that only overrides flex-basis,
 * not flex-grow) and made the handle visibly do nothing on those four. Dragging here
 * sets `flex: 0 0 auto` alongside the height the moment a panel is touched, so the
 * flex algorithm stops trying to redistribute it and the size actually sticks — the
 * trend panel isn't parented by a flex container at all, so the same call is simply
 * inert there, but every panel gets one consistent interaction instead of a native
 * handle on one and something else on four others. */
function useResizablePanel(key: string, enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const applyHeight = (px: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.flex = "0 0 auto";
    el.style.height = `${Math.round(px)}px`;
  };

  /* Re-run on every breakpoint change, not just on mount. A height saved by
     dragging on a desktop is an inline style, and an inline style outranks the
     stacked-layout media query that otherwise lets each panel size to its own
     content — so on a phone that same 300-odd pixels became a hard clip on a panel
     that now stacks four sections vertically instead of laying them out in four
     columns, hiding everything past the first one. Below the breakpoint the saved
     height is dropped rather than applied; it stays in storage and comes back the
     next time the layout is wide enough for it to mean anything. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      el.style.flex = "";
      el.style.height = "";
      return;
    }
    const saved = localStorage.getItem(PANEL_HEIGHT_KEY_PREFIX + key);
    if (saved) applyHeight(parseFloat(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    // Left button (or an unbuttoned touch/pen contact, button === -1) only — a
    // right/middle click landing on the handle shouldn't start a drag.
    if (!el || (e.button !== 0 && e.button !== -1)) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: el.getBoundingClientRect().height };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      applyHeight(drag.startHeight + (ev.clientY - drag.startY));
    };
    const onUp = (ev: PointerEvent) => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.releasePointerCapture(ev.pointerId);
      const finalEl = ref.current;
      if (finalEl) {
        localStorage.setItem(
          PANEL_HEIGHT_KEY_PREFIX + key,
          `${Math.round(finalEl.getBoundingClientRect().height)}`
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { ref, onHandlePointerDown };
}

const LIST_HEIGHT_KEY_PREFIX = "admin_list_height:";
/* Four rows is the floor — below that a ranking stops being a ranking and becomes a
   podium with a scrollbar. The ceiling is generous on purpose: someone who wants the
   whole list open on a phone should be able to just open it. */
const LIST_MIN_HEIGHT = 120;
const LIST_MAX_HEIGHT = 1400;

const clampListHeight = (px: number) => Math.min(LIST_MAX_HEIGHT, Math.max(LIST_MIN_HEIGHT, px));

/** A per-ranking height, dragged and persisted like useResizablePanel but applied to
 * the scrolling list itself rather than to a panel.
 *
 * Stacked on a phone the three rankings are stacked too, so the useful unit of
 * height is no longer "the panel" — the panel just grows — but "how much of THIS
 * list do I want to see before the next one starts". Whoever is reading 종목검색
 * 순위 wants that one long and the other two short, and only they know which.
 *
 * Height lives in React state (rather than being written straight to the node the
 * way the panel hook does it) because the list unmounts and remounts as the data
 * moves between its loading / empty / loaded states, and a value on the node would
 * go with it. */
function useResizableList(key: string, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  /* Mirrors useResizablePanel's rule in the other direction: a height dragged on a
     phone is meaningless in the four-column desktop layout, where all three lists
     share one row, so it is dropped there and read back from storage on the way
     back down. */
  useEffect(() => {
    if (!enabled) {
      setHeight(null);
      return;
    }
    const saved = localStorage.getItem(LIST_HEIGHT_KEY_PREFIX + key);
    if (!saved) return;
    const px = parseFloat(saved);
    if (Number.isFinite(px)) setHeight(clampListHeight(px));
  }, [key, enabled]);

  const persist = (px: number | null) => {
    if (px === null) localStorage.removeItem(LIST_HEIGHT_KEY_PREFIX + key);
    else localStorage.setItem(LIST_HEIGHT_KEY_PREFIX + key, `${Math.round(px)}`);
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || (e.button !== 0 && e.button !== -1)) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startHeight = el.getBoundingClientRect().height;
    dragRef.current = { startY: e.clientY, startHeight };
    let latest = startHeight;

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      latest = clampListHeight(drag.startHeight + (ev.clientY - drag.startY));
      setHeight(latest);
    };
    const onUp = (ev: PointerEvent) => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.releasePointerCapture(ev.pointerId);
      persist(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /* Back to the stylesheet's own height. The drag is the fine control; this is the
     way out of a height you dragged too far, without having to drag it back. */
  const reset = () => {
    setHeight(null);
    persist(null);
  };

  return { ref, height, onHandlePointerDown, reset, resized: height !== null };
}

/** The stacked-layout grab bar for one ranking list. Wide and full-width rather than
 * the hairline strip the desktop panels use — this one is only ever dragged with a
 * thumb, and a 4px target under a thumb is a target you miss. */
function ListResizeHandle({
  list,
  label,
}: {
  list: ReturnType<typeof useResizableList>;
  label: string;
}) {
  return (
    <div className="admin-list-resize">
      <span
        className="admin-list-resize-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label={`${label} 높이 조절`}
        title="위아래로 끌어서 높이 조절"
        onPointerDown={list.onHandlePointerDown}
      >
        <span className="admin-list-resize-bar" />
        높이 조절
      </span>
      {list.resized && (
        <button type="button" className="admin-list-resize-reset" onClick={list.reset}>
          기본값
        </button>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  useDocumentTitle("관리자 대시보드 | K-Stock Hub");
  const [authed] = useState(() => !!getStoredSession());
  /* Which of the two height systems is live. They are mutually exclusive on
     purpose: wide, the five panels negotiate a shared budget of screen height and
     the drag handles sit on the panels; stacked, every panel is as tall as it needs
     to be and the only thing worth sizing is each individual ranking list. */
  const stacked = useStackedLayout();

  // One resizable-panel controller per panel — see useResizablePanel's own comment.
  // Keys are stable, human-readable strings rather than array indices so a later
  // panel reorder can't silently swap two saved heights.
  const trendPanel = useResizablePanel("trend", !stacked);
  const sessionsPanel = useResizablePanel("sessions", !stacked);
  const commentsPanel = useResizablePanel("comments", !stacked);
  const tailPanel = useResizablePanel("tail", !stacked);
  const batchPanel = useResizablePanel("batch", !stacked);

  // ...and one per ranking list, live only in the stacked layout.
  const pagesList = useResizableList("pages", stacked);
  const stocksList = useResizableList("stocks", stacked);
  const hubList = useResizableList("hub", stacked);

  // The trend SVG's own viewBox tracks .admin-trend-chart-wrap's actual measured
  // size (see the `width`/`height` destructure further down) rather than a fixed
  // ratio, so dragging .admin-panel--trend's resize handle actually grows the chart
  // instead of just adding dead space around a fixed-aspect one. 760x247 (roughly
  // 3:1) is the value on screen before the first measurement lands.
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
          Math.round(width) === prev.width && Math.round(height) === prev.height
            ? prev
            : { width: Math.round(width), height: Math.round(height) }
        );
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [range, setRange] = useState<AdminTrendRange>("3h");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [visitorPoints, setVisitorPoints] = useState<VisitorTrendPoint[]>([]);
  const [trendLoaded, setTrendLoaded] = useState(false);
  // Which of the two the panel is currently drawing — everything else about it
  // (range, chart mode, the summary/legend/tooltip machinery) is shared, so this is
  // the only extra piece of state the toggle needs. Both series are fetched together
  // below regardless of which is showing, so flipping this is instant rather than
  // triggering a fresh loading skeleton.
  const [trendMetric, setTrendMetric] = useState<"pages" | "visitors" | "hub">("pages");
  /* Main-page behaviour. Three separate pieces of state because they answer on
     three different schedules: the summary and the series follow the chart's
     range, the ranking holds a fixed week, and the session trail is fetched
     only when a row in the log is opened. */
  const [hubPoints, setHubPoints] = useState<HubTrendPoint[]>([]);
  const [hubSummary, setHubSummary] = useState<HubSummary | null>(null);
  const [hubObjects, setHubObjects] = useState<HubObjectCount[] | null>(null);
  const [hubRankAction, setHubRankAction] = useState<HubAction | "all">("all");
  /* Which slice of the live log is on show. The entrance page produces far more
     events per visitor than any other page does — a tab that separates them is
     what keeps one person exploring the orbit from burying everything else. */
  const [tailScope, setTailScope] = useState<"all" | "hub">("all");
  const [openTrail, setOpenTrail] = useState<string | null>(null);
  const [trail, setTrail] = useState<HubSessionEvent[] | null>(null);
  const [pagesTop, setPagesTop] = useState<PageCount[] | null>(null);
  const [stocksTop, setStocksTop] = useState<StockSearchCount[] | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [tail, setTail] = useState<ActivityEvent[] | null>(null);
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(new Set());
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeLegend, setActiveLegend] = useState<string | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [chartMode, setChartMode] = useState<"area" | "bars">("area");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [prediction, setPrediction] = useState<PredictionStatus | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runningRegion, setRunningRegion] = useState<BatchRegion | null>(null);
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [mailHistory, setMailHistory] = useState<MailSend[] | null>(null);
  // Keyed by MailAccount.id so two accounts can't share one spinner — the mask is
  // not unique enough for that. "*" is the 전체 발송 button.
  const [mailSending, setMailSending] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<string | null>(null);
  const [kakaoVisitorStatus, setKakaoVisitorStatus] = useState<KakaoVisitorStatus | null>(null);
  const [kakaoVisitorRunning, setKakaoVisitorRunning] = useState(false);
  const [kakaoVisitorError, setKakaoVisitorError] = useState<string | null>(null);
  const [kakaoPredictionStatus, setKakaoPredictionStatus] = useState<KakaoPredictionStatus | null>(null);
  const [kakaoPredictionRunning, setKakaoPredictionRunning] = useState<BatchRegion | null>(null);
  const [kakaoPredictionError, setKakaoPredictionError] = useState<string | null>(null);
  const [dramStatus, setDramStatus] = useState<DramPriceStatus | null>(null);
  const [runningDram, setRunningDram] = useState(false);
  const [dramRunError, setDramRunError] = useState<string | null>(null);
  const [kakaoDramStatus, setKakaoDramStatus] = useState<KakaoDramPriceStatus | null>(null);
  const [kakaoDramRunning, setKakaoDramRunning] = useState(false);
  const [kakaoDramError, setKakaoDramError] = useState<string | null>(null);

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
      // Both fetched together, whichever one the toggle currently shows — the
      // second is one COUNT(DISTINCT session_id) over the same already-indexed
      // range, and paying for it up front is what lets the toggle just switch
      // stored state instead of showing a loading skeleton every time it's clicked.
      // The main-page series and its summary ride along with the other two for
      // the same reason they ride together: all three read one already-indexed
      // window, and paying for them up front is what lets the metric toggle
      // switch stored state instead of showing a skeleton on every click.
      Promise.all([
        adminApi.trend(range),
        adminApi.visitorTrend(range),
        adminApi.hubTrend(range),
        adminApi.hubSummary(range),
      ])
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
      // Both lists scroll past their first ten now, so they are fetched whole
      // rather than pre-truncated to what fits: every route the app has for
      // pages, and enough stocks that the 10-search floor applied below is
      // what actually ends the list rather than this number.
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

  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const load = () => {
      adminApi
        .predictionStatus()
        .then((s) => !cancelled && setPrediction(s))
        .catch(handleAuthError);
    };
    load();
    // Polls faster (5s) than the summary panels because a manual re-run is watched
    // here — the operator presses the button and wants to see it flip to 실행 중 and
    // then to the fresh result without a 30s wait.
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
        .kakaoVisitorStatus()
        .then((s) => !cancelled && setKakaoVisitorStatus(s))
        .catch(handleAuthError);
    };
    load();
    // Same 5s cadence as the prediction poll above, for the same reason: a manual
    // send is watched here right after the button is pressed.
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
        .kakaoPredictionStatus()
        .then((s) => !cancelled && setKakaoPredictionStatus(s))
        .catch(handleAuthError);
    };
    load();
    // 5s cadence, same reasoning as the other two polls above: also watches the
    // automatic 10-minutes-after-batch send land without a page refresh.
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
        .dramPriceStatus()
        .then((s) => !cancelled && setDramStatus(s))
        .catch(handleAuthError);
    };
    load();
    // Same 5s cadence as the prediction poll — a manual re-run is watched here too.
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
        .kakaoDramPriceStatus()
        .then((s) => !cancelled && setKakaoDramStatus(s))
        .catch(handleAuthError);
    };
    load();
    // Same 5s cadence as the other Kakao polls — also watches the automatic
    // 10-minutes-after-batch send land without a page refresh.
    const id = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  function handleRunKakaoVisitorNotify() {
    if (kakaoVisitorRunning) return;
    setKakaoVisitorRunning(true);
    setKakaoVisitorError(null);
    adminApi
      .runKakaoVisitorNotify()
      .then((r) =>
        setKakaoVisitorStatus((prev) => (prev ? { ...prev, last_run: r } : { configured: true, last_run: r }))
      )
      .catch((err) => {
        handleAuthError(err);
        setKakaoVisitorError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoVisitorRunning(false));
  }

  function handleRunKakaoPredictionNotify(region: BatchRegion) {
    if (kakaoPredictionRunning) return;
    setKakaoPredictionRunning(region);
    setKakaoPredictionError(null);
    adminApi
      .runKakaoPredictionNotify(region)
      .then((r) =>
        setKakaoPredictionStatus((prev) =>
          prev
            ? { ...prev, last_runs: { ...prev.last_runs, [region]: r } }
            : { configured: true, last_runs: { [region]: r } }
        )
      )
      .catch((err) => {
        handleAuthError(err);
        setKakaoPredictionError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoPredictionRunning(null));
  }

  const loadMail = useCallback(() => {
    adminApi
      .mailStatus()
      .then(setMailStatus)
      .catch(handleAuthError);
    adminApi
      .mailHistory(40)
      .then((r) => setMailHistory(r.items))
      .catch(handleAuthError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMail();
  }, [loadMail]);

  /** 수기 발송. `email` is the masked handle from the status call, or undefined for
   * every account at once. Manual sends deliberately ignore the once-a-day cap the
   * scheduled batch observes — that is what makes this button worth having. */
  function handleSendMail(account?: string, label?: string) {
    if (mailSending) return;
    const who = label ?? "구독 중인 모든 계정";
    if (!window.confirm(`${who}에 예측 메일을 지금 발송하시겠습니까?\n하루 1회 제한과 무관하게 즉시 발송됩니다.`)) {
      return;
    }
    setMailSending(account ?? "*");
    setMailError(null);
    setMailResult(null);
    adminApi
      .runMailSend(account)
      .then((report) => {
        const sent = report.results.reduce((n, r) => n + r.sent.length, 0);
        const failed = report.results.reduce((n, r) => n + (r.failed?.length ?? 0), 0);
        setMailResult(
          report.note ?? `${sent}건 발송 완료${failed ? ` · ${failed}건 실패` : ""}`
        );
        loadMail();
      })
      .catch((err) => {
        handleAuthError(err);
        setMailError(err instanceof Error ? err.message : "메일 발송에 실패했습니다.");
      })
      .finally(() => setMailSending(null));
  }

  function handleRunBatch(region: BatchRegion) {
    if (runningRegion) return;
    const label = region === "KR" ? "코스피·코스닥" : "나스닥";
    if (!window.confirm(`${label} 배치를 지금 재실행하시겠습니까? 해당 일자 데이터를 삭제 후 재생성합니다.`)) {
      return;
    }
    setRunningRegion(region);
    setRunError(null);
    adminApi
      .runPrediction(region)
      .then(() => {
        // The run is now in-flight server-side; the 5s poll above will pick up the
        // 'running' state and then the result. Refresh once immediately so the panel
        // reflects 실행 중 without waiting for the next tick.
        return adminApi.predictionStatus().then((s) => setPrediction(s));
      })
      .catch((err) => {
        handleAuthError(err);
        setRunError(err instanceof Error ? err.message : "배치 실행에 실패했습니다.");
      })
      .finally(() => setRunningRegion(null));
  }

  function handleRunDramBatch() {
    if (runningDram) return;
    setRunningDram(true);
    setDramRunError(null);
    adminApi
      .runDramPriceBatch()
      .then(() => {
        // The run is now in-flight server-side; the 5s poll above will pick up the
        // 'running' state and then the result. Refresh once immediately so the panel
        // reflects 실행 중 without waiting for the next tick.
        return adminApi.dramPriceStatus().then((s) => setDramStatus(s));
      })
      .catch((err) => {
        handleAuthError(err);
        setDramRunError(err instanceof Error ? err.message : "배치 실행에 실패했습니다.");
      })
      .finally(() => setRunningDram(false));
  }

  function handleRunKakaoDramNotify() {
    if (kakaoDramRunning) return;
    setKakaoDramRunning(true);
    setKakaoDramError(null);
    adminApi
      .runKakaoDramPriceNotify()
      .then((r) => setKakaoDramStatus((prev) => (prev ? { ...prev, last_run: r } : { configured: true, last_run: r })))
      .catch((err) => {
        handleAuthError(err);
        setKakaoDramError(err instanceof Error ? err.message : "카카오 알림 발송에 실패했습니다.");
      })
      .finally(() => setKakaoDramRunning(false));
  }

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

  function toggleWarnings(key: string) {
    setExpandedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
    const buckets = buildTimeline(range, new Date());

    // The visitor view has exactly one series — distinct sessions per bucket, with
    // no per-page breakdown to rank or bucket a "기타" tail out of — so it skips the
    // whole topPaths/otherPaths shape below and builds straight off visitorPoints.
    // Everything downstream (chartGeom, the legend, the tooltip) only ever reads
    // `series` as a plain Series[], so a one-item array is nothing special to it.
    if (trendMetric === "visitors") {
      const valueMap = new Map<string, number>();
      for (const p of visitorPoints) valueMap.set(p.bucket, p.count);
      const values = buckets.map((b) => valueMap.get(b) ?? 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      const seriesData: Series[] = [
        { path: "__visitors__", label: "방문자수", colorVar: "--series-violet", values, total },
      ];
      return { series: seriesData, categories: buckets, maxCount: Math.max(1, ...values) };
    }

    /* The main-page view: one series per kind of interaction, over the same
       timeline the other two use. It maps onto the identical Series shape —
       `path` carries the action name instead of a route — so the chart, the
       legend, the tooltip and both chart modes need to know nothing about it.

       Dwell rows are left out on purpose. Their unit is seconds, not events,
       and a series measuring time plotted against series counting taps would
       share an axis with nothing to say. The dwell figures have their own
       tiles above, where a number in seconds can be labelled as one. */
    if (trendMetric === "hub") {
      const valueMap = new Map<string, number>();
      const totals = new Map<HubAction, number>();
      for (const p of hubPoints) {
        if (p.action === "dwell") continue;
        valueMap.set(`${p.action}${p.bucket}`, p.count);
        totals.set(p.action, (totals.get(p.action) ?? 0) + p.count);
      }
      const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([action]) => action);
      const seriesData: Series[] = ordered.map((action, i) => ({
        path: action,
        label: HUB_ACTION_LABEL[action] ?? action,
        colorVar: SERIES_VARS[i % SERIES_VARS.length],
        values: buckets.map((b) => valueMap.get(`${action}${b}`) ?? 0),
        total: totals.get(action) ?? 0,
      }));
      const maxCount = Math.max(
        1,
        ...buckets.map((_, i) => seriesData.reduce((sum, s) => sum + s.values[i], 0))
      );
      return { series: seriesData, categories: buckets, maxCount };
    }

    const totals = new Map<string, number>();
    for (const p of trendPoints) totals.set(p.path, (totals.get(p.path) ?? 0) + p.count);
    const orderedPaths = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
    const topPaths = orderedPaths.slice(0, SERIES_VARS.length);
    const otherPaths = orderedPaths.slice(SERIES_VARS.length);

    // O(1) per-point lookup — the 24h view backfills 1,440 one-minute buckets,
    // so an O(n) `.find()` per (path, bucket) pair would mean over a million
    // scans across a handful of series.
    //
    // The separator is US (U+001F), not NUL: a literal NUL anywhere in the file
    // makes ripgrep classify the whole thing as binary and skip it, so this
    // component silently disappears from every repo-wide content search. Neither a
    // URL path nor a bucket timestamp can contain either character.
    const valueMap = new Map<string, number>();
    for (const p of trendPoints) valueMap.set(`${p.path}\u001f${p.bucket}`, p.count);
    const valueOf = (path: string, bucket: string) => valueMap.get(`${path}\u001f${bucket}`) ?? 0;

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
  }, [trendPoints, visitorPoints, hubPoints, range, trendMetric]);

  // Measured off .admin-trend-chart-wrap itself (see chartSize/chartWrapRef below)
  // rather than a fixed ratio, now that the panel is user-resizable
  // (.admin-panel--trend's own `resize: vertical` — see styles.css): a constant
  // viewBox would have left a resize drag doing nothing but stretch/letterbox a
  // fixed-aspect chart inside a taller box instead of actually using the new room.
  // 760x247 (roughly 3:1) is only the value on screen before the very first
  // measurement lands.
  const { width, height } = chartSize;
  const padding = { top: 22, right: 16, bottom: 32, left: 46 };
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

  // The heavy path geometry (smooth stacked-area bands can be 1,400+ cubic
  // segments each on the 24h view) is memoized so a hover — which only moves the
  // lightweight crosshair/tooltip overlay — never rebuilds it. Keyed on the data,
  // the visible-series set, the axis scale, and the render mode; NOT on hoverIndex
  // or activeLegend, which are applied as cheap per-render attributes below.
  const chartGeom = useMemo(() => {
    const n = categories.length;
    const vis = series.filter((s) => !hiddenSeries.has(s.path));
    const totals = categories.map((_, i) => vis.reduce((sum, s) => sum + s.values[i], 0));
    let peakIdx = 0;
    for (let i = 1; i < n; i++) if (totals[i] > totals[peakIdx]) peakIdx = i;
    const grandTotal = totals.reduce((a, b) => a + b, 0);

    // Stacked-area bands: each series is the ribbon between the running cumulative
    // below it and the cumulative including it, both smoothed independently so the
    // band's two edges curve in parallel.
    const bands: {
      path: string;
      label: string;
      colorVar: string;
      fill: string;
      stroke: string;
      topPts: Pt[];
      values: number[];
    }[] = [];
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
        bands.push({
          path: s.path,
          label: s.label,
          colorVar: s.colorVar,
          fill: areaBandPath(upper, lower),
          stroke: monotonePath(upper),
          topPts: upper,
          values: s.values,
        });
      }
    }

    // Stacked rounded bars: one flattened segment per (bucket, series) so each can
    // carry its own path + color and be dimmed individually.
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
          const d = isTop
            ? roundedTopRectPath(x, topY, barWidth, segH, barCornerR)
            : `M ${x},${topY} h ${barWidth} v ${segH} h ${-barWidth} Z`;
          bars.push({ path: s.path, colorVar: s.colorVar, d });
        });
      }
    }

    return { bands, bars, totals, peakIdx, grandTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, hiddenSeries, categories, maxCount, chartMode, width, height]);

  if (!authed) return null;

  const visibleSeries = series.filter((s) => !hiddenSeries.has(s.path));
  // Unique color tokens among the visible bands — one <linearGradient> per token
  // powers the area fills (the gradient tracks the CSS var, so it re-tints on a
  // theme flip for free).
  const gradientVars = [...new Set(visibleSeries.map((s) => s.colorVar))];
  const gradId = (colorVar: string) => `admtg-${colorVar.replace(/[^a-z0-9]/gi, "")}`;
  const peakTotal = chartGeom.totals[chartGeom.peakIdx] ?? 0;

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

  /* Every stock searched at least ten times, per an explicit request — the
     list shows its top ten without scrolling and the rest are reachable by
     scrolling it. The floor is what keeps that from running to hundreds of
     rows: single-digit counts are mostly one person opening one thing once,
     which is noise in a ranking rather than a tail of it. */
  const rankedStocks = (stocksTop ?? []).filter((s) => s.count >= STOCK_RANK_MIN_COUNT);
  const topStockCount = rankedStocks[0]?.count ?? 0;

  /* Re-sorted by SESSIONS, not by the raw count the server ordered on.
     The server orders by count because that is what its LIMIT has to cut on —
     it cannot know which rows survive this filter. What makes a ranking of
     objects mean something, though, is how many different people reached for
     one: forty taps from one visitor exploring is not the same result as forty
     visitors each tapping once, and only the second is a signal about the page.
     Dwell rows are excluded — they have no object, and they are already the
     tiles above. */
  /* Opening a session's trail. Fetched on demand rather than carried on every
     tail poll: it is one query per curiosity, and the tail refreshes on a timer
     for everyone whether or not anybody is reading a trail. Clicking the open
     row closes it, which is also how you stop the fetch mattering. */
  const toggleTrail = (sessionId: string) => {
    if (openTrail === sessionId) {
      setOpenTrail(null);
      setTrail(null);
      return;
    }
    setOpenTrail(sessionId);
    setTrail(null);
    adminApi
      .hubSession(sessionId)
      .then((res) => {
        // A second row opened while this was in flight owns the panel now.
        setOpenTrail((current) => {
          if (current === sessionId) setTrail(res.events);
          return current;
        });
      })
      .catch(handleAuthError);
  };

  /* Filtered client side rather than by a second request. The tail is one
     bounded list the panel already holds, the tab is a view of it, and asking
     the server again would make switching tabs a round trip for data that is
     sitting in memory. */
  const shownTail = (tail ?? []).filter((e) => tailScope === "all" || e.type === "hub");
  const hubTailCount = (tail ?? []).filter((e) => e.type === "hub").length;

  const rankedHub = (hubObjects ?? [])
    .filter((h) => h.action !== "dwell" && (hubRankAction === "all" || h.action === hubRankAction))
    .sort((a, b) => b.sessions - a.sessions || b.count - a.count);
  const topHubSessions = rankedHub[0]?.sessions ?? 0;

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
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> AI 예측
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> 글로벌 시총
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> 시총대결
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          {/* Admin-only, and only ever rendered here — neither the DB console nor the
              monitor has an entry point outside this page, and the page itself is
              behind the login. */}
          <Link to="/admin/db" className="kospi-map-nav-link kospi-map-nav-link--db">
            <DbIcon /> DB 조회
          </Link>
          <Link to="/admin/monitor" className="kospi-map-nav-link kospi-map-nav-link--monitor">
            <MonitorIcon /> 모니터링
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

      {/* ── the entrance page, on its own row ──
          A second row rather than four more tiles in the first. These follow
          the chart's range while the row above is fixed (now / all time / 24h),
          and mixing two different time bases into one strip of tiles is how a
          dashboard gets misread. The heading says which range is in force. */}
      <div className="admin-stats-row admin-stats-row--hub">
        <div className="admin-stats-rowlabel">
          메인 페이지 행동
          <span className="admin-stats-rowlabel-hint">
            {RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range} 기준
          </span>
        </div>
        <div className="admin-stat-tile admin-stat-tile--aqua">
          <span className="admin-stat-icon">
            <IconUsers />
          </span>
          <div className="admin-stat-body">
            <span className="admin-stat-label">메인 세션</span>
            {hubSummary ? (
              <span className="admin-stat-value">{hubSummary.sessions.toLocaleString()}</span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
        <div className="admin-stat-tile admin-stat-tile--good">
          <span className="admin-stat-icon">
            <IconPulse />
          </span>
          <div className="admin-stat-body">
            {/* Median, not mean, as the headline. A handful of visitors leave
                the orbit running and drag the average somewhere no real visit
                ever was; the mean is kept underneath where the gap between the
                two is itself readable. */}
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
                <span className="admin-stat-sub">
                  천체 {(hubSummary.totals.object_click ?? 0).toLocaleString()}회
                </span>
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
                <span className="admin-stat-sub">
                  {hubSummary.sessions > 0
                    ? `세션의 ${((hubSummary.bgm_sessions / hubSummary.sessions) * 100).toFixed(0)}%`
                    : "-"}
                </span>
              </span>
            ) : (
              <span className="admin-skeleton admin-skeleton--value" />
            )}
          </div>
        </div>
      </div>

      <section className="admin-panel admin-panel--trend" ref={trendPanel.ref}>
        <div className="admin-panel-head">
          <h2>
            {trendMetric === "visitors"
              ? "방문자수 추이"
              : trendMetric === "hub"
                ? "메인 행동 추이"
                : "페이지별 접속 추이"}
          </h2>
          <div className="admin-panel-controls">
            <div className="admin-trend-mode-toggle" role="group" aria-label="표시 항목">
              <button
                type="button"
                className={trendMetric === "pages" ? "active" : ""}
                onClick={() => setTrendMetric("pages")}
                aria-pressed={trendMetric === "pages"}
                title="페이지별 접속 추이"
              >
                <IconPulse className="admin-trend-mode-icon" />
                페이지별
              </button>
              <button
                type="button"
                className={trendMetric === "visitors" ? "active" : ""}
                onClick={() => setTrendMetric("visitors")}
                aria-pressed={trendMetric === "visitors"}
                title="일자별 방문자수"
              >
                <IconUsers className="admin-trend-mode-icon" />
                방문자수
              </button>
              {/* The third question this chart can answer, and the one the
                  other two cannot: not where people went or how many there
                  were, but what they did on the front page. */}
              <button
                type="button"
                className={trendMetric === "hub" ? "active" : ""}
                onClick={() => setTrendMetric("hub")}
                aria-pressed={trendMetric === "hub"}
                title="메인 페이지에서 일어난 행동을 시간대별로"
              >
                <IconTrophy className="admin-trend-mode-icon" />
                메인 행동
              </button>
            </div>
            <div className="admin-trend-mode-toggle" role="group" aria-label="차트 형태">
              <button
                type="button"
                className={chartMode === "area" ? "active" : ""}
                onClick={() => setChartMode("area")}
                aria-pressed={chartMode === "area"}
                title="영역 차트"
              >
                <IconArea className="admin-trend-mode-icon" />
                영역
              </button>
              <button
                type="button"
                className={chartMode === "bars" ? "active" : ""}
                onClick={() => setChartMode("bars")}
                aria-pressed={chartMode === "bars"}
                title="막대 차트"
              >
                <IconBars className="admin-trend-mode-icon" />
                막대
              </button>
            </div>
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
                {categories[chartGeom.peakIdx] && (
                  <span className="admin-trend-summary-sub">{formatBucket(categories[chartGeom.peakIdx])}</span>
                )}
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

                {/* Idle peak marker — a soft halo on the tallest bucket, hidden while
                    hovering so it never competes with the crosshair readout. */}
                {hoverIndex === null && peakTotal > 0 && categories.length > 1 && (
                  <g className="admin-trend-peak">
                    <circle cx={xAt(chartGeom.peakIdx)} cy={yAt(peakTotal)} r={11} className="admin-trend-peak-halo" />
                    <circle cx={xAt(chartGeom.peakIdx)} cy={yAt(peakTotal)} r={3} className="admin-trend-peak-dot" />
                  </g>
                )}

                {/* Crosshair guide — a single vertical rule at the hovered bucket. In
                    bar mode it sits behind a soft column highlight so the hovered
                    stack reads as the focus. */}
                {hoverIndex !== null && (
                  <>
                    {chartMode === "bars" && (
                      <rect
                        x={xAt(hoverIndex) - barWidth / 2 - 3}
                        y={padding.top}
                        width={barWidth + 6}
                        height={innerH}
                        rx={4}
                        fill="color-mix(in srgb, var(--text-primary) 6%, transparent)"
                      />
                    )}
                    <line
                      className="admin-trend-crosshair"
                      x1={xAt(hoverIndex)}
                      x2={xAt(hoverIndex)}
                      y1={padding.top}
                      y2={padding.top + innerH}
                    />
                  </>
                )}

                {/* Marks. Keyed on mode+range so a mode switch or range change
                    remounts the group and replays the CSS wipe/rise entrance — but a
                    routine 60s data refresh (same key) just updates paths in place. */}
                <g key={`${chartMode}-${range}`} className="admin-trend-marks">
                  {chartMode === "area"
                    ? chartGeom.bands.map((b) => {
                        const dimmed = activeLegend !== null && activeLegend !== b.path;
                        return (
                          <g key={b.path} className="admin-trend-band" opacity={dimmed ? 0.2 : 1}>
                            <path d={b.fill} fill={`url(#${gradId(b.colorVar)})`} />
                            <path
                              d={b.stroke}
                              fill="none"
                              stroke={`var(${b.colorVar})`}
                              strokeWidth={1.6}
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              className="admin-trend-band-stroke"
                            />
                          </g>
                        );
                      })
                    : chartGeom.bars.map((seg, i) => {
                        const dimmed = activeLegend !== null && activeLegend !== seg.path;
                        return <path key={i} d={seg.d} fill={`var(${seg.colorVar})`} opacity={dimmed ? 0.18 : 1} />;
                      })}
                </g>

                {/* Focus dots — one per non-zero band at the hovered bucket, sitting
                    on that band's smoothed upper edge with a surface ring so it reads
                    over any fill. */}
                {hoverIndex !== null &&
                  chartMode === "area" &&
                  chartGeom.bands.map((b) => {
                    if ((b.values[hoverIndex] ?? 0) <= 0) return null;
                    const pt = b.topPts[hoverIndex];
                    if (!pt) return null;
                    const dimmed = activeLegend !== null && activeLegend !== b.path;
                    return (
                      <circle
                        key={b.path}
                        className="admin-trend-dot"
                        cx={pt.x}
                        cy={pt.y}
                        r={3.4}
                        fill={`var(${b.colorVar})`}
                        opacity={dimmed ? 0.25 : 1}
                      />
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
                    <span className="admin-trend-tooltip-value">
                      {visibleSeries.reduce((sum, s) => sum + s.values[hoverIndex], 0)}
                    </span>
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
            <>
            <div
              className="admin-toppages-list admin-toppages-list--scroll"
              ref={pagesList.ref}
              style={pagesList.height !== null ? { maxHeight: pagesList.height } : undefined}
            >
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
            {stacked && <ListResizeHandle list={pagesList} label="페이지 순위" />}
            </>
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
            <p className="admin-empty">
              {stocksTop.length === 0
                ? "아직 검색 기록이 없습니다."
                : `${STOCK_RANK_MIN_COUNT}회 이상 검색된 종목이 아직 없습니다.`}
            </p>
          ) : (
            <>
            <div
              className="admin-toppages-list admin-toppages-list--scroll"
              ref={stocksList.ref}
              style={stocksList.height !== null ? { maxHeight: stocksList.height } : undefined}
            >
              {rankedStocks.map((s, i) => {
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
                        <StockLogo code={s.code} className="admin-toppages-stock-icon" />
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
            {stacked && <ListResizeHandle list={stocksList} label="종목검색 순위" />}
            </>
          )}
        </div>

        {/* ── 메인 반응 순위 ──
            The third ranking, and the only one whose rows are objects rather
            than destinations. A page ranking says where people ended up; this
            says what they reached for on the way, including the things that got
            reached for and never opened.

            Two figures per row on purpose. `count` is how often it happened and
            `sessions` is how many different people did it — and a planet that
            one visitor tapped forty times is a very different result from one
            that forty visitors tapped once. The bar is drawn on sessions for
            exactly that reason; the raw count sits beside it. */}
        <div className="admin-trend-tophub">
          <h3 className="admin-trend-toppages-title">
            메인 반응 순위 (7일 누적)
            <span className="admin-toppages-hint">순위는 세션 수 기준 · 스크롤하면 전체</span>
          </h3>
          <div className="admin-hub-rank-filter" role="group" aria-label="반응 종류">
            {HUB_RANK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={hubRankAction === f.key ? "active" : ""}
                onClick={() => setHubRankAction(f.key)}
                aria-pressed={hubRankAction === f.key}
              >
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
            <>
            <div
              className="admin-toppages-list admin-toppages-list--scroll"
              ref={hubList.ref}
              style={hubList.height !== null ? { maxHeight: hubList.height } : undefined}
            >
              {rankedHub.map((h, i) => {
                const rank = i + 1;
                const medal = RANK_MEDAL[rank];
                const pct = topHubSessions > 0 ? (h.sessions / topHubSessions) * 100 : 0;
                return (
                  <div
                    key={`${h.action}:${h.object_key}`}
                    className={`admin-toppages-row${rank <= 3 ? " admin-toppages-row--top" : ""}`}
                  >
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
                      <span className="admin-toppages-label">
                        {h.label}
                        <span className="admin-hub-rank-kind">{HUB_ACTION_LABEL[h.action] ?? h.action}</span>
                      </span>
                      <div className="admin-toppages-bar-track">
                        <div
                          className="admin-toppages-bar-fill"
                          style={{
                            width: `${Math.max(pct, 3)}%`,
                            background: `var(${HUB_ACTION_COLOR[h.action] ?? "--series-violet"})`,
                          }}
                        />
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
            {stacked && <ListResizeHandle list={hubList} label="메인 반응 순위" />}
            </>
          )}
        </div>
        </div>
        <span
          className="admin-panel-resize-handle"
          onPointerDown={trendPanel.onHandlePointerDown}
          aria-hidden="true"
        />
      </section>

      <div className="admin-panels-grid">
        <div className="admin-left-col">
        <section className="admin-panel admin-panel--sessions" ref={sessionsPanel.ref}>
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
                      <StockLogo code={s.stock_code} className="admin-session-stock-icon" />
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
          <span
            className="admin-panel-resize-handle"
            onPointerDown={sessionsPanel.onHandlePointerDown}
            aria-hidden="true"
          />
        </section>

        <section className="admin-panel admin-panel--comments" ref={commentsPanel.ref}>
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
          <span
            className="admin-panel-resize-handle"
            onPointerDown={commentsPanel.onHandlePointerDown}
            aria-hidden="true"
          />
        </section>
        </div>

        {/* The right-hand column: the live log keeps 70% of the fixed column height,
            and the batch-status panel below takes the remaining 30% (see
            .admin-tail-col / .admin-panel--batch in styles.css). */}
        <div className="admin-tail-col">
        <section className="admin-panel admin-panel--tail" ref={tailPanel.ref}>
          <h2>
            <span className="admin-live-dot" /> 실시간 로그
            {/* The tab. The entrance page emits several events per visitor
                where every other page emits one, so left in the same stream it
                would bury the rest — and separated, it becomes the only place
                you can watch one person move through the orbit in order. */}
            <span className="admin-tail-tabs" role="group" aria-label="로그 범위">
              <button
                type="button"
                className={tailScope === "all" ? "active" : ""}
                onClick={() => setTailScope("all")}
                aria-pressed={tailScope === "all"}
              >
                전체
              </button>
              <button
                type="button"
                className={tailScope === "hub" ? "active" : ""}
                onClick={() => setTailScope("hub")}
                aria-pressed={tailScope === "hub"}
              >
                메인 행동
                {hubTailCount > 0 && <span className="admin-tail-tabcount">{hubTailCount}</span>}
              </button>
            </span>
          </h2>
          <div className="admin-tail-list">
            {tail === null &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="admin-tail-row">
                  <span className="admin-skeleton admin-skeleton--row" />
                </div>
              ))}
            {shownTail.map((e) => {
              const meta = TYPE_META[e.type] ?? { label: e.type, colorVar: "--text-muted" };
              const hub = e.type === "hub";
              const badgeColor = hub ? HUB_ACTION_COLOR[e.action ?? "control"] : meta.colorVar;
              const badgeLabel = hub ? (e.action ? HUB_ACTION_LABEL[e.action] : "메인") : meta.label;
              const open = openTrail === e.session_id;
              return (
                <div key={e.id} className={`admin-tail-row${hub ? " admin-tail-row--hub" : ""}`}>
                  <span className="admin-tail-time">{formatClock(e.created_at)}</span>
                  {/* On a main-page row the session id becomes a control: it
                      opens that visitor's whole trail through the page, which
                      is the question a single line of log always raises. */}
                  {hub ? (
                    <button
                      type="button"
                      className={`admin-tail-session admin-tail-session--btn${open ? " is-open" : ""}`}
                      onClick={() => toggleTrail(e.session_id)}
                      title="이 세션의 메인 페이지 행동 전체 보기"
                    >
                      {shortSession(e.session_id)}
                    </button>
                  ) : (
                    <span className="admin-tail-session">{shortSession(e.session_id)}</span>
                  )}
                  <span className="admin-tail-badge" style={{ color: `var(${badgeColor})`, borderColor: `var(${badgeColor})` }}>
                    <TypeIcon type={e.type} className="admin-tail-badge-icon" />
                    {badgeLabel}
                  </span>
                  <span className="admin-tail-detail">
                    {e.type === "stock_view" && e.stock_code ? (
                      <>
                        <StockLogo code={e.stock_code} className="admin-tail-stock-icon" />
                        {e.stock_name} ({e.stock_code})
                      </>
                    ) : hub ? (
                      // A dwell row's number is its whole content; everything
                      // else on that page is named by its label.
                      e.action === "dwell" ? (
                        <>
                          체류 <strong>{formatDuration(e.value ?? 0)}</strong>
                        </>
                      ) : (
                        <>
                          {e.label ?? e.object_key ?? "메인"}
                          {e.object_key && <span className="admin-tail-key">{e.object_key}</span>}
                        </>
                      )
                    ) : e.label ? (
                      `${pageLabel(e.path)} · ${e.label}`
                    ) : (
                      pageLabel(e.path)
                    )}
                  </span>
                  {open && (
                    <div className="admin-tail-trail">
                      {trail === null ? (
                        <span className="admin-skeleton admin-skeleton--row" />
                      ) : trail.length === 0 ? (
                        <span className="admin-tail-trail-empty">기록된 행동이 없습니다.</span>
                      ) : (
                        trail.map((t, i) => (
                          <div key={`${t.created_at}${i}`} className="admin-tail-trail-row">
                            <span className="admin-tail-trail-time">{formatClock(t.created_at)}</span>
                            <span
                              className="admin-tail-trail-kind"
                              style={{ color: `var(${HUB_ACTION_COLOR[t.action] ?? "--text-muted"})` }}
                            >
                              {HUB_ACTION_LABEL[t.action] ?? t.action}
                            </span>
                            <span className="admin-tail-trail-label">
                              {t.action === "dwell" ? formatDuration(t.value ?? 0) : t.label ?? t.object_key ?? "-"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {tail !== null && shownTail.length === 0 && (
              <p className="admin-empty">
                {tailScope === "hub" ? "메인 페이지 행동을 기다리는 중..." : "이벤트를 기다리는 중..."}
              </p>
            )}
          </div>
          <span
            className="admin-panel-resize-handle"
            onPointerDown={tailPanel.onHandlePointerDown}
            aria-hidden="true"
          />
        </section>

        <section className="admin-panel admin-panel--batch" ref={batchPanel.ref}>
          <div className="admin-batch-split">
          <div className="admin-batch-half">
          <h2>
            <span className="admin-live-dot" /> AI 예측 배치
          </h2>
          <div className="admin-batch-body">
            {prediction === null ? (
              <div className="admin-batch-row">
                <span className="admin-skeleton admin-skeleton--row" />
              </div>
            ) : (
              (["KR", "US"] as BatchRegion[]).map((region) => {
                const label = region === "KR" ? "한국장 (코스피·코스닥)" : "미국장 (나스닥)";
                const last = prediction.last_runs[region] ?? null;
                const isRunning = prediction.running.includes(region) || runningRegion === region;
                // The process-memory record is richest, but dies with a restart —
                // fall back to the DB snapshot (per this region's markets) so
                // "최근 실행" still shows real data after a redeploy.
                const marketStats = (prediction.regions[region] ?? [])
                  .map((m) => prediction.markets[m])
                  .filter(Boolean);
                const dbUpdated = marketStats.length
                  ? marketStats.map((m) => m.updated_at).sort().slice(-1)[0]
                  : null;
                const dbCount = marketStats.reduce((sum, m) => sum + m.count, 0);
                const finishedAt = last?.finished_at ?? dbUpdated;
                const ok = last ? last.status === "ok" || last.status === "skipped" : dbCount > 0;
                const statusLabel = isRunning
                  ? "실행 중"
                  : last
                    ? last.status === "ok"
                      ? "성공"
                      : last.status === "skipped"
                        ? "스킵"
                        : "실패"
                    : dbCount > 0
                      ? "성공"
                      : "기록 없음";
                // Which analyst path actually produced the 60%, per market. This is
                // the one thing the panel can say that no other view can: the run
                // succeeds either way, so "성공" alone doesn't distinguish a Claude
                // analysis from a heuristic fallback. Ordered by the region's own
                // market list (KOSPI before KOSDAQ) rather than object key order.
                const sources = (prediction.regions[region] ?? [])
                  .map((market) => ({ market, stat: last?.markets?.[market] }))
                  .filter((entry): entry is { market: string; stat: { count: number; ai_source: string } } =>
                    Boolean(entry.stat)
                  );
                const warnings = last?.warnings ?? [];
                const warnKey = `warn-${region}`;
                const warnExpanded = expandedWarnings.has(warnKey);
                const shownWarnings = warnExpanded ? warnings : warnings.slice(0, WARNING_PREVIEW_COUNT);
                return (
                  <div key={region} className="admin-batch-item">
                    <div className="admin-batch-row">
                      <span
                        className={`admin-batch-status admin-batch-status--${
                          isRunning ? "running" : ok ? "ok" : "fail"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span className="admin-batch-name">{label}</span>
                      <span className="admin-batch-meta">
                        {last?.saved != null && last.status === "ok" ? `${last.saved}종목 저장 · ` : ""}
                        {last?.triggered_by === "admin" ? "수동 · " : ""}
                        {finishedAt ? `최근 ${formatDateTime(finishedAt)}` : "실행 이력 없음"}
                        {last?.error ? ` · ${last.error}` : ""}
                      </span>
                      <button
                        type="button"
                        className="admin-batch-run-btn"
                        disabled={isRunning || runningRegion !== null}
                        onClick={() => handleRunBatch(region)}
                      >
                        {isRunning ? "실행 중..." : "수동 재실행"}
                      </button>
                    </div>
                    {(sources.length > 0 || last?.elapsed_seconds != null) && (
                      <div className="admin-batch-detail">
                        {sources.map(({ market, stat }) => {
                          const meta = AI_SOURCE_META[stat.ai_source] ?? {
                            label: stat.ai_source,
                            tone: "unknown",
                          };
                          return (
                            <span
                              key={market}
                              className={`admin-batch-source admin-batch-source--${meta.tone}`}
                              title={`${market} ${stat.count}종목 · 60% 정성 판단: ${meta.label}`}
                            >
                              <span className="admin-batch-source-market">{market}</span>
                              {meta.label}
                              <span className="admin-batch-source-count">{stat.count}</span>
                            </span>
                          );
                        })}
                        {last?.predict_date && (
                          <span className="admin-batch-detail-note">
                            예측일 {last.predict_date.slice(5)}
                            {last.predict_weekday ? `(${last.predict_weekday})` : ""}
                          </span>
                        )}
                        {last?.elapsed_seconds != null && (
                          <span className="admin-batch-detail-note">{last.elapsed_seconds}초 소요</span>
                        )}
                      </div>
                    )}
                    {warnings.length > 0 && (
                      <ul className="admin-batch-warnings">
                        {shownWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                        {warnings.length > WARNING_PREVIEW_COUNT && (
                          <li>
                            <button
                              type="button"
                              className="admin-batch-warnings-more"
                              aria-expanded={warnExpanded}
                              onClick={() => toggleWarnings(warnKey)}
                            >
                              {warnExpanded
                                ? "접기"
                                : `외 ${warnings.length - WARNING_PREVIEW_COUNT}건 더 보기`}
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
            {runError && <p className="admin-batch-error">{runError}</p>}
          </div>

          <h2>
            <span className="admin-live-dot" /> D램 현물가격 배치
          </h2>
          <div className="admin-batch-body">
            {dramStatus === null ? (
              <div className="admin-batch-row">
                <span className="admin-skeleton admin-skeleton--row" />
              </div>
            ) : (
              (() => {
                const last = dramStatus.last_run;
                const isRunning = dramStatus.running || runningDram;
                const ok = last ? last.status === "ok" || last.status === "skipped" : dramStatus.item_count > 0;
                const statusLabel = isRunning
                  ? "실행 중"
                  : last
                    ? last.status === "ok"
                      ? "성공"
                      : last.status === "skipped"
                        ? "스킵"
                        : "실패"
                    : dramStatus.item_count > 0
                      ? "성공"
                      : "기록 없음";
                const finishedAt = last?.finished_at;
                const priceDate = last?.price_date ?? dramStatus.latest_price_date;
                const itemCount = last?.item_count ?? dramStatus.item_count;
                return (
                  <div className="admin-batch-item">
                    <div className="admin-batch-row">
                      <span
                        className={`admin-batch-status admin-batch-status--${
                          isRunning ? "running" : ok ? "ok" : "fail"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span className="admin-batch-name">DRAM 현물가격 (TrendForce)</span>
                      <span className="admin-batch-meta">
                        {priceDate ? `기준일 ${priceDate} · ${itemCount}개 항목 · ` : ""}
                        {last?.triggered_by === "admin" ? "수동 · " : ""}
                        {finishedAt ? `최근 ${formatDateTime(finishedAt)}` : "실행 이력 없음"}
                        {last?.error ? ` · ${last.error}` : ""}
                      </span>
                      <button
                        type="button"
                        className="admin-batch-run-btn"
                        disabled={isRunning}
                        onClick={handleRunDramBatch}
                      >
                        {isRunning ? "실행 중..." : "수동 재실행"}
                      </button>
                    </div>
                  </div>
                );
              })()
            )}
            {dramRunError && <p className="admin-batch-error">{dramRunError}</p>}
          </div>

          {/* ── 예측 메일 발송 ──
              Same shape as the batch rows above deliberately: status pill, what it is,
              when it last happened, and one button that does the thing. The scheduled
              send caps each stock at one mail a day; this button is the documented way
              past that, so the confirm dialog says so rather than leaving an operator
              to discover it by pressing twice. */}
          <h2 className="admin-mail-heading">
            <span className="admin-live-dot" /> 예측 메일 발송
            {mailStatus &&
              (mailStatus.configured ? (
                <span className="admin-mail-backend">
                  {mailStatus.backend === "resend" ? "API 발송" : "SMTP 발송"}
                </span>
              ) : (
                <span className="admin-mail-unconfigured">발송 설정 필요</span>
              ))}
          </h2>
          <div className="admin-batch-body">
            {mailStatus === null ? (
              <div className="admin-batch-row">
                <span className="admin-skeleton admin-skeleton--row" />
              </div>
            ) : mailStatus.accounts.length === 0 ? (
              <p className="admin-empty">구독 중인 계정이 없습니다.</p>
            ) : (
              <>
                {mailStatus.accounts.map((acct) => {
                  const busy = mailSending === acct.id;
                  const codes = acct.stocks.filter((s) => s.active);
                  return (
                    <div key={acct.id} className="admin-batch-item">
                      <div className="admin-batch-row">
                        <span
                          className={`admin-batch-status admin-batch-status--${
                            busy ? "running" : acct.sent_today > 0 ? "ok" : "idle"
                          }`}
                        >
                          {busy ? "발송 중" : acct.sent_today > 0 ? `오늘 ${acct.sent_today}건` : "미발송"}
                        </span>
                        <span className="admin-batch-name admin-mail-addr">{acct.email}</span>
                        <span className="admin-batch-meta">
                          {codes.length}종목 ·{" "}
                          {acct.last_sent_at
                            ? `최근 ${formatDateTime(acct.last_sent_at)}`
                            : "발송 이력 없음"}
                        </span>
                        <button
                          type="button"
                          className="admin-batch-run-btn"
                          disabled={mailSending !== null || !mailStatus.configured}
                          onClick={() => handleSendMail(acct.id, acct.email)}
                        >
                          {busy ? "발송 중..." : "수기 발송"}
                        </button>
                      </div>
                      <div className="admin-batch-detail">
                        {codes.map((s) => (
                          <span key={s.code} className="admin-mail-code">
                            {s.name ?? s.code}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {mailStatus.accounts.length > 1 && (
                  <div className="admin-batch-row admin-mail-allrow">
                    <span className="admin-batch-meta">구독 중인 전체 계정에 한 번에 발송</span>
                    <button
                      type="button"
                      className="admin-batch-run-btn"
                      disabled={mailSending !== null || !mailStatus.configured}
                      onClick={() => handleSendMail(undefined, "구독 중인 모든 계정")}
                    >
                      {mailSending === "*" ? "발송 중..." : "전체 수기 발송"}
                    </button>
                  </div>
                )}
              </>
            )}
            {mailResult && <p className="admin-mail-result">{mailResult}</p>}
            {mailError && <p className="admin-batch-error">{mailError}</p>}

            <h3 className="admin-notify-section-title">발송 이력</h3>
            {mailHistory === null ? (
              <span className="admin-skeleton admin-skeleton--row" />
            ) : mailHistory.length === 0 ? (
              <p className="admin-empty">발송 이력이 없습니다.</p>
            ) : (
              <div className="admin-mail-log">
                {mailHistory.map((h, i) => (
                  <div key={i} className="admin-mail-log-row">
                    <span
                      className={`admin-mail-log-status admin-mail-log-status--${
                        h.status === "sent" ? "ok" : "fail"
                      }`}
                    >
                      {h.status === "sent" ? "성공" : "실패"}
                    </span>
                    <span className="admin-mail-log-stock">{h.stock_name ?? h.stock_code}</span>
                    <span className="admin-mail-log-addr">{h.email}</span>
                    <span className="admin-mail-log-kind">{h.manual ? "수기" : "자동"}</span>
                    <span className="admin-mail-log-time">{formatDateTime(h.sent_at)}</span>
                    {h.error && <span className="admin-mail-log-error">{h.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>

          <div className="admin-batch-half admin-notify-half">
            <h2>
              <span className="admin-live-dot" /> 카카오 알림
            </h2>

            {(() => {
              // One token backs both notification types, so this warning belongs to the
              // card rather than either section. Only the refresh token is worth
              // surfacing: the access token refreshes itself every few hours, while the
              // refresh token expires roughly every 2 months and takes both
              // notifications down until scripts/kakao_get_refresh_token.py is run again
              // — silently, unless something says so before the deadline.
              const expiresAt =
                kakaoVisitorStatus?.token?.refresh_expires_at ??
                kakaoPredictionStatus?.token?.refresh_expires_at ??
                null;
              if (!expiresAt) return null;
              const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
              if (daysLeft > 14) return null;
              return (
                <p className="admin-batch-error">
                  {daysLeft <= 0
                    ? `카카오 refresh 토큰이 만료되었습니다 (${formatDateTime(expiresAt)}). scripts/kakao_get_refresh_token.py로 재발급이 필요합니다.`
                    : `카카오 refresh 토큰이 ${Math.ceil(daysLeft)}일 뒤 만료됩니다 (${formatDateTime(expiresAt)}). scripts/kakao_get_refresh_token.py로 재발급해 주세요.`}
                </p>
              );
            })()}

            <div className="admin-notify-section">
              <h3 className="admin-notify-section-title">사이트 방문자 현황</h3>
              <div className="admin-notify-body">
                {(() => {
                  const last = kakaoVisitorStatus?.last_run ?? null;
                  const configured = kakaoVisitorStatus?.configured ?? false;
                  const tone = kakaoVisitorRunning
                    ? "running"
                    : !configured
                      ? "neutral"
                      : last
                        ? last.status === "sent" ||
                          last.status === "skipped_recent" ||
                          last.status === "skipped_quiet_hours"
                          ? "ok"
                          : "fail"
                        : "neutral";
                  const statusLabel = kakaoVisitorRunning
                    ? "발송 중"
                    : !configured
                      ? "미설정"
                      : last
                        ? last.status === "sent"
                          ? "성공"
                          : last.status === "skipped_recent"
                            ? "스킵"
                            : last.status === "skipped_quiet_hours"
                              ? "스킵(새벽)"
                              : last.status === "error"
                                ? "실패"
                                : "미설정"
                        : "기록 없음";
                  const triggeredLabel =
                    last?.triggered_by === "admin"
                      ? "수동"
                      : last?.triggered_by === "in_process"
                        ? "자동(서버)"
                        : last?.triggered_by === "cron"
                          ? "자동(cron)"
                          : null;
                  const metaText = !configured
                    ? "REST API 키 · 토큰 설정이 필요합니다."
                    : last
                      ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` +
                        (last.status === "error" && last.error ? ` · ${last.error}` : "") +
                        (last.status === "skipped_recent" && last.last_sent_at
                          ? ` · 최근 발송 ${formatDateTime(last.last_sent_at)}`
                          : "") +
                        (last.status === "skipped_quiet_hours" ? " · 새벽 1~5시는 발송하지 않습니다" : "")
                      : "아직 실행 이력이 없습니다.";
                  return kakaoVisitorStatus === null ? (
                    <div className="admin-batch-row">
                      <span className="admin-skeleton admin-skeleton--row" />
                    </div>
                  ) : (
                    <div className="admin-batch-item">
                      <div className="admin-batch-row">
                        <span className={`admin-batch-status admin-batch-status--${tone}`}>{statusLabel}</span>
                        <span className="admin-batch-meta">{metaText}</span>
                        <button
                          type="button"
                          className="admin-batch-run-btn"
                          disabled={kakaoVisitorRunning}
                          onClick={handleRunKakaoVisitorNotify}
                        >
                          {kakaoVisitorRunning ? "발송 중..." : "지금 발송"}
                        </button>
                      </div>
                      {last?.message && <pre className="admin-notify-message">{last.message}</pre>}
                    </div>
                  );
                })()}
                {kakaoVisitorError && <p className="admin-batch-error">{kakaoVisitorError}</p>}
              </div>
            </div>

            <div className="admin-notify-section">
              <h3 className="admin-notify-section-title">AI 예측 배치 실행결과</h3>
              <div className="admin-notify-body">
                {kakaoPredictionStatus === null ? (
                  <div className="admin-batch-row">
                    <span className="admin-skeleton admin-skeleton--row" />
                  </div>
                ) : (
                  (["KR", "US"] as BatchRegion[]).map((region) => {
                    const regionLabel = region === "KR" ? "한국장 (코스피·코스닥)" : "미국장 (나스닥)";
                    const configured = kakaoPredictionStatus?.configured ?? false;
                    const last = kakaoPredictionStatus?.last_runs[region] ?? null;
                    const isSending = kakaoPredictionRunning === region;
                    const tone = isSending
                      ? "running"
                      : !configured
                        ? "neutral"
                        : last
                          ? last.status === "sent"
                            ? "ok"
                            : "fail"
                          : "neutral";
                    const statusLabel = isSending
                      ? "발송 중"
                      : !configured
                        ? "미설정"
                        : last
                          ? last.status === "sent"
                            ? "성공"
                            : last.status === "error"
                              ? "실패"
                              : "미설정"
                          : "기록 없음";
                    const triggeredLabel = last?.triggered_by === "admin" ? "수동" : last?.triggered_by === "auto_delayed" ? "자동(10분 지연)" : null;
                    const metaText = !configured
                      ? "REST API 키 · 토큰 설정이 필요합니다."
                      : last
                        ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` +
                          (last.status === "error" && last.error ? ` · ${last.error}` : "")
                        : "아직 실행 이력이 없습니다.";
                    return (
                      <div key={region} className="admin-batch-item">
                        <div className="admin-batch-row">
                          <span className={`admin-batch-status admin-batch-status--${tone}`}>{statusLabel}</span>
                          <span className="admin-batch-name">{regionLabel}</span>
                          <span className="admin-batch-meta">{metaText}</span>
                          <button
                            type="button"
                            className="admin-batch-run-btn"
                            disabled={kakaoPredictionRunning !== null}
                            onClick={() => handleRunKakaoPredictionNotify(region)}
                          >
                            {isSending ? "발송 중..." : "지금 발송"}
                          </button>
                        </div>
                        {last?.message && <pre className="admin-notify-message">{last.message}</pre>}
                      </div>
                    );
                  })
                )}
                {kakaoPredictionError && <p className="admin-batch-error">{kakaoPredictionError}</p>}
              </div>
            </div>

            <div className="admin-notify-section">
              <h3 className="admin-notify-section-title">D램 현물가격 배치 실행결과</h3>
              <div className="admin-notify-body">
                {kakaoDramStatus === null ? (
                  <div className="admin-batch-row">
                    <span className="admin-skeleton admin-skeleton--row" />
                  </div>
                ) : (
                  (() => {
                    const configured = kakaoDramStatus?.configured ?? false;
                    const last = kakaoDramStatus?.last_run ?? null;
                    const isSending = kakaoDramRunning;
                    const tone = isSending
                      ? "running"
                      : !configured
                        ? "neutral"
                        : last
                          ? last.status === "sent"
                            ? "ok"
                            : "fail"
                          : "neutral";
                    const statusLabel = isSending
                      ? "발송 중"
                      : !configured
                        ? "미설정"
                        : last
                          ? last.status === "sent"
                            ? "성공"
                            : last.status === "error"
                              ? "실패"
                              : "미설정"
                          : "기록 없음";
                    const triggeredLabel =
                      last?.triggered_by === "admin" ? "수동" : last?.triggered_by === "auto_delayed" ? "자동(10분 지연)" : null;
                    const metaText = !configured
                      ? "REST API 키 · 토큰 설정이 필요합니다."
                      : last
                        ? `${triggeredLabel ? `${triggeredLabel} · ` : ""}${formatDateTime(last.finished_at)}` +
                          (last.status === "error" && last.error ? ` · ${last.error}` : "")
                        : "아직 실행 이력이 없습니다.";
                    return (
                      <div className="admin-batch-item">
                        <div className="admin-batch-row">
                          <span className={`admin-batch-status admin-batch-status--${tone}`}>{statusLabel}</span>
                          <span className="admin-batch-name">DRAM 현물가격</span>
                          <span className="admin-batch-meta">{metaText}</span>
                          <button
                            type="button"
                            className="admin-batch-run-btn"
                            disabled={kakaoDramRunning}
                            onClick={handleRunKakaoDramNotify}
                          >
                            {isSending ? "발송 중..." : "지금 발송"}
                          </button>
                        </div>
                        {last?.message && <pre className="admin-notify-message">{last.message}</pre>}
                      </div>
                    );
                  })()
                )}
                {kakaoDramError && <p className="admin-batch-error">{kakaoDramError}</p>}
              </div>
            </div>
          </div>
          </div>
          <span
            className="admin-panel-resize-handle"
            onPointerDown={batchPanel.onHandlePointerDown}
            aria-hidden="true"
          />
        </section>
        </div>
      </div>

      <Footer />
    </div>
  );
}
