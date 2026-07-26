import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccuracyWindows,
  GlobalIndexWidget,
  IndexQuote,
  MarketInvestorSummary,
  MarketMapItem,
  PredictionItem,
  StockSearchResult,
  WeeklyForeignItem,
  api,
} from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { RESULT_ARROW } from "../prediction";
import { Link, navigate } from "../router";
import { getThemeColors, useThemeMode } from "../theme";
import { useDocumentTitle } from "../useDocumentTitle";
import { useMarketTicker } from "../useMarketTicker";
import { usePopularStocks } from "../usePopularStocks";
import { useVisitorCount } from "../useVisitorCount";
import { useWatchlist } from "../useWatchlist";
import Logo from "./Logo";
import LanguageToggle from "./LanguageToggle";
import SearchBar from "./SearchBar";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import "./dashboard2.css";

/* ───────────────────────────── constants ───────────────────────────── */

const INDEX_POLL_MS = 15_000;
const MAP_POLL_MS = 60_000;
const GLOBAL_POLL_MS = 60_000;
/** How deep into each market's cap ranking the breadth/movers rankings look — the
 * same universe the classic dashboard's 급등/급락 tabs use, so the two pages never
 * disagree about who today's biggest mover was. */
const UNIVERSE = 200;
const HEAT_TILES = 36;
const MOVERS_LIMIT = 8;

type MarketKey = "KOSPI" | "KOSDAQ";
type MappedItem = MarketMapItem & { market: MarketKey };

/* ───────────────────────────── small utilities ───────────────────────────── */

function pct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function toneOf(value: number): "up" | "down" | "flat" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** 억원 / 조원 (or B / T) — the unit KR investors read flow numbers in. Input is
 * already in 억원, matching the backend's investor payload. */
function formatFlow(value: number, en: boolean): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}${en ? "T" : "조"}`;
  return `${sign}${Math.round(abs).toLocaleString()}${en ? "B" : "억"}`;
}

/** Eases a number toward its latest value so a price/index tick lands as a short
 * roll rather than a jump-cut. Skipped entirely on the first value (nothing to roll
 * from) and for reduced-motion visitors. */
function useCountUp(target: number | null, duration = 620): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === null) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (from === null || reduce || from === target) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast off the mark, long settle, which reads as a ticker
      // landing rather than a linear crawl.
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setDisplay(from + (target - from) * eased);
      if (p < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return display;
}

/** Adds `is-in` the first time a block scrolls into view, which is all the reveal
 * animations key off. One observer per block, disconnected once it has fired — the
 * animation is an entrance, not a scroll-linked effect. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      node.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            node.classList.add("is-in");
            observer.disconnect();
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Seoul wall clock, ticking every second — the header's "the desk is live" signal.
 * Pinned to Asia/Seoul rather than the visitor's own zone because it labels a KRX
 * session, and a reader in another timezone needs the exchange's clock. */
function useSeoulClock(): { time: string; date: string } {
  const { lang } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now);
    const date = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ko-KR", {
      timeZone: "Asia/Seoul",
      month: "short",
      day: "numeric",
      weekday: "short",
    }).format(now);
    return { time, date };
  }, [now, lang]);
}

/* ───────────────────────────── shared bits ───────────────────────────── */

/** Decorative trend line for a tile — no axes, no hover, same up/down palette the
 * rest of the app uses for direction. */
function Spark({ values, tone, id }: { values: number[]; tone: "up" | "down" | "flat"; id: string }) {
  if (values.length < 2) return <svg className="nx-spark" aria-hidden="true" />;
  // Index labels and widget keys carry "^", "&", "=" and the like; an SVG gradient id
  // referenced from url(#…) has to survive as a plain token, so anything that isn't
  // alphanumeric is folded to a dash.
  const safeId = id.replace(/[^a-zA-Z0-9]/g, "-");
  const w = 240;
  const h = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const coords = values.map((v, i) => [i * stepX, h - ((v - min) / range) * h] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const stroke =
    tone === "down" ? "var(--down-color)" : tone === "up" ? "var(--up-color)" : "var(--text-muted)";
  const last = coords[coords.length - 1];

  return (
    <svg className="nx-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`nxg-${safeId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#nxg-${safeId})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} className="nx-spark-head" />
    </svg>
  );
}

/** Section shell — the HUD frame every block on this page shares: corner brackets,
 * an index number, a title, and an optional trailing action. */
function Panel({
  index,
  title,
  subtitle,
  action,
  className = "",
  children,
}: {
  index: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`nx-panel nx-reveal ${className}`}>
      <header className="nx-panel-head">
        <span className="nx-panel-index" aria-hidden="true">
          {index}
        </span>
        <div className="nx-panel-heading">
          <h2 className="nx-panel-title">{title}</h2>
          {subtitle && <p className="nx-panel-sub">{subtitle}</p>}
        </div>
        {action && <div className="nx-panel-action">{action}</div>}
      </header>
      <div className="nx-panel-body">{children}</div>
    </section>
  );
}

/* ───────────────────────────── navigation model ───────────────────────────── */

interface NavItem {
  to: string;
  label: string;
  glyph: string;
  tone: string;
  external?: boolean;
}

function navItems(en: boolean): NavItem[] {
  return [
    { to: "/map", label: "KOSPI", glyph: "◧", tone: "kospi" },
    { to: "/kosdaq-map", label: "KOSDAQ", glyph: "◨", tone: "kosdaq" },
    { to: "/sp500-map", label: "S&P500", glyph: "◩", tone: "sp500" },
    { to: "/nasdaq100-map", label: "NASDAQ", glyph: "◪", tone: "nasdaq" },
    { to: "/ai-prediction", label: en ? "AI FORECAST" : "AI 예측", glyph: "◆", tone: "ai" },
    { to: "/fight", label: en ? "CAP BATTLE" : "시총대결", glyph: "⬢", tone: "battle" },
    { to: "/news", label: "NEWS", glyph: "▤", tone: "news" },
    {
      to: "https://chs2147.github.io/mini-apps",
      label: "MINI APPS",
      glyph: "▣",
      tone: "apps",
      external: true,
    },
  ];
}

