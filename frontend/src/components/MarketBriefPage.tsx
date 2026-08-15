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
  market: "KOSPI" | "KOSDAQ";
  created_at: string;
  index: {
    close: number;
    change: number;
    change_pct: number;
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
  headlines: { title: string; url?: string; stock: string }[];
  summary: string;
  analysis: string[];
  disclaimer: string;
};
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
function Bars({ items }: { items: { name: string; change_pct: number }[] }) {
  const max = Math.max(1, ...items.map((x) => Math.abs(x.change_pct)));
  return (
    <div className="brief-bars">
      {items.slice(0, 7).map((x) => (
        <div key={x.name}>
          <b>{x.name}</b>
          <span>
            <i
              className={x.change_pct >= 0 ? "up" : "down"}
              style={{ width: `${(Math.abs(x.change_pct) / max) * 100}%` }}
            />
          </span>
          <em className={x.change_pct >= 0 ? "up-text" : "down-text"}>
            {signed(x.change_pct)}%
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
  initialMarket?: "KOSPI" | "KOSDAQ";
}) {
  const [market, setMarket] = useState<"KOSPI" | "KOSDAQ">(initialMarket),
    [data, setData] = useState<Brief | null>(null),
    [history, setHistory] = useState<{ date: string; market: string }[]>([]),
    [selected, setSelected] = useState(initialDate);
  const [error, setError] = useState("");
  useDocumentTitle(
    data
      ? `${data.date} ${data.market} 장 마감 분석 | K-Stock Hub`
      : "오늘의 장 마감 리포트 | K-Stock Hub",
  );
  useEffect(() => {
    setMarket(initialMarket);
    setSelected(initialDate);
  }, [initialDate, initialMarket]);
  useEffect(() => {
    fetch("/api/market-brief?limit=500")
      .then((r) => r.json())
      .then((r) => setHistory(r.items || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    setError("");
    const url = selected
      ? `/api/market-brief/${selected}/${market}`
      : `/api/market-brief/latest/${market}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((brief: Brief) => {
        setData(brief);
        /* Latest is a useful entry point, but a report that has resolved to a
           trading day should be shared and revisited at its permanent URL. */
        if (!selected) {
          window.history.replaceState(
            {},
            "",
            `/market-brief/${brief.date}/${brief.market.toLowerCase()}`,
          );
        }
      })
      .catch(() => setError("리포트를 불러오지 못했습니다."));
  }, [market, selected]);
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
  async function share() {
    const sharedUrl = new URL(location.href);
    sharedUrl.searchParams.set("utm_source", "native_share");
    sharedUrl.searchParams.set("utm_medium", "social");
    sharedUrl.searchParams.set("utm_campaign", `market_brief_${data?.date || "latest"}`);
    const url = sharedUrl.toString();
    try {
      if (navigator.share)
        await navigator.share({
          title: `${data?.date} ${market} 장 마감 리포트`,
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
        <h1>장 마감 인사이트</h1>
        <p>
          가격, 수급, 시장 확산도와 뉴스 흐름을 결합한 데이터 기반 데일리 리서치
        </p>
        <div className="brief-controls">
          <div>
            {(["KOSPI", "KOSDAQ"] as const).map((x) => (
              <button
                className={market === x ? "active" : ""}
                onClick={() => {
                  const date = selected || data?.date;
                  navigate(
                    date
                      ? `/market-brief/${date}/${x.toLowerCase()}`
                      : "/market-brief",
                  );
                }}
                key={x}
              >
                {x}
              </button>
            ))}
          </div>
          <select
            value={selected}
            onChange={(e) => {
              const date = e.target.value;
              navigate(
                date
                  ? `/market-brief/${date}/${market.toLowerCase()}`
                  : "/market-brief",
              );
            }}
          >
            <option value="">최신 리포트</option>
            {dates.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {dates.length > 0 && (
          <nav className="brief-archive" aria-label="최근 장 마감 리포트">
            <span>최근 리포트</span>
            {dates.slice(0, 8).map((date) => (
              <Link
                className={date === currentDate ? "active" : ""}
                key={date}
                to={`/market-brief/${date}/${market.toLowerCase()}`}
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
              <span>K-STOCK RESEARCH · CLOSE</span>
              <h2>
                {data.date} {data.market} 장 마감 분석
              </h2>
              <p>{data.summary}</p>
            </div>
            <div className="brief-grade">
              <small>시장 분위기</small>
              <strong
                className={data.index.change_pct >= 0 ? "up-text" : "down-text"}
              >
                {data.index.change_pct >= 1
                  ? "매수심리 우세"
                  : data.index.change_pct <= -1
                    ? "위험회피 경계"
                    : "방향성 중립"}
              </strong>
              <em>{new Date(data.created_at).toLocaleString("ko-KR")}</em>
            </div>
          </header>
          <section className="brief-kpis">
            <div>
              <span>종가</span>
              <strong>{nf.format(data.index.close)}</strong>
              <em
                className={data.index.change_pct >= 0 ? "up-text" : "down-text"}
              >
                {signed(data.index.change)} · {signed(data.index.change_pct)}%
              </em>
            </div>
            <div>
              <span>상승 종목 비중</span>
              <strong>{data.breadth.advance_ratio.toFixed(1)}%</strong>
              <em>
                상승 {data.breadth.advance} · 하락 {data.breadth.decline}
              </em>
            </div>
            <div>
              <span>추정 거래대금</span>
              <strong>{money(data.turnover_estimate)}</strong>
              <em>종목 종가×거래량 합산</em>
            </div>
            <div>
              <span>외국인 순매매</span>
              <strong>{flowMoney(data.investor.foreign_amount)}</strong>
              <em>기관 {flowMoney(data.investor.institution_amount)}</em>
            </div>
          </section>
          <section className="brief-analysis">
            <h3>Executive Summary</h3>
            <ol>
              {data.analysis.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </section>
          <div className="brief-two">
            <section>
              <h3>업종 온도계</h3>
              <Bars items={data.sectors} />
            </section>
            <section>
              <h3>시장 확산도</h3>
              <div
                className="breadth-donut"
                style={{
                  background: `conic-gradient(#ef6b75 0 ${data.breadth.advance_ratio}%,#5c83d6 ${data.breadth.advance_ratio}% 100%)`,
                }}
              >
                <div>
                  <strong>{data.breadth.advance_ratio}%</strong>
                  <span>상승 비중</span>
                </div>
              </div>
              <div className="breadth-legend">
                <span>▲ {data.breadth.advance}</span>
                <span>─ {data.breadth.flat}</span>
                <span>▼ {data.breadth.decline}</span>
              </div>
            </section>
          </div>
          <div className="brief-two">
            <section>
              <h3>주도 종목 · 거래대금</h3>
              <table>
                <tbody>
                  {data.active.slice(0, 6).map((x) => (
                    <tr key={x.code}>
                      <td>
                        <Link
                          to={`/stock/${x.code}`}
                        >
                          {x.name}
                        </Link>
                        <small>{x.sector}</small>
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
              <h3>상승·하락 극점</h3>
              <table>
                <tbody>
                  {[
                    ...data.top_up.slice(0, 3),
                    ...data.top_down.slice(0, 3),
                  ].map((x) => (
                    <tr key={x.code}>
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
            <h3>마감 뉴스 레이더</h3>
            <div>
              {data.headlines.map((x, i) => (
                <a href={x.url || "#"} target="_blank" rel="noreferrer" key={i}>
                  <small>{x.stock}</small>
                  <b>{x.title}</b>
                  <span>원문 보기 ↗</span>
                </a>
              ))}
            </div>
          </section>
          <footer>
            <b>Methodology</b>
            <p>
              공개 시세, 종목별 거래량, 시가총액 가중 업종 수익률, 시장 투자자
              순매매 및 당일 관련 뉴스를 자동 교차 집계했습니다.
            </p>
            <p>{data.disclaimer}</p>
          </footer>
          <aside className="brief-next-actions" aria-label="관련 시장 데이터">
            <div>
              <small>다음 분석</small>
              <strong>장 마감 흐름을 종목까지 확인하세요</strong>
            </div>
            <Link to={market === "KOSPI" ? "/map" : "/kosdaq-map"}>
              {market} 시가총액 맵
            </Link>
            <Link to={market === "KOSPI" ? "/kospi-100" : "/kosdaq-100"}>
              거래대금·등락률 순위
            </Link>
            <Link to="/desk">종목 상세 분석</Link>
          </aside>
          <nav className="brief-pagination" aria-label="장 마감 리포트 날짜 이동">
            {olderDate ? (
              <Link to={`/market-brief/${olderDate}/${market.toLowerCase()}`}>
                ← {olderDate} 이전 리포트
              </Link>
            ) : <span />}
            {newerDate && (
              <Link to={`/market-brief/${newerDate}/${market.toLowerCase()}`}>
                {newerDate} 다음 리포트 →
              </Link>
            )}
          </nav>
        </article>
      )}
    </main>
  );
}
