import { useMemo, useState } from "react";
import InsightCard from "./AdminGrowthInsight";
import type { GrowthControl, GrowthRankRow, GrowthTraffic, TrafficGroup, TrafficType } from "../adminApi";

/* ──────────────────────────────────────────────────────────────────────────
   유입 출처 — one inflow type per session (backend traffic_taxonomy.py):
   our automated SNS posts, hand-posted tagged SNS links, Naver blog posts,
   visitor shares, untagged community/SNS referrers, search engines, AI
   answers, external links, alerts, and direct/unknown. Shares are shown over
   sessions whose source is known, so a large direct bucket never hides the
   SNS-versus-search split.
   ────────────────────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("ko-KR");
const n0 = (v: number | null | undefined) => (v == null ? "—" : nf.format(Math.round(v)));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const signed = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`);

export const TYPE_COLOR: Record<TrafficType, string> = {
  sns_auto: "var(--gc-pink)", sns_tagged: "color-mix(in srgb, var(--gc-pink) 55%, var(--gc-violet))",
  naver_blog: "var(--gc-aqua)", share: "var(--gc-amber)", community: "color-mix(in srgb, var(--gc-pink) 45%, var(--gc-muted))",
  search: "var(--gc-blue)", ai: "var(--gc-violet)", referral: "color-mix(in srgb, var(--gc-amber) 50%, var(--gc-muted))",
  email: "color-mix(in srgb, var(--gc-violet) 45%, var(--gc-muted))", direct: "var(--gc-muted)",
};
const GROUP_COLOR: Record<TrafficGroup, string> = { sns: "var(--gc-pink)", search: "var(--gc-blue)", ai: "var(--gc-violet)", other: "var(--gc-muted)" };
const KNOWN: TrafficType[] = ["sns_auto", "sns_tagged", "naver_blog", "share", "community", "search", "ai", "referral", "email"];

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  return (
    <span className="gc-meter">
      <i style={{ width: `${Math.max(1, (value / Math.max(1, max)) * 100)}%`, background: color }} />
    </span>
  );
}

function Rank({ rows, cols }: { rows: GrowthRankRow[]; cols: Array<[string, string]> }) {
  if (!rows.length) return <p className="gc-empty">이 기간에 해당 유입이 없습니다.</p>;
  const max = Math.max(1, ...rows.map((r) => r.sessions));
  return (
    <div className="gc-table-wrap">
      <table className="gc-table">
        <thead>
          <tr>{cols.map(([k, l]) => <th key={k}>{l}</th>)}<th className="num">세션</th><th className="num">이탈률</th><th className="num">PV/세션</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.key ?? i}-${i}`}>
              {cols.map(([k]) => (
                <td key={k} className="gc-cell-key" title={String(r[k] ?? "")}>
                  {k === "label" && r.type ? <i className="gc-dot" style={{ background: TYPE_COLOR[r.type as TrafficType] }} /> : null}
                  {String(r[k] || "—")}
                </td>
              ))}
              <td className="num"><Bar value={r.sessions} max={max} color={TYPE_COLOR[r.type as TrafficType]} />{n0(r.sessions)}</td>
              <td className={`num${(r.bounce_rate ?? 0) >= 75 ? " is-bad" : ""}`}>{r.bounce_rate == null ? "—" : `${r.bounce_rate.toFixed(0)}%`}</td>
              <td className="num">{r.pages_per_session ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyStack({ t }: { t: GrowthTraffic }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = t.series;
  if (!rows.length) return null;
  const W = 1000, H = 220, L = 36, R = 8, T = 10, B = 22;
  const tot = rows.map((r) => KNOWN.reduce((s, k) => s + (r[k] || 0), 0));
  const yMax = Math.max(1, ...tot) * 1.08;
  const step = (W - L - R) / rows.length;
  const bw = Math.max(2, Math.min(28, step * 0.7));
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const h = hover != null ? rows[hover] : null;
  return (
    <div className="gc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="일별 출처 확인 유입(유형별 누적)"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.min(rows.length - 1, Math.max(0, Math.floor((px - L) / step))));
        }}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(yMax * f)} y2={y(yMax * f)} className="gc-grid" />
            <text x={L - 5} y={y(yMax * f) + 3} className="gc-axis" textAnchor="end">{Math.round(yMax * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          let acc = 0;
          const cx = L + i * step + step / 2;
          return (
            <g key={r.date} opacity={r.live ? 0.55 : 1}>
              {hover === i && <rect x={cx - step / 2} y={T} width={step} height={H - T - B} className="gc-hover-band" />}
              {KNOWN.map((k) => {
                const v = r[k] || 0;
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={k} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} style={{ fill: TYPE_COLOR[k] }} />;
              })}
            </g>
          );
        })}
        {rows.map((r, i) => (i % Math.max(1, Math.ceil(rows.length / 8)) === 0
          ? <text key={r.date} x={L + i * step + step / 2} y={H - 6} className="gc-axis" textAnchor="middle">{r.date.slice(5)}</text> : null))}
      </svg>
      <div className="gc-traffic-tip">
        {h ? (
          <>
            <b>{h.date}{h.live ? " (진행 중)" : ""}</b>
            {KNOWN.filter((k) => h[k]).map((k) => <span key={k}><i className="gc-dot" style={{ background: TYPE_COLOR[k] }} />{t.type_labels[k]} {n0(h[k])}</span>)}
            <span className="gc-sub">직접·미식별 {n0(h.direct)}</span>
          </>
        ) : (
          KNOWN.map((k) => <span key={k}><i className="gc-dot" style={{ background: TYPE_COLOR[k] }} />{t.type_labels[k]}</span>)
        )}
      </div>
    </div>
  );
}

const PLATFORMS = [
  ["threads", "Threads"], ["x", "X"], ["bluesky", "Bluesky"], ["naver_blog", "네이버 블로그"], ["naver_cafe", "네이버 카페"],
  ["kakaotalk", "카카오톡"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["telegram", "Telegram"],
  ["ppomppu", "뽐뿌"], ["clien", "클리앙"], ["dcinside", "디시인사이드"], ["fmkorea", "에펨코리아"], ["band", "밴드"],
] as const;

function LinkBuilder() {
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const [path, setPath] = useState("/movers");
  const [source, setSource] = useState("threads");
  const [topic, setTopic] = useState("");
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => {
    const u = new URL(path.startsWith("http") ? path : `https://kospimap.com${path.startsWith("/") ? "" : "/"}${path}`);
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", source === "naver_blog" ? "blog" : "social");
    const slug = topic.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_|_$/g, "") || "post";
    u.searchParams.set("utm_campaign", `${source === "naver_blog" ? "nb_" : ""}${slug}-${today}`);
    return u.toString();
  }, [path, source, topic, today]);
  return (
    <div className="gc-utm-builder">
      <label>페이지<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/movers" /></label>
      <label>올릴 곳<select value={source} onChange={(e) => setSource(e.target.value)}>
        {PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></label>
      <label>주제(영문·숫자·한글)<input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="samsung_earnings" /></label>
      <div className="gc-utm-out">
        <code>{url}</code>
        <button type="button" className="gc-btn is-primary" onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard denied */ }
        }}>{copied ? "복사됨" : "복사"}</button>
      </div>
    </div>
  );
}

