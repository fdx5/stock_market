import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminAuthError,
  ActivityEvent,
  ApiPulseEvent,
  MonitorGraph,
  MonitorLockedError,
  adminApi,
  clearMonitorAccess,
  getMonitorAccess,
  getStoredSession,
  unlockMonitor,
} from "../adminApi";
import { layoutGraph, type MonitorLayout, type PlacedNode } from "../monitor/layout";
import { MonitorScene, type HoverInfo } from "../monitor/scene";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import DashboardIcon from "./DashboardIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import "./monitor.css";

/** How often the live signal is fetched. Fast enough that a click feels like it lights
 * the graph, slow enough that a page left open all day is not a load generator — and it
 * is cursor-based, so a poll that finds nothing costs a few dozen bytes. */
const POLL_MS = 1200;

/** Console lines kept in the DOM. Past a few hundred the panel is scrollback nobody
 * reads, and every extra line is a React child re-reconciled on each poll. */
const CONSOLE_MAX = 300;

/** How many endpoints a page node lights when a visitor lands on it, and how far the
 * resulting cascade travels. Fanout is capped because a page with a dozen calls firing
 * all at once reads as a flash rather than as a signal leaving somewhere. */
const PAGE_FANOUT = 4;
const PAGE_HOPS = 1;

type LogKind = "page_view" | "click" | "stock_view" | "hub" | "api" | "system";

interface LogLine {
  key: string;
  kind: LogKind;
  time: string;
  target: string;
  detail: string;
  /** Right-aligned trailing figure — request duration, or a status code. */
  meta: string;
  bad: boolean;
}

const KIND_LABEL: Record<LogKind, string> = {
  page_view: "PAGE",
  click: "CLICK",
  stock_view: "STOCK",
  hub: "MAIN",
  api: "API",
  system: "SYS",
};

const FILTERS: { key: LogKind; label: string }[] = [
  { key: "api", label: "API" },
  { key: "page_view", label: "페이지" },
  { key: "click", label: "클릭" },
  { key: "stock_view", label: "종목" },
  { key: "hub", label: "메인" },
];

function clockOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** The visitor's route as activity_log reports it, reduced to the path the graph knows.
 * Query strings carry the stock code and would never match a node. */
