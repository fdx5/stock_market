import { useEffect, useMemo, useState } from "react";
import { GlobalTop100Item, api } from "../api/client";
import { hiResFlagUrl } from "../data/flagCodes";
import { trillionSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import CompanyLogo from "./CompanyLogo";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import GlobalTop100Sparkline, { formatPrice } from "./GlobalTop100Sparkline";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";
import "../globalTop100.css";

const POLL_INTERVAL_MS = 20_000;

type SortKey = "marcap" | "change" | "rankChange" | "pe" | "name";

interface SortOption {
  key: SortKey;
  label: string;
  /** Higher sorts first (ascending sorts negate their score below). Null always
   * sinks to the bottom — a stock missing a figure never outranks one that has it. */
  score: (item: GlobalTop100Item) => number | null;
  ascending?: boolean;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "marcap", label: "시가총액순", score: (it) => it.market_cap_usd },
  { key: "change", label: "당일 등락률순", score: (it) => it.change_pct },
  { key: "rankChange", label: "순위 상승순", score: (it) => it.rank_change },
  { key: "pe", label: "PER 낮은순", score: (it) => it.trailing_pe, ascending: true },
  { key: "name", label: "이름순", score: (it) => -it.rank },
];

const RETURN_WINDOWS: { key: keyof GlobalTop100Item["returns"]; label: string }[] = [
  { key: "d1", label: "1일" },
  { key: "w1", label: "7일" },
  { key: "m1", label: "1개월" },
  { key: "m3", label: "3개월" },
  { key: "m6", label: "6개월" },
  { key: "y1", label: "1년" },
  { key: "all", label: "전체기간" },
];

const RATING_TONE: Record<string, string> = {
  strong_buy: "strong-buy",
  buy: "buy",
  hold: "hold",
  sell: "sell",
  strong_sell: "strong-sell",
};

// Not routed through useT()/DICTIONARY: "매수"/"매도" are already dictionary keys for
// the orderbook's Bid/Ask labels, and reusing them here would show "Bid"/"Ask" for an
// analyst Buy/Sell rating in English mode. recommendation_key (unambiguous, backend-
// assigned) is the lookup key instead of the Korean label text.
const RATING_LABELS: Record<string, { ko: string; en: string }> = {
  strong_buy: { ko: "강력매수", en: "Strong Buy" },
  buy: { ko: "매수", en: "Buy" },
  hold: { ko: "중립", en: "Hold" },
  sell: { ko: "매도", en: "Sell" },
  strong_sell: { ko: "강력매도", en: "Strong Sell" },
};

const FLAT_BAND_PCT = 0.05;

function direction(changePct: number | null): "up" | "down" | "flat" {
  if (changePct == null) return "flat";
  if (changePct > FLAT_BAND_PCT) return "up";
  if (changePct < -FLAT_BAND_PCT) return "down";
  return "flat";
}

function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function formatMarcap(marcapUsd: number | null, lang: "ko" | "en"): string {
  if (marcapUsd == null) return "-";
  return `$${(marcapUsd / 1_000_000_000_000).toFixed(2)}${trillionSuffix(lang)}`;
}

function RankChangeBadge({ value }: { value: number | null }) {
  // No prior-day snapshot to compare against yet (first day after launch, or a new
  // entrant to the TOP 100 since yesterday) — shows nothing rather than a "신규" label.
  if (value == null) return null;
  if (value === 0) return <span className="gt100-rankchg gt100-rankchg--flat">–</span>;
  if (value > 0) return <span className="gt100-rankchg gt100-rankchg--up">▲{value}</span>;
  return <span className="gt100-rankchg gt100-rankchg--down">▼{-value}</span>;
}

function RatingBadge({ item, lang }: { item: GlobalTop100Item; lang: "ko" | "en" }) {
  if (!item.recommendation_key || !item.recommendation_label) {
    return <span className="gt100-rating gt100-rating--none">-</span>;
  }
  const tone = RATING_TONE[item.recommendation_key] || "hold";
  const label = RATING_LABELS[item.recommendation_key]?.[lang] ?? item.recommendation_label;
  return <span className={`gt100-rating gt100-rating--${tone}`}>{label}</span>;
}