/* ───────────────────────────── header ───────────────────────────── */

function NxHeader({
  status,
  online,
  total,
}: {
  status: string | null;
  online: number | null;
  total: number | null;
}) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const { time, date } = useSeoulClock();
  const [open, setOpen] = useState(false);
  const items = navItems(en);

  const statusInfo = (() => {
    const upper = (status ?? "").toUpperCase();
    if (upper === "OPEN") return { label: en ? "MARKET OPEN" : "장중", tone: "open" };
    if (upper === "PREOPEN") return { label: en ? "PRE-OPEN" : "장 시작 전", tone: "pre" };
    if (upper === "CLOSE") return { label: en ? "CLOSED" : "장마감", tone: "closed" };
    return { label: en ? "SYNCING" : "동기화 중", tone: "sync" };
  })();

  // The drawer takes over the viewport on a phone, so the page underneath must not
  // scroll behind it — restored on close and on unmount.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header className="nx-header">
      <div className="nx-header-glow" aria-hidden="true" />
      <div className="nx-header-inner">
        <Link to="/v2" className="nx-brand" aria-label="K-Stock Hub">
          <span className="nx-brand-mark" aria-hidden="true">
            <span className="nx-brand-ring" />
            <span className="nx-brand-core" />
          </span>
          <span className="nx-brand-text">
            <Logo className="nx-brand-logo" />
            <span className="nx-brand-tag">NEXUS TERMINAL</span>
          </span>
        </Link>

        <nav className="nx-nav" aria-label={en ? "Primary" : "주요 메뉴"}>
          {items.map((item) =>
            item.external ? (
              <a
                key={item.to}
                href={item.to}
                target="_blank"
                rel="noopener noreferrer"
                className={`nx-nav-link nx-nav-link--${item.tone}`}
              >
                <span className="nx-nav-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                {item.label}
              </a>
            ) : (
              <Link key={item.to} to={item.to} className={`nx-nav-link nx-nav-link--${item.tone}`}>
                <span className="nx-nav-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div className="nx-header-meta">
          <div className={`nx-status nx-status--${statusInfo.tone}`}>
            <span className="nx-status-dot" aria-hidden="true" />
            <span className="nx-status-label">{statusInfo.label}</span>
          </div>
          <div className="nx-clock" title="Asia/Seoul">
            <span className="nx-clock-time">{time}</span>
            <span className="nx-clock-date">
              KST · {date}
            </span>
          </div>
          <div className="nx-presence" title={en ? "Live visitors" : "실시간 접속자"}>
            <span className="nx-presence-pulse" aria-hidden="true" />
            <span className="nx-presence-value">{online === null ? "—" : online.toLocaleString()}</span>
            <span className="nx-presence-sep">/</span>
            <span className="nx-presence-total">{total === null ? "—" : total.toLocaleString()}</span>
          </div>
          <div className="nx-toggles">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <button
            type="button"
            className={`nx-burger ${open ? "is-open" : ""}`}
            aria-expanded={open}
            aria-label={en ? "Menu" : "메뉴"}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div className={`nx-drawer ${open ? "is-open" : ""}`} role="dialog" aria-hidden={!open}>
        <div className="nx-drawer-inner">
          <div className="nx-drawer-clock">
            <span className="nx-clock-time">{time}</span>
            <span className="nx-clock-date">KST · {date}</span>
            <span className={`nx-status nx-status--${statusInfo.tone}`}>
              <span className="nx-status-dot" aria-hidden="true" />
              {statusInfo.label}
            </span>
          </div>
          <nav className="nx-drawer-nav" aria-label={en ? "Primary" : "주요 메뉴"}>
            {items.map((item) =>
              item.external ? (
                <a
                  key={item.to}
                  href={item.to}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`nx-drawer-link nx-nav-link--${item.tone}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="nx-nav-glyph" aria-hidden="true">
                    {item.glyph}
                  </span>
                  {item.label}
                </a>
              ) : (
                <a
                  key={item.to}
                  href={item.to}
                  className={`nx-drawer-link nx-nav-link--${item.tone}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    navigate(item.to);
                  }}
                >
                  <span className="nx-nav-glyph" aria-hidden="true">
                    {item.glyph}
                  </span>
                  {item.label}
                </a>
              )
            )}
          </nav>
          <div className="nx-drawer-foot">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>
      {open && <button type="button" className="nx-drawer-scrim" aria-label="close" onClick={() => setOpen(false)} />}
    </header>
  );
}

/* ───────────────────────────── hero: index cores ───────────────────────────── */

function FlowBar({ summary }: { summary: MarketInvestorSummary | null }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  if (!summary) return null;
  const rows: Array<[string, number]> = [
    [en ? "RETAIL" : "개인", summary.individual_amount],
    [en ? "FOREIGN" : "외국인", summary.foreign_amount],
    [en ? "INSTITUTION" : "기관", summary.institution_amount],
  ];
  const peak = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  return (
    <div className="nx-flow">
      {rows.map(([label, value]) => (
        <div key={label} className={`nx-flow-row is-${toneOf(value)}`}>
          <span className="nx-flow-label">{label}</span>
          <span className="nx-flow-track">
            <span className="nx-flow-fill" style={{ width: `${(Math.abs(value) / peak) * 100}%` }} />
          </span>
          <span className="nx-flow-value">{formatFlow(value, en)}</span>
        </div>
      ))}
    </div>
  );
}

