import { useEffect, useMemo, useState } from "react";
import { AdminAuthError, GrowthOverview, adminApi, clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import "./adminGrowth.css";
import "./adminGrowthPastel.css";
import "./adminGrowthFilters.css";

const nf = new Intl.NumberFormat("ko-KR");
const channelNames: Record<string, string> = { search: "검색", email: "메일", social: "소셜", referral: "외부 링크", direct: "직접 방문" };
const channelColors: Record<string, string> = {
  search: "var(--series-blue)",
  email: "var(--series-violet)",
  social: "var(--series-pink)",
  referral: "var(--series-amber)",
  direct: "var(--text-muted)",
};
const quickRanges = [1, 3, 5, 7, 15, 30, 90, 365, 730];
const kstDate = (daysAgo = 0) => new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
const addDays = (dateStr: string, delta: number) => new Date(Date.parse(dateStr) + delta * 86_400_000).toISOString().slice(0, 10);
const SEO_MARKER_KEY = "growth_seo_marker_date";

/** JS's own Date parsing of a bare "YYYY-MM-DD" is UTC-midnight, and .getDay() then
 * reads it back through the browser's local timezone — which can shift the weekday
 * by one depending on where the admin is sitting. These date strings are already
 * KST calendar dates, so the weekday has to come from the digits directly, not from
 * an instant. */
function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function movingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}

/** The upgraded main trend — the old page just drew one bare `<polyline>` with no
 * hover, no smoothing, and no way to tell a real trend from day-to-day noise (daily
 * visitor counts here swing roughly 130~770). This adds a 7일 이동평균 overlay and a
 * hover tooltip, in the same lightweight percentage-viewBox SVG the rest of this
 * page already uses (no ResizeObserver needed). */
