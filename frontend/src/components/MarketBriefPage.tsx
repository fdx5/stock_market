import { useEffect, useMemo, useState } from "react";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import "./marketBrief.css";

type Stock = {
  code: string;
  name: string;
  close: number;
  change_pct: number;
  volume: number;
  sector: string;
};

type Brief = {
  date: string;
  market: string;
  target_type?: "market" | "stock";
  code?: string;
  name?: string;
  created_at: string;
  index: {
    symbol?: string;
    name?: string;
    close: number;
    change: number;
    change_pct: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
    turnover?: number;
    marcap?: number;
    foreign_ratio?: number;
    per?: number;
    roe?: number;
    sector?: string;
    market_status?: string;
    updated_at: string;
  };
  investor: {
    individual_amount: number;
    foreign_amount: number;
    institution_amount: number;
  };
  breadth: {
    advance: number;
    decline: number;
    flat: number;
    advance_ratio: number;
  };
  turnover_estimate: number;
  top_up: Stock[];
  top_down: Stock[];
  active: Stock[];
  sectors: {
    name: string;
    change_pct: number;
    marcap: number;
    count: number;
  }[];
  headlines: { title: string; url?: string; stock: string; press?: string; date?: string }[];
  summary: string;
  analysis: string[];
  key_issues?: string[];
  checkpoints?: string[];
  disclaimer: string;
};

type MarketTab = {
  id: string;
  slug: string;
  label: string;
  code?: string;
};

const MARKET_TABS: MarketTab[] = [
  { id: "KOSPI", slug: "kospi", label: "KOSPI" },
  { id: "KOSDAQ", slug: "kosdaq", label: "KOSDAQ" },
  { id: "SAMSUNG", slug: "samsung", label: "삼성전자", code: "005930" },
  { id: "HYNIX", slug: "hynix", label: "SK하이닉스", code: "000660" },
  { id: "HYUNDAI", slug: "hyundai", label: "현대차", code: "005380" },
  { id: "SKSQUARE", slug: "sksquare", label: "SK스퀘어", code: "402340" },
  { id: "SEMCO", slug: "semco", label: "삼성전기", code: "009150" },
];

const nf = new Intl.NumberFormat("ko-KR");
const money = (n: number) => `${(n / 1e12).toFixed(1)}조`;
const signed = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;
const flowMoney = (n: number) => {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const amount = Math.abs(n);
  return amount >= 10_000
    ? `${sign}${(amount / 10_000).toFixed(1)}조원`
    : `${sign}${nf.format(Math.round(amount))}억원`;
};

function Bars({ items }: { items?: { name: string; change_pct: number }[] }) {
  const safeItems = items || [];
  const max = Math.max(1, ...safeItems.map((x) => Math.abs(x.change_pct || 0)));
  return (
    <div className="brief-bars">
      {safeItems.slice(0, 7).map((x) => (
        <div key={x.name}>
          <b>{x.name}</b>
          <span>
            <i
              className={(x.change_pct || 0) >= 0 ? "up" : "down"}
              style={{ width: `${(Math.abs(x.change_pct || 0) / max) * 100}%` }}
            />
          </span>
          <em className={(x.change_pct || 0) >= 0 ? "up-text" : "down-text"}>
            {signed(x.change_pct || 0)}%
          </em>
        </div>
      ))}
    </div>
  );
}