function IndexCore({
  label,
  quote,
  investor,
  series,
}: {
  label: string;
  quote: IndexQuote | null;
  investor: MarketInvestorSummary | null;
  series: number[];
}) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const rolled = useCountUp(quote?.close ?? null);
  const tone = toneOf(quote?.change ?? 0);

  return (
    <article className={`nx-core is-${tone}`}>
      <span className="nx-core-scan" aria-hidden="true" />
      <div className="nx-core-head">
        <span className="nx-core-label">{label}</span>
        <Link to={`/index/${(quote?.symbol ?? label).toLowerCase()}`} className="nx-core-link">
          {en ? "CHART" : "지수 차트"} ↗
        </Link>
      </div>

      {quote === null ? (
        <div className="nx-core-skeleton">
          <span className="nx-sk" style={{ width: "62%", height: 44 }} />
          <span className="nx-sk" style={{ width: "40%", height: 18 }} />
        </div>
      ) : (
        <>
          <div className="nx-core-value">
            {(rolled ?? quote.close).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="nx-core-delta">
            <span className="nx-core-arrow" aria-hidden="true">
              {quote.change >= 0 ? "▲" : "▼"}
            </span>
            {Math.abs(quote.change).toLocaleString("en-US", { maximumFractionDigits: 2 })}
            <span className="nx-core-pct">{pct(quote.change_pct)}</span>
          </div>
        </>
      )}

      <div className="nx-core-spark">
        <Spark values={series} tone={tone} id={label} />
      </div>

      <FlowBar summary={investor} />
    </article>
  );
}

/** Advance/decline across the KOSPI + KOSDAQ cap-200 universe, drawn as a conic
 * ring. Breadth is the one number that says "is this a broad move or three mega
 * caps" — the index alone can't. */
function BreadthCore({ items }: { items: MappedItem[] }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const up = items.filter((i) => i.change_pct > 0).length;
  const down = items.filter((i) => i.change_pct < 0).length;
  const flat = items.length - up - down;
  const total = items.length || 1;
  const upPct = (up / total) * 100;
  const flatPct = (flat / total) * 100;
  const rolled = useCountUp(items.length ? upPct : null);
  const shown = rolled ?? 0;

  // Cap-weighted average move across the same universe — the "how hard" to the
  // ring's "how many".
  const capTotal = items.reduce((sum, i) => sum + (i.marcap || 0), 0);
  const weighted =
    capTotal > 0 ? items.reduce((sum, i) => sum + i.change_pct * (i.marcap || 0), 0) / capTotal : 0;

  const ringStyle = {
    background: `conic-gradient(var(--up-color) 0% ${upPct}%, var(--status-neutral) ${upPct}% ${
      upPct + flatPct
    }%, var(--down-color) ${upPct + flatPct}% 100%)`,
  };

  return (
    <article className="nx-breadth">
      <span className="nx-core-scan" aria-hidden="true" />
      <div className="nx-core-head">
        <span className="nx-core-label">{en ? "MARKET BREADTH" : "시장 폭"}</span>
        <span className="nx-breadth-universe">KOSPI+KOSDAQ TOP{UNIVERSE}</span>
      </div>

      <div className="nx-breadth-main">
        <div className="nx-ring" style={items.length ? ringStyle : undefined}>
          <div className="nx-ring-hole">
            <span className="nx-ring-value">{items.length ? `${shown.toFixed(0)}%` : "—"}</span>
            <span className="nx-ring-caption">{en ? "ADVANCING" : "상승 비중"}</span>
          </div>
        </div>
        <ul className="nx-breadth-legend">
          <li className="is-up">
            <span className="nx-legend-dot" aria-hidden="true" />
            <span className="nx-legend-name">{en ? "UP" : "상승"}</span>
            <span className="nx-legend-count">{up}</span>
          </li>
          <li className="is-flat">
            <span className="nx-legend-dot" aria-hidden="true" />
            <span className="nx-legend-name">{en ? "FLAT" : "보합"}</span>
            <span className="nx-legend-count">{flat}</span>
          </li>
          <li className="is-down">
            <span className="nx-legend-dot" aria-hidden="true" />
            <span className="nx-legend-name">{en ? "DOWN" : "하락"}</span>
            <span className="nx-legend-count">{down}</span>
          </li>
        </ul>
      </div>

      <div className={`nx-breadth-weighted is-${toneOf(weighted)}`}>
        <span className="nx-breadth-weighted-label">{en ? "CAP-WEIGHTED MOVE" : "시총 가중 등락"}</span>
        <span className="nx-breadth-weighted-value">{items.length ? pct(weighted) : "—"}</span>
      </div>
    </article>
  );
}

/* ───────────────────────────── ticker belt ───────────────────────────── */