function VisitorTrendChart({ rows }: { rows: GrowthOverview["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ma = useMemo(() => movingAverage(rows.map((r) => r.visitors), 7), [rows]);
  const max = Math.max(1, ...rows.map((r) => r.visitors), ...ma);
  const xAt = (i: number) => (rows.length === 1 ? 50 : (i / (rows.length - 1)) * 100);
  const yAt = (v: number) => 92 - (v / max) * 76;
  const linePoints = (values: number[]) => values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const areaPoints = rows.length ? `0,100 ${linePoints(rows.map((r) => r.visitors))} 100,100` : "";
  const labels = rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 5)) === 0);
  const total = rows.reduce((sum, row) => sum + row.visitors, 0);
  const peak = rows.reduce((best, row) => (!best || row.visitors > best.visitors ? row : best), rows[0]);
  const hoveredRow = hover !== null ? rows[hover] : null;

  return (
    <div className="growth-trend">
      <div className="growth-trend__summary">
        <span>
          <i /> 순 방문자
        </span>
        <strong>기간 합계 {nf.format(total)}명</strong>
        <em>{peak ? `최고 ${peak.date} · ${nf.format(peak.visitors)}명` : "데이터 수집 중"}</em>
      </div>
      {rows.length ? (
        <div className="growth-trend__canvas">
          <div className="growth-trend__grid">
            <i />
            <i />
            <i />
            <i />
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label="날짜별 순 방문자 추세"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = (e.clientX - rect.left) / rect.width;
              setHover(Math.min(rows.length - 1, Math.max(0, Math.round(frac * (rows.length - 1)))));
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="growthArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#cdb4db" stopOpacity=".45" />
                <stop offset=".55" stopColor="#bde0fe" stopOpacity=".2" />
                <stop offset="1" stopColor="#bde0fe" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={areaPoints} fill="url(#growthArea)" />
            <polyline points={linePoints(rows.map((r) => r.visitors))} fill="none" stroke="#bde0fe" strokeWidth="1.3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
            {rows.length > 1 && (
              <polyline points={linePoints(ma)} fill="none" stroke="#5eead4" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="0" />
            )}
            {hoveredRow && (
              <line x1={xAt(hover as number)} x2={xAt(hover as number)} y1="4" y2="96" stroke="#eaf4ff" strokeOpacity="0.35" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          <div className="growth-trend__labels">
            {labels.map((row) => (
              <span key={row.date}>{row.date.slice(5).replace("-", ".")}</span>
            ))}
          </div>
          {hoveredRow && (
            <div className="growth-trend__tooltip" style={{ left: `${xAt(hover as number)}%` }}>
              <b>{hoveredRow.date}</b>
              <span>순 방문자 {nf.format(hoveredRow.visitors)}명</span>
              <span>페이지뷰 {nf.format(hoveredRow.pageviews)}</span>
              <span className="growth-trend__tooltip-ma">7일 평균 {nf.format(Math.round(ma[hover as number]))}명</span>
            </div>
          )}
        </div>
      ) : (
        <p className="empty">수집된 방문 데이터가 없습니다.</p>
      )}
      <div className="growth-trend__legend">
        <span>
          <i className="growth-trend__legend-dot growth-trend__legend-dot--raw" /> 일별 방문자
        </span>
        <span>
          <i className="growth-trend__legend-dot growth-trend__legend-dot--ma" /> 7일 이동평균
        </span>
      </div>
    </div>
  );
}

/** 검색+소셜+외부링크가 direct에 편중된 유입 구성을 실제로 옮기고 있는지 추적하는
 * 핵심 차트 — SEO/백링크 작업 등 "조치 적용일"을 세로 마커로 찍어두면, 그 이후로 이
 * 비중이 오르는지 다음 조회에서 바로 비교할 수 있다. */
function NonDirectShareChart({ rows, markerDate }: { rows: GrowthOverview["daily"]; markerDate: string }) {
  const shares = rows.map((r) => {
    const total = r.search + r.email + r.social + r.referral + r.direct;
    return total > 0 ? ((r.search + r.social + r.referral) / total) * 100 : 0;
  });
  const max = Math.max(10, ...shares);
  const xAt = (i: number) => (rows.length === 1 ? 50 : (i / (rows.length - 1)) * 100);
  const yAt = (v: number) => 92 - (v / max) * 76;
  const points = shares.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const markerIdx = rows.findIndex((r) => r.date === markerDate);
  const avg = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;

  return (
    <div className="growth-trend growth-trend--nondirect">
      <div className="growth-trend__summary">
        <span>
          <i /> 검색·소셜·외부링크 비중
        </span>
        <strong>기간 평균 {avg.toFixed(1)}%</strong>
        <em>direct 제외 유입</em>
      </div>
      {rows.length ? (
        <div className="growth-trend__canvas growth-trend__canvas--pct">
          <div className="growth-trend__grid">
            <i />
            <i />
            <i />
            <i />
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="검색·소셜·외부링크 비중 추세">
            <polyline points={points} fill="none" stroke="#67e8f9" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {markerIdx >= 0 && (
              <>
                <line x1={xAt(markerIdx)} x2={xAt(markerIdx)} y1="4" y2="96" stroke="#fca5a5" strokeWidth="0.8" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>
          {markerIdx >= 0 && (
            <span className="growth-marker-label" style={{ left: `${xAt(markerIdx)}%` }}>
              조치 적용
            </span>
          )}
          <div className="growth-trend__labels">
            {rows
              .filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 5)) === 0)
              .map((row) => (
                <span key={row.date}>{row.date.slice(5).replace("-", ".")}</span>
              ))}
          </div>
        </div>
      ) : (
        <p className="empty">수집된 방문 데이터가 없습니다.</p>
      )}
    </div>
  );
}

