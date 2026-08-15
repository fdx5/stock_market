import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { StockBoard, StockBoardItem, StockBoardSector, api, mergeBoardRefresh } from "../api/client";
import { wonSuffix } from "../i18n/format";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useThemeMode } from "../theme";
import { changeToRgb, rgbToCss } from "../treemap";
import { useDocumentTitle } from "../useDocumentTitle";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import EtfNavLink from "./EtfNavLink";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import MarketTickerBar from "./MarketTickerBar";
import PredictIcon from "./PredictIcon";
import SessionBadge from "./SessionBadge";
import SessionSplit from "./SessionSplit";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import UsStockIcon from "./UsStockIcon";
import VisitorBadge from "./VisitorBadge";
import "./stockBoard.css";

/* ─────────────────────────── what this page is ───────────────────────────
   Three sibling boards — /kospi-100, /kosdaq-100, /nasdaq-100 — each showing
   its market's top 100 by size as cards grouped by 업종.

   The design rule the whole page follows: every card answers "how is this
   stock doing?" at four time horizons at once, and each horizon is drawn with
   a mark you can read without a legend.

     today      the change badge, and the price it sits beside
     3 months   the sparkline, colored by its own start-to-end direction
     52 weeks   a range track with the current price as a marker on it
     4 windows  1주 / 1개월 / 3개월 / YTD as signed chips

   Color is never decorative here. Every tinted thing on the page is on the
   same diverging up/down scale the market map uses (`changeToRgb`), so a
   reader who has seen /map already knows how to read a sector header. Sectors
   themselves get NO identity color: 16 hues is well past what a categorical
   palette can keep distinguishable, and the group's own sticky header names it
   in words anyway.
   ───────────────────────────────────────────────────────────────────────── */

// Matches the roster snapshot's own fastest tier (market_map's FIRST_TIER_TTL_SECONDS),
// so the board never sits on a price the map page has already moved past. Affordable at
// this cadence only because a refresh asks for the slim payload — see the load effect.
const POLL_INTERVAL_MS = 10_000;

// How often a refresh pulls the sparkline bars too, instead of just the prices. Matches
// the backend's TTL_SPARK_SECONDS — see the note in the load effect for why the bars
// need their own clock at all. At ~24KB a fetch this is 0.03KB/s next to the 0.9KB/s
// the 10s price refresh costs.
const FULL_RELOAD_MS = 15 * 60 * 1000;

/** Filter sentinel for "every 업종" — distinct from any real sector label the
 * backend can send, including "기타". */
const ALL_SECTORS = "__all__";

type SortKey = "marcap" | "gainers" | "losers" | "volume" | "range" | "momentum";

interface SortOption {
  key: SortKey;
  label: string;
  /** Higher sorts first. Null means "no value" and always sinks to the bottom,
   * so a stock missing a figure never outranks one that has it. */
  score: (item: StockBoardItem) => number | null;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "marcap", label: "시가총액순", score: (it) => it.marcap },
  { key: "gainers", label: "상승률순", score: (it) => it.change_pct },
  { key: "losers", label: "하락률순", score: (it) => -it.change_pct },
  { key: "volume", label: "거래량순", score: (it) => it.volume ?? null },
  { key: "range", label: "52주 고점 근접순", score: (it) => it.week52_pos },
  { key: "momentum", label: "1개월 수익률순", score: (it) => it.returns.m1 ?? null },
];

// Matches the backend's own FLAT_BAND_PCT — the band inside which a move is drawn
// as 보합 rather than colored. Kept in sync by hand because it is a display
// convention on both sides, not a value the API sends.
const FLAT_BAND_PCT = 0.05;

function direction(changePct: number): "up" | "down" | "flat" {
  if (changePct > FLAT_BAND_PCT) return "up";
  if (changePct < -FLAT_BAND_PCT) return "down";
  return "flat";
}

/* ──────────────────────────── number formatting ──────────────────────────── */

