import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  AdminAuthError,
  AdminHealth,
  AdminHealthLog,
  AdminSummary,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { pageLabel } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import AdminCommentsPanel from "./AdminCommentsPanel";
import AdminOpsPanel from "./AdminOpsPanel";
import AdminTrafficSection from "./AdminTrafficSection";
import LiveSessionsAndLog, { LiveStatus } from "./LiveSessionsAndLog";
import "./adminLive.css";
import "./adminDashboard.css";
import "./adminConsole.css";

/* 관리자 콘솔. 왼쪽 메뉴로 나뉜 여섯 화면 — 개요(상태판), 트래픽, 실시간, 운영·배치,
 * 시스템, 댓글 — 과 모든 화면 위의 상태 표시줄. 개요와 시스템은 /api/admin/health
 * (system_health.py)를 15초마다 읽는다: 서버·DB·백그라운드 작업·수집기 상태와 최근
 * 경고·오류 로그. 각 묶음은 따로 불러오고 따로 실패하며, 실패한 곳은 마지막 값과
 * 오류, 재시도를 보인다 — 하나가 늦어 화면 전체가 "로딩 중"에 머무는 일이 없게. */

type Section = "overview" | "traffic" | "live" | "ops" | "system" | "comments";

const SECTIONS: { key: Section; label: string; hint: string }[] = [
  { key: "overview", label: "개요", hint: "상태판" },
  { key: "traffic", label: "트래픽", hint: "방문·순위" },
  { key: "live", label: "실시간", hint: "세션·로그" },
  { key: "ops", label: "운영·배치", hint: "예측·메일·알림" },
  { key: "system", label: "시스템", hint: "DB·수집·오류" },
  { key: "comments", label: "댓글", hint: "관리" },
];

type Level = "ok" | "warn" | "down" | "unknown";

const LEVEL_TEXT: Record<Level, string> = { ok: "정상", warn: "주의", down: "장애", unknown: "확인 중" };

function sectionFromHash(): Section {
  const h = window.location.hash.replace("#", "") as Section;
  return SECTIONS.some((s) => s.key === h) ? h : "overview";
}

function clock(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("ko-KR", { hour12: false });
}

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
}

function pct(v: number | undefined): string {
  return v === undefined ? "—" : `${(v * 100).toFixed(v >= 0.995 || v === 0 ? 0 : 1)}%`;
}

/** The whole server in one word, from what /health reports. */
function assess(health: AdminHealth | null, failing: boolean): { level: Level; reasons: string[] } {
  if (!health) return { level: failing ? "down" : "unknown", reasons: failing ? ["상태 정보를 받지 못함"] : [] };
  const reasons: string[] = [];
  let level: Level = "ok";
  const raise = (to: Level, why: string) => {
    reasons.push(why);
    if (to === "down" || level === "ok") level = to;
  };
  if (failing) raise("warn", "상태 갱신 실패 (마지막 값 표시)");
  if (!health.db.ok) raise("down", "DB 응답 없음");
  else if (health.db.ms > 1500) raise("warn", `DB 응답 느림 ${health.db.ms}ms`);
  const open = health.gates.filter((g) => g.open);
  if (open.length) raise("down", `저장소 차단: ${open.map((g) => g.name).join(", ")}`);
  if (health.errors_last_hour > 0) raise("warn", `최근 1시간 오류 ${health.errors_last_hour}건`);
  if (health.realestate.last_error) raise("warn", "부동산 수집 오류");
  return { level, reasons };
}

function usePolled<T>(fetch: () => Promise<T>, everyMs: number, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () =>
      fetch()
        .then((v) => {
          if (cancelled) return;
          setData(v);
          setError(null);
          setAt(new Date());
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof AdminAuthError) {
            clearStoredSession();
            navigate("/admin");
            return;
          }
          setError(err instanceof Error ? err.message : String(err));
        });
    load();
    const stop = startVisibilityAwareInterval(load, everyMs);
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, everyMs, tick]);
  return { data, error, at, retry: () => setTick((t) => t + 1) };
}

