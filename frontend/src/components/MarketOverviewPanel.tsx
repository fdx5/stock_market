import { useEffect, useState } from "react";
import { IndexQuote, InvestorSummaryItem, MarketInvestorSummary, api } from "../api/client";
import { Link } from "../router";

function formatAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

function amountColor(value: number): string {
  if (value > 0) return "var(--up-color)";
  if (value < 0) return "var(--down-color)";
  return "var(--text-muted)";
}

function MarketInvestorLine({ summary }: { summary: MarketInvestorSummary | null }) {
  if (!summary) return null;
  return (
    <div className="index-tile-investor">
      <span style={{ color: amountColor(summary.individual_amount) }}>개인 {formatAmount(summary.individual_amount)}</span>
      <span style={{ color: amountColor(summary.foreign_amount) }}>외국인 {formatAmount(summary.foreign_amount)}</span>
      <span style={{ color: amountColor(summary.institution_amount) }}>기관 {formatAmount(summary.institution_amount)}</span>
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
  if (!index) {
    return (
      <div className="index-tile">
        <div className="index-tile-name">{label}</div>
        <div className="loading-state">불러오는 중...</div>
      </div>
    );
  }

  const color = index.change >= 0 ? "var(--up-color)" : "var(--down-color)";
  return (
    <div className="index-tile">
      <div className="index-tile-name">{index.name}</div>
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

export default function MarketOverviewPanel() {
  const [kospi, setKospi] = useState<IndexQuote | null>(null);
  const [kosdaq, setKosdaq] = useState<IndexQuote | null>(null);
  const [kospiInvestor, setKospiInvestor] = useState<MarketInvestorSummary | null>(null);
  const [kosdaqInvestor, setKosdaqInvestor] = useState<MarketInvestorSummary | null>(null);
  const [items, setItems] = useState<InvestorSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    loadIndices();
    loadSummary(true);

    const indexInterval = setInterval(loadIndices, INDEX_REFRESH_MS);
    const summaryInterval = setInterval(() => loadSummary(false), SUMMARY_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(indexInterval);
      clearInterval(summaryInterval);
    };
  }, []);

  const latestDate = items[0]?.date;

  return (
    <section className="card market-overview-panel">
      <div className="market-overview-half market-overview-index">
        <h2>코스피 · 코스닥 지수</h2>
        <p className="market-overview-subtitle">
          지수 하단은 시장 전체 개인/외국인/기관 누적 순매수(억원)이며, 매수는 빨간색, 매도는 파란색입니다.
        </p>
        <div className="index-tiles">
          <IndexTile index={kospi} investor={kospiInvestor} label="코스피" />
          <IndexTile index={kosdaq} investor={kosdaqInvestor} label="코스닥" />
        </div>
      </div>

      <div className="market-overview-half market-overview-investor">
        <h2>종목별 투자자 매매동향 (억원)</h2>
        <p className="market-overview-subtitle">
          {latestDate ? `${latestDate} 기준 누적 순매수` : "최근 확정 거래일 기준 누적 순매수"} · 종목명을 누르면
          최근 추이를 볼 수 있습니다.
        </p>

        {loading && <div className="loading-state">불러오는 중...</div>}
        {error && <div className="error-state">{error}</div>}

        {!loading && !error && (
          <div className="investor-table-wrap">
            <table className="investor-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>개인</th>
                  <th>기관</th>
                  <th>외국인</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.code}>
                    <td className="investor-table-name">
                      <Link to={`/investor/${item.code}`}>{item.name}</Link>
                    </td>
                    <td style={{ color: amountColor(item.individual_amount) }}>
                      {formatAmount(item.individual_amount)}
                    </td>
                    <td style={{ color: amountColor(item.institution_amount) }}>
                      {formatAmount(item.institution_amount)}
                    </td>
                    <td style={{ color: amountColor(item.foreign_amount) }}>
                      {formatAmount(item.foreign_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
