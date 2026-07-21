import { useEffect, useState } from "react";
import {
  IndexQuote,
  InvestorSummaryItem,
  MarketInvestorSummary,
  MarketMapItem,
  StockSearchResult,
  WeeklyForeignItem,
  api,
} from "../api/client";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText, useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import MacroRatesStrip from "./MacroRatesStrip";

type Tab = "top50" | "kosdaq50" | "gainers" | "losers" | "investor" | "foreignBuyTop20" | "foreignSellTop20";

// How deep into each market's cap ranking the gain/loss ranking looks. Deep enough
// that a real mover isn't missed for sitting outside the mega caps, shallow enough
// that the ranking isn't dominated by illiquid micro caps whose 30% day means very
// little — and both responses are already warmed in the backend's map cache.
const MOVERS_UNIVERSE = 200;
const MOVERS_LIMIT = 20;

// Shared by every table on this panel (top50, investor, weekly foreign) while their
// first response is still in flight — enough rows to fill each table's scroll area
// without a layout shift once real rows swap in.
const SKELETON_ROWS = Array.from({ length: 8 }, (_, i) => i);

function medalFor(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function formatAmount(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (lang === "en") {
    if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}T`;
    return `${sign}${(abs / 10).toFixed(1)}B`;
  }
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

function amountColor(value: number): string {
  if (value > 0) return "var(--up-color)";
  if (value < 0) return "var(--down-color)";
  return "var(--text-muted)";
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function MarketInvestorLine({ summary }: { summary: MarketInvestorSummary | null }) {
  const { lang } = useLanguage();
  const t = useT();
  if (!summary) return null;
  return (
    <div className="index-tile-investor">
      <span style={{ color: amountColor(summary.individual_amount) }}>
        {t("개인")} {formatAmount(summary.individual_amount, lang)}
      </span>
      <span style={{ color: amountColor(summary.foreign_amount) }}>
        {t("외국인")} {formatAmount(summary.foreign_amount, lang)}
      </span>
      <span style={{ color: amountColor(summary.institution_amount) }}>
        {t("기관")} {formatAmount(summary.institution_amount, lang)}
      </span>
    </div>
  );
}

/** Naver reports the session state alongside every index quote ("OPEN", "CLOSE",
 * "PREOPEN"); the dashboard already had the field and never showed it. Anything
 * unrecognised renders nothing rather than guessing — a wrong "장중" badge is worse
 * than no badge. */
function MarketStatusPill({ status }: { status: string | null }) {
  const t = useT();
  if (!status) return null;
  const upper = status.toUpperCase();
  const known: Record<string, { label: string; tone: string }> = {
    OPEN: { label: t("장중"), tone: "is-open" },
    CLOSE: { label: t("장마감"), tone: "is-closed" },
    PREOPEN: { label: t("장 시작 전"), tone: "is-pre" },
  };
  const info = known[upper];
  if (!info) return null;
  return (
    <span className={`market-status-pill ${info.tone}`}>
      <span className="market-status-dot" aria-hidden="true" />
      {info.label}
    </span>
  );
}

function IndexTile({
  index,
  investor,
  label,
}: {
  index: IndexQuote | null;
  investor: MarketInvestorSummary | null;
  label: string;
}) {
  const t = useT();
  if (!index) {
    return (
      <div className="index-tile" aria-hidden="true">
        <div className="index-tile-name">{t(label)}</div>
        <div className="skeleton" style={{ width: "70%", height: 20 }} />
        <div className="skeleton" style={{ width: "90%", height: 14, marginTop: 6 }} />
        <div className="index-tile-investor">
          <span className="skeleton" style={{ width: 60, height: 11 }} />
          <span className="skeleton" style={{ width: 60, height: 11 }} />
          <span className="skeleton" style={{ width: 60, height: 11 }} />
        </div>
      </div>
    );
  }

  const color = index.change >= 0 ? "var(--up-color)" : "var(--down-color)";
  return (
    <Link to={`/index/${index.symbol.toLowerCase()}`} className="index-tile index-tile-link">
      <div className="index-tile-name">{t(label)}</div>
      <div className="index-tile-value" style={{ color }}>
        {index.close.toLocaleString()}
      </div>
      <div className="index-tile-change" style={{ color }}>
        {index.change >= 0 ? "▲" : "▼"} {Math.abs(index.change).toLocaleString()} (
        {index.change_pct >= 0 ? "+" : ""}
        {index.change_pct}%)
      </div>
      <MarketInvestorLine summary={investor} />
    </Link>
  );
}

function Top50PriceList({
  onSelectStock,
  market,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
  market: "KOSPI" | "KOSDAQ";
}) {
  const { lang } = useLanguage();
  const t = useT();
  const [items, setItems] = useState<MarketMapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const REFRESH_MS = 30_000;

  useEffect(() => {
    let cancelled = false;
    const fetchItems = market === "KOSPI" ? () => api.marketMap(50) : () => api.kosdaqMap(50);

    const load = (isInitial: boolean) => {
      if (isInitial) setLoading(true);
      fetchItems()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setError(err.message || "데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    load(true);
    const stopPolling = startVisibilityAwareInterval(() => load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [market]);

  const translatedNames = useTranslatedTexts(items.map((it) => it.name));

  if (error) return <div className="error-state">{t(error)}</div>;

  return (
    <div className="top50-table-wrap">
      <table className="top50-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t("종목명")}</th>
            <th>{t("현재가")}</th>
            <th>{t("등락")}</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? SKELETON_ROWS.map((i) => (
                <tr key={`skeleton-${i}`} className="skeleton-row-tr" aria-hidden="true">
                  <td colSpan={4}>
                    <div className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                  </td>
                </tr>
              ))
            : items.map((item, idx) => (
                <tr key={item.code}>
                  <td className="top50-table-rank">{idx + 1}</td>
                  <td className="top50-table-name">
                    <button
                      type="button"
                      onClick={() => onSelectStock({ code: item.code, name: item.name, market })}
                    >
                      {translatedNames[idx] ?? item.name}
                    </button>
                  </td>
                  <td>
                    {item.close.toLocaleString()}
                    {lang === "en" ? " KRW" : "원"}
                  </td>
                  <td style={{ color: item.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                    {pct(item.change_pct)}
                  </td>
                </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Top gainers/losers across KOSPI + KOSDAQ, ranked client-side from the two map
 * payloads the backend already caches for the treemap pages — no new endpoint, and
 * the fetch only fires once a visitor actually opens one of these two tabs. */
function MoversList({
  onSelectStock,
  direction,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
  direction: "up" | "down";
}) {
  const { lang } = useLanguage();
  const t = useT();
  const [items, setItems] = useState<(MarketMapItem & { market: "KOSPI" | "KOSDAQ" })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const REFRESH_MS = 60_000;

  useEffect(() => {
    let cancelled = false;

    const load = (isInitial: boolean) => {
      if (isInitial) setLoading(true);
      Promise.all([api.marketMap(MOVERS_UNIVERSE), api.kosdaqMap(MOVERS_UNIVERSE)])
        .then(([kospiRes, kosdaqRes]) => {
          if (cancelled) return;
          const merged = [
            ...kospiRes.items.map((it) => ({ ...it, market: "KOSPI" as const })),
            ...kosdaqRes.items.map((it) => ({ ...it, market: "KOSDAQ" as const })),
          ];
          setItems(merged);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setError(err.message || "데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    load(true);
    const stopPolling = startVisibilityAwareInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  // Sorted per render rather than in state: `items` is the one raw list, and both
  // tabs read it through this hook, so flipping direction never refetches.
  const ranked = [...items]
    .sort((a, b) => (direction === "up" ? b.change_pct - a.change_pct : a.change_pct - b.change_pct))
    .slice(0, MOVERS_LIMIT);

  const translatedNames = useTranslatedTexts(ranked.map((it) => it.name));

  if (error) return <div className="error-state">{t(error)}</div>;

  return (
    <div className="top50-table-wrap">
      <table className="top50-table movers-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t("종목명")}</th>
            <th>{t("현재가")}</th>
            <th>{t("등락")}</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? SKELETON_ROWS.map((i) => (
                <tr key={`skeleton-${i}`} className="skeleton-row-tr" aria-hidden="true">
                  <td colSpan={4}>
                    <div className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                  </td>
                </tr>
              ))
            : ranked.map((item, idx) => (
                <tr key={`${item.market}-${item.code}`}>
                  <td className="top50-table-rank">{idx + 1}</td>
                  <td className="top50-table-name">
                    <button
                      type="button"
                      onClick={() => onSelectStock({ code: item.code, name: item.name, market: item.market })}
                    >
                      {translatedNames[idx] ?? item.name}
                      <span className="movers-market-tag">{item.market === "KOSPI" ? "KP" : "KQ"}</span>
                    </button>
                  </td>
                  <td>
                    {item.close.toLocaleString()}
                    {lang === "en" ? " KRW" : "원"}
                  </td>
                  <td style={{ color: item.change_pct >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                    {pct(item.change_pct)}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

function WeeklyForeignRow({ item, rank, lang }: { item: WeeklyForeignItem; rank: number; lang: Lang }) {
  const name = useTranslatedText(item.name);
  const medal = medalFor(rank);
  return (
    <tr>
      <td className="top50-table-rank weekly-foreign-rank-col">{medal || rank}</td>
      <td className="investor-table-name weekly-foreign-name-col">
        <Link to={`/investor/${item.code}`}>{name}</Link>
      </td>
      <td className="weekly-foreign-amount-col" style={{ color: amountColor(item.amount) }}>
        {formatAmount(item.amount, lang)}
      </td>
    </tr>
  );
}

function WeeklyForeignTable({
  items,
  lang,
  amountLabel,
  loading,
}: {
  items: WeeklyForeignItem[];
  lang: Lang;
  amountLabel: string;
  loading: boolean;
}) {
  const t = useT();
  return (
    <div className="investor-table-wrap">
      <table className="investor-table weekly-foreign-table">
        <thead>
          <tr>
            <th className="weekly-foreign-rank-col">{t("순위")}</th>
            <th className="weekly-foreign-name-col">{t("종목명")}</th>
            <th className="weekly-foreign-amount-col">{amountLabel}</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? SKELETON_ROWS.map((i) => (
                <tr key={`skeleton-${i}`} className="skeleton-row-tr" aria-hidden="true">
                  <td colSpan={3}>
                    <div className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                  </td>
                </tr>
              ))
            : items.map((item, idx) => (
                <WeeklyForeignRow key={item.code} item={item} rank={idx + 1} lang={lang} />
              ))}
        </tbody>
      </table>
    </div>
  );
}

function InvestorTableRow({
  item,
  lang,
}: {
  item: InvestorSummaryItem;
  lang: Lang;
}) {
  const name = useTranslatedText(item.name);
  return (
    <tr>
      <td className="investor-table-name">
        <Link to={`/investor/${item.code}`}>{name}</Link>
      </td>
      <td style={{ color: amountColor(item.individual_amount) }}>{formatAmount(item.individual_amount, lang)}</td>
      <td style={{ color: amountColor(item.institution_amount) }}>{formatAmount(item.institution_amount, lang)}</td>
      <td style={{ color: amountColor(item.foreign_amount) }}>{formatAmount(item.foreign_amount, lang)}</td>
    </tr>
  );
}

export default function MarketOverviewPanel({
  onSelectStock,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const [tab, setTab] = useState<Tab>("top50");
  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [kospiInvestor, setKospiInvestor] = useState<MarketInvestorSummary | null>(null);
  const [kosdaqInvestor, setKosdaqInvestor] = useState<MarketInvestorSummary | null>(null);
  const [items, setItems] = useState<InvestorSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeklyForeignBuy, setWeeklyForeignBuy] = useState<WeeklyForeignItem[]>([]);
  const [weeklyForeignSell, setWeeklyForeignSell] = useState<WeeklyForeignItem[]>([]);
  const [weeklyForeignLoading, setWeeklyForeignLoading] = useState(true);
  const [weeklyForeignError, setWeeklyForeignError] = useState<string | null>(null);

  const INDEX_REFRESH_MS = 15_000;
  const SUMMARY_REFRESH_MS = 5 * 60_000;

  useEffect(() => {
    let cancelled = false;

    const loadIndices = () => {
      // Always reuses the backend's stale-while-revalidate cache (fresh=false) rather
      // than forcing a synchronous re-scrape on every page entry — with a 10-20s TTL,
      // the worst case is a few seconds of staleness, which is far cheaper than
      // blocking a request thread on Naver for every visitor's first paint.
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
          // A missed index refresh just keeps showing the last known values.
        });
    };

    const loadSummary = (isInitial: boolean) => {
      if (isInitial) setLoading(true);
      api
        .investorSummary()
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setError(err.message || "데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (isInitial && !cancelled) setLoading(false);
        });
    };

    const loadWeeklyForeign = (isInitial: boolean) => {
      if (isInitial) setWeeklyForeignLoading(true);
      api
        .weeklyForeignTop()
        .then((res) => {
          if (cancelled) return;
          setWeeklyForeignBuy(res.buy);
          setWeeklyForeignSell(res.sell);
          setWeeklyForeignError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          if (isInitial) setWeeklyForeignError(err.message || "데이터를 불러오지 못했습니다.");
        })
        .finally(() => {
          if (isInitial && !cancelled) setWeeklyForeignLoading(false);
        });
    };

    loadIndices();
    loadSummary(true);
    loadWeeklyForeign(true);

    const stopIndexPolling = startVisibilityAwareInterval(() => loadIndices(), INDEX_REFRESH_MS);
    const stopSummaryPolling = startVisibilityAwareInterval(() => loadSummary(false), SUMMARY_REFRESH_MS);
    const stopWeeklyForeignPolling = startVisibilityAwareInterval(() => loadWeeklyForeign(false), SUMMARY_REFRESH_MS);

    return () => {
      cancelled = true;
      stopIndexPolling();
      stopSummaryPolling();
      stopWeeklyForeignPolling();
    };
  }, []);

  const latestDate = items[0]?.date;

  return (
    <section className="card market-overview-panel">
      <div className="market-overview-half market-overview-index">
        <div className="market-overview-heading">
          <h2>{t("코스피 · 코스닥 지수")}</h2>
          <MarketStatusPill status={kospi?.market_status ?? kosdaq?.market_status ?? null} />
        </div>
        <p className="market-overview-subtitle">
          {t("지수 하단은 시장 전체 개인/외국인/기관 누적 순매수(억원)이며, 매수는 빨간색, 매도는 파란색입니다.")}
        </p>
        <div className="index-tiles">
          <IndexTile index={kospi} investor={kospiInvestor} label="코스피" />
          <IndexTile index={kosdaq} investor={kosdaqInvestor} label="코스닥" />
        </div>

        {/* The two macro numbers a KR investor reads next to the index itself.
            Polled on the ticker's own cadence rather than the index refresh, since
            they come from the ticker payload. */}
        <MacroRatesStrip />
      </div>

      <div className="market-overview-half market-overview-investor">
        <div className="market-overview-tab-bar">
          <button
            type="button"
            className={`market-overview-tab ${tab === "top50" ? "active" : ""}`}
            onClick={() => setTab("top50")}
          >
            {t("코스피 시총 50위")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "kosdaq50" ? "active" : ""}`}
            onClick={() => setTab("kosdaq50")}
          >
            {t("코스닥 시총 50위")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "gainers" ? "active" : ""}`}
            onClick={() => setTab("gainers")}
          >
            {t("급등 TOP")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "losers" ? "active" : ""}`}
            onClick={() => setTab("losers")}
          >
            {t("급락 TOP")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "investor" ? "active" : ""}`}
            onClick={() => setTab("investor")}
          >
            {t("종목별 투자자 매매동향")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "foreignBuyTop20" ? "active" : ""}`}
            onClick={() => setTab("foreignBuyTop20")}
          >
            {t("외국인 주간매수 TOP20")}
          </button>
          <button
            type="button"
            className={`market-overview-tab ${tab === "foreignSellTop20" ? "active" : ""}`}
            onClick={() => setTab("foreignSellTop20")}
          >
            {t("외국인 주간매도 TOP20")}
          </button>
        </div>

        {tab === "top50" && <Top50PriceList onSelectStock={onSelectStock} market="KOSPI" />}

        {tab === "kosdaq50" && <Top50PriceList onSelectStock={onSelectStock} market="KOSDAQ" />}

        {(tab === "gainers" || tab === "losers") && (
          <>
            <p className="market-overview-subtitle">
              {t("코스피·코스닥 시총 200위 이내 종목의 당일 등락률 순위입니다. · KP=코스피, KQ=코스닥")}
            </p>
            <MoversList onSelectStock={onSelectStock} direction={tab === "gainers" ? "up" : "down"} />
          </>
        )}

        {(tab === "foreignBuyTop20" || tab === "foreignSellTop20") && (
          <>
            <p className="market-overview-subtitle">
              {t("최근 5거래일 기준 외국인 누적 순매수 상위 20종목입니다. · 종목명을 누르면 최근 추이를 볼 수 있습니다.")}
            </p>

            {weeklyForeignError && <div className="error-state">{t(weeklyForeignError)}</div>}

            {!weeklyForeignError && (
              <WeeklyForeignTable
                items={tab === "foreignBuyTop20" ? weeklyForeignBuy : weeklyForeignSell}
                lang={lang}
                amountLabel={tab === "foreignBuyTop20" ? t("외국인 순매수(억원)") : t("외국인 순매도(억원)")}
                loading={weeklyForeignLoading}
              />
            )}
          </>
        )}

        {tab === "investor" && (
          <>
            <p className="market-overview-subtitle">
              {latestDate
                ? `${latestDate} ${t("기준 누적 순매수(억원)")}`
                : t("최근 확정 거래일 기준 누적 순매수(억원)")}{" "}
              · {t("시총 100위까지 · 종목명을 누르면 최근 추이를 볼 수 있습니다.")}
            </p>

            {error && <div className="error-state">{t(error)}</div>}

            {!error && (
              <div className="investor-table-wrap">
                <table className="investor-table">
                  <thead>
                    <tr>
                      <th>{t("종목명")}</th>
                      <th>{t("개인")}</th>
                      <th>{t("기관")}</th>
                      <th>{t("외국인")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? SKELETON_ROWS.map((i) => (
                          <tr key={`skeleton-${i}`} className="skeleton-row-tr" aria-hidden="true">
                            <td colSpan={4}>
                              <div className="skeleton-row" style={{ animationDelay: `${i * 60}ms` }} />
                            </td>
                          </tr>
                        ))
                      : items.map((item) => (
                          <InvestorTableRow key={item.code} item={item} lang={lang} />
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
