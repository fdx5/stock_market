import { PointerEvent as ReactPointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { BoardComment, BoardDetail, BoardPost, EtfItem, GlobalDiscussionPost, InvestorTrendRecord, MarketSparkline, StockSearchResult, api } from "../api/client";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { reportDiscussionPostClick, reportDiscussionSearchSelection } from "../useActivityTracking";
import { startVisibilityAwareInterval } from "../pollVisibility";
import StockLogo from "./StockLogo";
import "../discussionExplorer.css";

const INITIAL_COUNT = 40;
const MAX_VISIBLE = 40;
const SPHERE_RADIUS = 510;

const FPS_METER_ENABLED = (() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("fps")) return false;
  const value = (params.get("fps") ?? "").trim().toLowerCase();
  return !["0", "off", "false", "no"].includes(value);
})();

const STAR_COLORS = ["#ffffff", "#dff7ff", "#9edcff", "#c7b9ff", "#ffe2a8"];
const cosmicRandom = (seed: number) => {
  const value = Math.sin(seed * 91.733 + 17.17) * 43758.5453;
  return value - Math.floor(value);
};
const COSMIC_STARS = Array.from({ length: 145 }, (_, index) => ({
  x: cosmicRandom(index * 5 + 1) * 100,
  y: cosmicRandom(index * 5 + 2) * 100,
  size: index % 31 === 0 ? 3.5 + cosmicRandom(index + 9) * 2.2 : 0.6 + cosmicRandom(index * 5 + 3) * 1.8,
  opacity: 0.28 + cosmicRandom(index * 5 + 4) * 0.72,
  duration: 2.2 + cosmicRandom(index * 5 + 5) * 5.8,
  delay: -cosmicRandom(index * 7 + 3) * 7,
  color: STAR_COLORS[index % STAR_COLORS.length],
  radiant: index % 31 === 0,
}));

const CARD_THEMES = [
  { accent: "#67e8f9", text: "#ddfbff", a: "rgba(8,72,92,.9)", b: "rgba(8,20,43,.82)" },
  { accent: "#c4b5fd", text: "#f2edff", a: "rgba(72,45,125,.88)", b: "rgba(20,13,52,.84)" },
  { accent: "#f9a8d4", text: "#fff0f7", a: "rgba(118,35,82,.86)", b: "rgba(48,13,41,.84)" },
  { accent: "#86efac", text: "#edfff3", a: "rgba(18,91,65,.88)", b: "rgba(7,41,38,.84)" },
  { accent: "#fde68a", text: "#fff9db", a: "rgba(116,78,16,.88)", b: "rgba(49,31,8,.84)" },
  { accent: "#fdba74", text: "#fff3e8", a: "rgba(133,55,23,.88)", b: "rgba(54,21,11,.84)" },
  { accent: "#93c5fd", text: "#edf6ff", a: "rgba(25,75,135,.88)", b: "rgba(8,29,64,.84)" },
  { accent: "#5eead4", text: "#e5fffb", a: "rgba(14,94,91,.88)", b: "rgba(5,39,46,.84)" },
];

type UniversePost = {
  id: string;
  title: string;
  preview: string;
  author: string;
  date: string;
  views: number;
  likes: number;
  dislikes: number;
  source?: GlobalDiscussionPost;
};

type AssetKind = "STOCK" | "ETF";
type SearchAsset = { code: string; name: string; market: "KR" | "US"; kind: AssetKind };

type Point3D = { x: number; y: number; z: number };
type ExplorerQuote = { close: number; change: number; change_pct: number };