function Row({
  item,
  displayRank,
  expanded,
  onToggle,
  lang,
}: {
  item: GlobalTop100Item;
  /** Position in the page's current sort/filter order (1-based) — shown instead of
   * item.rank, which is only ever refreshed by the nightly snapshot and can fall out
   * of step with today's live-price-adjusted market cap order (e.g. still reading
   * "3" for a company the live overlay has since pushed ahead of "2"). */
  displayRank: number;
  expanded: boolean;
  onToggle: () => void;
  lang: "ko" | "en";
}) {
  const t = useT();
  const dir = direction(item.change_pct);
  const trend =
    item.spark_points.length >= 2
      ? direction(((item.spark_points[item.spark_points.length - 1] / item.spark_points[0]) - 1) * 100)
      : "flat";
  const flagSrc = hiResFlagUrl(item.country) ?? item.flag_url;
  const description = lang === "en" ? item.description_en ?? item.description_ko : item.description_ko ?? item.description_en;

  return (
    <article className={`gt100-row${expanded ? " is-expanded" : ""}`} data-dir={dir}>
      <button type="button" className="gt100-row-main" onClick={onToggle} aria-expanded={expanded}>
        <span className="gt100-rank">
          <b>{displayRank}</b>
          <RankChangeBadge value={item.rank_change} />
        </span>
        <span className="gt100-logo">
          <CompanyLogo item={item} className="gt100-logo-img" />
        </span>
        <span className="gt100-identity">
          <span className="gt100-name" title={item.name}>
            {item.name}
          </span>
          <span className="gt100-meta">
            {flagSrc && <img src={flagSrc} alt={item.country} className="gt100-flag" />}
            <span className="gt100-country">{item.country}</span>
            <span className="gt100-dot" aria-hidden="true" />
            <span className="gt100-symbol">{item.symbol}</span>
          </span>
        </span>

        <span className="gt100-price-cell">
          <span className="gt100-price">{item.price != null ? formatPrice(item.price, item.currency) : "-"}</span>
          <span className="gt100-change" data-dir={dir}>
            {formatPct(item.change_pct)}
          </span>
        </span>

        <span className="gt100-marcap-cell">
          <span className="gt100-marcap-label">{t("시가총액")}</span>
          <span className="gt100-marcap">{formatMarcap(item.market_cap_usd, lang)}</span>
        </span>

        <span className="gt100-spark-cell">
          <GlobalTop100Sparkline points={item.spark_points} dates={item.spark_dates} currency={item.currency} trend={trend} />
        </span>

        <span className="gt100-chips-cell">
          <span className="gt100-chip" data-dir={direction(item.returns.m1 ?? null)}>
            <i>{t("1개월")}</i>
            {formatPct(item.returns.m1)}
          </span>
          <span className="gt100-chip gt100-chip--muted">
            <i>PER</i>
            {item.trailing_pe != null ? item.trailing_pe.toFixed(1) : "-"}
          </span>
          <RatingBadge item={item} lang={lang} />
        </span>

        <span className="gt100-expand-icon" aria-hidden="true">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded && (
        <div className="gt100-detail">
          <div className="gt100-returns-grid">
            {RETURN_WINDOWS.map((w) => (
              <div className="gt100-return-cell" key={w.key} data-dir={direction(item.returns[w.key] ?? null)}>
                <dt>{t(w.label)}</dt>
                <dd>{formatPct(item.returns[w.key])}</dd>
              </div>
            ))}
          </div>

          <dl className="gt100-stats">
            <div className="gt100-stat">
              <dt>{t("업종")}</dt>
              <dd>{item.sector ? t(item.sector) : "-"}</dd>
            </div>
            <div className="gt100-stat">
              <dt>{t("희석 EPS")}</dt>
              <dd>{item.trailing_eps != null ? item.trailing_eps.toFixed(2) : "-"}</dd>
            </div>
            <div className="gt100-stat">
              <dt>{t("순마진")}</dt>
              <dd>{item.profit_margin != null ? `${(item.profit_margin * 100).toFixed(1)}%` : "-"}</dd>
            </div>
            <div className="gt100-stat">
              <dt>{t("EPS 성장률")}</dt>
              <dd>{item.earnings_growth != null ? `${(item.earnings_growth * 100).toFixed(1)}%` : "-"}</dd>
            </div>
            <div className="gt100-stat">
              <dt>{t("PER")}</dt>
              <dd>{item.trailing_pe != null ? item.trailing_pe.toFixed(2) : "-"}</dd>
            </div>
            <div className="gt100-stat">
              <dt>{t("애널리스트 의견")}</dt>
              <dd>
                <RatingBadge item={item} lang={lang} />
                {item.analyst_count != null && <span className="gt100-analyst-count"> ({item.analyst_count})</span>}
              </dd>
            </div>
          </dl>

          {description && <p className="gt100-description">{description}</p>}
        </div>
      )}
    </article>
  );
}

