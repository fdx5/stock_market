import { useEffect, useMemo, useState } from "react";
import { Link } from "../router";
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
export default function MarketBriefPage() {
  useDocumentTitle("오늘의 장 마감 리포트 | K-Stock Hub");
  const [market, setMarket] = useState<"KOSPI" | "KOSDAQ">("KOSPI"),
    [data, setData] = useState<Brief | null>(null),
    [history, setHistory] = useState<{ date: string; market: string }[]>([]),
    [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/market-brief?limit=180")
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
      .then(setData)
      .catch(() => setError("리포트를 불러오지 못했습니다."));
  }, [market, selected]);
  const dates = useMemo(
    () => [
      ...new Set(history.filter((x) => x.market === market).map((x) => x.date)),
    ],
    [history, market],
  );
  async function share() {
    const url = location.href;
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
                  setMarket(x);
                  setSelected("");
                }}
                key={x}
              >
                {x}
              </button>
            ))}
          </div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">최신 리포트</option>
            {dates.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
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
                          to={`/desk?code=${x.code}&name=${encodeURIComponent(x.name)}`}
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
        </article>
      )}
    </main>
  );
}