function NxBelt() {
  const items = useMarketTicker();
  if (items.length === 0) return <div className="nx-belt nx-belt--empty" aria-hidden="true" />;
  // Rendered twice back to back and scrolled exactly one set's width — that's what
  // makes the loop seamless rather than snapping at the seam.
  return (
    <div className="nx-belt" aria-hidden="true">
      <div className="nx-belt-track">
        {[...items, ...items].map((item, idx) => {
          const up = item.change >= 0;
          return (
            <span key={`${item.symbol}-${idx}`} className={`nx-belt-item is-${up ? "up" : "down"}`}>
              <span className="nx-belt-label">{item.label}</span>
              <span className="nx-belt-price">
                {item.price.toLocaleString(undefined, {
                  minimumFractionDigits: item.price >= 1000 ? 0 : 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="nx-belt-change">
                {up ? "▲" : "▼"}
                {Math.abs(item.change_pct).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── AI oracle ───────────────────────────── */

function OracleCard({ item }: { item: PredictionItem }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const tone = item.result === "상승" ? "up" : item.result === "하락" ? "down" : "flat";
  const isKr = item.market === "KOSPI" || item.market === "KOSDAQ";
  const reliability = item.reliability ?? 0;

  return (
    <article className={`nx-oracle-card is-${tone}`}>
      <div className="nx-oracle-card-top">
        {isKr ? (
          <StockIcon className="nx-oracle-logo" code={item.code} />
        ) : (
          <span className="nx-oracle-mono" aria-hidden="true">
            {item.code.slice(0, 2)}
          </span>
        )}
        <span className="nx-oracle-name">{item.name}</span>
        <span className="nx-oracle-market">{item.market}</span>
      </div>
      <div className="nx-oracle-verdict">
        <span className="nx-oracle-arrow" aria-hidden="true">
          {RESULT_ARROW[item.result]}
        </span>
        <span className="nx-oracle-rate">{pct(item.change_rate)}</span>
        <span className="nx-oracle-result">{item.result}</span>
      </div>
      <div className="nx-oracle-meter" title={`${en ? "Reliability" : "신뢰도"} ${reliability}`}>
        <span className="nx-oracle-meter-fill" style={{ width: `${Math.max(4, reliability)}%` }} />
      </div>
      <div className="nx-oracle-meta">
        <span>{en ? "RELIABILITY" : "신뢰도"}</span>
        <strong>{item.reliability === null ? "—" : `${reliability}`}</strong>
        <span className="nx-oracle-meta-sep">·</span>
        <span>{en ? "CONVICTION" : "확신"}</span>
        <strong>{item.confidence}</strong>
      </div>
    </article>
  );
}

function OracleStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`nx-oracle-stat ${tone ? `is-${tone}` : ""}`}>
      <span className="nx-oracle-stat-value">{value}</span>
      <span className="nx-oracle-stat-label">{label}</span>
    </div>
  );
}

/* ───────────────────────────── heat grid ───────────────────────────── */

function HeatGrid({
  items,
  market,
  onPick,
}: {
  items: MarketMapItem[];
  market: MarketKey;
  onPick: (stock: StockSearchResult) => void;
}) {
  const mode = useThemeMode();
  const colors = getThemeColors();
  const names = useTranslatedTexts(items.map((i) => i.name));

  const tileStyle = (change: number) => {
    const magnitude = Math.min(1, Math.abs(change) / 3);
    if (Math.abs(change) < 0.05) {
      return {
        background: mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)",
        color: "var(--text-secondary)",
      };
    }
    const [r, g, b] = hexToRgb(change > 0 ? colors.up : colors.down);
    const alpha = 0.16 + magnitude * 0.7;
    return {
      background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      // Above roughly half saturation the fill is dark/saturated enough in both
      // themes that white text is the readable choice; below it the page's own
      // primary text wins.
      color: alpha > 0.5 ? "#ffffff" : "var(--text-primary)",
      boxShadow: `inset 0 0 0 1px rgba(${r}, ${g}, ${b}, ${Math.min(0.9, alpha + 0.2)})`,
    };
  };

  return (
    <div className="nx-heat">
      {items.map((item, idx) => (
        <button
          key={item.code}
          type="button"
          className="nx-heat-tile"
          style={tileStyle(item.change_pct)}
          onClick={() => onPick({ code: item.code, name: item.name, market })}
          title={`${item.name} ${pct(item.change_pct)}`}
        >
          <span className="nx-heat-name">{names[idx] ?? item.name}</span>
          <span className="nx-heat-pct">{pct(item.change_pct, 1)}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── movers ───────────────────────────── */

function MoverList({
  items,
  direction,
  onPick,
}: {
  items: MappedItem[];
  direction: "up" | "down";
  onPick: (stock: StockSearchResult) => void;
}) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const names = useTranslatedTexts(items.map((i) => i.name));
  const peak = Math.max(...items.map((i) => Math.abs(i.change_pct)), 1);

  return (
    <ol className={`nx-movers is-${direction}`}>
      {items.length === 0 &&
        Array.from({ length: MOVERS_LIMIT }).map((_, i) => (
          <li key={`sk-${i}`} className="nx-mover nx-mover--skeleton" aria-hidden="true">
            <span className="nx-sk" style={{ width: "100%", height: 18, animationDelay: `${i * 60}ms` }} />
          </li>
        ))}
      {items.map((item, idx) => (
        <li key={`${item.market}-${item.code}`} className="nx-mover">
          <button type="button" onClick={() => onPick({ code: item.code, name: item.name, market: item.market })}>
            <span className="nx-mover-rank">{String(idx + 1).padStart(2, "0")}</span>
            <StockIcon className="nx-mover-logo" code={item.code} />
            <span className="nx-mover-name">
              {names[idx] ?? item.name}
              <span className="nx-mover-tag">{item.market === "KOSPI" ? "KP" : "KQ"}</span>
            </span>
            <span className="nx-mover-bar" aria-hidden="true">
              <span
                className="nx-mover-bar-fill"
                style={{ width: `${(Math.abs(item.change_pct) / peak) * 100}%` }}
              />
            </span>
            <span className="nx-mover-price">
              {item.close.toLocaleString()}
              {en ? "" : "원"}
            </span>
            <span className="nx-mover-pct">{pct(item.change_pct)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────────── foreign flow ───────────────────────────── */

function ForeignColumn({
  items,
  title,
  direction,
  loading,
}: {
  items: WeeklyForeignItem[];
  title: string;
  direction: "buy" | "sell";
  loading: boolean;
}) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const names = useTranslatedTexts(items.map((i) => i.name));
  const peak = Math.max(...items.map((i) => Math.abs(i.amount)), 1);

  return (
    <div className={`nx-foreign-col is-${direction}`}>
      <h3 className="nx-foreign-title">{title}</h3>
      <ol className="nx-foreign-list">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <li key={`sk-${i}`} aria-hidden="true">
              <span className="nx-sk" style={{ width: "100%", height: 16, animationDelay: `${i * 60}ms` }} />
            </li>
          ))}
        {!loading &&
          items.slice(0, 8).map((item, idx) => (
            <li key={item.code}>
              <Link to={`/investor/${item.code}`} className="nx-foreign-row">
                <span className="nx-foreign-rank">{idx + 1}</span>
                <span className="nx-foreign-name">{names[idx] ?? item.name}</span>
                <span className="nx-foreign-bar" aria-hidden="true">
                  <span
                    className="nx-foreign-bar-fill"
                    style={{ width: `${(Math.abs(item.amount) / peak) * 100}%` }}
                  />
                </span>
                <span className="nx-foreign-amount">{formatFlow(item.amount, en)}</span>
              </Link>
            </li>
          ))}
      </ol>
    </div>
  );
}

/* ───────────────────────────── global grid ───────────────────────────── */

function GlobalTile({ item }: { item: GlobalIndexWidget }) {
  const tone = toneOf(item.change_pct ?? 0);
  return (
    <article className={`nx-gt is-${tone}`}>
      <div className="nx-gt-head">
        {item.flag && <img className="nx-gt-flag" src={`/img/flag/${item.flag}.svg`} alt="" loading="lazy" />}
        <span className="nx-gt-name">{item.label}</span>
      </div>
      <div className="nx-gt-value">
        {item.close === null
          ? "—"
          : `${item.unit === "usd" ? "$" : ""}${item.close.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
      </div>
      <div className="nx-gt-change">{item.change_pct === null ? "—" : pct(item.change_pct)}</div>
      <div className="nx-gt-spark">
        <Spark values={item.points.map((p) => p.close)} tone={tone} id={item.key} />
      </div>
    </article>
  );
}

/* ───────────────────────────── footer ───────────────────────────── */

function NxFooter({ online, total }: { online: number | null; total: number | null }) {
  const { lang } = useLanguage();
  const en = lang === "en";
  const year = new Date().getFullYear();
  const ref = useReveal<HTMLElement>();

  return (
    <footer ref={ref} className="nx-footer nx-reveal">
      <div className="nx-footer-grid-bg" aria-hidden="true" />
      <div className="nx-footer-top">
        <div className="nx-footer-brand">
          <Link to="/v2" className="nx-brand nx-brand--footer" aria-label="K-Stock Hub">
            <span className="nx-brand-mark" aria-hidden="true">
              <span className="nx-brand-ring" />
              <span className="nx-brand-core" />
            </span>
            <span className="nx-brand-text">
              <Logo className="nx-brand-logo" />
              <span className="nx-brand-tag">NEXUS TERMINAL</span>
            </span>
          </Link>
          <p className="nx-footer-tagline">
            {en
              ? "Real-time quotes, market-cap maps and AI forecasts — the Korean market, on one screen."
              : "실시간 시세부터 시가총액 맵, AI 예측까지 — 국내 증시를 한 화면에서."}
          </p>
          <div className="nx-footer-live">
            <span className="nx-presence-pulse" aria-hidden="true" />
            {en
              ? `${online ?? "—"} online · ${total ?? "—"} total visits`
              : `현재 접속 ${online ?? "—"}명 · 누적 방문 ${total ?? "—"}명`}
          </div>
        </div>

        <nav className="nx-footer-col" aria-label={en ? "Markets" : "마켓"}>
          <h3>{en ? "MARKETS" : "마켓"}</h3>
          <Link to="/map">KOSPI MAP</Link>
          <Link to="/kosdaq-map">KOSDAQ MAP</Link>
          <Link to="/sp500-map">S&P 500 MAP</Link>
          <Link to="/nasdaq100-map">NASDAQ 100 MAP</Link>
        </nav>

        <nav className="nx-footer-col" aria-label={en ? "Intelligence" : "인텔리전스"}>
          <h3>{en ? "INTELLIGENCE" : "인텔리전스"}</h3>
          <Link to="/ai-prediction">{en ? "AI FORECAST" : "AI 종목예측"}</Link>
          <Link to="/fight">{en ? "CAP BATTLE" : "시총 대결"}</Link>
          <Link to="/news">{en ? "GLOBAL NEWS" : "글로벌 뉴스"}</Link>
          <Link to="/">{en ? "CLASSIC DASHBOARD" : "기존 대시보드"}</Link>
        </nav>

        <div className="nx-footer-col nx-footer-col--sys">
          <h3>{en ? "DATA SOURCES" : "데이터 소스"}</h3>
          <span className="nx-footer-src">
            <i aria-hidden="true" /> NAVER FINANCE
          </span>
          <span className="nx-footer-src">
            <i aria-hidden="true" /> YAHOO FINANCE
          </span>
          <span className="nx-footer-src">
            <i aria-hidden="true" /> FinanceDataReader
          </span>
          <span className="nx-footer-src">
            <i aria-hidden="true" /> CLAUDE / AI ENGINE
          </span>
        </div>
      </div>

      <div className="nx-footer-bottom">
        <p className="nx-footer-disclaimer">
          {en
            ? "Quotes and data provided here are for reference only and must not be used as the basis for trading decisions. All investment decisions and their consequences rest with the user."
            : "본 서비스에서 제공하는 시세 및 데이터는 투자 참고용이며, 실제 매매 판단의 근거로 사용할 수 없습니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다."}
        </p>
        <p className="nx-footer-copy">
          © {year} K-Stock Hub
          <Link to="/admin" className="nx-footer-admin" aria-label="Admin" title="Admin">
            ⚙
          </Link>
        </p>
      </div>
    </footer>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function Dashboard2() {
  const { lang } = useLanguage();
  const en = lang === "en";
  useDocumentTitle("K-Stock Hub — NEXUS");

  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [kospiInvestor, setKospiInvestor] = useState<MarketInvestorSummary | null>(null);
  const [kosdaqInvestor, setKosdaqInvestor] = useState<MarketInvestorSummary | null>(null);
  const [kospiSeries, setKospiSeries] = useState<number[]>([]);
  const [kosdaqSeries, setKosdaqSeries] = useState<number[]>([]);

  const [kospiItems, setKospiItems] = useState<MarketMapItem[]>([]);
  const [kosdaqItems, setKosdaqItems] = useState<MarketMapItem[]>([]);

  const [predictions, setPredictions] = useState<PredictionItem[] | null>(null);
  const [predictionDate, setPredictionDate] = useState<string>("");
  const [accuracy, setAccuracy] = useState<Record<string, AccuracyWindows> | null>(null);

  const [globals, setGlobals] = useState<GlobalIndexWidget[] | null>(null);

  const [foreignBuy, setForeignBuy] = useState<WeeklyForeignItem[]>([]);
  const [foreignSell, setForeignSell] = useState<WeeklyForeignItem[]>([]);
  const [foreignLoading, setForeignLoading] = useState(true);

  const [heatMarket, setHeatMarket] = useState<MarketKey>("KOSPI");

  const { current: online, total } = useVisitorCount();
  const popular = usePopularStocks(8);
  const { favorites, recents } = useWatchlist();

  /* — indices — */
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .indices(false)
        .then((res) => {
          if (cancelled) return;
          setKospi(res.kospi);
          setKosdaq(res.kosdaq);
          setKospiInvestor(res.kospi_investor);
          setKosdaqInvestor(res.kosdaq_investor);
        })
        .catch(() => {
          // A missed refresh keeps the last known values on screen.
        });
    load();
    const stop = startVisibilityAwareInterval(load, INDEX_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  /* — index sparklines (static enough to fetch once) — */
  useEffect(() => {
    let cancelled = false;
    api
      .indexHistory("KOSPI", 1)
      .then((res) => {
        if (!cancelled) setKospiSeries(res.points.slice(-90).map((p) => p.close));
      })
      .catch(() => {});
    api
      .indexHistory("KOSDAQ", 1)
      .then((res) => {
        if (!cancelled) setKosdaqSeries(res.points.slice(-90).map((p) => p.close));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* — one map fetch feeds breadth, the heat grid and both mover lists — */
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([api.marketMap(UNIVERSE), api.kosdaqMap(UNIVERSE)])
        .then(([a, b]) => {
          if (cancelled) return;
          setKospiItems(a.items);
          setKosdaqItems(b.items);
        })
        .catch(() => {
          // Keeps whatever is already rendered.
        });
    load();
    const stop = startVisibilityAwareInterval(load, MAP_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  /* — AI forecast + its track record — */
  useEffect(() => {
    let cancelled = false;
    api
      .predictions()
      .then((res) => {
        if (cancelled) return;
        setPredictions(res.groups.flatMap((g) => g.items));
        setPredictionDate(res.label || res.date || "");
      })
      .catch(() => {
        if (!cancelled) setPredictions([]);
      });
    api
      .predictionAccuracy()
      .then((res) => {
        if (!cancelled) setAccuracy(res.markets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* — global indices — */
  useEffect(() => {
    let cancelled = false;
    const load = (first: boolean) =>
      api
        .globalIndices()
        .then((res) => {
          if (!cancelled) setGlobals(res.items);
        })
        .catch(() => {
          if (!cancelled && first) setGlobals([]);
        });
    load(true);
    const stop = startVisibilityAwareInterval(() => load(false), GLOBAL_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  /* — weekly foreign flow — */
  useEffect(() => {
    let cancelled = false;
    api
      .weeklyForeignTop()
      .then((res) => {
        if (cancelled) return;
        setForeignBuy(res.buy);
        setForeignSell(res.sell);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setForeignLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* — derived — */
  const universe = useMemo<MappedItem[]>(
    () => [
      ...kospiItems.map((it) => ({ ...it, market: "KOSPI" as const })),
      ...kosdaqItems.map((it) => ({ ...it, market: "KOSDAQ" as const })),
    ],
    [kospiItems, kosdaqItems]
  );

  const gainers = useMemo(
    () => [...universe].sort((a, b) => b.change_pct - a.change_pct).slice(0, MOVERS_LIMIT),
    [universe]
  );
  const losers = useMemo(
    () => [...universe].sort((a, b) => a.change_pct - b.change_pct).slice(0, MOVERS_LIMIT),
    [universe]
  );

  const heatItems = useMemo(() => {
    const source = heatMarket === "KOSPI" ? kospiItems : kosdaqItems;
    return [...source].sort((a, b) => b.marcap - a.marcap).slice(0, HEAT_TILES);
  }, [heatMarket, kospiItems, kosdaqItems]);

  const oracle = useMemo(() => {
    if (!predictions || predictions.length === 0) return null;
    const up = predictions.filter((p) => p.result === "상승").length;
    const down = predictions.filter((p) => p.result === "하락").length;
    const flat = predictions.length - up - down;
    const reliabilityValues = predictions
      .map((p) => p.reliability)
      .filter((v): v is number => v !== null);
    const avgReliability = reliabilityValues.length
      ? reliabilityValues.reduce((s, v) => s + v, 0) / reliabilityValues.length
      : null;
    const top = [...predictions]
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 6);
    return { up, down, flat, avgReliability, top, count: predictions.length };
  }, [predictions]);

  // One hit rate across every market's recent-20-session window, so the headline is
  // "the engine's recent record" rather than one market's slice of it.
  const hitRate = useMemo(() => {
    if (!accuracy) return null;
    let hit = 0;
    let total = 0;
    Object.values(accuracy).forEach((w) => {
      hit += w.recent20.hit;
      total += w.recent20.total;
    });
    if (total === 0) return null;
    return { rate: Math.round((hit / total) * 100), hit, total };
  }, [accuracy]);

  const selectStock = useCallback((stock: StockSearchResult) => {
    if (stock.market === "US") {
      navigate(`/global?code=${stock.code}`);
      return;
    }
    navigate(`/?code=${stock.code}`);
  }, []);

  const rail = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ code: string; name: string; market: string; kind: string }> = [];
    favorites.forEach((s) => {
      if (seen.has(s.code)) return;
      seen.add(s.code);
      out.push({ ...s, kind: "fav" });
    });
    recents.forEach((s) => {
      if (seen.has(s.code) || out.length >= 12) return;
      seen.add(s.code);
      out.push({ ...s, kind: "recent" });
    });
    (popular ?? []).forEach((s) => {
      if (seen.has(s.code) || out.length >= 12) return;
      seen.add(s.code);
      out.push({ code: s.code, name: s.name, market: s.market, kind: "hot" });
    });
    return out;
  }, [favorites, recents, popular]);

  const railNames = useTranslatedTexts(rail.map((r) => r.name));
  const heroRef = useReveal<HTMLDivElement>();
  const ctaRef = useReveal<HTMLElement>();

  return (
    <div className="nx-root">
      {/* Fixed atmosphere layer — perspective grid, two drifting auroras, a scan
          sweep and a fine noise wash. Purely decorative and pointer-transparent, so
          it never intercepts a tap on the content sitting above it. */}
      <div className="nx-backdrop" aria-hidden="true">
        <div className="nx-backdrop-grid" />
        <div className="nx-backdrop-aurora nx-backdrop-aurora--a" />
        <div className="nx-backdrop-aurora nx-backdrop-aurora--b" />
        <div className="nx-backdrop-scan" />
        <div className="nx-backdrop-noise" />
      </div>

      <NxHeader status={kospi?.market_status ?? kosdaq?.market_status ?? null} online={online} total={total} />

      <main className="nx-main">
        {/* ── HERO ── */}
        <div ref={heroRef} className="nx-hero nx-reveal">
          <div className="nx-hero-copy">
            <span className="nx-eyebrow">
              <span className="nx-eyebrow-dot" aria-hidden="true" />
              {en ? "KOREAN MARKET INTELLIGENCE" : "국내 증시 인텔리전스"}
            </span>
            <h1 className="nx-hero-title">
              {en ? (
                <>
                  <em>Real-time</em>
                  <br />
                  market data.
                </>
              ) : (
                <>
                  증시 <em>실시간</em>
                  <br />
                  정보를 제공합니다
                </>
              )}
            </h1>
            <p className="nx-hero-lede">
              {en
                ? "Live KOSPI/KOSDAQ quotes, market-cap heat maps, investor flows and a self-scoring AI forecast. No login, no sign-up."
                : "코스피·코스닥 실시간 시세, 시가총액 히트맵, 투자자 수급, 그리고 스스로 채점하는 AI 예측까지. 로그인, 회원가입도 필요 없습니다."}
            </p>

            <div className="nx-search">
              <span className="nx-search-prompt" aria-hidden="true">
                ▸
              </span>
              <SearchBar onSelect={selectStock} />
            </div>

            {rail.length > 0 && (
              <div className="nx-rail" aria-label={en ? "Quick access" : "빠른 이동"}>
                {rail.map((item, idx) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`nx-chip is-${item.kind}`}
                    onClick={() => selectStock({ code: item.code, name: item.name, market: item.market })}
                  >
                    <span className="nx-chip-glyph" aria-hidden="true">
                      {item.kind === "fav" ? "★" : item.kind === "recent" ? "◷" : "▲"}
                    </span>
                    {railNames[idx] ?? item.name}
                  </button>
                ))}
              </div>
            )}

            {/* What the page is willing to promise, stated up front. Every line is
                a fact about how this thing runs, not a marketing claim — the whole
                point of the block is that it can be checked. */}
            <dl className="nx-trust">
              <div className="nx-trust-item">
                <dt>{en ? "QUOTE REFRESH" : "시세 갱신"}</dt>
                <dd>
                  10<span>s</span>
                </dd>
              </div>
              <div className="nx-trust-item">
                <dt>{en ? "ACCOUNT REQUIRED" : "가입 · 로그인"}</dt>
                <dd>{en ? "NONE" : "불필요"}</dd>
              </div>
              <div className="nx-trust-item">
                <dt>{en ? "FORECASTS GRADED" : "예측 사후 채점"}</dt>
                <dd>{en ? "DAILY" : "매 거래일"}</dd>
              </div>
            </dl>
          </div>

          <div className="nx-hero-stack">
            <IndexCore label="KOSPI" quote={kospi} investor={kospiInvestor} series={kospiSeries} />
            <IndexCore label="KOSDAQ" quote={kosdaq} investor={kosdaqInvestor} series={kosdaqSeries} />
            <BreadthCore items={universe} />
          </div>
        </div>

        <NxBelt />

        {/* ── AI ORACLE ── */}
        <Panel
          index="01"
          title={en ? "AI FORECAST ENGINE" : "AI 예측 엔진"}
          subtitle={
            en
              ? "Every call ships with its own probability spread, reliability score and a graded track record."
              : "모든 예측은 방향 확률·신뢰도·사후 채점 결과를 함께 기록합니다."
          }
          action={
            <Link to="/ai-prediction" className="nx-cta">
              {en ? "OPEN ENGINE" : "예측 전체보기"} <span aria-hidden="true">→</span>
            </Link>
          }
          className="nx-panel--oracle"
        >
          <div className="nx-oracle-stats">
            <OracleStat
              label={en ? "HIT RATE · LAST 20 SESSIONS" : "적중률 · 최근 20거래일"}
              value={hitRate ? `${hitRate.rate}%` : "—"}
              tone={hitRate ? (hitRate.rate >= 60 ? "up" : hitRate.rate < 40 ? "down" : "flat") : undefined}
            />
            <OracleStat
              label={en ? "GRADED CALLS" : "채점 완료 예측"}
              value={hitRate ? `${hitRate.hit}/${hitRate.total}` : "—"}
            />
            <OracleStat
              label={en ? "AVG RELIABILITY" : "평균 신뢰도"}
              value={oracle?.avgReliability != null ? oracle.avgReliability.toFixed(0) : "—"}
            />
            <OracleStat
              label={en ? "TARGET SESSION" : "예측 대상일"}
              value={predictionDate || "—"}
            />
          </div>

          {oracle && (
            <div className="nx-oracle-spread" role="img" aria-label={`${oracle.up} up / ${oracle.flat} flat / ${oracle.down} down`}>
              <span className="nx-oracle-spread-seg is-up" style={{ flex: Math.max(oracle.up, 0.001) }}>
                {oracle.up > 0 && `${en ? "UP" : "상승"} ${oracle.up}`}
              </span>
              <span className="nx-oracle-spread-seg is-flat" style={{ flex: Math.max(oracle.flat, 0.001) }}>
                {oracle.flat > 0 && `${en ? "FLAT" : "보합"} ${oracle.flat}`}
              </span>
              <span className="nx-oracle-spread-seg is-down" style={{ flex: Math.max(oracle.down, 0.001) }}>
                {oracle.down > 0 && `${en ? "DOWN" : "하락"} ${oracle.down}`}
              </span>
            </div>
          )}

          <div className="nx-oracle-grid">
            {predictions === null &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={`sk-${i}`} className="nx-oracle-card nx-oracle-card--skeleton" aria-hidden="true">
                  <span className="nx-sk" style={{ width: "60%", height: 16, animationDelay: `${i * 70}ms` }} />
                  <span className="nx-sk" style={{ width: "80%", height: 28 }} />
                  <span className="nx-sk" style={{ width: "100%", height: 6 }} />
                </div>
              ))}
            {oracle?.top.map((item) => <OracleCard key={`${item.market}-${item.code}`} item={item} />)}
            {predictions !== null && predictions.length === 0 && (
              <p className="nx-empty">
                {en ? "No forecast rows for the current session yet." : "아직 이번 세션의 예측 데이터가 없습니다."}
              </p>
            )}
          </div>
        </Panel>

        {/* ── HEAT GRID ── */}
        <Panel
          index="02"
          title={en ? "MARKET CAP HEAT" : "시가총액 히트맵"}
          subtitle={
            en
              ? "Top 36 by market cap, tinted by today's move. Tap a tile to open the stock."
              : "시가총액 상위 36종목을 당일 등락률로 색칠했습니다. 타일을 누르면 종목 상세로 이동합니다."
          }
          action={
            <div className="nx-seg">
              {(["KOSPI", "KOSDAQ"] as MarketKey[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`nx-seg-btn ${heatMarket === m ? "is-active" : ""}`}
                  onClick={() => setHeatMarket(m)}
                >
                  {m}
                </button>
              ))}
              <Link to={heatMarket === "KOSPI" ? "/map" : "/kosdaq-map"} className="nx-cta nx-cta--sm">
                {en ? "FULL MAP" : "전체 맵"} <span aria-hidden="true">→</span>
              </Link>
            </div>
          }
        >
          {heatItems.length === 0 ? (
            <div className="nx-heat">
              {Array.from({ length: HEAT_TILES }).map((_, i) => (
                <span key={i} className="nx-heat-tile nx-heat-tile--skeleton nx-sk" style={{ animationDelay: `${i * 22}ms` }} />
              ))}
            </div>
          ) : (
            <HeatGrid items={heatItems} market={heatMarket} onPick={selectStock} />
          )}
        </Panel>

        {/* ── MOVERS ── */}
        <Panel
          index="03"
          title={en ? "TODAY'S EXTREMES" : "당일 급등 · 급락"}
          subtitle={
            en
              ? "Ranked within the KOSPI + KOSDAQ top-200 by market cap. KP = KOSPI, KQ = KOSDAQ."
              : "코스피·코스닥 시총 200위 이내 종목의 당일 등락률 순위입니다. · KP=코스피, KQ=코스닥"
          }
          className="nx-panel--movers"
        >
          <div className="nx-movers-split">
            <div className="nx-movers-col">
              <h3 className="nx-movers-title is-up">
                <span className="nx-movers-title-glyph" aria-hidden="true">
                  ▲
                </span>
                {en ? "TOP GAINERS" : "급등 TOP"}
              </h3>
              <MoverList items={gainers} direction="up" onPick={selectStock} />
            </div>
            <div className="nx-movers-col">
              <h3 className="nx-movers-title is-down">
                <span className="nx-movers-title-glyph" aria-hidden="true">
                  ▼
                </span>
                {en ? "TOP LOSERS" : "급락 TOP"}
              </h3>
              <MoverList items={losers} direction="down" onPick={selectStock} />
            </div>
          </div>
        </Panel>

        {/* ── FOREIGN FLOW ── */}
        <Panel
          index="04"
          title={en ? "FOREIGN CAPITAL FLOW" : "외국인 수급"}
          subtitle={
            en
              ? "Cumulative foreign net buying/selling over the last 5 sessions. Tap a name for its flow history."
              : "최근 5거래일 기준 외국인 누적 순매수/순매도 상위입니다. · 종목명을 누르면 최근 추이를 볼 수 있습니다."
          }
        >
          <div className="nx-foreign">
            <ForeignColumn
              items={foreignBuy}
              title={en ? "NET BUY" : "순매수 TOP"}
              direction="buy"
              loading={foreignLoading}
            />
            <ForeignColumn
              items={foreignSell}
              title={en ? "NET SELL" : "순매도 TOP"}
              direction="sell"
              loading={foreignLoading}
            />
          </div>
        </Panel>

        {/* ── GLOBAL ── */}
        <Panel
          index="05"
          title={en ? "GLOBAL SIGNAL" : "글로벌 신호"}
          subtitle={
            en
              ? "Overnight majors and overseas benchmarks that set the tone for the Seoul open."
              : "서울 개장 분위기를 결정하는 미국·해외 주요 지수입니다."
          }
        >
          <div className="nx-global">
            {globals === null
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="nx-gt nx-gt--skeleton nx-sk" style={{ animationDelay: `${i * 50}ms` }} />
                ))
              : globals.map((item) => <GlobalTile key={item.key} item={item} />)}
          </div>
        </Panel>

        {/* ── CTA ── */}
        <section className="nx-cta-band nx-reveal" ref={ctaRef}>
          <div className="nx-cta-band-inner">
            <h2>{en ? "Go deeper" : "더 깊이 들어가기"}</h2>
            <p>
              {en
                ? "Full treemaps, 3-year candles with indicators, order books, discussion boards and the AI forecast archive."
                : "전체 트리맵, 3년 일봉과 보조지표, 10호가 창, 종목토론방, 그리고 AI 예측 아카이브까지."}
            </p>
            <div className="nx-cta-band-links">
              <Link to="/" className="nx-cta nx-cta--solid">
                {en ? "CLASSIC DASHBOARD" : "기존 대시보드"} <span aria-hidden="true">→</span>
              </Link>
              <Link to="/ai-prediction" className="nx-cta">
                {en ? "AI FORECAST" : "AI 예측"} <span aria-hidden="true">→</span>
              </Link>
              <Link to="/map" className="nx-cta">
                KOSPI MAP <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <NxFooter online={online} total={total} />

      {/* Mobile-only command dock — the four destinations a phone visitor actually
          jumps between, always within thumb reach so they never scroll back up to
          the header to navigate. */}
      <nav className="nx-dock" aria-label={en ? "Quick navigation" : "빠른 이동"}>
        <Link to="/v2" className="nx-dock-item is-active">
          <span aria-hidden="true">◈</span>
          {en ? "HOME" : "홈"}
        </Link>
        <Link to="/map" className="nx-dock-item">
          <span aria-hidden="true">◧</span>
          MAP
        </Link>
        <Link to="/ai-prediction" className="nx-dock-item">
          <span aria-hidden="true">◆</span>
          AI
        </Link>
        <Link to="/news" className="nx-dock-item">
          <span aria-hidden="true">▤</span>
          NEWS
        </Link>
      </nav>
    </div>
  );
}
