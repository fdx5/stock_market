import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActiveSession,
  ActivityEvent,
  AdminAuthError,
  HubAction,
  HubSessionEvent,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { Link, navigate } from "../router";
import { pageLabel } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import StockLogo from "./StockLogo";
import "./adminLive.css";

/* A single-purpose mobile screen: just the two live panels the classic dashboard
 * buries halfway down a desktop grid (실시간 세션 / 실시간 로그), pulled onto their own
 * route so a phone can open this one URL and watch the site breathe without paying
 * for the growth chart, the comment table, or any of the batch panels around them.
 *
 * Polling is faster than the dashboard's (2.5s vs 3s for the tail) since this page
 * has nothing else competing for the round trip, and the newest row is what a visitor
 * checking this on a phone actually came to see.
 */

const TAIL_POLL_MS = 2_500;
const SESSIONS_POLL_MS = 5_000;
const TAIL_LIMIT = 120;
/** Past this scroll depth a fresh poll no longer replaces the list in place — see
 * the pause/resume handling below. */
const PAUSE_SCROLL_PX = 48;
const RESUME_SCROLL_PX = 8;

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

const HUB_ACTION_LABEL: Record<HubAction, string> = {
  object_click: "천체 클릭",
  control: "조작",
  bgm: "BGM",
  focus: "주목",
  dwell: "체류",
  exit: "이동",
};