function routeOf(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

export default function MonitorPage() {
  useDocumentTitle("모니터 · K-Stock Hub");

  const canvasRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MonitorScene | null>(null);
  const layoutRef = useRef<MonitorLayout | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  /** Cursors live in a ref, not state: they change on every poll and nothing renders
   * from them, so putting them in state would be a re-render per second for nothing. */
  const cursors = useRef({ api: 0, activity: 0 });
  const pinnedRef = useRef(false);

  const [graph, setGraph] = useState<MonitorGraph | null>(null);
  // In state, not only in the ref: the legend and the header counters are derived from
  // it during render, and a ref written by a later effect never re-triggers that.
  const [layout, setLayout] = useState<MonitorLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [muted, setMuted] = useState<Set<LogKind>>(new Set());
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selected, setSelected] = useState<PlacedNode | null>(null);
  const [sessions, setSessions] = useState(0);
  const [rate, setRate] = useState(0);

  // The one admin surface that does not require the admin account: it can be opened
  // from outside with the monitor passcode alone, so a lost session drops back to the
  // lock screen in place rather than bouncing to the admin login.
  const [authed, setAuthed] = useState(() => !!getMonitorAccess());
  // Whether the viewer arrived through the admin dashboard or through the passcode.
  // The only thing it changes is the way back: a passcode viewer has no admin session,
  // so offering them a link into the dashboard would be a door that opens onto a login
  // screen they cannot pass.
  const [isAdmin, setIsAdmin] = useState(() => !!getStoredSession());

  const onAuthError = useCallback((err: unknown) => {
    if (err instanceof AdminAuthError) {
      clearMonitorAccess();
      setAuthed(false);
      setIsAdmin(false);
      // Dropping the graph is what tears the WebGL scene down: its effect keys on the
      // graph, and without this the renderer would keep drawing into a canvas that the
      // lock screen has already unmounted.
      setGraph(null);
      cursors.current = { api: 0, activity: 0 };
      return true;
    }
    return false;
  }, []);

  const pushLines = useCallback((incoming: LogLine[]) => {
    if (incoming.length === 0) return;
    setLines((prev) => {
      const next = prev.concat(incoming);
      return next.length > CONSOLE_MAX ? next.slice(next.length - CONSOLE_MAX) : next;
    });
  }, []);

  /* ─────────────────────────── graph load + scene boot ─────────────────────────── */

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    adminApi
      .monitorGraph()
      .then((res) => {
        if (!cancelled) setGraph(res);
      })
      .catch((err: unknown) => {
        if (cancelled || onAuthError(err)) return;
        setError(err instanceof Error ? err.message : "구조를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [authed, onAuthError]);

  useEffect(() => {
    if (!graph || !canvasRef.current || !labelRef.current) return;
    const layout = layoutGraph(graph);
    layoutRef.current = layout;
    setLayout(layout);

    const scene = new MonitorScene(canvasRef.current, labelRef.current);
    sceneRef.current = scene;
    scene.setGraph(layout);
    scene.onHover = setHover;
    scene.onSelect = setSelected;
    scene.start();

    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(canvasRef.current);

    // A WebGL scene left running in a hidden tab burns a GPU for nothing; the poll below
    // keeps collecting, so nothing is missed, it just isn't drawn.
    const onVisibility = () => (document.hidden ? scene.stop() : scene.start());
    document.addEventListener("visibilitychange", onVisibility);

    pushLines([
      {
        key: "boot",
        kind: "system",
        time: clockOf(Date.now()),
        target: "monitor",
        detail: `구조 로드 · 노드 ${layout.nodes.length} · 연결 ${layout.edges.length}`,
        meta: "",
        bad: false,
      },
      ...layout.warnings.map((w, i) => ({
        key: `warn-${i}`,
        kind: "system" as const,
        time: clockOf(Date.now()),
        target: "graph",
        detail: w,
        meta: "DRIFT",
        bad: true,
      })),
    ]);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [graph, pushLines]);

  /* ───────────────────────────────── live polling ───────────────────────────────── */

  useEffect(() => {
    if (!authed || !graph) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const pulse = await adminApi.monitorPulse(cursors.current.api, cursors.current.activity);
        if (cancelled) return;

        // The very first response is the buffer's existing backlog — structure worth
        // having as cursors, but replaying it as a burst of light would show minutes-old
        // traffic as if it were happening now.
        const priming = cursors.current.api === 0 && cursors.current.activity === 0;
        cursors.current = { api: pulse.api_cursor, activity: pulse.activity_cursor };
        setSessions(pulse.active_sessions);

        if (priming) {
          pushLines([
            {
              key: "primed",
              kind: "system",
              time: clockOf(Date.now()),
              target: "pulse",
              detail: "실시간 신호 수신 시작",
              meta: "",
              bad: false,
            },
          ]);
          return;
        }

        const scene = sceneRef.current;
        const layout = layoutRef.current;
        const fresh: LogLine[] = [];

        for (const event of pulse.activity) {
          fresh.push(activityLine(event));
          if (!scene || !layout) continue;
          const nodeId = layout.byPagePath.get(routeOf(event.path));
          if (!nodeId) continue;
          // A page view is a whole cascade; a click is the same node twitching.
          if (event.type === "page_view") scene.pulseFrom(nodeId, PAGE_FANOUT, PAGE_HOPS);
          else scene.fireNode(nodeId, 0.8);
        }

        for (const event of pulse.api) {
          fresh.push(apiLine(event));
          if (!scene || !layout) continue;
          const nodeId = layout.byApiPath.get(event.route);
          if (!nodeId) continue;
          scene.fireNode(nodeId, 1);
          // Push the signal onward to whatever the endpoint leans on, so the outer
          // shell of stores and upstream feeds lights from real traffic too.
          scene.pulseFrom(nodeId, 2, 0);
        }

        setRate(pulse.api.length + pulse.activity.length);
        pushLines(fresh);
      } catch (err) {
        if (cancelled || onAuthError(err)) return;
        // A dropped poll is not worth a banner — the next one is a second away.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authed, graph, onAuthError, pushLines]);

  /* ───────────────────────────────── console panel ───────────────────────────────── */

  const visible = useMemo(() => lines.filter((l) => l.kind === "system" || !muted.has(l.kind)), [lines, muted]);

  useEffect(() => {
    // Auto-scroll only while the operator is at the bottom. Scrolling them away from a
    // line they are reading is the classic way to make a live console useless.
    if (paused || pinnedRef.current) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, paused]);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 48;
  };

  const toggleFilter = (kind: LogKind) =>
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const groups = useMemo(() => {
    if (!layout) return [] as { group: string; color: string; count: number }[];
    const counts = new Map<string, { color: number; count: number }>();
    for (const node of layout.nodes) {
      const entry = counts.get(node.group);
      if (entry) entry.count += 1;
      else counts.set(node.group, { color: node.color, count: 1 });
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([group, v]) => ({ group, color: `#${v.color.toString(16).padStart(6, "0")}`, count: v.count }));
  }, [layout]);

  if (!authed) return <MonitorLock onUnlocked={() => setAuthed(true)} />;

  return (
    <div className="app monitor-page">
      <header className="app-header monitor-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="monitor-headline">
            <h1 className="monitor-title">뉴런 모니터</h1>
            <p className="monitor-subtitle">사이트 전체 구조와 실시간 신호 전달</p>
          </div>
        </div>
        <div className="monitor-stats">
          <Stat label="노드" value={layout?.nodes.length ?? 0} />
          <Stat label="연결" value={layout?.edges.length ?? 0} />
          <Stat label="접속 세션" value={sessions} live />
          <Stat label="신호/틱" value={rate} live />
          {isAdmin && (
            <Link to="/admin/dashboard" className="monitor-back">
              ← 관리자
            </Link>
          )}
        </div>
      </header>

      <div className="app-nav-row monitor-nav-row">
        <Link to="/desk" className="kospi-map-nav-link kospi-map-nav-link--home">
          <DashboardIcon /> 홈
        </Link>
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
      </div>

      {error && <div className="error-state">{error}</div>}

      <div className="monitor-body">
        <div className="monitor-stage">
          <div className="monitor-canvas" ref={canvasRef} />
          <div className="monitor-labels" ref={labelRef} />

          {!graph && !error && <div className="monitor-booting">뉴런 구조를 생성하는 중…</div>}

          {hover && (
            <div
              className="monitor-tip"
              style={{ transform: `translate(${hover.x + 14}px, ${hover.y - 10}px)` }}
            >
              <span className="monitor-tip-kind" data-kind={hover.node.kind}>
                {hover.node.kind === "page" ? "페이지" : hover.node.kind === "api" ? "API" : "데이터"}
              </span>
              <b>{hover.node.label}</b>
              {hover.node.path && <code>{hover.node.path}</code>}
            </div>
          )}

          <div className="monitor-legend">
            {groups.map((g) => (
              <span key={g.group} className="monitor-legend-item">
                <i style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
                {g.group}
                <b>{g.count}</b>
              </span>
            ))}
          </div>

          {/* Two sets, one shown per input kind by CSS: a tablet has no wheel, no right
              button and no arrow keys, so the mouse list is six lines of advice it
              cannot follow standing between the operator and the picture. */}
          <div className="monitor-help monitor-help--mouse">
            <span>드래그 회전</span>
            <span>휠 확대</span>
            <span>우클릭·Shift+드래그 이동</span>
            <span>←→↑↓ 회전</span>
            <span>Shift+방향키 이동</span>
            <span>+ / − 확대</span>
          </div>
          <div className="monitor-help monitor-help--touch">
            <span>한 손가락 회전</span>
            <span>두 손가락 확대·이동</span>
            <span>탭하면 정보</span>
          </div>

          {selected && (
            <div className="monitor-selected">
              <div className="monitor-selected-head">
                <span className="monitor-tip-kind" data-kind={selected.kind}>
                  {selected.kind === "page" ? "페이지" : selected.kind === "api" ? "API" : "데이터"}
                </span>
                <b>{selected.label}</b>
                <button type="button" onClick={() => setSelected(null)} aria-label="닫기">
                  ×
                </button>
              </div>
              {selected.path && <code>{selected.path}</code>}
              {selected.methods && <div className="monitor-selected-methods">{selected.methods.join(" · ")}</div>}
              <div className="monitor-selected-actions">
                <button type="button" onClick={() => sceneRef.current?.focusNode(selected.id)}>
                  이 노드로 이동
                </button>
                <button type="button" onClick={() => sceneRef.current?.pulseFrom(selected.id, 6, 2)}>
                  신호 테스트
                </button>
              </div>
            </div>
          )}

          <button type="button" className="monitor-reset" onClick={() => sceneRef.current?.resetView()}>
            시점 초기화
          </button>
        </div>

        <aside className="monitor-console">
          <div className="monitor-console-head">
            <span className="monitor-console-title">
              <i className="monitor-dot" /> EVENT STREAM
            </span>
            <button
              type="button"
              className={`monitor-console-pause${paused ? " is-on" : ""}`}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "재개" : "일시정지"}
            </button>
          </div>
          <div className="monitor-console-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`monitor-chip${muted.has(f.key) ? " is-off" : ""}`}
                data-kind={f.key}
                onClick={() => toggleFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="monitor-chip monitor-chip--clear" onClick={() => setLines([])}>
              지우기
            </button>
          </div>
          <div className="monitor-console-body" ref={logRef} onScroll={onLogScroll}>
            {visible.map((line) => (
              <div key={line.key} className={`monitor-line${line.bad ? " is-bad" : ""}`} data-kind={line.kind}>
                <span className="monitor-line-time">{line.time}</span>
                <span className="monitor-line-kind">{KIND_LABEL[line.kind]}</span>
                <span className="monitor-line-target">{line.target}</span>
                <span className="monitor-line-detail">{line.detail}</span>
                <span className="monitor-line-meta">{line.meta}</span>
              </div>
            ))}
            {visible.length === 0 && <div className="monitor-line monitor-line--empty">신호 대기 중…</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The door.
 *
 * The monitor is the one admin surface meant to be openable from outside, so it asks
 * for its own passcode rather than for the admin account — a link can be handed to
 * someone without handing over the dashboard, the DB console and the batch triggers
 * along with it. An admin session is strictly more than this buys, so anyone already
 * logged in never sees this screen (see adminApi's getMonitorAccess).
 */
function MonitorLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !passcode) return;
    setError(null);
    setBusy(true);
    try {
      await unlockMonitor(passcode);
      onUnlocked();
    } catch (err) {
      // The server's own message carries the useful part — a wrong passcode reads
      // differently from "too many tries, wait 4 minutes", and the visitor needs to
      // know which one they are looking at.
      setError(err instanceof MonitorLockedError ? err.message : "잠금을 해제하지 못했습니다.");
      setPasscode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="monitor-lock">
      <form className="monitor-lock-card" onSubmit={handleSubmit}>
        <div className="monitor-lock-badge">
          <i />
          <i />
          <i />
        </div>
        <h1 className="monitor-lock-title">뉴런 모니터</h1>
        <p className="monitor-lock-subtitle">
          사이트 구조와 실시간 신호를 보는 화면입니다.
          <br />
          접속 패스코드를 입력해 주세요.
        </p>
        <label className="monitor-lock-field">
          <span>패스코드</span>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error && <p className="monitor-lock-error">{error}</p>}
        <button type="submit" className="monitor-lock-submit" disabled={busy || !passcode}>
          {busy ? "확인 중…" : "입장"}
        </button>
        <Link to="/" className="monitor-lock-back">
          ← 홈으로
        </Link>
      </form>
    </div>
  );
}

function Stat({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <span className={`monitor-stat${live ? " is-live" : ""}`}>
      <b>{value}</b>
      {label}
    </span>
  );
}

function activityLine(event: ActivityEvent): LogLine {
  const detail =
    event.type === "stock_view"
      ? `${event.stock_name ?? ""} ${event.stock_code ?? ""}`.trim()
      : event.type === "hub"
        ? // A dwell row's number IS its content; everything else on the
          // entrance page is named by its label.
          event.action === "dwell"
          ? `체류 ${Math.round(event.value ?? 0)}초`
          : event.label ?? event.object_key ?? "메인"
        : event.label ?? routeOf(event.path);
  return {
    key: `a${event.id}`,
    kind: event.type,
    time: clockOf(Date.parse(event.created_at)),
    target: routeOf(event.path),
    detail,
    meta: event.session_id.slice(0, 6),
    bad: false,
  };
}

function apiLine(event: ApiPulseEvent): LogLine {
  return {
    key: `p${event.id}`,
    kind: "api",
    time: clockOf(event.ts * 1000),
    target: event.route.replace(/^\/api\//, ""),
    detail: `${event.method} ${event.status}`,
    meta: `${event.ms}ms`,
    bad: event.status >= 400,
  };
}