function formatPrice(value: number, currency: "KRW" | "USD", lang: Lang): string {
  if (currency === "USD") {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(value).toLocaleString()}${wonSuffix(lang)}`;
}

/** Price without its currency mark — for the two ends of the 52-week track, where
 * the unit is already established by the price above it and repeating it three times
 * would crowd out the numbers themselves. */
function formatBarePrice(value: number, currency: "KRW" | "USD"): string {
  if (currency === "USD") {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(value).toLocaleString();
}

function formatChangeAmount(value: number, currency: "KRW" | "USD", lang: Lang): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const magnitude = Math.abs(value);
  if (currency === "USD") {
    return `${sign}$${magnitude.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${sign}${Math.round(magnitude).toLocaleString()}${wonSuffix(lang)}`;
}

function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** Won market cap in 조/억, or — on the NASDAQ board, where `marcap` is the
 * constituent's index weight rather than an absolute cap — as that weight. */
function formatSize(value: number, kind: "krw" | "weight", lang: Lang): string {
  if (kind === "weight") return `${value.toFixed(2)}%`;
  const eok = value / 100_000_000;
  if (lang === "en") {
    return eok >= 10_000 ? `${(eok / 10_000).toFixed(1)}T KRW` : `${(eok / 10).toFixed(1)}B KRW`;
  }
  return eok >= 10_000 ? `${(eok / 10_000).toFixed(1)}조` : `${Math.round(eok).toLocaleString()}억`;
}

function formatVolume(value: number, lang: Lang): string {
  if (lang === "en") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString()}만`;
  return value.toLocaleString();
}

/** "20260728" -> "07.28". The sparkline tooltip's date; the year is never in doubt
 * across a 3-month window. */
function formatSparkDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}`;
}

/* The two phrases below are built per language rather than assembled from dictionary
 * fragments around a number. Korean glues its counter to the digit ("16종목",
 * "3/16위") where English needs a space and a different word order — a `t()` key of
 * "종목" that has to translate to " stocks" is the shape of a string that breaks the
 * moment a third language shows up. */

/** Trims the share-class boilerplate off a US listing name.
 *
 * The NASDAQ roster carries names as the exchange files them — "Palantir
 * Technologies Inc. Class A Common Stock", "Seagate Technology Holdings PLC Ordinary
 * Shares (Ireland)". Every card on this board is one listing, so the security type is
 * never the distinguishing fact; it is just the part that pushes the company's actual
 * name out of the card. Display-only, and left in place if trimming would empty the
 * string. */
function tidyUsName(name: string): string {
  const trimmed = name
    .replace(/\s*\((?:[^()]*)\)\s*$/, "")
    .replace(
      /\s*(?:Class\s+[A-Z]\s+)?(?:Common Stock|Capital Stock|Ordinary Shares|Common Shares|American Depositary Shares?|Registered Shares?|Depositary Shares?)\s*$/i,
      ""
    )
    .replace(/[\s,]+$/, "");
  return trimmed || name;
}

function formatCount(count: number, lang: Lang): string {
  return lang === "en" ? `${count} stocks` : `${count}종목`;
}

function formatSectorRank(sector: string, rank: number, size: number, lang: Lang): string {
  return lang === "en" ? `#${rank} of ${size} in ${sector}` : `${sector} ${rank}/${size}위`;
}

/* ───────────────────────────────── sparkline ─────────────────────────────────
   One series, no axes, no legend — the card's title and price already name it.
   Drawn in a 0..100 x 0..100 viewBox stretched to the card's width with
   `preserveAspectRatio="none"`, which is why the stroke carries
   vector-effect="non-scaling-stroke": without it the horizontal stretch would
   thicken the line unevenly.

   Hovering reads out the exact close under the pointer rather than making the
   reader estimate it off a line with no y-axis. State is local to this
   component so moving across one card doesn't re-render the other 99.
   ─────────────────────────────────────────────────────────────────────────── */

function Sparkline({
  points,
  dates,
  currency,
  lang,
  trend,
}: {
  points: number[];
  /** Board-level session dates, aligned to `points` from the end. */
  dates: string[];
  currency: "KRW" | "USD";
  lang: Lang;
  trend: "up" | "down" | "flat";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    // A perfectly flat series has no range to normalize against; park it on the
    // centre line rather than dividing by zero.
    const span = max - min || 1;
    const x = (i: number) => (i / (points.length - 1)) * 100;
    // 6% of headroom top and bottom so the extremes aren't clipped by the stroke.
    const y = (v: number) => 94 - ((v - min) / span) * 88;
    const coords = points.map((v, i) => [x(i), y(v)] as const);
    return {
      coords,
      line: coords.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" "),
      area: `0,100 ${coords.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" ")} 100,100`,
      // The window's own opening price, drawn as a dashed baseline — it's what makes
      // the line's color legible as "up over 3 months" rather than just a shape.
      base: y(points[0]),
    };
  }, [points]);

  if (!geometry) {
    return <div className="sb-spark sb-spark--empty">{t("차트 데이터 없음")}</div>;
  }

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };

  const index = hover ?? points.length - 1;
  const [hx, hy] = geometry.coords[index];
  // The final point is not a historical bar: the backend pins it to the live price
  // (see stock_board._apply_spark), so it is labelled 현재 rather than given the last
  // session's date, which would be off by a day the moment a session is in progress.
  const dateOffset = dates.length - points.length;
  const hoverDate =
    index === points.length - 1
      ? t("현재")
      : formatSparkDate(dates[dateOffset + index] ?? "");

  return (
    <div className="sb-spark" data-trend={trend}>
      <svg
        ref={svgRef}
        className="sb-spark-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("최근 3개월 종가 추이")}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <polyline className="sb-spark-area" points={geometry.area} />
        <line className="sb-spark-base" x1="0" x2="100" y1={geometry.base} y2={geometry.base} />
        <polyline className="sb-spark-line" points={geometry.line} vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line className="sb-spark-crosshair" x1={hx} x2={hx} y1="0" y2="100" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* The end marker rides outside the SVG so the stretched viewBox can't turn it
          into an ellipse — positioned in percentages of the same box instead. */}
      <span className="sb-spark-dot" style={{ left: `${hx}%`, top: `${hy}%` }} />
      <span className="sb-spark-readout" data-active={hover !== null}>
        <b>{formatPrice(points[index], currency, lang)}</b>
        <i>{hoverDate}</i>
      </span>
    </div>
  );
}