function RowSkeleton() {
  return (
    <div className="gt100-row gt100-row--skeleton" aria-hidden="true">
      <span className="gt100-skeleton-block" />
    </div>
  );
}

export default function GlobalTop100Page() {
  const t = useT();
  const { lang } = useLanguage();
  useDocumentTitle(`${t("글로벌 시가총액 TOP 100")} | K-Stock Hub`);

  const [items, setItems] = useState<GlobalTop100Item[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("marcap");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .globalTop100()
        .then((data) => {
          if (cancelled) return;
          setItems(data.items);
          setUpdatedAt(data.updated_at);
          setError(null);
        })
        .catch((err: Error) => {
          // A failed refresh leaves the list on screen — a page that empties itself
          // because one 20s tick failed is worse than one showing slightly stale data.
          if (!cancelled) setError(err.message);
        });

    load();
    const stop = startVisibilityAwareInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const visible = useMemo(() => {
    const list = items ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter((it) => it.symbol.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle))
      : list;
    const option = SORT_OPTIONS.find((o) => o.key === sortKey) ?? SORT_OPTIONS[0];
    return [...filtered].sort((a, b) => {
      const sa = option.score(a);
      const sb = option.score(b);
      if (sa === null && sb === null) return a.rank - b.rank;
      if (sa === null) return 1;
      if (sb === null) return -1;
      const diff = option.ascending ? sa - sb : sb - sa;
      return diff || a.rank - b.rank;
    });
  }, [items, query, sortKey]);

  const updatedLabel = updatedAt ? updatedAt.replace("T", " ").slice(0, 16) : "";

  return (
    <div className="app gt100-page">
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
          <Link to="/dashboard" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> {t("AI 예측")}
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100 is-active">
            <GlobeRankIcon /> {t("글로벌 시총")}
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          <VisitorBadge />
        </div>
      </header>

      <section className="gt100-hero">
        <h1 className="gt100-title">{t("글로벌 시가총액 TOP 100")}</h1>
        <p className="gt100-subtitle">
          {t("전 세계 시가총액 상위 100개 기업의 순위·주가·재무지표를 20초마다 갱신합니다.")}
          {updatedLabel && (
            <span className="gt100-updated">
              <span className="gt100-live-dot" aria-hidden="true" />
              {lang === "en" ? `updated ${updatedLabel}` : `${updatedLabel} 기준`}
            </span>
          )}
        </p>
      </section>

      <div className="gt100-toolbar">
        <label className="gt100-search">
          <span className="sr-only">{t("종목 검색")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("종목명 · 심볼 검색")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="gt100-select">
          <span className="sr-only">{t("정렬")}</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="error-state">{t(error)}</div>}

      {!items && !error && (
        <>
          <span className="sr-only" role="status">
            {t("글로벌 시가총액 TOP 100을 불러오는 중입니다…")}
          </span>
          <div className="gt100-list">
            {Array.from({ length: 12 }).map((_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </>
      )}

      {items && (
        <main className="gt100-list">
          {visible.length === 0 && <p className="gt100-empty">{t("조건에 맞는 종목이 없습니다.")}</p>}
          {visible.map((item, index) => (
            <Row
              key={item.symbol}
              item={item}
              displayRank={index + 1}
              lang={lang}
              expanded={expanded === item.symbol}
              onToggle={() => setExpanded(expanded === item.symbol ? null : item.symbol)}
            />
          ))}
        </main>
      )}

      <p className="gt100-provenance">
        {t(
          "순위·국가·로고는 companiesmarketcap.com, 시세는 Yahoo Finance 기준이며 20초마다 갱신됩니다. 순위 변동은 전일 대비이며, 서비스 시작 첫날은 비교 대상이 없어 전 종목 신규로 표시됩니다."
        )}
      </p>

      <Footer />
    </div>
  );
}