export default function MarketBriefPage({
  initialDate = "",
  initialMarket = "KOSPI",
}: {
  initialDate?: string;
  initialMarket?: "KOSPI" | "KOSDAQ" | "SAMSUNG" | "HYNIX" | string;
}) {
  const normalizedInitial = useMemo(() => {
    const raw = (initialMarket || "KOSPI").toUpperCase();
    const map: Record<string, string> = {
      "005930": "SAMSUNG", "SAMSUNG": "SAMSUNG",
      "000660": "HYNIX", "HYNIX": "HYNIX", "SKHYNIX": "HYNIX",
      "005380": "HYUNDAI", "HYUNDAI": "HYUNDAI",
      "402340": "SKSQUARE", "SKSQUARE": "SKSQUARE",
      "009150": "SEMCO", "SEMCO": "SEMCO",
      "KOSDAQ": "KOSDAQ", "KOSPI": "KOSPI",
    };
    return map[raw] || "KOSPI";
  }, [initialMarket]);

  const [market, setMarket] = useState<string>(normalizedInitial);
  const [data, setData] = useState<Brief | null>(null);
  const [history, setHistory] = useState<{ date: string; market: string }[]>([]);
  const [selected, setSelected] = useState(initialDate);
  const [error, setError] = useState("");

  const activeTab = useMemo(
    () => MARKET_TABS.find((t) => t.id === market) || MARKET_TABS[0],
    [market],
  );

  const displayTitle = data?.name || activeTab.label;

  useDocumentTitle(
    data
      ? `${data.date} ${displayTitle} 오늘 브리핑 | K-Stock Hub`
      : "오늘 브리핑 | K-Stock Hub",
  );

  useEffect(() => {
    setMarket(normalizedInitial);
    setSelected(initialDate);
  }, [initialDate, normalizedInitial]);

  useEffect(() => {
    fetch("/api/market-brief?limit=500")
      .then((r) => r.json())
      .then((r) => setHistory(r.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    setError("");
    const slug = activeTab.slug;
    const url = selected
      ? `/api/market-brief/${selected}/${slug}`
      : `/api/market-brief/latest/${slug}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((brief: Brief) => {
        setData(brief);
        if (!selected) {
          const tab = MARKET_TABS.find((t) => t.id === brief.market) || activeTab;
          window.history.replaceState(
            {},
            "",
            `/market-brief/${brief.date}/${tab.slug}`,
          );
        }
      })
      .catch(() => setError("오늘 브리핑을 불러오지 못했습니다."));
  }, [activeTab, selected]);

  const dates = useMemo(
    () => [
      ...new Set(history.filter((x) => x.market === market).map((x) => x.date)),
    ],
    [history, market],
  );

  const currentDate = selected || data?.date || "";
  const currentIndex = dates.indexOf(currentDate);
  const newerDate = currentIndex > 0 ? dates[currentIndex - 1] : "";
  const olderDate = currentIndex >= 0 ? dates[currentIndex + 1] || "" : "";

  const isStock = market !== "KOSPI" && market !== "KOSDAQ";

  async function share() {
    const sharedUrl = new URL(location.href);
    sharedUrl.searchParams.set("utm_source", "native_share");
    sharedUrl.searchParams.set("utm_medium", "social");
    sharedUrl.searchParams.set("utm_campaign", `market_brief_${data?.date || "latest"}`);
    const url = sharedUrl.toString();
    try {
      if (navigator.share)
        await navigator.share({
          title: `${data?.date} ${displayTitle} 오늘 브리핑`,
          text: data?.summary,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        alert("링크를 복사했습니다.");
      }
    } catch {}
  }

  return (
    <main className="brief-page">
      <header className="brief-site-head">
        <Link to="/desk">← 마켓 데스크</Link>
        <div>
          <button onClick={share}>공유하기</button>
          <button onClick={() => window.print()}>PDF·인쇄</button>
        </div>
      </header>
      <section className="brief-hero">
        <span>DAILY MARKET INTELLIGENCE</span>
        <h1>오늘 브리핑</h1>
        <p>
          가격, 수급, 시장 확산도와 실시간 뉴스 흐름을 결합한 데이터 기반 오늘 마감 브리핑
        </p>
        <div className="brief-controls">
          <div>
            {MARKET_TABS.map((tab) => (
              <button
                className={market === tab.id ? "active" : ""}
                onClick={() => {
                  const date = selected || data?.date;
                  navigate(
                    date
                      ? `/market-brief/${date}/${tab.slug}`
                      : `/market-brief/latest/${tab.slug}`,
                  );
                }}
                key={tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <select
            value={selected}
            onChange={(e) => {
              const date = e.target.value;
              navigate(
                date
                  ? `/market-brief/${date}/${activeTab.slug}`
                  : `/market-brief/latest/${activeTab.slug}`,
              );
            }}
          >
            <option value="">최신 브리핑</option>
            {dates.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {dates.length > 0 && (
          <nav className="brief-archive" aria-label="최근 오늘 브리핑">
            <span>최근 브리핑</span>
            {dates.slice(0, 8).map((date) => (
              <Link
                className={date === currentDate ? "active" : ""}
                key={date}
                to={`/market-brief/${date}/${activeTab.slug}`}
              >
                {date.slice(5)}
              </Link>
            ))}
          </nav>
        )}
      </section>
      {error && <p className="brief-error">{error}</p>}
      {!data ? (
        <div className="brief-loading">
          <i />
          <i />
          <div />
        </div>
      ) : (
        <article className="brief-sheet">
          <header className="brief-report-head">
            <div>
              <span>K-STOCK · TODAY BRIEFING</span>
              <h2>
                {data.date} {data.name || data.market} 오늘 브리핑
                {data.code && <span className="brief-stock-badge">{data.code}</span>}
              </h2>
              <p>{data.summary}</p>
            </div>
            <div className="brief-grade">
              <small>{isStock ? "종목 분위기" : "시장 분위기"}</small>
              <strong
                className={(data.index?.change_pct ?? 0) >= 0 ? "up-text" : "down-text"}
              >
                {(data.index?.change_pct ?? 0) >= 2
                  ? (isStock ? "외인 매수 집중" : "매수심리 우세")
                  : (data.index?.change_pct ?? 0) > 0
                    ? "상승 흐름"
                    : (data.index?.change_pct ?? 0) <= -2
                      ? "위험회피 경계"
                      : (data.index?.change_pct ?? 0) < 0
                        ? "하락 조정"
                        : "방향성 중립"}
              </strong>
              <em>{data.created_at ? new Date(data.created_at).toLocaleString("ko-KR") : ""}</em>
            </div>
          </header>
          <section className="brief-kpis">
            <div>
              <span>종가</span>
              <strong>{nf.format(data.index?.close ?? 0)} {isStock ? "원" : ""}</strong>
              <em
                className={(data.index?.change_pct ?? 0) >= 0 ? "up-text" : "down-text"}
              >
                {signed(data.index?.change ?? 0)} · {signed(data.index?.change_pct ?? 0)}%
              </em>
            </div>
            <div>
              <span>{isStock ? "외국인 지분율 / PER" : "상승 종목 비중"}</span>
              <strong>
                {isStock
                  ? `${data.index?.foreign_ratio?.toFixed(1) || "-"}%`
                  : `${(data.breadth?.advance_ratio ?? 0).toFixed(1)}%`}
              </strong>
              <em>
                {isStock
                  ? `PER ${data.index?.per ? `${data.index.per.toFixed(1)}배` : "-"} · ROE ${data.index?.roe ? `${data.index.roe.toFixed(1)}%` : "-"}`
                  : `상승 ${data.breadth?.advance ?? 0} · 하락 ${data.breadth?.decline ?? 0}`}
              </em>
            </div>
            <div>
              <span>{isStock ? "당일 거래대금" : "추정 거래대금"}</span>
              <strong>{money(data.turnover_estimate ?? 0)}</strong>
              <em>{isStock ? (data.code === "005930" ? "코스피 시총 1위 대장주" : data.code === "000660" ? "코스피 시총 2위 주도주" : "코스피 주요 대표주") : "종목 종가×거래량 합산"}</em>
            </div>
            <div>
              <span>외국인 순매매</span>
              <strong>{flowMoney(data.investor?.foreign_amount ?? 0)}</strong>
              <em>기관 {flowMoney(data.investor?.institution_amount ?? 0)}</em>
            </div>
          </section>

          <section className="brief-analysis">
            <h3>Executive Summary</h3>
            <ol>
              {(data.analysis || []).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </section>

          {(data.key_issues?.length || data.checkpoints?.length) ? (
            <section className="brief-key-points">
              {data.key_issues && data.key_issues.length > 0 && (
                <div className="brief-key-box">
                  <h4>💡 핵심 이슈 사항</h4>
                  <ul>
                    {data.key_issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {data.checkpoints && data.checkpoints.length > 0 && (
                <div className="brief-key-box checkpoints">
                  <h4>🔍 다음 거래일 확인할 사항</h4>
                  <ul>
                    {data.checkpoints.map((cp, i) => (
                      <li key={i}>{cp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : null}

          <div className="brief-two">
            <section>
              <h3>{isStock ? "관련 종목 · 피어그룹 등락" : "업종 온도계"}</h3>
              <Bars items={data.sectors} />
            </section>
            <section>
              <h3>{isStock ? "당일 매수 수급 강도" : "시장 확산도"}</h3>
              <div
                className="breadth-donut"
                style={{
                  background: `conic-gradient(#ef6b75 0 ${data.breadth?.advance_ratio ?? 50}%,#5c83d6 ${data.breadth?.advance_ratio ?? 50}% 100%)`,
                }}
              >
                <div>
                  <strong>{data.breadth?.advance_ratio ?? 50}%</strong>
                  <span>{isStock ? "매수 강도" : "상승 비중"}</span>
                </div>
              </div>
              <div className="breadth-legend">
                {isStock ? (
                  <>
                    <span>외인 {flowMoney(data.investor?.foreign_amount ?? 0)}</span>
                    <span>기관 {flowMoney(data.investor?.institution_amount ?? 0)}</span>
                  </>
                ) : (
                  <>
                    <span>▲ {data.breadth?.advance ?? 0}</span>
                    <span>─ {data.breadth?.flat ?? 0}</span>
                    <span>▼ {data.breadth?.decline ?? 0}</span>
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="brief-two">
            <section>
              <h3>{isStock ? "관련 주요 종목 · 거래대금" : "주도 종목 · 거래대금"}</h3>
              <table>
                <tbody>
                  {(data.active || []).slice(0, 6).map((x) => (
                    <tr key={x.code}>
                      <td>
                        <Link to={`/stock/${x.code}`}>
                          {x.name}
                        </Link>
                        <small>{x.sector || (x.code === data.code ? "본 종목" : "관련주")}</small>
                      </td>
                      <td>{money(x.close * x.volume)}</td>
                      <td
                        className={x.change_pct >= 0 ? "up-text" : "down-text"}
                      >
                        {signed(x.change_pct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h3>{isStock ? "피어그룹 상승·하락 극점" : "상승·하락 극점"}</h3>
              <table>
                <tbody>
                  {[
                    ...(data.top_up || []).slice(0, 3),
                    ...(data.top_down || []).slice(0, 3),
                  ].map((x, idx) => (
                    <tr key={`${x.code}-${idx}`}>
                      <td>{x.name}</td>
                      <td>{nf.format(x.close)}</td>
                      <td
                        className={x.change_pct >= 0 ? "up-text" : "down-text"}
                      >
                        {signed(x.change_pct)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="brief-news">
            <h3>{isStock ? `${data.name || displayTitle} 마감 뉴스 레이더` : "마감 뉴스 레이더"}</h3>
            <div>
              {(data.headlines || []).map((x, i) => (
                <a href={x.url || "#"} target="_blank" rel="noreferrer" key={i}>
                  <small>{x.press || x.stock}</small>
                  <b>{x.title}</b>
                  <span>원문 보기 ↗</span>
                </a>
              ))}
            </div>
          </section>

          <footer>
            <b>Methodology</b>
            <p>
              공개 시세, 종목별 거래량, 시가총액 가중 업종/피어 수익률, 투자자별
              순매매 및 당일 관련 기사·공시 정보를 자동 교차 집계했습니다.
            </p>
            <p>{data.disclaimer}</p>
          </footer>

          <aside className="brief-next-actions" aria-label="관련 시장 데이터">
            <div>
              <small>다음 분석</small>
              <strong>장 마감 흐름을 종목까지 확인하세요</strong>
            </div>
            {isStock && data.code ? (
              <>
                <Link to={`/stock/${data.code}`}>
                  {data.name} 실시간 차트·호가
                </Link>
                <Link to="/fight">
                  삼성전자 vs SK하이닉스 배틀
                </Link>
                <Link to="/map">코스피 시가총액 맵</Link>
              </>
            ) : (
              <>
                <Link to={market === "KOSPI" ? "/map" : "/kosdaq-map"}>
                  {market} 시가총액 맵
                </Link>
                <Link to={market === "KOSPI" ? "/kospi-100" : "/kosdaq-100"}>
                  거래대금·등락률 순위
                </Link>
                <Link to="/desk">종목 상세 분석</Link>
              </>
            )}
          </aside>

          <nav className="brief-pagination" aria-label="오늘 브리핑 날짜 이동">
            {olderDate ? (
              <Link to={`/market-brief/${olderDate}/${activeTab.slug}`}>
                ← {olderDate} 이전 브리핑
              </Link>
            ) : <span />}
            {newerDate && (
              <Link to={`/market-brief/${newerDate}/${activeTab.slug}`}>
                {newerDate} 다음 브리핑 →
              </Link>
            )}
          </nav>
        </article>
      )}
    </main>
  );
}