export default function TrafficTab({ data, onChanged }: { data: GrowthControl; onChanged: () => void }) {
  const t = data.traffic;
  if (!t || !t.coverage.days) {
    return (
      <section className="gc-panel">
        <p className="gc-empty">유입 출처 집계(롤업 v2)가 아직 준비되지 않았습니다. 서버가 최근 45일을 다시 집계하는 중이며, 오늘 데이터는 바로 보입니다.</p>
      </section>
    );
  }
  const insights = data.insights.filter((i) => i.area === "유입 출처");
  const knownTypes = t.types.filter((x) => x.type !== "direct");
  const maxKnown = Math.max(1, ...knownTypes.map((x) => x.sessions));
  const direct = t.types.find((x) => x.type === "direct");
  return (
    <>
      <p className="gc-sub gc-traffic-note">
        유입 출처 집계 {t.coverage.days}/{t.coverage.range_days}일 (from {t.coverage.from}) · 출처 확인 {n0(t.known)}세션 / 전체 {n0(t.total)}세션.
        비중은 <b>출처를 아는 유입</b> 기준이며, 직접·미식별({pct(direct?.share)})은 따로 표시합니다.
      </p>
      <section className="gc-channel-cards gc-traffic-groups">
        {t.groups.map((g) => {
          const ch = g.per_day_prev_7d ? ((g.per_day_7d - g.per_day_prev_7d) / g.per_day_prev_7d) * 100 : null;
          return (
            <article key={g.group} style={{ borderTopColor: GROUP_COLOR[g.group] }}>
              <span>{g.label}</span>
              <strong>{g.group === "other" ? n0(g.sessions - (direct?.sessions ?? 0)) : n0(g.sessions)}</strong>
              <small>출처 확인 유입의 {pct(g.share_known)}</small>
              <em className={(ch ?? 0) >= 0 ? "is-up" : "is-down"}>최근 7일 {g.per_day_7d}/일 · 이전 {g.per_day_prev_7d}/일 ({signed(ch)})</em>
            </article>
          );
        })}
      </section>

      {insights.length > 0 && (
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">ANALYSIS</span><h2>유입 출처 분석</h2></div></header>
          <div className="gc-insights">
            {insights.map((it) => <InsightCard key={it.key} it={it} onChanged={onChanged} />)}
          </div>
        </section>
      )}

      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">DAILY</span><h2>일별 출처 확인 유입 (유형별)</h2></div>
          <span className="gc-sub">막대 위에 올리면 그날의 유형별 세션</span>
        </header>
        <DailyStack t={t} />
      </section>

      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">TYPES</span><h2>유입 유형별 성과</h2></div>
          <span className="gc-sub">UTM 태그 + 리퍼러로 세션마다 한 유형</span>
        </header>
        <div className="gc-table-wrap">
          <table className="gc-table">
            <thead>
              <tr><th>유형</th><th className="num">세션</th><th className="num">출처 확인 중 비중</th><th className="num">최근 7일/일</th>
                <th className="num">이전 7일/일</th><th className="num">변화</th><th className="num">이탈률</th><th className="num">PV/세션</th></tr>
            </thead>
            <tbody>
              {t.types.map((x) => (
                <tr key={x.type} className={x.type === "direct" ? "is-dim" : ""}>
                  <td className="gc-cell-key"><i className="gc-dot" style={{ background: TYPE_COLOR[x.type] }} />{x.label}</td>
                  <td className="num">{x.type !== "direct" && <Bar value={x.sessions} max={maxKnown} color={TYPE_COLOR[x.type]} />}{n0(x.sessions)}</td>
                  <td className="num">{x.type === "direct" ? `전체의 ${pct(x.share)}` : pct(x.share_known)}</td>
                  <td className="num">{x.per_day_7d}</td>
                  <td className="num">{x.per_day_prev_7d}</td>
                  <td className={`num ${(x.change_pct ?? 0) >= 0 ? "is-good" : "is-bad"}`}>{signed(x.change_pct)}</td>
                  <td className={`num${(x.bounce_rate ?? 0) >= 75 ? " is-bad" : ""}`}>{x.bounce_rate == null ? "—" : `${x.bounce_rate.toFixed(0)}%`}</td>
                  <td className="num">{x.pages_per_session ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gc-tagging">
          <span>SNS 유입 중 UTM 태그로 식별된 비중</span>
          <Bar value={t.tagging.tagged_sns} max={t.tagging.tagged_sns + t.tagging.untagged_sns} color="var(--gc-pink)" />
          <b>{pct(t.tagging.tagged_share, 0)}</b>
          <small>태그 {n0(t.tagging.tagged_sns)} · 태그 없음 {n0(t.tagging.untagged_sns)}</small>
        </div>
      </section>

      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">POSTS</span><h2>우리가 올린 링크별 (플랫폼 · 게시 묶음)</h2></div>
            <span className="gc-sub">campaign에서 날짜를 뺀 판 이름</span></header>
          <Rank rows={t.posts} cols={[["label", "유형"], ["platform", "플랫폼"], ["program", "게시"]]} />
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">PLATFORMS</span><h2>플랫폼·도메인별</h2></div></header>
          <Rank rows={t.platforms.filter((r) => r.type !== "direct")} cols={[["label", "유형"], ["platform", "플랫폼"]]} />
        </section>
      </div>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">SEARCH · AI</span><h2>검색엔진·AI별</h2></div></header>
          <Rank rows={t.search_engines} cols={[["label", "유형"], ["platform", "엔진"]]} />
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">LANDINGS</span><h2>유형별 첫 페이지</h2></div></header>
          <Rank rows={t.landings} cols={[["label", "유형"], ["route", "페이지"]]} />
        </section>
      </div>

      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">TAG RULES</span><h2>UTM 태그 규칙 · 링크 만들기</h2></div>
          <span className="gc-sub">직접 올리는 글·댓글·프로필 링크도 이 형식이면 위 표에 따로 잡힙니다</span>
        </header>
        <div className="gc-utm-rules">
          <p><code>utm_source</code> 올린 곳: x · threads · bluesky · naver_blog · kakaotalk · native_share · link_copy …</p>
          <p><code>utm_medium</code> social(SNS 글) · blog(블로그 글) · share(방문자 공유) · referral(위젯·피드) · reminder(알림)</p>
          <p><code>utm_campaign</code> &lt;판 또는 주제&gt;-&lt;YYYYMMDD&gt; · 블로그는 nb_ 접두사 · 자동 SNS 판 이름(movers_close 등)이면 '자동 SNS 게시'로, 그 외는 'SNS 수동 게시'로 분류</p>
        </div>
        <LinkBuilder />
      </section>
    </>
  );
}