function WeekdayBars({ rows }: { rows: GrowthOverview["daily"] }) {
  const buckets = useMemo(() => {
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    for (const r of rows) {
      const idx = weekdayIndex(r.date);
      sums[idx] += r.visitors;
      counts[idx]++;
    }
    return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));
  }, [rows]);
  const max = Math.max(1, ...buckets);
  return (
    <div className="weekday-bars">
      {buckets.map((avg, i) => (
        <div className="weekday-bar" key={i}>
          <div className="weekday-bar__track">
            <div className="weekday-bar__fill" style={{ height: `${(avg / max) * 100}%` }} />
          </div>
          <span className="weekday-bar__label">{WEEKDAY_LABELS[i]}</span>
          <span className="weekday-bar__value">{nf.format(Math.round(avg))}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminGrowthPage() {
  useDocumentTitle("100배 성장 통계 | K-Stock Hub");
  const [days, setDays] = useState(30);
  const [customOpen, setCustomOpen] = useState(false);
  const [startDate, setStartDate] = useState(kstDate(29));
  const [endDate, setEndDate] = useState(kstDate());
  const [appliedDates, setAppliedDates] = useState<{ start: string; end: string } | null>(null);
  const [data, setData] = useState<GrowthOverview | null>(null);
  const [prevTotal, setPrevTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [markerDate, setMarkerDate] = useState(() => localStorage.getItem(SEO_MARKER_KEY) || kstDate());

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  const resolvedStart = appliedDates?.start ?? kstDate(days - 1);
  const resolvedEnd = appliedDates?.end ?? kstDate();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    adminApi
      .growthOverview(days, resolvedStart, resolvedEnd)
      .then((value) => {
        if (cancelled) return;
        setData(value);
      })
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          clearStoredSession();
          navigate("/admin");
        } else if (!cancelled) setError(err instanceof Error ? err.message : "통계를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, appliedDates]);

  // 직전 동기간 대비 — 같은 길이의 바로 앞 기간 하나를 더 불러와 합계만 비교한다.
  useEffect(() => {
    let cancelled = false;
    setPrevTotal(null);
    const span = Math.floor((Date.parse(resolvedEnd) - Date.parse(resolvedStart)) / 86_400_000) + 1;
    const prevEnd = addDays(resolvedStart, -1);
    const prevStart = addDays(prevEnd, -(span - 1));
    adminApi
      .growthOverview(span, prevStart, prevEnd)
      .then((value) => {
        if (cancelled) return;
        setPrevTotal(value.daily.reduce((sum, r) => sum + r.visitors, 0));
      })
      .catch(() => {
        /* comparison is a nice-to-have — a failed fetch just hides the badge */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, appliedDates]);

  const selectQuickRange = (value: number) => {
    setDays(value);
    setAppliedDates(null);
    setCustomOpen(false);
  };
  const applyCustomRange = () => {
    if (!startDate || !endDate || startDate > endDate) {
      setError("시작일과 종료일을 올바르게 선택해 주세요.");
      return;
    }
    const selectedDays = Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
    if (selectedDays > 730) {
      setError("최대 730일까지 조회할 수 있습니다.");
      return;
    }
    setDays(selectedDays);
    setAppliedDates({ start: startDate, end: endDate });
  };

  const updateMarkerDate = (value: string) => {
    setMarkerDate(value);
    localStorage.setItem(SEO_MARKER_KEY, value);
  };

  const maxChannel = Math.max(1, ...(data?.channels.map((item) => item.visitors) || [1]));
  const channelTotal = Math.max(1, data?.channels.reduce((sum, item) => sum + item.visitors, 0) || 1);
  let channelCursor = 0;
  const channelDonut =
    data?.channels
      .map((item) => {
        const start = channelCursor;
        channelCursor += (item.visitors / channelTotal) * 100;
        return `${channelColors[item.channel] || "#94a3b8"} ${start}% ${channelCursor}%`;
      })
      .join(",") || "#203a55 0 100%";
  const directShare = (data?.channels.find((c) => c.channel === "direct")?.visitors ?? 0) / channelTotal;
  const maxPage = Math.max(1, ...(data?.pages.map((item) => item.visitors) || [1]));
  const pageTotal = Math.max(1, data?.pages.reduce((sum, p) => sum + p.visitors, 0) || 1);

  const currentTotal = data ? data.daily.reduce((sum, r) => sum + r.visitors, 0) : 0;
  const periodChangePct = prevTotal !== null && prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : null;

  // 마일스톤 예상 도달일 — 최근 7일 평균과 그 직전 7일 평균의 차이를 하루 성장분으로 잡는다.
  // 개별 날짜 대신 두 구간의 평균을 비교하는 이유는 요일별 진폭(주말 급감)이 하루 단위
  // 비교보다 훨씬 커서, endpoint 두 개만 보면 요일 효과를 추세로 착각하기 쉽기 때문이다.
  const milestone = useMemo(() => {
    if (!data || data.daily.length < 14) return null;
    const rows = data.daily;
    const last7 = rows.slice(-7).reduce((s, r) => s + r.visitors, 0) / 7;
    const prev7 = rows.slice(-14, -7).reduce((s, r) => s + r.visitors, 0) / 7;
    const perDay = (last7 - prev7) / 7;
    const baseline = data.goal.baseline_daily_visitors;
    const targets = [
      { mult: 10, label: "1차 목표 10×" },
      { mult: 100, label: "최종 목표 100×" },
    ];
    return targets.map(({ mult, label }) => {
      const target = baseline * mult;
      if (last7 >= target) return { label, text: "이미 달성" };
      if (perDay <= 0) return { label, text: "현재 추세로는 도달 불가 — 유입 확대가 필요합니다" };
      const daysNeeded = Math.ceil((target - last7) / perDay);
      const eta = addDays(kstDate(), daysNeeded);
      return { label, text: `현재 추세면 ${eta} 경 (약 ${daysNeeded}일 후)` };
    });
  }, [data]);

  if (!getStoredSession()) return null;

  return (
    <main className="admin-growth">
      <div className="growth-orb growth-orb--one" />
      <div className="growth-orb growth-orb--two" />
      <header className="growth-header">
        <div>
          <div className="growth-kicker">
            <i /> ACQUISITION MISSION
          </div>
          <h1>방문자 100배 성장 관제실</h1>
          <p>검색부터 캠페인까지, 유입의 흐름과 목표 달성 과정을 한눈에 확인합니다.</p>
        </div>
        <nav>
          <Link to="/admin/dashboard">대시보드</Link>
          <Link to="/admin/db">DB 조회</Link>
          <Link to="/admin/monitor">모니터링</Link>
        </nav>
      </header>
      <div className="growth-toolbar">
        <div className="growth-range-control">
          <div className="ranges" role="group" aria-label="조회 기간">
            {quickRanges.map((n) => (
              <button type="button" className={!appliedDates && days === n ? "active" : ""} onClick={() => selectQuickRange(n)} key={n}>
                {n === 365 ? "1년" : n === 730 ? "2년" : `${n}일`}
              </button>
            ))}
            <button type="button" className={appliedDates ? "active" : ""} onClick={() => setCustomOpen((value) => !value)}>
              직접입력
            </button>
          </div>
          {customOpen && (
            <div className="growth-custom-range" role="group" aria-label="직접 조회 기간">
              <label>
                <span>시작일</span>
                <input type="date" value={startDate} max={endDate || kstDate()} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <i>→</i>
              <label>
                <span>종료일</span>
                <input type="date" value={endDate} min={startDate} max={kstDate()} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <button type="button" onClick={applyCustomRange}>
                조회
              </button>
            </div>
          )}
        </div>
        <span>데이터 기준 · KST</span>
      </div>
      {error && <div className="error">{error}</div>}
      {!data ? (
        <div className="growth-skeleton">
          <i />
          <i />
          <i />
          <i />
          <div />
        </div>
      ) : (
        <>
          <section className="cards">
            <article>
              <div className="metric-icon metric-icon--baseline">B</div>
              <span>기준 일 방문자</span>
              <strong>
                {nf.format(data.goal.baseline_daily_visitors)}
                <small>명</small>
              </strong>
              <footer>{new Date(data.goal.started_at).toLocaleDateString("ko-KR")} 출발</footer>
            </article>
            <article>
              <div className="metric-icon metric-icon--today">T</div>
              <span>오늘 순 방문자</span>
              <strong>
                {nf.format(data.today.visitors)}
                <small>명</small>
              </strong>
              <footer>{nf.format(data.today.pageviews)} 페이지뷰</footer>
            </article>
            <article className="accent">
              <div className="metric-icon metric-icon--growth">×</div>
              <span>현재 성장 배수</span>
              <strong>
                {data.current_multiplier.toFixed(2)}
                <small>×</small>
              </strong>
              <footer>
                {periodChangePct === null ? (
                  "1차 목표 10× · 최종 100×"
                ) : (
                  <span className={`growth-compare-badge${periodChangePct >= 0 ? " is-up" : " is-down"}`}>
                    직전 동기간 대비 {periodChangePct >= 0 ? "▲" : "▼"} {Math.abs(periodChangePct).toFixed(1)}%
                  </span>
                )}
              </footer>
            </article>
            <article>
              <div className="metric-icon metric-icon--goal">%</div>
              <span>100배 달성률</span>
              <strong>
                {data.achievement_pct.toFixed(2)}
                <small>%</small>
              </strong>
              <div className="goal-meter">
                <i style={{ width: `${Math.max(1, data.achievement_pct)}%` }} />
              </div>
              <footer>목표 {nf.format(data.goal.baseline_daily_visitors * 100)}명/일</footer>
            </article>
          </section>

          {milestone && (
            <section className="panel growth-milestone-panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-label">PROJECTION</span>
                  <h2>마일스톤 예상 도달일</h2>
                </div>
                <span>최근 7일 평균 vs 그 직전 7일 평균 기준 단순 추정</span>
              </div>
              <div className="growth-milestone-list">
                {milestone.map((m) => (
                  <div className="growth-milestone-item" key={m.label}>
                    <b>{m.label}</b>
                    <span>{m.text}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel panel--trend">
            <div className="panel-heading">
              <div>
                <span className="panel-label">GROWTH VELOCITY</span>
                <h2>날짜별 순 방문자 성장</h2>
              </div>
              <span>선 위에 마우스를 올리면 날짜별 수치를 확인할 수 있습니다.</span>
            </div>
            <VisitorTrendChart rows={data.daily} />
          </section>

          <section className="panel panel--trend">
            <div className="panel-heading">
              <div>
                <span className="panel-label">EXTERNAL INFLOW</span>
                <h2>검색·소셜·외부링크 유입 비중 추이</h2>
              </div>
              <label className="growth-marker-input">
                <span>조치 적용일</span>
                <input type="date" value={markerDate} max={kstDate()} onChange={(e) => updateMarkerDate(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              direct(직접 방문)가 대부분을 차지하는 건 실제 현황입니다 — SEO·백링크·커뮤니티 공유 같은 대책이 이 비중을 얼마나
              옮기는지, 위 날짜를 조치를 적용한 날로 찍어두고 이후 추이로 확인하세요.
            </p>
            <NonDirectShareChart rows={data.daily} markerDate={markerDate} />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="panel-label">TIMING</span>
                <h2>요일별 평균 방문자</h2>
              </div>
              <span>언제 공유·발행하면 좋을지 참고하세요</span>
            </div>
            <WeekdayBars rows={data.daily} />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="panel-label">CAMPAIGN ATTRIBUTION</span>
                <h2>실행한 캠페인 성과</h2>
              </div>
              <span>utm_source 태그가 붙은 유입 — 카카오톡 공유·메일 등</span>
            </div>
            <p className="hint">
              메일 링크나 공유 버튼에{" "}
              <code>utm_source=kakaotalk&amp;utm_medium=social&amp;utm_campaign=...</code> 를 붙이면 여기 자동 집계됩니다.
            </p>
            {data.campaigns.length ? (
              data.campaigns.map((c) => (
                <div className="campaign-row" key={`${c.campaign}-${c.source}`}>
                  <b>{c.campaign || "(미지정)"}</b>
                  <span>{c.source}</span>
                  <em>{nf.format(c.visitors)}명</em>
                </div>
              ))
            ) : (
              <p className="empty">아직 집계된 캠페인이 없습니다.</p>
            )}
          </section>

          <div className="grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-label">ACQUISITION MIX</span>
                  <h2>유입 채널 분포</h2>
                </div>
              </div>
              <div className="channel-layout">
                <div className="channel-donut" style={{ background: `conic-gradient(${channelDonut})` }}>
                  <div>
                    <strong>{nf.format(channelTotal)}</strong>
                    <span>순 방문자</span>
                  </div>
                </div>
                <div className="channel-list">
                  {data.channels.map((item) => (
                    <div className="channel" key={item.channel}>
                      <div>
                        <b>
                          <i style={{ background: channelColors[item.channel] || "#94a3b8" }} />
                          {channelNames[item.channel] || item.channel}
                        </b>
                        <span>{((item.visitors / channelTotal) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="channel-meter">
                        <i style={{ width: `${(item.visitors / maxChannel) * 100}%`, background: channelColors[item.channel] || "#94a3b8" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {directShare > 0.9 && (
                <p className="hint growth-channel-hint">
                  direct 비중이 {(directShare * 100).toFixed(0)}%로 매우 높습니다 — 바로 위 "검색·소셜·외부링크 유입 비중 추이"에서
                  이 비율이 실제로 개선되고 있는지 추적하세요.
                </p>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-label">ORGANIC SEARCH</span>
                  <h2>검색엔진 유입</h2>
                </div>
              </div>
              {data.search_sources.length ? (
                data.search_sources.map((item, index) => (
                  <div className="rank-row" key={item.source}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{item.source}</b>
                    <em>{nf.format(item.visitors)}명</em>
                    <small>{nf.format(item.pageviews)} PV</small>
                  </div>
                ))
              ) : (
                <p className="empty">검색 유입을 기다리고 있습니다. 데이터가 들어오면 엔진별로 자동 분류됩니다.</p>
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="panel-label">PAGE PERFORMANCE</span>
                <h2>페이지별 방문 성과</h2>
              </div>
              <span>순 방문자 기준 상위 50개 페이지</span>
            </div>
            <div className="page-bars">
              {data.pages.slice(0, 6).map((page, index) => (
                <div key={page.path}>
                  <span>{index + 1}</span>
                  <b title={page.path}>{page.path}</b>
                  <div>
                    <i style={{ width: `${(page.visitors / maxPage) * 100}%` }} />
                  </div>
                  <em>{nf.format(page.visitors)}명</em>
                </div>
              ))}
            </div>
            <div className="table">
              <div className="head">
                <b>페이지 경로</b>
                <span>순 방문자</span>
                <em>비중</em>
              </div>
              {data.pages.map((page) => (
                <div key={page.path}>
                  <b title={page.path}>{page.path}</b>
                  <span>{nf.format(page.visitors)}</span>
                  <em>{((page.visitors / pageTotal) * 100).toFixed(1)}%</em>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