function Card({
  title,
  level,
  children,
  foot,
}: {
  title: string;
  level?: Level;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <section className={`ac-card${level ? ` is-${level}` : ""}`}>
      <header>
        {level && <i className="ac-dot" aria-hidden="true" />}
        <h3>{title}</h3>
      </header>
      <div className="ac-card-body">{children}</div>
      {foot && <footer>{foot}</footer>}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="ac-metric">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Failed({ error, at, retry }: { error: string | null; at: Date | null; retry: () => void }) {
  if (!error) return null;
  return (
    <div className="admin-load-error" role="alert">
      <span>
        불러오지 못했습니다 — {error}
        {at && ` · ${clock(at)} 값 표시 중`}
      </span>
      <button type="button" onClick={retry}>
        다시 시도
      </button>
    </div>
  );
}

function LogList({ logs, limit }: { logs: AdminHealthLog[]; limit?: number }) {
  const rows = limit ? logs.slice(0, limit) : logs;
  if (!rows.length) return <p className="ac-empty">최근 경고·오류가 없습니다.</p>;
  return (
    <ul className="ac-logs">
      {rows.map((r, i) => (
        <li key={`${r.at}-${i}`} className={`is-${r.level.toLowerCase()}`}>
          <time>{r.at.slice(5, 16).replace("T", " ")}</time>
          <em>{r.level === "WARNING" ? "경고" : r.level === "ERROR" ? "오류" : r.level}</em>
          <code>{r.logger}</code>
          <p>{r.message}</p>
        </li>
      ))}
    </ul>
  );
}

function Overview({
  health,
  healthState,
  summary,
  summaryState,
  go,
}: {
  health: AdminHealth | null;
  healthState: { error: string | null; at: Date | null; retry: () => void };
  summary: AdminSummary | null;
  summaryState: { error: string | null; at: Date | null; retry: () => void };
  go: (s: Section) => void;
}) {
  const re = health?.realestate;
  const gateTrouble = health ? health.gates.reduce((n, g) => n + g.busy_rejects + g.errors, 0) : 0;
  const problems = (health?.logs ?? []).filter((l) => l.level !== "INFO");
  const dbLevel: Level = !health ? "unknown" : !health.db.ok ? "down" : health.db.ms > 1500 ? "warn" : "ok";
  const errLevel: Level = !health ? "unknown" : health.errors_last_hour > 0 ? "warn" : "ok";
  const moving = re?.migration?.needed && !re.migration.done;
  const reLevel: Level = !re ? "unknown" : re.error || re.last_error || re.rent_error || moving ? "warn" : "ok";
  return (
    <div className="ac-overview">
      <Failed {...healthState} />
      <div className="ac-grid ac-grid--4">
        <Card title="서버" level={health ? "ok" : "unknown"}>
          <Metric label="가동 시간" value={health ? duration(health.uptime_s) : "—"} sub={health ? `배포 ${health.commit}` : undefined} />
          <Metric label="메모리" value={health?.memory_mb ? `${health.memory_mb.toLocaleString()} MB` : "—"} />
        </Card>
        <Card title="데이터베이스" level={dbLevel}>
          <Metric label="응답 시간" value={health ? `${health.db.ms.toLocaleString()} ms` : "—"} sub={health?.db.error} />
          <Metric label="바쁨·오류 (누적)" value={health ? gateTrouble.toLocaleString() : "—"} sub={health ? `저장소 ${health.gates.length}개` : undefined} />
        </Card>
        <Card title="오류·경고 (1시간)" level={errLevel} foot={<button type="button" onClick={() => go("system")}>로그 전체 보기 →</button>}>
          <Metric label="오류" value={health ? health.errors_last_hour.toLocaleString() : "—"} />
          <Metric label="경고" value={health ? health.warnings_last_hour.toLocaleString() : "—"} />
        </Card>
        <Card
          title={moving ? `부동산 수집 · DB 이전 중 ${re?.migration?.rows.toLocaleString() ?? 0}행` : "부동산 수집"}
          level={reLevel}
          foot={<button type="button" onClick={() => go("system")}>수집 상세 →</button>}
        >
          <Metric label="최근 2년" value={pct(re?.recent_coverage)} sub={re?.history_from ? `과거 이력 ${pct(re.history_coverage)} (${re.history_from.slice(0, 4)}년~)` : undefined} />
          <Metric
            label="오늘 API 호출"
            value={re?.calls_today !== undefined ? re.calls_today.toLocaleString() : "—"}
            sub={re?.daily_limit ? `한도 ${re.daily_limit.toLocaleString()}` : undefined}
          />
        </Card>
      </div>

      <Failed {...summaryState} />
      {summary?.stale && summary.stale.length > 0 && (
        <p className="ac-note ac-stale">DB가 늦어 일부 지표({summary.stale.length}개)는 직전 값입니다. 다음 갱신 때 다시 계산합니다.</p>
      )}
      <div className="ac-grid ac-grid--4">
        <Card title="현재 접속">
          <Metric label="접속 중" value={summary ? summary.online_now.toLocaleString() : "—"} />
        </Card>
        <Card title="최근 24시간 조회">
          <Metric label="사람 조회수" value={summary ? summary.views_last_24h.toLocaleString() : "—"} sub={summary?.bots ? `봇 ${summary.bots.pageviews.toLocaleString()}회 제외` : undefined} />
        </Card>
        <Card title="누적 방문">
          <Metric label="전체" value={summary ? summary.total_visits.toLocaleString() : "—"} />
        </Card>
        <Card title="24시간 인기 페이지" foot={<button type="button" onClick={() => go("traffic")}>트래픽 상세 →</button>}>
          <ol className="ac-toplist">
            {(summary?.top_pages ?? []).slice(0, 4).map((p) => (
              <li key={p.path}>
                <span>{pageLabel(p.path)}</span>
                <b>{p.count.toLocaleString()}</b>
              </li>
            ))}
            {!summary && <li className="ac-empty">—</li>}
          </ol>
        </Card>
      </div>

      <div className="ac-grid ac-grid--2">
        <Card title="최근 경고·오류" foot={<button type="button" onClick={() => go("system")}>전체 로그 →</button>}>
          <LogList logs={problems} limit={8} />
        </Card>
        <Card title="바로가기">
          <nav className="ac-links">
            <Link to="/admin/growth">📈 성장 통계</Link>
            <Link to="/admin/db">🗄 DB 조회</Link>
            <Link to="/admin/monitor">🧠 모니터링</Link>
            <Link to="/realestate-map">🏠 부동산 지도</Link>
            <Link to="/desk">📰 마켓데스크</Link>
          </nav>
        </Card>
      </div>
    </div>
  );
}

function SystemSection({ health, state }: { health: AdminHealth | null; state: { error: string | null; at: Date | null; retry: () => void } }) {
  const [filter, setFilter] = useState<"all" | "ERROR" | "WARNING">("all");
  const [q, setQ] = useState("");
  const logs = useMemo(
    () =>
      (health?.logs ?? []).filter(
        (l) => (filter === "all" || l.level === filter) && (!q || `${l.logger} ${l.message}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [health, filter, q],
  );
  const re = health?.realestate;
  return (
    <div className="ac-system">
      <Failed {...state} />
      <div className="ac-grid ac-grid--2">
        <Card title="저장소(DB 게이트)">
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>저장소</th>
                  <th>호출</th>
                  <th>대기</th>
                  <th>처리</th>
                  <th>바쁨</th>
                  <th>오류</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {(health?.gates ?? [])
                  .slice()
                  .sort((a, b) => b.calls - a.calls)
                  .map((g) => (
                    <tr key={g.name} className={g.open ? "is-down" : g.busy_rejects || g.errors ? "is-warn" : ""} title={g.last_error || undefined}>
                      <td>{g.name}</td>
                      <td>{g.calls.toLocaleString()}</td>
                      <td>{g.avg_wait_ms}ms</td>
                      <td>{g.avg_work_ms}ms</td>
                      <td>{g.busy_rejects}</td>
                      <td>{g.errors}</td>
                      <td>{g.open ? "차단" : "정상"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="ac-note">
            DB 응답 {health ? `${health.db.ms}ms` : "—"} · 대기·처리는 최근 호출의 이동 평균 · 바쁨은 4초 넘게 순서를 기다리다 포기한 호출입니다.
          </p>
        </Card>
        <Card title="부동산 수집기">
          {re?.error ? (
            <p className="ac-empty">{re.error}</p>
          ) : (
            <dl className="ac-dl">
              <dt>최근 2년 수집률</dt>
              <dd>{pct(re?.recent_coverage)}</dd>
              <dt>과거 이력 수집률</dt>
              <dd>
                {pct(re?.history_coverage)} {re?.history_from && <small>({re.history_from.slice(0, 4)}.{re.history_from.slice(4)}부터)</small>}
              </dd>
              <dt>오늘 API 호출 (한도 {re?.daily_limit?.toLocaleString() ?? "—"})</dt>
              <dd>
                매매 {re?.calls_today?.toLocaleString() ?? "—"} · 전월세 {re?.calls_today_rent?.toLocaleString() ?? "—"} · K-apt{" "}
                {re?.calls_today_kapt?.toLocaleString() ?? "—"}
                {re?.daily_limit && (re.calls_today ?? 0) >= re.daily_limit && <small> · 매매 한도 소진, 자정에 재개</small>}
              </dd>
              <dt>수집 중 / 대기</dt>
              <dd>
                {re?.collecting ?? "없음"} / {re?.queued_districts ?? 0}개 시군구
              </dd>
              <dt>지도 캐시 / 재계산 대기</dt>
              <dd>
                {re?.maps_cached ?? 0} / {re?.maps_rebuild_queue ?? 0}
              </dd>
              <dt>등락 집계 캐시 / 대기</dt>
              <dd>
                {re?.summaries_cached ?? 0} / {re?.summaries_pending ?? 0}
              </dd>
              <dt>전월세 캐시 / 대기</dt>
              <dd>
                {re?.rent_districts_cached ?? 0} / {re?.rent_queue ?? 0}
              </dd>
              <dt>메모리의 시군구</dt>
              <dd>{re?.districts_in_memory ?? 0}</dd>
              <dt>저장 위치</dt>
              <dd>
                {re?.separate_db ? "부동산 전용 DB" : "공유 DB"}
                {re?.migration?.needed && (
                  <small>
                    {" "}
                    · 기존 데이터 이전{" "}
                    {re.migration.done ? "완료" : re.migration.running ? `중 (${re.migration.table ?? ""} ${re.migration.rows.toLocaleString()}행)` : "대기"}
                    {re.migration.error && ` · 오류: ${re.migration.error}`}
                  </small>
                )}
              </dd>
              {(re?.last_error || re?.rent_error) && (
                <>
                  <dt>최근 오류</dt>
                  <dd className="is-error">{[re?.last_error, re?.rent_error].filter(Boolean).join(" · ")}</dd>
                </>
              )}
            </dl>
          )}
        </Card>
      </div>

      <div className="ac-grid ac-grid--2">
        <Card title="관리자 집계 캐시">
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>집계</th>
                  <th>인자</th>
                  <th>갱신 지연</th>
                  <th>마지막 오류</th>
                </tr>
              </thead>
              <tbody>
                {(health?.admin_cache ?? []).map((c, i) => (
                  <tr key={i} className={c.error ? "is-warn" : ""}>
                    <td>{c.name}</td>
                    <td>{c.args}</td>
                    <td>{c.overdue_s ? `${c.overdue_s}s` : "최신"}</td>
                    <td>{c.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ac-note">값이 오래되면 바로 보여준 뒤 뒤에서 다시 계산합니다. 계산이 실패하면 마지막 값을 유지합니다.</p>
        </Card>
        <Card title="백그라운드 작업">
          <ul className="ac-chips">
            {(health?.threads ?? []).map((t) => (
              <li key={t.name}>
                {t.name}
                {t.count > 1 && <b>×{t.count}</b>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`로그 (경고·오류 최근 ${health?.logs.length ?? 0}건)`}>
        <div className="ac-log-tools">
          {(["all", "ERROR", "WARNING"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "전체" : f === "ERROR" ? "오류" : "경고"}
            </button>
          ))}
          <input type="search" placeholder="검색 (로거·메시지)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <LogList logs={logs} />
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  useDocumentTitle("관리자 콘솔 · K-Stock Hub");
  const [authed] = useState(() => !!getStoredSession());
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({ lastUpdated: null, connectionOk: true });

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (s: Section) => {
    setSection(s);
    window.history.replaceState(null, "", `#${s}`);
    window.scrollTo({ top: 0 });
  };

  // The status bar is on every screen, so the health poll runs on all of them.
  const health = usePolled(adminApi.health, 15_000, authed);
  const summary = usePolled(adminApi.summary, 60_000, authed && section === "overview");
  const status = assess(health.data, !!health.error);

  if (!authed) return null;
  const current = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="ac-page">
      <aside className="ac-side">
        <Link to="/" className="ac-brand">
          K-Stock Hub
          <small>관리자 콘솔</small>
        </Link>
        <nav className="ac-nav" aria-label="관리자 메뉴">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={section === s.key ? "is-on" : ""} onClick={() => go(s.key)}>
              <span>{s.label}</span>
              <small>{s.hint}</small>
              {s.key === "system" && health.data && health.data.errors_last_hour > 0 && <b className="ac-badge">{health.data.errors_last_hour}</b>}
            </button>
          ))}
        </nav>
        <div className="ac-side-foot">
          <Link to="/admin/growth">성장 통계</Link>
          <Link to="/admin/db">DB 조회</Link>
          <Link to="/admin/monitor">모니터링</Link>
          <button
            type="button"
            className="ac-logout"
            onClick={() => {
              clearStoredSession();
              navigate("/admin");
            }}
          >
            로그아웃
          </button>
        </div>
      </aside>

      <main className="ac-main">
        <header className="ac-top">
          <div>
            <h1>{current.label}</h1>
            <p>{current.hint}</p>
          </div>
          <div className={`ac-status is-${status.level}`} title={status.reasons.join("\n") || "문제 없음"}>
            <i aria-hidden="true" />
            <b>{LEVEL_TEXT[status.level]}</b>
            <span>{status.reasons[0] ?? "모든 항목 정상"}</span>
          </div>
          <div className="ac-top-meta">
            <span>상태 확인 {clock(health.at)}</span>
            <button type="button" onClick={health.retry} aria-label="지금 새로고침">
              ⟳
            </button>
          </div>
        </header>

        {section === "overview" && (
          <Overview
            health={health.data}
            healthState={{ error: health.error, at: health.at, retry: health.retry }}
            summary={summary.data}
            summaryState={{ error: summary.error, at: summary.at, retry: summary.retry }}
            go={go}
          />
        )}
        {section === "traffic" && <AdminTrafficSection />}
        {section === "live" && (
          <section className="admin-panel admin-panel--live">
            <div className="admin-panel-head">
              <h2>
                <span className={`admin-live-dot${liveStatus.connectionOk ? "" : " admin-live-dot--off"}`} /> 실시간 세션 · 로그
              </h2>
              <span className="admin-dash-updated">
                {liveStatus.lastUpdated ? (liveStatus.connectionOk ? `${clock(liveStatus.lastUpdated)} 갱신` : "연결 끊김 · 재시도 중") : "연결 중..."}
              </span>
            </div>
            <LiveSessionsAndLog className="admin-panel--live-embed" onStatus={setLiveStatus} />
          </section>
        )}
        {section === "ops" && <AdminOpsPanel />}
        {section === "system" && <SystemSection health={health.data} state={{ error: health.error, at: health.at, retry: health.retry }} />}
        {section === "comments" && <AdminCommentsPanel />}
      </main>
    </div>
  );
}