/* ─────────────────────────── 52-week range track ───────────────────────────
   A one-dimensional position, which is a track with a marker — not a bar chart
   and not a gauge. The two ends are labelled with the actual prices so the
   marker's position is checkable rather than merely suggestive.
   ───────────────────────────────────────────────────────────────────────── */

function Week52Track({ item, currency, lang }: { item: StockBoardItem; currency: "KRW" | "USD"; lang: Lang }) {
  const t = useT();
  if (item.week52_pos === null || item.week52_low === null || item.week52_high === null) {
    return null;
  }
  const pos = item.week52_pos * 100;
  return (
    <div className="sb-range">
      <div className="sb-range-head">
        <span className="sb-range-title">{t("52주 범위")}</span>
        <span className="sb-range-pos">
          {t("고점 대비")} {formatPct((item.close / item.week52_high - 1) * 100, 1)}
        </span>
      </div>
      <div
        className="sb-range-track"
        role="img"
        aria-label={`${t("52주 범위")} ${formatBarePrice(item.week52_low, currency)} ~ ${formatBarePrice(
          item.week52_high,
          currency
        )}, ${t("현재")} ${Math.round(pos)}%`}
      >
        <span className="sb-range-fill" style={{ width: `${pos}%` }} />
        <span className="sb-range-marker" style={{ left: `${pos}%` }} />
      </div>
      {/* Only the high end carries the unit. Repeating it on both, or floating it
          between them, reads as a third value on a track that has exactly two. */}
      <div className="sb-range-scale">
        <span>{formatBarePrice(item.week52_low, currency)}</span>
        <span>{formatPrice(item.week52_high, currency, lang)}</span>
      </div>
    </div>
  );
}

/* ───────────────────────── trailing-return chips ───────────────────────── */

const RETURN_WINDOWS: { key: "w1" | "m1" | "m3" | "ytd"; label: string }[] = [
  { key: "w1", label: "1주" },
  { key: "m1", label: "1개월" },
  { key: "m3", label: "3개월" },
  { key: "ytd", label: "연초" },
];