function ExplorerFpsMeter({ cards }: { cards: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const worstRef = useRef<HTMLSpanElement>(null);
  const heapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    let previous = since;
    let worst = 0;
    const tick = (now: number) => {
      const delta = now - previous;
      previous = now;
      if (delta < 1000) worst = Math.max(worst, delta);
      frames += 1;
      const elapsed = now - since;
      if (elapsed >= 500) {
        const fps = frames * 1000 / elapsed;
        if (fpsRef.current) fpsRef.current.textContent = fps.toFixed(0);
        if (frameRef.current) frameRef.current.textContent = `${(elapsed / frames).toFixed(1)} ms`;
        if (worstRef.current) worstRef.current.textContent = `${worst.toFixed(1)} ms`;
        if (rootRef.current) rootRef.current.dataset.tone = fps >= 50 ? "good" : fps >= 30 ? "fair" : "bad";
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        if (heapRef.current) heapRef.current.textContent = memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : "N/A";
        frames = 0;
        worst = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="discussion-fps" ref={rootRef} data-tone="good" aria-hidden="true">
      <div><strong ref={fpsRef}>—</strong><b>FPS</b><span ref={frameRef}>— ms</span></div>
      <small>WORST <span ref={worstRef}>— ms</span></small>
      <small>HEAP <span ref={heapRef}>—</span></small>
      <small>CARDS <span>{cards}</span></small>
    </div>
  );
}

function spherePoint(index: number, count: number, sphereRadius: number): Point3D {
  const y = 1 - (index / Math.max(1, count - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (3 - Math.sqrt(5)) * index;
  return {
    x: Math.cos(theta) * radius * sphereRadius,
    y: y * sphereRadius,
    z: Math.sin(theta) * radius * sphereRadius,
  };
}

function defaultZoom(): number {
  if (window.innerWidth <= 480) return 0.42;
  if (window.innerWidth <= 820) return 0.58;
  return 0.82;
}

function maximumZoom(): number {
  // Large CSS-scaled 3D layers are the main WebKit GPU-memory pressure point.
  // 1.05 still gives an iPhone 2.5x magnification from its 0.42 default.
  if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 480) return 1.05;
  if (window.matchMedia("(pointer: coarse)").matches) return 1.2;
  return 1.4;
}

function normalizeAngle(angle: number): number {
  // Very large CSS rotation values gradually lose floating-point precision in
  // long-running WebKit/Blink compositor sessions. Keep the equivalent angle small.
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function normalizeDomestic(post: BoardPost): UniversePost {
  return {
    id: post.nid,
    title: post.title,
    preview: post.title,
    author: post.author,
    date: post.date,
    views: post.views,
    likes: post.likes,
    dislikes: post.dislikes,
  };
}

function normalizeGlobal(post: GlobalDiscussionPost): UniversePost {
  return {
    id: post.id,
    title: post.title || post.text.slice(0, 70),
    preview: post.text,
    author: post.author,
    date: post.written_at.slice(0, 16).replace("T", " "),
    views: post.views,
    likes: post.likes,
    dislikes: post.dislikes,
    source: post,
  };
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function DetailPanel({
  post,
  code,
  market,
  onClose,
}: {
  post: UniversePost;
  code: string;
  market: "KR" | "US";
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [loading, setLoading] = useState(market === "KR");
  const [error, setError] = useState("");

  const releasePanelMedia = () => {
    panelRef.current?.querySelectorAll("img").forEach((image) => {
      // Replacing the source before detach releases WebKit's decoded IOSurface more
      // reliably than removing a node and waiting for its image cache to be collected.
      image.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      image.removeAttribute("srcset");
    });
  };

  useEffect(() => {
    if (market !== "KR") return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([api.boardDetail(code, post.id, controller.signal), api.boardComments(code, post.id, controller.signal)])
      .then(([nextDetail, nextComments]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setComments(nextComments.items);
      })
      .catch((reason: Error) => {
        if (!cancelled && reason.name !== "AbortError") setError(reason.message || "게시글을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [code, market, post.id]);

  useEffect(() => {
    // Capture the mounted element: React may clear panelRef before passive cleanup.
    const panel = panelRef.current;
    return () => panel?.querySelectorAll("img").forEach((image) => {
      image.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      image.removeAttribute("srcset");
    });
  }, []);

  return (
    <aside ref={panelRef} className="discussion-detail" aria-label="게시글 상세">
      <div className="discussion-detail-glow" aria-hidden="true" />
      <header>
        <div>
          <span className="discussion-detail-kicker">DISCUSSION SIGNAL</span>
          <h2>{detail?.title || post.title}</h2>
          <p>{detail?.author || post.author} · {detail?.written_at?.slice(0, 16).replace("T", " ") || post.date}</p>
        </div>
        <button type="button" onClick={() => { releasePanelMedia(); onClose(); }} aria-label="상세 닫기">×</button>
      </header>

      <div className="discussion-detail-scroll">
        {loading && <div className="discussion-detail-loading"><i /><span>신호를 해독하는 중…</span></div>}
        {error && <div className="discussion-detail-error">{error}</div>}
        {market === "US" && <p className="discussion-detail-text">{post.source?.text || post.preview}</p>}
        {detail?.blocks.map((block, index) =>
          block.type === "image" && block.src ? (
            <img key={`${post.id}-${index}`} src={block.src} alt="게시글 첨부 이미지" loading="lazy" decoding="async" />
          ) : (
            <p key={`${post.id}-${index}`} className="discussion-detail-text">{block.text}</p>
          )
        )}

        {!loading && market === "KR" && (
          <section className="discussion-detail-comments">
            <h3>댓글 <span>{comments.length}</span></h3>
            {comments.length === 0 ? <p className="discussion-detail-empty">아직 댓글이 없습니다.</p> : comments.map((comment) => (
              <article key={comment.id}>
                <div><strong>{comment.author || "익명"}</strong><time>{comment.written_at.slice(0, 16).replace("T", " ")}</time></div>
                <p>{comment.text}</p>
                <span>공감 {comment.likes} · 비공감 {comment.dislikes}</span>
              </article>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

/** A flat, all-titles-at-once companion to the 3D sphere: the sphere reads as an
 * atmosphere, not a scanner, since only cards facing the camera are legible at any
 * moment. This panel lists every currently loaded post in one place so a visitor can
 * actually scan the board. Posts arrive newest-first from both `loadDomestic` (board
 * pages fetched in page order) and `loadCursorDiscussion` (cursor starts at the latest
 * post), so the incoming order already reads as "최신순" without re-sorting an
 * ambiguous date string. Selecting a row opens the same detail popup as tapping its
 * card in the sphere. */
function DiscussionListPanel({
  posts,
  selectedId,
  onSelect,
}: {
  posts: UniversePost[];
  selectedId: string | null;
  onSelect: (post: UniversePost) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`discussion-list-panel ${collapsed ? "is-collapsed" : ""}`} aria-label="전체 토론 목록">
      <header>
        <div>
          <span>ALL SIGNALS</span>
          <strong>
            전체 목록 <b>{posts.length}</b>
          </strong>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "목록 펼치기" : "목록 접기"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </header>
      {!collapsed && (
        <div className="discussion-list-scroll">
          {posts.length === 0 ? (
            <p className="discussion-list-empty">표시할 토론이 없습니다</p>
          ) : (
            posts.map((post, index) => (
              <button
                key={post.id}
                type="button"
                className={`discussion-list-row ${selectedId === post.id ? "is-active" : ""}`}
                onClick={() => onSelect(post)}
              >
                <span className="discussion-list-row-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="discussion-list-row-body">
                  <strong>{post.title}</strong>
                  <em>
                    {post.author} · 조회 {post.views.toLocaleString()}
                  </em>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
}

/** The five names `market_brief.py` actually generates a daily AI-written brief for
 * (see MARKET_TABS in MarketBriefPage.tsx) — every other code this page can be opened
 * with falls back to the rule-based summary below instead of silently showing nothing. */
const AI_BRIEF_SLUGS: Record<string, string> = {
  "005930": "samsung",
  "000660": "hynix",
  "005380": "hyundai",
  "402340": "sksquare",
  "009150": "semco",
};

type StockBrief = { date: string; summary: string; analysis: string[]; key_issues?: string[] };

function formatEok(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

/** KST calendar date as YYYY-MM-DD, matching the trading-date string market_brief.py
 * stores — en-CA is just the shortest built-in Intl locale that formats that way. */
function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function toneOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (!value) return "flat";
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function MiniTrendChart({ points, tone: chartTone }: { points: number[]; tone: "up" | "down" | "flat" }) {
  if (points.length < 2) return <div className="discussion-insight-chart-empty">차트 준비 중</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((value, index) => [
    (index / (points.length - 1)) * 280,
    58 - ((value - min) / span) * 48,
  ]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,58 ${line} 280,58`;
  return (
    <svg className={`discussion-insight-chart is-${chartTone}`} viewBox="0 0 280 58" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} className="discussion-insight-chart-fill" />
      <polyline points={line} className="discussion-insight-chart-line" />
    </svg>
  );
}

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Every line the AUTO SUMMARY branch shows when there's no real brief to fall back
 * on — a short read built entirely from numbers already on screen (today's change%,
 * the 20-day trailing return, the year of daily closes behind the trend chart, and —
 * for a KR stock code — its trailing investor-flow rows), so it stays honest about
 * being derived rather than written. `investorRecords` is null when the flow data
 * doesn't apply to this asset (US stocks, ETFs) so that section is simply omitted
 * rather than showing a "loading" line that would never resolve. Returns one string
 * per line rather than a single blob so the panel can render a real paragraph break
 * between each point instead of one dense wall of text. */
function buildRuleBasedLines(
  quote: ExplorerQuote | null,
  spark: MarketSparkline | null,
  changeTone: "up" | "down" | "flat",
  investorRecords: InvestorTrendRecord[] | null,
): string[] {
  const lines: string[] = [];
  const r = spark?.returns;

  lines.push(
    changeTone === "up"
      ? `오늘 장중 ${quote ? fmtPct(quote.change_pct) : ""} 상승하며 강세 흐름을 보이고 있습니다.`
      : changeTone === "down"
        ? `오늘 장중 ${quote ? fmtPct(quote.change_pct) : ""} 하락하며 약세 흐름을 보이고 있습니다.`
        : "오늘 장중 뚜렷한 방향성 없이 보합권에서 움직이고 있습니다.",
  );

  lines.push(
    r?.d20 == null
      ? "최근 20거래일 추세 데이터를 준비하는 중입니다."
      : `최근 20거래일(약 1개월) 수익률은 ${fmtPct(r.d20)}로, ${r.d20 >= 0 ? "단기 상승 흐름" : "단기 조정 흐름"}에 가깝습니다.`,
  );

  const points = spark?.points ?? [];
  if (quote && points.length >= 2) {
    const hi = Math.max(...points);
    const lo = Math.min(...points);
    if (hi > lo) {
      const posPct = ((quote.close - lo) / (hi - lo)) * 100;
      lines.push(
        `최근 조회 구간(약 1년) 고가 대비 ${fmtPct(((quote.close - hi) / hi) * 100)}, 저가 대비 ${fmtPct(((quote.close - lo) / lo) * 100)} 지점으로, 구간 내 위치는 하단 대비 상위 ${posPct.toFixed(0)}% 수준입니다.`,
      );
    }
  } else {
    lines.push("최근 1년 가격 구간 데이터를 준비하는 중입니다.");
  }

  if (investorRecords) {
    const latest = investorRecords[0];
    if (latest) {
      lines.push(
        `최근 거래일(${latest.date}) 수급은 외국인 ${formatEok(latest.foreign_amount)}, 기관 ${formatEok(latest.institution_amount)}, 개인 ${formatEok(latest.individual_amount)} 순매수(매도)입니다.`,
      );
      const cumForeign = investorRecords.reduce((sum, row) => sum + row.foreign_amount, 0);
      const cumInstitution = investorRecords.reduce((sum, row) => sum + row.institution_amount, 0);
      lines.push(
        `최근 ${investorRecords.length}거래일 누적으로는 외국인 ${formatEok(cumForeign)}, 기관 ${formatEok(cumInstitution)} 순매수(매도)를 기록해, ${cumForeign >= 0 ? "외국인 자금이 순유입" : "외국인 자금이 순유출"}되는 흐름입니다.`,
      );
    } else {
      lines.push("최근 수급(외국인·기관) 데이터를 준비하는 중입니다.");
    }
  }

  return lines;
}

/** A floating, tilted card mirroring DiscussionListPanel on the opposite side — the
 * sphere's spare left real estate on wide screens. Shows the price already polled for
 * the header, a trailing-close trend chart, and a short read of today's session: a
 * real AI-written blurb for the five stocks `market_brief.py` covers, and a rule-based
 * one (built from the same change%/trailing-return numbers already on screen) for
 * every other code, so the panel never has to hide itself for lack of a real brief.
 * Desktop-only: gated to width in CSS rather than unmounted, since the fetches it
 * triggers are cheap and worth warming even just under the breakpoint. */
function DiscussionInsightPanel({
  code,
  name,
  market,
  assetKind,
  quote,
}: {
  code: string;
  name: string;
  market: "KR" | "US";
  assetKind: AssetKind;
  quote: ExplorerQuote | null;
}) {
  const [brief, setBrief] = useState<StockBrief | null>(null);
  const [spark, setSpark] = useState<MarketSparkline | null>(null);
  const [investorRecords, setInvestorRecords] = useState<InvestorTrendRecord[]>([]);
  // Naver's investor-flow table only exists for KR common stocks — not US listings,
  // not ETFs — so this is checked once here rather than inferred from an empty
  // response, which would be indistinguishable from "still loading".
  const investorApplicable = market === "KR" && assetKind === "STOCK";

  useEffect(() => {
    setBrief(null);
    const slug = market === "KR" && assetKind === "STOCK" ? AI_BRIEF_SLUGS[code] : undefined;
    if (!slug) return;
    let cancelled = false;

    const load = () => {
      fetch(`/api/market-brief/latest/${slug}`)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data: StockBrief) => {
          // The batch that writes this only runs once, at 16:10 KST after close (see
          // market_brief.py's _loop). Mid-session — or on a day the batch hasn't run
          // yet — "latest" is still whatever the last completed session produced,
          // sometimes several days stale across a holiday weekend. Showing that next
          // to a live current price reads as "today's take" when it isn't, so it's
          // only surfaced once its trading date actually catches up to today; until
          // then the rule-based summary below (built from the same live numbers) is
          // the honest one to show.
          if (!cancelled && data.date === todayKst()) setBrief(data);
        })
        .catch(() => {
          // No brief published yet for today — the rule-based summary covers it.
        });
    };

    load();
    // It's written to storage once, at 16:10 KST — polling every 10s like the quote
    // would just be 360 wasted requests an hour for a value that changes once a day.
    // Five minutes is fast enough to flip a page left open across that moment from
    // the rule-based summary to the real brief without a manual refresh.
    const stopPolling = startVisibilityAwareInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code, market, assetKind]);

  useEffect(() => {
    setSpark(null);
    let cancelled = false;
    api
      .marketSparklines([code], market === "US" ? "us" : "kr")
      .then((res) => {
        if (!cancelled) setSpark(res.items[code] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, market]);

  useEffect(() => {
    setInvestorRecords([]);
    if (!investorApplicable) return;
    let cancelled = false;
    const load = () => {
      api
        .investorTrend(code, 20)
        .then((res) => {
          if (!cancelled) setInvestorRecords(res.records);
        })
        .catch(() => {});
    };
    load();
    const stopPolling = startVisibilityAwareInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code, investorApplicable]);

  const changeTone = toneOf(quote?.change_pct);
  const ruleBasedLines = useMemo(
    () => buildRuleBasedLines(quote, spark, changeTone, investorApplicable ? investorRecords : null),
    [quote, spark, changeTone, investorApplicable, investorRecords],
  );

  return (
    <aside className="discussion-insight-panel" aria-label="종목 브리핑">
      <header>
        <span>{brief ? "AI 브리핑" : "AUTO SUMMARY"}</span>
        <em>{brief ? `${brief.date} 기준` : "실시간 지표 기반"}</em>
      </header>

      <div className="discussion-insight-price">
        <div className="discussion-insight-identity">
          <StockLogo code={code} className="discussion-insight-logo" />
          <span>{name}</span>
        </div>
        <div className="discussion-insight-quote">
          {quote ? (
            <>
              <strong>
                {market === "US"
                  ? `$${quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `${quote.close.toLocaleString("ko-KR")}원`}
              </strong>
              <span className={`is-${changeTone}`}>
                {quote.change >= 0 ? "+" : ""}
                {quote.change_pct.toFixed(2)}%
              </span>
            </>
          ) : (
            <strong className="discussion-insight-price-loading">시세 확인 중…</strong>
          )}
        </div>
      </div>

      <MiniTrendChart points={spark?.points ?? []} tone={changeTone} />

      <div className="discussion-insight-analysis">
        {brief ? (
          <>
            <p>{brief.summary}</p>
            {brief.analysis.slice(0, 3).map((line, index) => (
              <p key={index}>{line}</p>
            ))}
            {brief.key_issues && brief.key_issues.length > 0 && (
              <div className="discussion-insight-issues">
                <b>핵심 이슈</b>
                <ul>
                  {brief.key_issues.slice(0, 4).map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          ruleBasedLines.map((line, index) => <p key={index}>{line}</p>)
        )}
      </div>
    </aside>
  );
}

export default function DiscussionExplorerPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") || "005930";
  const name = params.get("name") || code;
  const market = params.get("market") === "US" ? "US" : "KR";
  const assetKind: AssetKind = params.get("asset") === "ETF" ? "ETF" : "STOCK";
  const backPath = assetKind === "ETF" ? "/etf" : market === "US" ? `/global?code=${encodeURIComponent(code)}` : `/stock/${encodeURIComponent(code)}`;

  useDocumentTitle(`${name} 종목토론 · K-Stock Hub`);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [posts, setPosts] = useState<UniversePost[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<UniversePost | null>(null);
  const [disintegrating, setDisintegrating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoomLabel, setZoomLabel] = useState(100);
  const [helpOpen, setHelpOpen] = useState(false);
  const [headerQuote, setHeaderQuote] = useState<ExplorerQuote | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockResults, setStockResults] = useState<StockSearchResult[]>([]);
  const [etfUniverse, setEtfUniverse] = useState<EtfItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isIphonePortrait = /iPhone|iPod/i.test(navigator.userAgent) && viewportWidth < window.innerHeight;
  const isCompactTouch = viewportWidth <= 1100 && window.matchMedia("(pointer: coarse)").matches;
  const nextDomesticPage = useRef(6);
  const nextGlobalOffset = useRef<string | null>(null);
  const etfUniverseRequested = useRef(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputTimer = useRef<number | null>(null);
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = useRef({ x: -8, y: 0 });
  const zoom = useRef(defaultZoom());
  const drag = useRef({ active: false, x: 0, y: 0, pointerId: -1 });
  const touchDistance = useRef<number | null>(null);
  const activePointers = useRef(new Set<number>());
  const pendingCardTap = useRef<{ post: UniversePost; pointerId: number; x: number; y: number } | null>(null);
  const starPaused = useRef(false);
  const pageVisible = useRef(!document.hidden);
  const removalTimers = useRef(new Set<number>());
  const gestureTransformFrame = useRef(0);
  const zoomLabelTimer = useRef<number | null>(null);
  const viewportChanging = useRef(false);
  const appliedFaceRotation = useRef({ x: Number.NaN, y: Number.NaN });
  const lastFaceUpdate = useRef(0);

  useEffect(() => {
    const onVisibilityChange = () => { pageVisible.current = !document.hidden; };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removalTimers.current.forEach((timer) => window.clearTimeout(timer));
      removalTimers.current.clear();
      if (searchInputTimer.current !== null) window.clearTimeout(searchInputTimer.current);
      if (gestureTransformFrame.current) window.cancelAnimationFrame(gestureTransformFrame.current);
      if (zoomLabelTimer.current !== null) window.clearTimeout(zoomLabelTimer.current);
    };
  }, []);

  useEffect(() => {
    let settleTimer = 0;
    const settleViewport = () => {
      window.clearTimeout(settleTimer);
      viewportChanging.current = true;
      stageRef.current?.classList.add("is-viewport-changing");
      settleTimer = window.setTimeout(() => {
        // Width changes represent a real layout/orientation change. Mobile browser
        // chrome mostly changes height, which must not rebuild the 3D tree.
        setViewportWidth((current) => Math.abs(current - window.innerWidth) >= 24 ? window.innerWidth : current);
        viewportChanging.current = false;
        stageRef.current?.classList.remove("is-viewport-changing");
        appliedFaceRotation.current = { x: Number.NaN, y: Number.NaN };
        applySceneTransform(true);
      }, 320);
    };
    window.addEventListener("resize", settleViewport, { passive: true });
    window.addEventListener("orientationchange", settleViewport, { passive: true });
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", settleViewport);
      window.removeEventListener("orientationchange", settleViewport);
    };
  }, []);

  useEffect(() => {
    starPaused.current = Boolean(selected);
  }, [isIphonePortrait, selected]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      const request = assetKind === "ETF"
        ? api.etfQuote(code, market)
        : market === "US" ? api.usStockQuote(code) : api.quote(code);
      request.then((quote) => {
        if (!cancelled) setHeaderQuote({ close: quote.close, change: quote.change, change_pct: quote.change_pct });
      }).catch(() => {
        // Discussion remains usable when a quote provider is temporarily unavailable.
      });
    };
    poll();
    const stopPolling = startVisibilityAwareInterval(poll, 10_000);
    return () => { cancelled = true; stopPolling(); };
  }, [assetKind, code, market]);

  useEffect(() => {
    const canvas = starCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const compactTouch = window.innerWidth <= 1100 && window.matchMedia("(pointer: coarse)").matches;
    let frame = 0;
    let previous = -Infinity;
    let animationStarted = performance.now();
    let width = 0;
    let height = 0;
    let ratio = 1;
    let resizeTimer = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      // A capped DPR keeps stars crisp without allocating a full 4K canvas on
      // high-density phones and tablets.
      ratio = compactTouch ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      COSMIC_STARS.forEach((star, index) => {
        const pulse = reducedMotion ? 0.82 : 0.66 + Math.sin(time / (star.duration * 520) + index * 1.71) * 0.26;
        const x = width * star.x / 100;
        const y = height * star.y / 100;
        const radius = star.size * Math.max(0.7, pulse);
        context.globalAlpha = Math.max(0.16, star.opacity * pulse);
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(x, y, radius / 2, 0, Math.PI * 2);
        context.fill();
        if (star.radiant && !compactTouch) {
          const glow = context.createRadialGradient(x, y, 0, x, y, radius * 4.8);
          glow.addColorStop(0, "rgba(255,255,255,.9)");
          glow.addColorStop(.18, star.color);
          glow.addColorStop(1, "rgba(103,232,249,0)");
          context.globalAlpha = star.opacity * .62;
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, radius * 4.8, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = star.color;
          context.lineWidth = .55;
          context.beginPath();
          context.moveTo(x - radius * 5.5, y); context.lineTo(x + radius * 5.5, y);
          context.moveTo(x, y - radius * 5.5); context.lineTo(x, y + radius * 5.5);
          context.stroke();
        }
      });
      context.globalAlpha = 1;
    };

    const animateStars = (time: number) => {
      // Slow stellar scintillation does not need a 60 Hz repaint. 12 Hz looks
      // continuous while leaving the main thread/GPU budget to the 3D cards.
      if (!starPaused.current && time - previous >= 84) { draw(time); previous = time; }
      // After the entrance ambience has settled, retain the last star frame. A
      // permanent full-screen canvas repaint caused heat/throttling on long visits.
      if (time - animationStarted >= 20_000) { frame = 0; return; }
      frame = window.requestAnimationFrame(animateStars);
    };
    resize();
    draw(0);
    // A static star field preserves the atmosphere on compact iPhones without a
    // permanent canvas repaint loop competing with WebKit's 3D compositor.
    if (!reducedMotion && !compactTouch) frame = window.requestAnimationFrame(animateStars);
    // Safari changes innerHeight while its address bar moves. Reallocating a canvas
    // buffer on every such resize is expensive and can retain old IOSurface memory.
    // On compact iOS only an orientation change warrants a new backing store.
    const settleCanvas = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { resize(); draw(performance.now()); }, 320);
    };
    window.addEventListener("resize", settleCanvas, { passive: true });
    window.addEventListener("orientationchange", settleCanvas, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", settleCanvas);
      window.removeEventListener("orientationchange", settleCanvas);
    };
  }, []);

  const applySceneTransform = (forceFace = false) => {
    if (!sceneRef.current) return;
    rotation.current.x = normalizeAngle(rotation.current.x);
    rotation.current.y = normalizeAngle(rotation.current.y);
    const x = Math.round(rotation.current.x * 1000) / 1000;
    const y = Math.round(rotation.current.y * 1000) / 1000;
    sceneRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${zoom.current}) rotateX(${x}deg) rotateY(${y}deg)`;
    // Zoom changes do not change billboard orientation. Avoid invalidating inherited
    // custom properties across every card during a pinch/wheel gesture.
    const now = performance.now();
    // Updating inherited billboard variables recalculates every card subtree. On
    // touch devices 20 Hz remains visually locked to the very slow globe while
    // leaving alternate frames entirely to the compositor.
    const faceDue = forceFace || !isCompactTouch || now - lastFaceUpdate.current >= 50;
    if (faceDue && (appliedFaceRotation.current.x !== x || appliedFaceRotation.current.y !== y)) {
      sceneRef.current.style.setProperty("--face-x", `${-x}deg`);
      sceneRef.current.style.setProperty("--face-y", `${-y}deg`);
      appliedFaceRotation.current = { x, y };
      lastFaceUpdate.current = now;
    }
  };

  const scheduleSceneTransform = () => {
    if (gestureTransformFrame.current) return;
    gestureTransformFrame.current = window.requestAnimationFrame(() => {
      gestureTransformFrame.current = 0;
      applySceneTransform();
    });
  };

  const scheduleZoomLabel = () => {
    if (zoomLabelTimer.current !== null) window.clearTimeout(zoomLabelTimer.current);
    zoomLabelTimer.current = window.setTimeout(() => {
      setZoomLabel(Math.round(zoom.current * 100));
      zoomLabelTimer.current = null;
    }, 120);
  };

  useEffect(() => {
    zoom.current = Math.min(maximumZoom(), Math.max(0.42, zoom.current));
    appliedFaceRotation.current = { x: Number.NaN, y: Number.NaN };
    scheduleSceneTransform();
    setZoomLabel(Math.round(zoom.current * 100));
  }, [viewportWidth]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setStockResults([]);
      setSearching(false);
      return;
    }
    // The ETF catalog is only needed once the visitor actually searches. Avoid
    // retaining that additional dataset during ordinary universe exploration.
    if (!etfUniverseRequested.current) {
      etfUniverseRequested.current = true;
      Promise.all([api.etfs("KR"), api.etfs("US")])
        .then(([kr, us]) => setEtfUniverse([...kr.items, ...us.items]))
        .catch(() => setEtfUniverse([]));
    }
    setSearching(true);
    const controller = new AbortController();
    api.search(query, controller.signal)
      .then(setStockResults)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setStockResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [searchQuery]);

  const searchResults = useMemo<SearchAsset[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const etfs: SearchAsset[] = etfUniverse
      .filter((item) => `${item.name} ${item.code} ${item.benchmark}`.toLowerCase().includes(query))
      .map((item) => ({ code: item.code, name: item.name, market: item.region, kind: "ETF" }));
    const stocks: SearchAsset[] = stockResults.map((item) => ({
      code: item.code,
      name: item.name,
      market: item.market === "US" ? "US" : "KR",
      kind: "STOCK",
    }));
    return dedupe([...etfs, ...stocks].map((item) => ({ ...item, id: `${item.kind}:${item.market}:${item.code}` })))
      .slice(0, 12)
      .map(({ id: _id, ...item }) => item);
  }, [etfUniverse, searchQuery, stockResults]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const loadDomestic = async () => {
      const pages = await Promise.all([1, 2, 3, 4, 5].map((page) => api.board(code, page, page === 1)));
      return { items: dedupe(pages.flatMap((page) => page.items.map(normalizeDomestic))).slice(0, INITIAL_COUNT), nextOffset: null };
    };
    const loadCursorDiscussion = async (source: "naver" | "toss") => {
      let offset: string | null = null;
      let items: UniversePost[] = [];
      while (items.length < INITIAL_COUNT) {
        const limit = source === "toss" ? 10 : Math.min(50, INITIAL_COUNT - items.length);
        const result: { items: GlobalDiscussionPost[]; next_offset: string | null } = source === "toss"
          ? await api.tossEtfDiscussion(code, limit, offset)
          : await api.globalDiscussion(code, limit, offset);
        items = dedupe([...items, ...result.items.map(normalizeGlobal)]);
        offset = result.next_offset;
        if (!offset || result.items.length === 0) break;
      }
      return { items: items.slice(0, INITIAL_COUNT), nextOffset: offset };
    };
    const request = market === "KR"
      ? loadDomestic()
      : loadCursorDiscussion(assetKind === "ETF" ? "toss" : "naver");

    request
      .then((result) => {
        if (cancelled) return;
        setPosts(result.items);
        nextGlobalOffset.current = result.nextOffset;
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "토론 신호를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [assetKind, code, market]);

  useEffect(() => {
    scheduleSceneTransform();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!autoRotate || selected || disintegrating || reducedMotion) return;
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      // A fixed sustainable cadence avoids 90/120 Hz devices doing twice the work
      // and later thermal-throttling. The browser can still present other UI at its
      // native refresh rate while the slow cinematic orbit updates independently.
      const interval = 1000 / (isCompactTouch ? 30 : 45);
      if (pageVisible.current && !viewportChanging.current && !drag.current.active && now - previous >= interval) {
        const elapsed = Math.min(50, now - previous);
        previous = now;
        // 0.00525 = the original 0.0035 speed × 1.5. Time-based motion keeps the
        // angular velocity identical on 60/90/120Hz displays and after a busy frame.
        rotation.current.y += elapsed * 0.00525;
        applySceneTransform();
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, disintegrating, isCompactTouch, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select")) return;
      const step = event.shiftKey ? 12 : 5;
      if (["ArrowLeft", "a", "A"].includes(event.key)) rotation.current.y -= step;
      else if (["ArrowRight", "d", "D"].includes(event.key)) rotation.current.y += step;
      else if (["ArrowUp", "w", "W"].includes(event.key)) rotation.current.x -= step;
      else if (["ArrowDown", "s", "S"].includes(event.key)) rotation.current.x += step;
      else if (["+", "="].includes(event.key)) zoom.current = Math.min(maximumZoom(), zoom.current + 0.08);
      else if (["-", "_"].includes(event.key)) zoom.current = Math.max(0.42, zoom.current - 0.08);
      else if (event.key === "Escape") {
        const closeButton = document.querySelector<HTMLButtonElement>(".discussion-detail header button");
        if (!closeButton) return;
        closeButton.click();
      }
      else return;
      rotation.current.x = Math.max(-80, Math.min(80, rotation.current.x));
      setZoomLabel(Math.round(zoom.current * 100));
      applySceneTransform();
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activePosts = useMemo(() => posts.filter((post) => !removed.has(post.id)), [posts, removed]);
  // Data remains at 40 signals, while compact iPhone WebKit only composites a
  // bounded window of 3D cards at once to avoid its per-page GPU memory ceiling.
  const renderedPosts = useMemo(
    () => isIphonePortrait ? activePosts.slice(0, 28) : activePosts,
    [activePosts, isIphonePortrait],
  );
  const positions = useMemo(() => {
    const count = Math.max(isIphonePortrait ? 28 : INITIAL_COUNT, renderedPosts.length);
    // Keep the complete orbit inside narrow screens. Desktop retains the cinematic
    // 510px radius; phones use a tighter physical sphere plus their smaller zoom.
    const sphereRadius = Math.min(SPHERE_RADIUS, Math.max(280, viewportWidth * 0.44));
    return new Map(renderedPosts.map((post, index) => [post.id, spherePoint(index, count, sphereRadius)]));
  }, [isIphonePortrait, renderedPosts, viewportWidth]);

  const selectPost = (post: UniversePost) => {
    if (selected && selected.id !== post.id) {
      const previousId = selected.id;
      setDisintegrating(previousId);
      const timer = window.setTimeout(() => {
        setRemoved((current) => new Set(current).add(previousId));
        setDisintegrating((current) => current === previousId ? null : current);
        removalTimers.current.delete(timer);
      }, isIphonePortrait ? 400 : 850);
      removalTimers.current.add(timer);
    }
    reportDiscussionPostClick({ code, name, title: post.title, postId: post.id, market, assetKind });
    setSelected(post);
  };

  const closeSelectedPost = () => {
    if (!selected) return;
    const closingId = selected.id;
    // Closing the panel resumes rotation immediately (selected becomes null), while
    // the card remains in the scene just long enough to complete its dust animation.
    setSelected(null);
    setDisintegrating(closingId);
    const timer = window.setTimeout(() => {
      setRemoved((current) => new Set(current).add(closingId));
      setDisintegrating((current) => current === closingId ? null : current);
      removalTimers.current.delete(timer);
    }, isIphonePortrait ? 400 : 850);
    removalTimers.current.add(timer);
  };

  const loadMore = async () => {
    if (loadingMore || removed.size === 0 || activePosts.length >= MAX_VISIBLE) return;
    setLoadingMore(true);
    const wanted = Math.min(removed.size, MAX_VISIBLE - activePosts.length);
    try {
      let incoming: UniversePost[] = [];
      if (market === "KR") {
        while (incoming.length < wanted && nextDomesticPage.current <= 20) {
          const result = await api.board(code, nextDomesticPage.current++);
          incoming = dedupe([...incoming, ...result.items.map(normalizeDomestic)]);
          if (result.items.length === 0) break;
        }
      } else if (nextGlobalOffset.current) {
        let offset: string | null = nextGlobalOffset.current;
        while (incoming.length < wanted && offset) {
          const limit = assetKind === "ETF" ? 10 : Math.min(50, wanted - incoming.length);
          const result: { items: GlobalDiscussionPost[]; next_offset: string | null } = assetKind === "ETF"
            ? await api.tossEtfDiscussion(code, limit, offset)
            : await api.globalDiscussion(code, limit, offset);
          incoming = dedupe([...incoming, ...result.items.map(normalizeGlobal)]);
          offset = result.next_offset;
          if (result.items.length === 0) break;
        }
        nextGlobalOffset.current = offset;
      }
      const existing = new Set(posts.map((post) => post.id));
      const additions = incoming.filter((post) => !existing.has(post.id)).slice(0, wanted);
      // Discard explored post payloads instead of retaining them forever behind the
      // removed-id filter. Repeated explore/refill cycles now stay bounded at 40.
      setPosts((current) => [
        ...current.filter((post) => !removed.has(post.id)),
        ...additions,
      ].slice(0, MAX_VISIBLE));
      setRemoved(new Set());
    } finally {
      setLoadingMore(false);
    }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selected || (event.target as HTMLElement).closest("button, a, .discussion-detail, .discussion-list-panel, .discussion-insight-panel")) return;
    drag.current = { active: true, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const captureCardPress = (event: ReactPointerEvent<HTMLElement>) => {
    activePointers.current.add(event.pointerId);
    if (activePointers.current.size > 1) {
      // A second contact turns the gesture into pinch/rotate immediately. Never let
      // either finger activate a card when it is released.
      pendingCardTap.current = null;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".discussion-detail-layer, .discussion-search, .discussion-controls, .discussion-footer, .discussion-hud, .discussion-list-panel, .discussion-insight-panel")) return;
    const buttons = Array.from(sceneRef.current?.querySelectorAll<HTMLButtonElement>(".discussion-node > button") ?? []);
    const matches = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (matches.length === 0) return;
    // Several cards can overlap in the projected sphere. Prefer the one the browser
    // paints foremost, then the one whose visual centre is closest to the pointer.
    const chosen = matches.sort((left, right) => {
      const leftNode = left.closest<HTMLElement>(".discussion-node");
      const rightNode = right.closest<HTMLElement>(".discussion-node");
      const depthDifference = Number(rightNode?.style.zIndex || 0) - Number(leftNode?.style.zIndex || 0);
      if (depthDifference) return depthDifference;
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return Math.hypot(event.clientX - (a.left + a.width / 2), event.clientY - (a.top + a.height / 2))
        - Math.hypot(event.clientX - (b.left + b.width / 2), event.clientY - (b.top + b.height / 2));
    })[0];
    const postId = chosen.dataset.postId;
    const post = activePosts.find((item) => item.id === postId);
    if (!post) return;
    pendingCardTap.current = { post, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const capturePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const pending = pendingCardTap.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    // Eight physical CSS pixels tolerates normal tap jitter while cancelling a drag
    // early enough that an iPhone pinch never becomes an accidental post open.
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8 || activePointers.current.size > 1) {
      pendingCardTap.current = null;
    }
  };

  const captureCardRelease = (event: ReactPointerEvent<HTMLElement>) => {
    const pending = pendingCardTap.current;
    const wasSingleTap = activePointers.current.size === 1 && pending?.pointerId === event.pointerId;
    // Card buttons stop the bubbling pointerup event, so release any stage drag in
    // capture phase before opening the detail panel.
    drag.current.active = false;
    activePointers.current.delete(event.pointerId);
    pendingCardTap.current = null;
    if (!wasSingleTap || !pending) return;
    event.preventDefault();
    event.stopPropagation();
    selectPost(pending.post);
  };

  const capturePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    drag.current.active = false;
    activePointers.current.delete(event.pointerId);
    pendingCardTap.current = null;
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A stale pointer capture must never rotate the universe behind an open panel.
    // Mouse movement with no pressed button also terminates a missed pointerup.
    if (selected || (event.pointerType === "mouse" && event.buttons === 0)) {
      drag.current.active = false;
      return;
    }
    if (!drag.current.active || drag.current.pointerId !== event.pointerId) return;
    rotation.current.y += (event.clientX - drag.current.x) * 0.24;
    rotation.current.x -= (event.clientY - drag.current.y) * 0.18;
    rotation.current.x = Math.max(-80, Math.min(80, rotation.current.x));
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    applySceneTransform();
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    applySceneTransform(true);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Scrollable overlays own their wheel gesture. Letting it bubble into the stage
    // zoomed the entire universe while the user was only reading a post/search list.
    if (target.closest(".discussion-detail-layer, .discussion-search, .discussion-help, .discussion-list-panel, .discussion-insight-panel")) return;
    zoom.current = Math.max(0.42, Math.min(maximumZoom(), zoom.current - event.deltaY * 0.0007));
    scheduleZoomLabel();
    scheduleSceneTransform();
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      touchDistance.current = null;
      return;
    }
    const [a, b] = Array.from(event.touches);
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (touchDistance.current !== null) {
      zoom.current = Math.max(0.42, Math.min(maximumZoom(), zoom.current + (distance - touchDistance.current) * 0.003));
      // Do not update React state during a pinch: doing so reconciled all 50 cards on
      // every iOS touchmove. The scene transform itself remains immediate and smooth.
      scheduleSceneTransform();
    }
    touchDistance.current = distance;
  };

  return (
    <main
      className={`discussion-explorer ${selected ? "has-detail" : ""} ${isCompactTouch ? "is-compact-touch" : ""} ${isIphonePortrait ? "is-iphone-portrait" : ""}`}
      ref={stageRef}
      onPointerDownCapture={captureCardPress}
      onPointerMoveCapture={capturePointerMove}
      onPointerUpCapture={captureCardRelease}
      onPointerCancelCapture={capturePointerCancel}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onTouchEnd={() => { touchDistance.current = null; setZoomLabel(Math.round(zoom.current * 100)); scheduleSceneTransform(); }}
    >
      <div className="discussion-cosmos" aria-hidden="true" />
      <div className="discussion-nebula" aria-hidden="true" />
      <canvas className="discussion-stars" ref={starCanvasRef} aria-hidden="true" />
      <div className="discussion-comets" aria-hidden="true"><i /><i /><i /></div>
      {FPS_METER_ENABLED && <ExplorerFpsMeter cards={renderedPosts.length} />}

      <header className="discussion-hud">
        <Link to={backPath} className="discussion-back" aria-label="종목 상세로 돌아가기">←</Link>
        <div className="discussion-heading">
          <span>LIVE DISCUSSION UNIVERSE</span>
          <h1>
            <Link to={backPath} className="discussion-heading-asset" aria-label={`${name} 종목 상세로 이동`}>
              <StockLogo code={code} className="discussion-heading-logo" />
              <span>{name}</span>
              <b>{code}</b>
            </Link>
            {headerQuote && (
              <span className={`discussion-heading-quote is-${headerQuote.change > 0 ? "up" : headerQuote.change < 0 ? "down" : "flat"}`}>
                <strong>{market === "US" ? `$${headerQuote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${headerQuote.close.toLocaleString("ko-KR")}원`}</strong>
                <em>
                  {headerQuote.change >= 0 ? "+" : "-"}
                  {market === "US" ? `$${Math.abs(headerQuote.change).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.abs(headerQuote.change).toLocaleString("ko-KR")}
                  <span> ({headerQuote.change_pct >= 0 ? "+" : ""}{headerQuote.change_pct.toFixed(2)}%)</span>
                </em>
              </span>
            )}
          </h1>
          <p>종목토론</p>
        </div>
        <div className="discussion-counter"><strong>{activePosts.length}</strong><span>ACTIVE SIGNALS</span></div>
      </header>

      <div className="discussion-search" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="discussion-search-prompt"
          onClick={() => { searchInputRef.current?.focus(); setSearchOpen(true); }}
        >
          <span aria-hidden="true">✦</span> 삼성전자 외 다른 종목도 탐험해 보세요
        </button>
        <div className={`discussion-search-box ${searchOpen ? "is-open" : ""}`}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInputRef}
            defaultValue=""
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearchOpen(true);
              if (searchInputTimer.current !== null) window.clearTimeout(searchInputTimer.current);
              // Keep native typing independent from the expensive 3D React tree.
              searchInputTimer.current = window.setTimeout(() => {
                setSearchQuery(value);
                searchInputTimer.current = null;
              }, 180);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="종목명·티커를 입력하세요 (예: SK하이닉스, AAPL, QQQ)"
            aria-label="국내 해외 종목 및 ETF 통합 검색"
          />
          {searching && <i aria-label="검색 중" />}
          {searchQuery && <button type="button" onClick={() => {
            if (searchInputTimer.current !== null) window.clearTimeout(searchInputTimer.current);
            searchInputTimer.current = null;
            if (searchInputRef.current) searchInputRef.current.value = "";
            setSearchQuery("");
            setSearchOpen(false);
          }} aria-label="검색어 지우기">×</button>}
          {!searchQuery && !searching && <button type="button" className="discussion-search-cta" onClick={() => searchInputRef.current?.focus()}>종목 찾기</button>}
        </div>
        {searchOpen && searchQuery.trim() && (
          <div className="discussion-search-results">
            {searchResults.length === 0 && !searching ? <p>검색 결과가 없습니다.</p> : searchResults.map((item) => (
              <button
                type="button"
                key={`${item.kind}-${item.market}-${item.code}`}
                onClick={() => {
                  reportDiscussionSearchSelection({
                    code: item.code,
                    name: item.name,
                    market: item.market,
                    assetKind: item.kind,
                  });
                  window.location.assign(`/discussion-explorer?code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}&market=${item.market}&asset=${item.kind}`);
                }}
              >
                <span className={`asset-${item.kind.toLowerCase()}`}>{item.kind}</span>
                <strong>{item.name}</strong>
                <small>{item.code}</small>
                <em>{item.market === "KR" ? "국내" : "해외"}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="discussion-statusbar">
        <span><i className="is-live" /> 실시간 토론 궤도</span>
        <span>확대 {zoomLabel}%</span>
        <span>현재 {activePosts.length}/{MAX_VISIBLE}</span>
      </div>

      <DiscussionInsightPanel code={code} name={name} market={market} assetKind={assetKind} quote={headerQuote} />
      <DiscussionListPanel posts={activePosts} selectedId={selected?.id ?? null} onSelect={selectPost} />

      <section className="discussion-viewport" aria-label={`${name} 최근 종목 토론 3차원 공간`}>
        {loading && <div className="discussion-loading"><div className="discussion-loader-orbit"><i /><i /><i /></div><p>토론 유니버스를 생성하는 중…</p></div>}
        {error && <div className="discussion-error"><strong>연결 신호가 약합니다</strong><span>{error}</span></div>}
        {!loading && !error && activePosts.length === 0 && <div className="discussion-error"><strong>표시할 토론이 없습니다</strong></div>}

        <div className="discussion-scene" ref={sceneRef}>
          <div className="discussion-core" aria-hidden="true"><i /><span>{code}</span></div>
          {renderedPosts.map((post, index) => {
            const point = positions.get(post.id) || { x: 0, y: 0, z: 0 };
            const renderedRadius = Math.min(SPHERE_RADIUS, Math.max(280, viewportWidth * 0.44));
            const depth = (point.z + renderedRadius) / (renderedRadius * 2);
            const theme = CARD_THEMES[index % CARD_THEMES.length];
            const viewTone = post.views >= 50 ? "is-hot-view" : post.views >= 15 ? "is-high-view" : post.views < 10 ? "is-low-view" : "is-mid-view";
            return (
              <div
                className={`discussion-node ${viewTone} ${selected?.id === post.id ? "is-selected" : ""} ${disintegrating === post.id ? "is-disintegrating" : ""}`}
                key={post.id}
                style={{
                  // Keep the position in the rotating globe, but counter-rotate the
                  // node itself so its card remains a camera-facing billboard even
                  // around the 90deg side-on point. Keeping this outside the card's
                  // float animation prevents that animation from overriding it.
                  transform: `translate3d(${point.x}px, ${point.y}px, ${point.z}px) rotateY(var(--face-y, 0deg)) rotateX(var(--face-x, 0deg))`,
                  zIndex: Math.round(depth * 100),
                  // Rear-hemisphere posts must remain readable while the sphere turns.
                  // Depth is still communicated by scale and contrast, not by fading
                  // a card until it effectively disappears.
                  opacity: 0.72 + depth * 0.28,
                  "--float-delay": `${-(index % 17) * 0.37}s`,
                  "--node-scale": `${0.68 + depth * 0.5}`,
                  // A bounded micro-orbit gives every signal its own direction without
                  // destroying the globe's spatial memory or letting 80 hit targets
                  // cross one another. Prime-ish cycles avoid visible synchronization.
                  "--drift-x": `${((index * 7) % 11) - 5}px`,
                  "--drift-y": `${((index * 13) % 9) - 4}px`,
                  "--drift-x-start": `${-(((index * 7) % 11) - 5) * 0.55}px`,
                  "--drift-y-start": `${-(((index * 13) % 9) - 4) * 0.55}px`,
                  "--drift-x-mid": `${-(((index * 7) % 11) - 5) * 0.2}px`,
                  "--drift-y-mid": `${(((index * 13) % 9) - 4) * 0.4}px`,
                  "--drift-r": `${((index * 5) % 7) - 3}deg`,
                  "--drift-r-start": `${-(((index * 5) % 7) - 3) * 0.35}deg`,
                  "--drift-r-mid": `${-(((index * 5) % 7) - 3) * 0.15}deg`,
                  "--drift-duration": `${6.5 + (index % 9) * 0.43}s`,
                  "--drift-direction": index % 2 === 0 ? "normal" : "reverse",
                  "--card-accent": theme.accent,
                  "--card-text": theme.text,
                  "--card-a": theme.a,
                  "--card-b": theme.b,
                } as React.CSSProperties}
              >
                <button
                  type="button"
                  data-post-id={post.id}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    // Pointer interaction is resolved by the stage gesture arbiter;
                    // detail===0 keeps
                    // Enter/Space keyboard activation available without double firing.
                    if (event.detail === 0) selectPost(post);
                  }}
                >
                  <span className="discussion-node-index">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{post.title}</strong>
                  <span className="discussion-node-preview">{post.preview}</span>
                  <span className="discussion-node-meta">{post.author} · 조회 {post.views.toLocaleString()}</span>
                  <i className="discussion-node-beacon" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="discussion-controls">
        <button type="button" className={autoRotate ? "is-on" : ""} onClick={() => setAutoRotate((value) => !value)} title="자동 회전">◉<span>자동 회전</span></button>
        <button type="button" onClick={() => { zoom.current = Math.min(maximumZoom(), zoom.current + 0.12); setZoomLabel(Math.round(zoom.current * 100)); applySceneTransform(); }} title="확대">＋<span>확대</span></button>
        <button type="button" onClick={() => { zoom.current = Math.max(0.42, zoom.current - 0.12); setZoomLabel(Math.round(zoom.current * 100)); applySceneTransform(); }} title="축소">−<span>축소</span></button>
        <button type="button" onClick={() => { const nextZoom = defaultZoom(); rotation.current = { x: -8, y: 0 }; zoom.current = nextZoom; setZoomLabel(Math.round(nextZoom * 100)); applySceneTransform(); }} title="시점 초기화">⌖<span>초기화</span></button>
        <button type="button" onClick={() => setHelpOpen((value) => !value)} title="조작 도움말">?<span>조작법</span></button>
      </div>

      {helpOpen && <div className="discussion-help"><strong>UNIVERSE CONTROLS</strong><span>드래그 · 방향키/WASD — 회전</span><span>휠 · 두 손가락 · +/− — 확대/축소</span><span>게시글 선택 — 본문과 댓글 해독</span></div>}

      <footer className="discussion-footer">
        <div><span>읽은 신호</span><strong>{removed.size}</strong></div>
        <button type="button" onClick={loadMore} disabled={loadingMore || removed.size === 0 || activePosts.length >= MAX_VISIBLE}>
          {loadingMore ? "신호 수신 중…" : removed.size === 0 ? "글을 탐험하면 새 신호를 보충할 수 있습니다" : `사라진 신호 ${Math.min(removed.size, MAX_VISIBLE - activePosts.length)}개 채우기`}
        </button>
      </footer>

      {selected && (
        <div
          className="discussion-detail-layer"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <DetailPanel key={selected.id} post={selected} code={code} market={market} onClose={closeSelectedPost} />
        </div>
      )}
    </main>
  );
}
