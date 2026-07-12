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

type Tab = "top50" | "kosdaq50" | "investor" | "foreignBuyTop20" | "foreignSellTop20";

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
      <div className="index-tile">
        <div className="index-tile-name">{t(label)}</div>
        <div className="loading-state">{t("불러오는 중...")}</div>
      </div>
    );
  }

  const color = index.change >= 0 ? "var(--up-color)" : "var(--down-color)";
  return (
    <div className="index-tile">
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
    </div>
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

  if (loading) return <div className="loading-state">{t("불러오는 중...")}</div>;
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
          {items.map((item, idx) => (
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

function WeeklyForeignRow({ item, rank, lang }: { item: WeeklyForeignItem; rank: number; lang: Lang }) {
  const name = useTranslatedText(item.name);
  const medal = medalFor(rank);
  return (
    <tr>
      <td className="top50-table-rank weekly-foreign-rank-col">{medal || rank}</td>
      <td className="investor-table-name">
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
}: {
  items: WeeklyForeignItem[];
  lang: Lang;
  amountLabel: string;
}) {
  const t = useT();
  return (
    <div className="investor-table-wrap">
      <table className="investor-table weekly-foreign-table">
        <thead>
          <tr>
            <th className="weekly-foreign-rank-col">{t("순위")}</th>
            <th>{t("종목명")}</th>
            <th className="weekly-foreign-amount-col">{amountLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
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
      api
        .indices()
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

    const stopIndexPolling = startVisibilityAwareInterval(loadIndices, INDEX_REFRESH_MS);
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
        <h2>{t("코스피 · 코스닥 지수")}</h2>
        <p className="market-overview-subtitle">
          {t("지수 하단은 시장 전체 개인/외국인/기관 누적 순매수(억원)이며, 매수는 빨간색, 매도는 파란색입니다.")}
        </p>
        <div className="index-tiles">
          <IndexTile index={kospi} investor={kospiInvestor} label="코스피" />
          <IndexTile index={kosdaq} investor={kosdaqInvestor} label="코스닥" />
        </div>
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

        {(tab === "foreignBuyTop20" || tab === "foreignSellTop20") && (
          <>
            <p className="market-overview-subtitle">
              {t("최근 5거래일 기준 외국인 누적 순매수 상위 20종목입니다. · 종목명을 누르면 최근 추이를 볼 수 있습니다.")}
            </p>

            {weeklyForeignLoading && <div className="loading-state">{t("불러오는 중...")}</div>}
            {weeklyForeignError && <div className="error-state">{t(weeklyForeignError)}</div>}

            {!weeklyForeignLoading && !weeklyForeignError && (
              <WeeklyForeignTable
                items={tab === "foreignBuyTop20" ? weeklyForeignBuy : weeklyForeignSell}
                lang={lang}
                amountLabel={tab === "foreignBuyTop20" ? t("외국인 순매수(억원)") : t("외국인 순매도(억원)")}
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

            {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
            {error && <div className="error-state">{t(error)}</div>}

            {!loading && !error && (
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
                    {items.map((item) => (
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