const HUB_ACTION_COLOR: Record<HubAction, string> = {
  object_click: "--series-violet",
  control: "--series-blue",
  bgm: "--series-aqua",
  focus: "--series-amber",
  dwell: "--text-muted",
  exit: "--series-green",
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}분 ${total % 60}초`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
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

function avatarColorVar(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SERIES_VARS[hash % SERIES_VARS.length];
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour12: false });
}

function formatEventClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
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
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export default function AdminLivePage() {
  useDocumentTitle("실시간 로그 · K-Stock Hub Admin");
  const [authed] = useState(() => !!getStoredSession());

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  function handleAuthError(err: unknown) {
    if (err instanceof AdminAuthError) {
      clearStoredSession();
      navigate("/admin");
    }
  }

  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  /** The latest poll, always kept current regardless of scroll position — this is
   * what "N개" in the resume pill counts against. */
  const [freshTail, setFreshTail] = useState<ActivityEvent[] | null>(null);
  /** What is actually on screen. Diverges from freshTail only while paused. */
  const [committedTail, setCommittedTail] = useState<ActivityEvent[] | null>(null);
  const [scope, setScope] = useState<"all" | "hub">("all");
  const [openTrail, setOpenTrail] = useState<string | null>(null);
  const [trail, setTrail] = useState<HubSessionEvent[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connectionOk, setConnectionOk] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);

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
    const id = setInterval(load, SESSIONS_POLL_MS);
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
        .tail(TAIL_LIMIT)
        .then((r) => {
          if (cancelled) return;
          setFreshTail(r.events);
          setLastUpdated(new Date());
          setConnectionOk(true);
        })
        .catch((err) => {
          if (cancelled) return;
          setConnectionOk(false);
          handleAuthError(err);
        });
    };
    load();
    const id = setInterval(load, TAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Rows only reach the screen here — every poll above lands in freshTail no matter
  // what the visitor is doing, and this is the one gate that decides whether the
  // visible list moves. Paused, it holds still so a thumb mid-read never gets yanked.
  useEffect(() => {
    if (freshTail === null || paused) return;
    setCommittedTail(freshTail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshTail, paused]);

  const pendingCount = useMemo(() => {
    if (!paused || !freshTail || !committedTail) return 0;
    const known = new Set(committedTail.map((e) => e.id));
    return freshTail.filter((e) => !known.has(e.id)).length;
  }, [paused, freshTail, committedTail]);

  const resume = () => {
    setPaused(false);
    if (freshTail) setCommittedTail(freshTail);
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop > PAUSE_SCROLL_PX) {
      setPaused((p) => (p ? p : true));
    } else if (el.scrollTop <= RESUME_SCROLL_PX) {
      setPaused((p) => (p ? false : p));
    }
  };

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
        setOpenTrail((current) => {
          if (current === sessionId) setTrail(res.events);
          return current;
        });
      })
      .catch(handleAuthError);
  };

  const shownTail = (committedTail ?? []).filter((e) => scope === "all" || e.type === "hub");
  const hubCount = (committedTail ?? []).filter((e) => e.type === "hub").length;

  return (
    <div className="admin-live-page">
      <header className="admin-live-topbar">
        <Link to="/admin/dashboard" className="admin-live-back" aria-label="대시보드로 돌아가기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="admin-live-title-wrap">
          <h1>
            <span className={`admin-live-pulse${connectionOk ? "" : " admin-live-pulse--off"}`} />
            실시간 로그
          </h1>
          <span className="admin-live-updated">
            {lastUpdated ? (connectionOk ? `${formatClock(lastUpdated)} 갱신` : "연결 끊김 · 재시도 중") : "연결 중..."}
          </span>
        </div>
        <button
          type="button"
          className="admin-live-logout"
          onClick={() => {
            clearStoredSession();
            navigate("/admin");
          }}
          aria-label="로그아웃"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </header>

      <div className="admin-live-sessions-strip">
        <div className="admin-live-sessions-track">
          {sessions === null &&
            [0, 1, 2].map((i) => (
              <span key={i} className="admin-skeleton admin-live-session-chip admin-live-session-chip--skeleton" />
            ))}
          {sessions?.length === 0 && <span className="admin-live-sessions-empty">활성 세션이 없습니다</span>}
          {sessions?.map((s) => (
            <div key={s.session_id} className="admin-live-session-chip">
              <span className="admin-live-session-avatar" style={{ background: `var(${avatarColorVar(s.session_id)})` }}>
                {initials(s.session_id)}
              </span>
              <span className="admin-live-session-body">
                <span className="admin-live-session-id">{shortSession(s.session_id)}</span>
                <span className="admin-live-session-page">
                  {s.stock_code ? (
                    <>
                      <StockLogo code={s.stock_code} className="admin-live-session-stock-icon" />
                      {s.stock_name}
                    </>
                  ) : (
                    pageLabel(s.path)
                  )}
                </span>
              </span>
              <span className="admin-live-session-time">{timeAgo(s.last_seen)}</span>
            </div>
          ))}
        </div>
        {sessions !== null && sessions.length > 0 && (
          <span className="admin-live-sessions-count">{sessions.length}</span>
        )}
      </div>

      <div className="admin-live-tabs" role="group" aria-label="로그 범위">
        <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")} aria-pressed={scope === "all"}>
          전체
        </button>
        <button type="button" className={scope === "hub" ? "active" : ""} onClick={() => setScope("hub")} aria-pressed={scope === "hub"}>
          메인 행동
          {hubCount > 0 && <span className="admin-live-tab-count">{hubCount}</span>}
        </button>
      </div>

      <div className="admin-live-list" ref={listRef} onScroll={handleScroll}>
        {paused && pendingCount > 0 && (
          <button type="button" className="admin-live-jump" onClick={resume}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            새 로그 {pendingCount}개
          </button>
        )}

        {committedTail === null &&
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="admin-live-row admin-live-row--skeleton" aria-hidden="true">
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
            <div
              key={e.id}
              className="admin-live-row"
              style={{ borderLeftColor: `var(${badgeColor})` }}
            >
              <div className="admin-live-row-main">
                <span className="admin-live-row-time">{formatEventClock(e.created_at)}</span>
                {hub ? (
                  <button
                    type="button"
                    className={`admin-live-row-session admin-live-row-session--btn${open ? " is-open" : ""}`}
                    onClick={() => toggleTrail(e.session_id)}
                  >
                    {shortSession(e.session_id)}
                  </button>
                ) : (
                  <span className="admin-live-row-session">{shortSession(e.session_id)}</span>
                )}
                <span className="admin-live-row-badge" style={{ color: `var(${badgeColor})` }}>
                  <TypeIcon type={e.type} className="admin-live-row-badge-icon" />
                  {badgeLabel}
                </span>
              </div>
              <div className="admin-live-row-detail">
                {e.type === "stock_view" && e.stock_code ? (
                  <>
                    <StockLogo code={e.stock_code} className="admin-live-row-stock-icon" />
                    {e.stock_name} <span className="admin-live-row-detail-muted">({e.stock_code})</span>
                  </>
                ) : hub ? (
                  e.action === "dwell" ? (
                    <>
                      체류 <strong>{formatDuration(e.value ?? 0)}</strong>
                    </>
                  ) : (
                    <>
                      {e.label ?? e.object_key ?? "메인"}
                      {e.object_key && <span className="admin-live-row-key">{e.object_key}</span>}
                    </>
                  )
                ) : e.label ? (
                  `${pageLabel(e.path)} · ${e.label}`
                ) : (
                  pageLabel(e.path)
                )}
              </div>
              {open && (
                <div className="admin-live-trail">
                  {trail === null ? (
                    <span className="admin-live-trail-loading">불러오는 중...</span>
                  ) : trail.length === 0 ? (
                    <span className="admin-live-trail-empty">기록된 행동이 없습니다.</span>
                  ) : (
                    trail.map((t, i) => (
                      <div key={`${t.created_at}${i}`} className="admin-live-trail-row">
                        <span className="admin-live-trail-time">{formatEventClock(t.created_at)}</span>
                        <span className="admin-live-trail-kind" style={{ color: `var(${HUB_ACTION_COLOR[t.action] ?? "--text-muted"})` }}>
                          {HUB_ACTION_LABEL[t.action] ?? t.action}
                        </span>
                        <span className="admin-live-trail-label">
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

        {committedTail !== null && shownTail.length === 0 && (
          <p className="admin-live-empty">{scope === "hub" ? "메인 페이지 행동을 기다리는 중..." : "이벤트를 기다리는 중..."}</p>
        )}
      </div>
    </div>
  );
}