function ReturnChips({ item }: { item: StockBoardItem }) {
  const t = useT();
  return (
    <div className="sb-returns">
      {RETURN_WINDOWS.map(({ key, label }) => {
        const value = item.returns[key];
        return (
          <div key={key} className="sb-return" data-dir={value === null || value === undefined ? "na" : direction(value)}>
            <span className="sb-return-label">{t(label)}</span>
            <span className="sb-return-value">
              {value === null || value === undefined ? "—" : formatPct(value, 1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── the card ─────────────────────────────── */

interface CardContext {
  board: StockBoard;
  lang: Lang;
  /** Sector rank (1 = best performer inside its 업종 today) and how the stock did
   * against the whole board's cap-weighted move, in %p. Both computed once for the
   * board rather than per card — see `derived` in the page component. */
  sectorRank: number;
  sectorSize: number;
  relative: number;
  displayName: string;
}

function StockCard({ item, ctx, compact }: { item: StockBoardItem; ctx: CardContext; compact: boolean }) {
  const t = useT();
  const { board, lang, displayName } = ctx;
  const dir = direction(item.change_pct);
  const isUs = board.market === "nasdaq";
  const href = isUs ? `/global?code=${item.code}` : `/stock/${item.code}`;
  // A 3-month sparkline is colored by what it actually shows — its own start-to-end
  // direction — not by today's tick, which the badge beside it already carries.
  const trend =
    item.points.length >= 2 ? direction((item.points[item.points.length - 1] / item.points[0] - 1) * 100) : "flat";

  const open = () => navigate(href);

  return (
    <article className={`sb-card${compact ? " sb-card--compact" : ""}`} data-dir={dir}>
      {/* The whole card is the link. An anchor wrapping this much structured content
          would swallow it into one flat accessible name, so the anchor covers the card
          as an overlay and everything else stays real markup underneath. */}
      <a
        className="sb-card-hit"
        href={href}
        aria-label={`${displayName} ${formatPrice(item.close, board.currency, lang)} ${formatPct(item.change_pct)}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          open();
        }}
      />

      <header className="sb-card-head">
        <span className="sb-rank">{item.rank}</span>
        <span className="sb-logo">
          {isUs ? (
            <UsStockIcon
              code={item.code}
              className="sb-logo-img sb-logo-img--us"
              fallback={<span className="sb-logo-ticker">{item.code.slice(0, 4)}</span>}
            />
          ) : (
            <StockIcon code={item.code} className="sb-logo-img" />
          )}
        </span>
        <span className="sb-identity">
          <span className="sb-name" title={displayName}>
            {displayName}
          </span>
          <span className="sb-meta">
            <span className="sb-code">{item.code}</span>
            <span className="sb-dot" aria-hidden="true" />
            <span className="sb-sector">{t(item.sector)}</span>
          </span>
        </span>
      </header>

      <div className="sb-price-row">
        <span className="sb-price">
          {formatPrice(item.close, board.currency, lang)}
          <SessionBadge session={item.session} compact />
        </span>
        <span className="sb-change" data-dir={dir}>
          <span className="sb-change-pct">{formatPct(item.change_pct)}</span>
          <span className="sb-change-amt">{formatChangeAmount(item.change, board.currency, lang)}</span>
        </span>
      </div>

      {/* After the bell `change_pct` above is the regular move plus the after-hours
          one — this is the only place on the card that can tell a 1% session followed
          by a −6% earnings print apart from a plain −5% day. Nothing renders during
          regular hours or on the two KR boards. */}
      <SessionSplit quote={item} className="sb-session-split" />

      {/* The line the rest of this page can't show: how the stock did relative to the
          board it's on, and where it placed inside its own 업종 today. Both are the
          questions a ranked list of 100 names actually raises. */}
      <div className="sb-relative">
        <span className="sb-relative-item" data-dir={direction(ctx.relative)}>
          {t("시장 대비")} <b>{formatPct(ctx.relative, 2).replace("%", "%p")}</b>
        </span>
        <span className="sb-relative-item">{formatSectorRank(t(item.sector), ctx.sectorRank, ctx.sectorSize, lang)}</span>
      </div>

      <Sparkline
        points={item.points}
        dates={board.spark_dates}
        currency={board.currency}
        lang={lang}
        trend={trend}
      />

      {!compact && (
        <>
          <Week52Track item={item} currency={board.currency} lang={lang} />
          <ReturnChips item={item} />
          <dl className="sb-stats">
            <div className="sb-stat">
              <dt>{board.marcap_kind === "weight" ? t("지수 내 비중") : t("시가총액")}</dt>
              <dd>{formatSize(item.marcap, board.marcap_kind, lang)}</dd>
            </div>
            {item.volume != null && (
              <div className="sb-stat">
                <dt>{t("거래량")}</dt>
                <dd>{formatVolume(item.volume, lang)}</dd>
              </div>
            )}
            {item.per != null && (
              <div className="sb-stat">
                <dt>PER</dt>
                <dd>{item.per.toFixed(1)}</dd>
              </div>
            )}
            {item.roe != null && (
              <div className="sb-stat">
                <dt>ROE</dt>
                <dd>{item.roe.toFixed(1)}%</dd>
              </div>
            )}
            {item.foreign_ratio != null && (
              <div className="sb-stat">
                <dt>{t("외국인")}</dt>
                <dd>{item.foreign_ratio.toFixed(1)}%</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </article>
  );
}

/* ──────────────────────────────── skeletons ────────────────────────────────
   Placeholders that mirror the real card's structure rather than a blank pulsing
   box, so nothing on the page moves when the data lands — same grid, same row
   order, same heights. Follows the convention ChartSkeleton set: fake values give
   the sparkline a plausible silhouette instead of an empty rectangle, because a
   flat block in a chart's slot reads as "broken" where a line reads as "coming".

   Per-card variation matters as much as the shapes do — eight identical cards read
   as a rendering artifact — so name/price widths and the fake curve cycle through
   fixed spreads. All of it is aria-hidden; the live region announcing the load sits
   beside it, since a screen reader needs the sentence, not the scaffolding. */

const SKELETON_CARDS = 8;

// Name width, price width (% of the card), and the fake sparkline's path — indexed
// per card so the grid looks populated rather than stamped.
const SKELETON_SHAPES = [
  { name: 58, price: 46, curve: "M0,72 L14,54 L29,66 L43,32 L57,44 L71,22 L86,34 L100,18" },
  { name: 82, price: 38, curve: "M0,28 L14,42 L29,34 L43,58 L57,48 L71,70 L86,62 L100,78" },
  { name: 70, price: 52, curve: "M0,50 L14,38 L29,56 L43,44 L57,60 L71,40 L86,52 L100,36" },
  { name: 92, price: 42, curve: "M0,20 L14,36 L29,26 L43,48 L57,38 L71,56 L86,46 L100,64" },
];

function SkeletonCard({ index, compact, market }: { index: number; compact: boolean; market: string }) {
  const shape = SKELETON_SHAPES[index % SKELETON_SHAPES.length];
  // A US card carries one fundamental (index weight) where a KR card carries five,
  // so its stats block wraps to one row instead of two and the whole card is 19px
  // shorter. Same skeleton, one modifier — otherwise the NASDAQ board shrinks on load
  // by exactly as much as the KOSPI one used to grow.
  const usClass = market === "nasdaq" ? " sb-card--skeleton-us" : "";
  return (
    <article
      className={`sb-card sb-card--skeleton${usClass}${compact ? " sb-card--compact" : ""}`}
      aria-hidden="true"
    >
      <header className="sb-card-head">
        <span className="skeleton sb-sk-rank" />
        <span className="skeleton sb-sk-logo" />
        <span className="sb-identity">
          <span className="skeleton sb-sk-line" style={{ width: `${shape.name}%` }} />
          <span className="skeleton sb-sk-line sb-sk-line--meta" />
        </span>
      </header>

      <div className="sb-price-row">
        <span className="skeleton sb-sk-price" style={{ width: `${shape.price}%` }} />
        <span className="skeleton sb-sk-change" />
      </div>

      <div className="sb-relative">
        <span className="skeleton sb-sk-chip" />
        <span className="skeleton sb-sk-chip sb-sk-chip--wide" />
      </div>

      {/* The one placeholder that isn't a bar: a chart's slot holding a flat block
          reads as a failed render, where a line reads as one still arriving. */}
      <div className="sb-sk-spark">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={shape.curve} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {!compact && (
        <>
          <div className="sb-range">
            <div className="sb-range-head">
              <span className="skeleton sb-sk-line sb-sk-line--tiny" />
              <span className="skeleton sb-sk-line sb-sk-line--tiny" />
            </div>
            <div className="skeleton sb-sk-track" />
            <div className="sb-sk-scale">
              <span className="skeleton sb-sk-line sb-sk-line--tiny" />
              <span className="skeleton sb-sk-line sb-sk-line--tiny" />
            </div>
          </div>
          <div className="sb-returns">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton sb-sk-return" />
            ))}
          </div>
          <div className="sb-sk-stats">
            <span className="skeleton sb-sk-line sb-sk-line--stat" />
            {market !== "nasdaq" && <span className="skeleton sb-sk-line sb-sk-line--stat" />}
            {market !== "nasdaq" && <span className="skeleton sb-sk-line sb-sk-line--stat" />}
          </div>
        </>
      )}
    </article>
  );
}

/** The market-pulse box's placeholder — same footprint as the real one, so the hero
 * doesn't reflow when the breadth numbers arrive. */
function SkeletonPulse() {
  return (
    <div className="sb-pulse sb-pulse--skeleton" aria-hidden="true">
      <div className="sb-pulse-figure">
        <span className="skeleton sb-sk-pulse-value" />
        <span className="skeleton sb-sk-line sb-sk-line--tiny" />
      </div>
      <div className="sb-pulse-breadth">
        <span className="skeleton sb-sk-breadth" />
        <span className="skeleton sb-sk-line sb-sk-line--meta" />
      </div>
    </div>
  );
}

/** Sector filter chips. Widths vary because the real labels do — a row of equal pills
 * would be the one part of the skeleton that never matches what replaces it. There are
 * as many here as a real market has 업종 for the same reason the widths vary: the row
 * is a horizontal scroller, and a short row that doesn't overflow has no scrollbar,
 * which alone made it 15px shorter than the row it stands in for. */
const SKELETON_CHIP_WIDTHS = [58, 104, 88, 122, 96, 76, 110, 84, 118, 92, 70, 106, 82, 114, 90, 100];

function SkeletonChips() {
  return (
    <div className="sb-chips" aria-hidden="true">
      {SKELETON_CHIP_WIDTHS.map((width, i) => (
        <span key={i} className="skeleton sb-sk-filter-chip" style={{ width: `${width}px` }} />
      ))}
    </div>
  );
}

/** Two sector groups' worth of cards — enough to fill the first screen, and enough
 * to show that the page groups by 업종 at all before any data proves it. */
function BoardSkeleton({ compact, market }: { compact: boolean; market: string }) {
  return (
    <div className="sb-body" aria-hidden="true">
      {[0, 1].map((group) => (
        <section className="sb-group" key={group}>
          <div className="sb-sector-head sb-sector-head--skeleton">
            <span className="skeleton sb-sector-swatch" />
            <span className="skeleton sb-sk-line sb-sk-line--sector" />
            <span className="skeleton sb-sk-line sb-sk-line--meta" />
            <span className="skeleton sb-sk-sector-avg" />
          </div>
          <div className={`sb-grid${compact ? " sb-grid--compact" : ""}`}>
            {Array.from({ length: SKELETON_CARDS / 2 }, (_, i) => (
              <SkeletonCard key={i} index={group * 2 + i} compact={compact} market={market} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───────────────────────────── sector group header ───────────────────────────── */

function SectorHeader({
  summary,
  board,
  lang,
  mode,
}: {
  summary: StockBoardSector;
  board: StockBoard;
  lang: Lang;
  mode: "dark" | "light";
}) {
  const t = useT();
  const total = summary.up + summary.flat + summary.down || 1;
  return (
    <div className="sb-sector-head">
      <span
        className="sb-sector-swatch"
        style={{ background: rgbToCss(changeToRgb(summary.avg_change_pct, mode)) }}
        aria-hidden="true"
      />
      <h2 className="sb-sector-name">{t(summary.sector)}</h2>
      <span className="sb-sector-count">{formatCount(summary.count, lang)}</span>
      <span className="sb-sector-size">{formatSize(summary.marcap, board.marcap_kind, lang)}</span>
      <span className="sb-sector-avg" data-dir={direction(summary.avg_change_pct)}>
        {formatPct(summary.avg_change_pct)}
        <i>{t("시총가중")}</i>
      </span>
      <span
        className="sb-breadth sb-breadth--mini"
        role="img"
        aria-label={`${t("상승")} ${summary.up}, ${t("보합")} ${summary.flat}, ${t("하락")} ${summary.down}`}
      >
        <span className="sb-breadth-seg" data-dir="up" style={{ width: `${(summary.up / total) * 100}%` }} />
        <span className="sb-breadth-seg" data-dir="flat" style={{ width: `${(summary.flat / total) * 100}%` }} />
        <span className="sb-breadth-seg" data-dir="down" style={{ width: `${(summary.down / total) * 100}%` }} />
      </span>
    </div>
  );
}

/* ──────────────────────────────── the page ──────────────────────────────── */

export interface StockBoardPageProps {
  market: "kospi" | "kosdaq" | "nasdaq";
  pageTitle: string;
  /** Korean copy; the dictionary carries the English. */
  subtitle: string;
  loadingLabel: string;
}

/** The three boards, in a fixed order — used both for the segmented switcher at the
 * top of every board and for the nav row, so the set is declared once. */
const BOARDS: { market: "kospi" | "kosdaq" | "nasdaq"; path: string; label: string }[] = [
  { market: "kospi", path: "/kospi-100", label: "코스피 100" },
  { market: "kosdaq", path: "/kosdaq-100", label: "코스닥 100" },
  { market: "nasdaq", path: "/nasdaq-100", label: "나스닥 100" },
];

export default function StockBoardPage({ market, pageTitle, subtitle, loadingLabel }: StockBoardPageProps) {
  const t = useT();
  const { lang } = useLanguage();
  const mode = useThemeMode();
  useDocumentTitle(`${pageTitle} | K-Stock Hub`);

  const [board, setBoard] = useState<StockBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sector, setSector] = useState<string>(ALL_SECTORS);
  const [sortKey, setSortKey] = useState<SortKey>("marcap");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [compact, setCompact] = useState(false);

  // Switching boards keeps the page mounted (the three routes share this component),
  // so every piece of view state that describes the *previous* market has to be reset
  // — a 업종 filter of "배터리" carried onto the NASDAQ board would show nothing.
  useEffect(() => {
    setBoard(null);
    setError(null);
    setSector(ALL_SECTORS);
    setSortKey("marcap");
    setQuery("");
  }, [market]);

  // The board we last applied, mirrored out of state because `load` below needs the
  // previous sparklines to fold a refresh onto and must not re-subscribe to get them.
  const boardRef = useRef<StockBoard | null>(null);
  // When those sparklines were last actually fetched, rather than merged onto.
  const lastFullRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Switching markets reuses this component, so the previous board's history must not
    // survive into the new market's first refresh.
    boardRef.current = null;
    lastFullRef.current = 0;

    const apply = (data: StockBoard) => {
      if (cancelled) return;
      boardRef.current = data;
      setBoard(data);
      setError(null);
    };
    const fail = (err: Error) => {
      // A failed refresh leaves the board on screen — a page that empties itself
      // because one 10s tick timed out is worse than one showing a price from 10s ago.
      if (!cancelled) setError(err.message);
    };
    const loadFull = () =>
      api
        .stockBoard(market)
        .then((data) => {
          if (cancelled) return;
          lastFullRef.current = Date.now();
          apply(data);
        })
        .catch(fail);

    // Only the first load pulls the sparkline history; every tick after it asks for the
    // slim payload and splices the new closes onto the series already in state. At 10s
    // that is the difference between refreshing the board and re-downloading it.
    const load = () => {
      const prev = boardRef.current;
      // ...but a slim refresh can only ever move the last point of bars we already have,
      // so the bars themselves have to be re-fetched on their own clock. Two things go
      // wrong otherwise, and both were observed rather than guessed: a board first loaded
      // while the backend's spark cache was cold (the ~40s after a deploy, when it serves
      // every card with an empty series) would never grow its charts, and a page left
      // open across a session boundary would keep a 60-day window that has stopped
      // gaining days while its final point is overwritten with the new day's price —
      // quietly losing the previous close. Matched to the backend's own TTL_SPARK_SECONDS,
      // because a full fetch any more often than that returns the same bars.
      const barsStale = Date.now() - lastFullRef.current >= FULL_RELOAD_MS;
      if (!prev || barsStale) {
        loadFull();
        return;
      }
      api
        .stockBoardRefresh(market)
        .then((refresh) => {
          if (cancelled) return;
          const merged = mergeBoardRefresh(prev, refresh);
          if (merged) apply(merged);
          else loadFull(); // the roster gained a name — see mergeBoardRefresh
        })
        .catch(fail);
    };

    load();
    const stop = startVisibilityAwareInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [market]);

  const items = board?.items ?? [];

  // KR names are Korean in the payload and need translating for an English reader;
  // US names are English in the payload and carry their own Korean rendering.
  const translatedNames = useTranslatedTexts(market === "nasdaq" ? [] : items.map((it) => it.name));
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it, i) => {
      if (market === "nasdaq") map.set(it.code, it.name_ko && lang === "ko" ? it.name_ko : tidyUsName(it.name));
      else map.set(it.code, translatedNames[i] ?? it.name);
    });
    return map;
  }, [items, translatedNames, market, lang]);

  /** Per-card figures that need the whole board to compute: today's rank inside the
   * stock's own 업종, and its move against the board's cap-weighted average. Done once
   * here rather than inside 100 cards. */
  const derived = useMemo(() => {
    const marketAvg = board?.breadth.avg_change_pct ?? 0;
    const bySector = new Map<string, StockBoardItem[]>();
    items.forEach((it) => {
      const bucket = bySector.get(it.sector);
      if (bucket) bucket.push(it);
      else bySector.set(it.sector, [it]);
    });
    const ranks = new Map<string, { sectorRank: number; sectorSize: number }>();
    bySector.forEach((bucket) => {
      [...bucket]
        .sort((a, b) => b.change_pct - a.change_pct)
        .forEach((it, i) => ranks.set(it.code, { sectorRank: i + 1, sectorSize: bucket.length }));
    });
    return { marketAvg, ranks };
  }, [items, board]);

  const sectorSummaries = board?.sectors ?? [];

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (sector !== ALL_SECTORS && it.sector !== sector) return false;
      if (!needle) return true;
      const displayName = nameByCode.get(it.code) ?? it.name;
      return (
        it.code.toLowerCase().includes(needle) ||
        it.name.toLowerCase().includes(needle) ||
        displayName.toLowerCase().includes(needle)
      );
    });
    const option = SORT_OPTIONS.find((o) => o.key === sortKey) ?? SORT_OPTIONS[0];
    return [...filtered].sort((a, b) => {
      const sa = option.score(a);
      const sb = option.score(b);
      // Missing figures sink rather than sorting as zero — see SortOption.score.
      if (sa === null && sb === null) return a.rank - b.rank;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa || a.rank - b.rank;
    });
  }, [items, sector, sortKey, query, nameByCode]);

  /** The rendered body: either one flat run of cards, or a run per 업종 with the
   * group's own header. Sector order follows the board's own (by combined size), and
   * a sector with nothing left after filtering is dropped rather than left as an
   * empty heading. */
  const groups = useMemo(() => {
    if (!grouped) return [{ summary: null as StockBoardSector | null, items: visible }];
    return sectorSummaries
      .map((summary) => ({ summary, items: visible.filter((it) => it.sector === summary.sector) }))
      .filter((group) => group.items.length > 0);
  }, [grouped, sectorSummaries, visible]);

  const breadth = board?.breadth;
  const breadthTotal = breadth ? breadth.up + breadth.flat + breadth.down || 1 : 1;
  // Down to the second, not the minute: the board refreshes every 10s and the footnote
  // says so, and a stamp that only moves once every six ticks reads as a stalled page.
  const updatedAt = board?.generated_at?.replace("T", " ").slice(5, 19) ?? "";

  return (
    <div className="app sb-page">
      <header className="app-header">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/desk" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
          <Link to="/market-brief" className="kospi-map-nav-link kospi-map-nav-link--brief">장 마감 리포트</Link>
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> {t("KOSPI MAP")}
          </Link>
          <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq">
            <MarketIcon /> {t("NASDAQ MAP")}
          </Link>
          <EtfNavLink />
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> {t("AI 예측")}
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> {t("글로벌 시총")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> {t("NEWS")}
          </Link>
          <VisitorBadge />
        </div>
      </header>

      {/* ── the board's own headline: which market, and what it did as a whole ── */}
      <section className="sb-hero">
        <div className="sb-hero-main">
          <div className="sb-hero-titles">
            <h1 className="sb-title">
              {pageTitle}
              {/* NASDAQ only, and only outside regular US hours: every card below is
                  then priced off its pre/post print, and the breadth bar and 시총가중
                  평균 등락 beside it are computed from those same prices. Nothing else
                  on the page says so. */}
              <SessionBadge session={board?.session} />
            </h1>
            <p className="sb-subtitle">
              {t(subtitle)}
              {updatedAt && (
                <span className="sb-updated">
                  <span className="sb-live-dot" aria-hidden="true" />
                  {lang === "en" ? `updated ${updatedAt}` : `${updatedAt} 기준`}
                </span>
              )}
            </p>
          </div>
          {/* The three boards are siblings, so the switch between them is the page's
              primary control rather than a link buried in the nav row. */}
          <nav className="sb-switch" aria-label={t("시장 선택")}>
            {BOARDS.map((entry) => (
              <Link
                key={entry.market}
                to={entry.path}
                className={`sb-switch-tab${entry.market === market ? " is-active" : ""}`}
                aria-current={entry.market === market ? "page" : undefined}
              >
                {t(entry.label)}
              </Link>
            ))}
          </nav>
        </div>

        {!breadth && !error && <SkeletonPulse />}
        {breadth && (
          <div className="sb-pulse">
            <div className="sb-pulse-figure" data-dir={direction(breadth.avg_change_pct)}>
              <span className="sb-pulse-value">{formatPct(breadth.avg_change_pct)}</span>
              <span className="sb-pulse-label">{t("시총가중 평균 등락")}</span>
            </div>
            <div className="sb-pulse-breadth">
              <span
                className="sb-breadth"
                role="img"
                aria-label={`${t("상승")} ${breadth.up}, ${t("보합")} ${breadth.flat}, ${t("하락")} ${breadth.down}`}
              >
                <span className="sb-breadth-seg" data-dir="up" style={{ width: `${(breadth.up / breadthTotal) * 100}%` }} />
                <span className="sb-breadth-seg" data-dir="flat" style={{ width: `${(breadth.flat / breadthTotal) * 100}%` }} />
                <span className="sb-breadth-seg" data-dir="down" style={{ width: `${(breadth.down / breadthTotal) * 100}%` }} />
              </span>
              <div className="sb-breadth-legend">
                <span data-dir="up">{t("상승")} {breadth.up}</span>
                <span data-dir="flat">{t("보합")} {breadth.flat}</span>
                <span data-dir="down">{t("하락")} {breadth.down}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      <MarketTickerBar />

      {/* ── controls, in one row above the cards ── */}
      <div className="sb-toolbar">
        <label className="sb-search">
          <span className="sr-only">{t("종목 검색")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("종목명 · 코드 검색")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="sb-select">
          <span className="sr-only">{t("정렬")}</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <div className="sb-toggles">
          <button type="button" className={grouped ? "is-active" : ""} onClick={() => setGrouped(true)}>
            {t("업종별")}
          </button>
          <button type="button" className={!grouped ? "is-active" : ""} onClick={() => setGrouped(false)}>
            {t("전체 순위")}
          </button>
        </div>
        <div className="sb-toggles">
          <button type="button" className={!compact ? "is-active" : ""} onClick={() => setCompact(false)}>
            {t("카드")}
          </button>
          <button type="button" className={compact ? "is-active" : ""} onClick={() => setCompact(true)}>
            {t("간략히")}
          </button>
        </div>
      </div>

      {/* Sector chips double as the filter and as a ranked view of the market: each
          carries its own cap-weighted move, so the row reads as "which 업종 is
          working today" before anything is clicked. */}
      {sectorSummaries.length === 0 && !error && <SkeletonChips />}
      {sectorSummaries.length > 0 && (
        <div className="sb-chips" role="group" aria-label={t("업종")}>
          <button
            type="button"
            className={`sb-chip${sector === ALL_SECTORS ? " is-active" : ""}`}
            onClick={() => setSector(ALL_SECTORS)}
          >
            {t("전체")}
            <b>{items.length}</b>
          </button>
          {sectorSummaries.map((summary) => (
            <button
              key={summary.sector}
              type="button"
              className={`sb-chip${sector === summary.sector ? " is-active" : ""}`}
              onClick={() => setSector(sector === summary.sector ? ALL_SECTORS : summary.sector)}
            >
              <span
                className="sb-chip-swatch"
                style={{ background: rgbToCss(changeToRgb(summary.avg_change_pct, mode)) }}
                aria-hidden="true"
              />
              {t(summary.sector)}
              <b>{summary.count}</b>
              <i data-dir={direction(summary.avg_change_pct)}>{formatPct(summary.avg_change_pct, 1)}</i>
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-state">{t(error)}</div>}
      {/* The skeleton is decorative scaffolding (aria-hidden throughout); this is what
          actually announces the load, so a screen reader gets the sentence rather than
          a description of forty empty boxes. */}
      {!board && !error && (
        <>
          <span className="sr-only" role="status">
            {t(loadingLabel)}
          </span>
          <BoardSkeleton compact={compact} market={market} />
        </>
      )}

      {board && (
        <main className="sb-body">
          {visible.length === 0 && <p className="sb-empty">{t("조건에 맞는 종목이 없습니다.")}</p>}
          {groups.map((group, i) => (
            <section className="sb-group" key={group.summary?.sector ?? `all-${i}`}>
              {group.summary && (
                <SectorHeader summary={group.summary} board={board} lang={lang} mode={mode} />
              )}
              <div className={`sb-grid${compact ? " sb-grid--compact" : ""}`}>
                {group.items.map((item) => (
                  <StockCard
                    key={item.code}
                    item={item}
                    compact={compact}
                    ctx={{
                      board,
                      lang,
                      sectorRank: derived.ranks.get(item.code)?.sectorRank ?? 1,
                      sectorSize: derived.ranks.get(item.code)?.sectorSize ?? 1,
                      relative: item.change_pct - derived.marketAvg,
                      displayName: nameByCode.get(item.code) ?? item.name,
                    }}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Where every number on this page came from — the page asks readers to
              trust four different time horizons at once, so it says outright what
              each is measured from. */}
          <p className="sb-provenance">
            {t(
              "시세·시가총액은 실시간(장중 10초 갱신), 차트·52주 범위·기간수익률은 일봉 종가 기준입니다. 기간수익률은 거래일 기준(1주=5거래일, 1개월=21거래일, 3개월=63거래일)이며 연초수익률은 전년도 종가 대비입니다."
            )}
          </p>
        </main>
      )}

      <Footer />
    </div>
  );
}
