import { useEffect, useMemo, useState } from "react";
import {
  ActiveSession,
  ActivityEvent,
  AdminAuthError,
  AdminSummary,
  TrendPoint,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { navigate } from "../router";
import { pageLabel } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import StockIcon from "./StockIcon";

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

function formatBucket(bucket: string): string {
  // Hourly bucket "2026-07-20T14" or daily bucket "2026-07-20".
  if (bucket.length > 10) return `${bucket.slice(11, 13)}시`;
  return bucket.slice(5).replace("-", "/");
}

/** Uniform Catmull-Rom → cubic Bezier conversion, so the trend line reads as a
 * smooth curve instead of sharp polyline joints, while still passing exactly
 * through every data point. */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]},${points[0][1]}`;
  let d = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
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
}

export default function AdminDashboardPage() {
  useDocumentTitle("관리자 대시보드 | K-Stock Hub");
  const [authed] = useState(() => !!getStoredSession());
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [tail, setTail] = useState<ActivityEvent[] | null>(null);
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

  const { series, categories, maxCount } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of trendPoints) totals.set(p.path, (totals.get(p.path) ?? 0) + p.count);
    const orderedPaths = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
    const topPaths = orderedPaths.slice(0, SERIES_VARS.length);
    const otherPaths = orderedPaths.slice(SERIES_VARS.length);
    const buckets = [...new Set(trendPoints.map((p) => p.bucket))].sort();

    const valueOf = (path: string, bucket: string) =>
      trendPoints.find((p) => p.path === path && p.bucket === bucket)?.count ?? 0;

    const seriesData: Series[] = topPaths.map((path, i) => ({
      path,
      label: pageLabel(path),
      colorVar: SERIES_VARS[i],
      values: buckets.map((b) => valueOf(path, b)),
    }));
    if (otherPaths.length > 0) {
      seriesData.push({
        path: "__other__",
        label: "기타",
        colorVar: "--text-muted",
        values: buckets.map((b) => otherPaths.reduce((sum, path) => sum + valueOf(path, b), 0)),
      });
    }
    const maxCount = Math.max(1, ...seriesData.flatMap((s) => s.values));
    return { series: seriesData, categories: buckets, maxCount };
  }, [trendPoints]);

  if (!authed) return null;

  const visibleSeries = series.filter((s) => !hiddenSeries.has(s.path));

  const width = 760;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const xStep = categories.length > 1 ? innerW / (categories.length - 1) : 0;
  const xAt = (i: number) => padding.left + i * xStep;
  // 8% headroom at the top so the smoothed curve's gentle overshoot on sharp
  // peaks never clips against the chart edge.
  const yAt = (v: number) => padding.top + innerH * (1 - (v / maxCount) * 0.92);
  const baselineY = padding.top + innerH;
  const yTicks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCount * f)))];
  const tickStride = Math.max(1, Math.ceil(categories.length / 6));

  return (
    <div className="admin-dash-page">
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
            <button className={range === "24h" ? "active" : ""} onClick={() => setRange("24h")}>
              24시간
            </button>
            <button className={range === "7d" ? "active" : ""} onClick={() => setRange("7d")}>
              7일
            </button>
          </div>
        </div>
        {!trendLoaded ? (
          <div className="admin-skeleton admin-skeleton--chart" />
        ) : categories.length === 0 ? (
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
              <defs>
                {visibleSeries.map((s, i) => (
                  <linearGradient key={s.path} id={`admin-trend-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={`var(${s.colorVar})`} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={`var(${s.colorVar})`} stopOpacity="0" />
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
              {hoverIndex !== null && (
                <line
                  x1={xAt(hoverIndex)}
                  x2={xAt(hoverIndex)}
                  y1={padding.top}
                  y2={baselineY}
                  stroke="var(--baseline)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}
              {visibleSeries.map((s, i) => {
                const points: [number, number][] = s.values.map((v, vi) => [xAt(vi), yAt(v)]);
                const line = smoothPath(points);
                const area =
                  points.length > 1
                    ? `${line} L ${xAt(points.length - 1)},${baselineY} L ${xAt(0)},${baselineY} Z`
                    : "";
                const dimmed = activeLegend !== null && activeLegend !== s.path;
                return (
                  <g key={s.path} className="admin-trend-series" style={{ opacity: dimmed ? 0.18 : 1 }}>
                    {area && <path d={area} fill={`url(#admin-trend-grad-${i})`} stroke="none" />}
                    <path
                      d={line}
                      fill="none"
                      stroke={`var(${s.colorVar})`}
                      strokeWidth={activeLegend === s.path ? 3 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              })}
              {visibleSeries.map((s) => {
                const lastI = s.values.length - 1;
                return (
                  <circle
                    key={`${s.path}-end`}
                    cx={xAt(lastI)}
                    cy={yAt(s.values[lastI])}
                    r={4}
                    fill={`var(${s.colorVar})`}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                    opacity={activeLegend !== null && activeLegend !== s.path ? 0.18 : 1}
                  />
                );
              })}
              {hoverIndex !== null &&
                visibleSeries.map((s) => (
                  <circle
                    key={`${s.path}-hover`}
                    cx={xAt(hoverIndex)}
                    cy={yAt(s.values[hoverIndex])}
                    r={3.5}
                    fill={`var(${s.colorVar})`}
                    stroke="var(--surface-1)"
                    strokeWidth={1.5}
                  />
                ))}
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
      </section>

      <div className="admin-panels-grid">
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
    </div>
  );
}
