import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type MarketMapItem } from "../api/client";
import { Link } from "../router";
import { pct, toneOf } from "../desk2/lib";
import { hasReturn, quoteColor } from "./marketQuote";
import StockLogo from "../components/StockLogo";
import type { BoardMarket } from "./pulseBoardData";
import "./pulseStockPanel.css";

/** Wide screens only: desktops and unfolded foldables (not phones). */
export const STOCK_PANEL_QUERY = "(min-width: 680px) and (min-height: 500px)";

const ROLL_MS = 1500;
const TITLES = 30;
const MARKET_LABEL: Record<BoardMarket, string> = { kospi: "KOSPI", kosdaq: "KOSDAQ", nasdaq100: "NASDAQ 100" };

const won = (n: number) => n >= 1e12 ? `${(n / 1e12).toFixed(1)}조` : n >= 1e8 ? `${Math.round(n / 1e8).toLocaleString("ko-KR")}억` : n.toLocaleString("ko-KR");
const price = (v?: number | null) => v != null && Number.isFinite(v) && v > 0 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
const pp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%p`;

/** A short, rule-based read of where the stock stands right now, from the board's own data:
 *  its move against the index and its sector, how much money is changing hands, and its size. */
function readFlow(item: MarketMapItem, stocks: MarketMapItem[], market: BoardMarket, indexChange: number | null | undefined, lang: "ko" | "en") {
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const lines: string[] = [];
  if (!hasReturn(item)) return { verdict: L("시세 확인 중", "Quote pending"), lines };
  const c = item.change_pct;
  const verdict = c >= 5 ? L("강한 상승 탄력", "Strong upward momentum") : c >= 1 ? L("상승 흐름", "Rising") : c > -1 ? L("보합권 · 방향 탐색", "Flat · finding direction") : c > -5 ? L("하락 압력", "Under selling pressure") : L("급락 · 변동성 확대", "Sharp drop · volatile");
  if (indexChange != null && Number.isFinite(indexChange)) {
    const gap = c - indexChange, idx = MARKET_LABEL[market];
    lines.push(Math.abs(gap) < 0.3
      ? L(`${idx}(${pct(indexChange)})와 비슷하게 움직이며 시장 흐름을 따라가고 있습니다.`, `Moving with the ${idx} (${pct(indexChange)}).`)
      : gap > 0
        ? L(`${idx}(${pct(indexChange)}) 대비 ${pp(gap)} 강세로 시장보다 강하게 움직입니다.`, `${pp(gap)} stronger than the ${idx} (${pct(indexChange)}).`)
        : L(`${idx}(${pct(indexChange)}) 대비 ${pp(gap)} 약세로 시장보다 약합니다.`, `${pp(gap)} weaker than the ${idx} (${pct(indexChange)}).`));
  }
  const peers = item.sector ? stocks.filter(s => s.sector === item.sector && hasReturn(s)) : [];
  if (peers.length >= 2) {
    const avg = peers.reduce((sum, s) => sum + s.change_pct, 0) / peers.length;
    const rank = [...peers].sort((a, b) => b.change_pct - a.change_pct).findIndex(s => s.code === item.code) + 1;
    lines.push(L(`${item.sector} 업종 ${peers.length}종목 평균 ${pct(avg)} 가운데 ${rank}위입니다.`, `${rank} of ${peers.length} in ${item.sector} (avg ${pct(avg)}).`));
  }
  const traded = stocks.filter(s => (s.turnover ?? 0) > 0);
  if (item.turnover && traded.length > 4 && market !== "nasdaq100") {
    const rank = [...traded].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0)).findIndex(s => s.code === item.code) + 1;
    lines.push(L(`거래대금 ${won(item.turnover)}원으로 전광판 ${traded.length}종목 중 ${rank}위${rank <= 10 ? " — 자금이 몰리고 있습니다" : ""}.`, `Turnover ₩${won(item.turnover)}, #${rank} of ${traded.length}.`));
  } else if (item.volume && item.average_volume) {
    const ratio = item.volume / item.average_volume;
    lines.push(L(`거래량이 평소의 ${ratio.toFixed(1)}배${ratio >= 1.5 ? "로 관심이 커졌습니다" : ""}.`, `Volume ${ratio.toFixed(1)}× its usual.`));
  }
  const capRank = [...stocks].sort((a, b) => b.marcap - a.marcap).findIndex(s => s.code === item.code) + 1;
  if (capRank > 0) lines.push(L(`${market === "nasdaq100" ? "지수 비중" : "시가총액"} ${capRank}위${item.foreign_ratio ? ` · 외국인 보유 ${item.foreign_ratio.toFixed(1)}%` : ""}${item.per ? ` · PER ${item.per.toFixed(1)}` : ""}.`,
    `#${capRank} by ${market === "nasdaq100" ? "index weight" : "market cap"}${item.foreign_ratio ? ` · foreign ${item.foreign_ratio.toFixed(1)}%` : ""}.`));
  return { verdict, lines };
}

/** The latest titles from the stock's discussion board (KR: Naver 종목토론, US: Toss). */
function useDiscussionTitles(code: string, market: BoardMarket) {
  const [titles, setTitles] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    setTitles(null);
    const load = async () => {
      try {
        if (market === "nasdaq100") {
          const page = await api.tossDiscussion(code, TITLES);
          return page.items.filter(p => !p.is_reply).map(p => p.title || p.text).filter(Boolean);
        }
        const first = await api.board(code, 1);
        let items = first.items;
        if (items.length < TITLES) { try { items = items.concat((await api.board(code, 2)).items); } catch { /* one page is enough */ } }
        return items.map(p => p.title);
      } catch { return []; }
    };
    void load().then(list => { if (alive) setTitles(list.map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, TITLES)); });
    return () => { alive = false; };
  }, [code, market]);
  return titles;
}

export default function PulseStockPanel({ item, stocks, market, indexChange, onClose, lang }: {
  item: MarketMapItem; stocks: MarketMapItem[]; market: BoardMarket; indexChange: number | null | undefined; onClose: () => void; lang: "ko" | "en";
}) {
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const flow = useMemo(() => readFlow(item, stocks, market, indexChange, lang), [item, stocks, market, indexChange, lang]);
  const titles = useDiscussionTitles(item.code, market);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [item.code]);
  useEffect(() => {
    if (!titles || titles.length < 2) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % titles.length), ROLL_MS);
    return () => window.clearInterval(timer);
  }, [titles]);
  const known = hasReturn(item);
  const board = market === "nasdaq100" ? L("토스 종목토론", "Toss discussion") : L("네이버 종목토론", "Naver discussion");
  return <aside className={`pbp is-${toneOf(known ? item.change_pct : undefined)}`} style={{ "--sc-color": quoteColor(item) } as CSSProperties} aria-label={L(`${item.name} 상세`, `${item.name} details`)}>
    <header className="pbp-head">
      <StockLogo code={item.code} name={item.name} className="pbp-logo" />
      <div className="pbp-id"><strong>{item.name}</strong><small>{item.code} · {MARKET_LABEL[market]}{item.sector ? ` · ${item.sector}` : ""}</small></div>
      <button type="button" className="pbp-close" onClick={onClose} aria-label={L("닫기", "Close")}>×</button>
    </header>
    <div className="pbp-quote">
      <strong>{price(item.close)}</strong>
      <b>{known ? pct(item.change_pct) : "—"}</b>
      {known && Number.isFinite(item.change) && <span>{item.change > 0 ? "▲" : item.change < 0 ? "▼" : ""} {Math.abs(item.change).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>}
    </div>
    <section className="pbp-flow">
      <h3>{L("현재 흐름", "Right now")} <em>{flow.verdict}</em></h3>
      <ul>{flow.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <p className="pbp-note">{L("전광판 시세로 자동 작성한 요약이며 투자 권유가 아닙니다.", "Automatic summary from the board's quotes; not investment advice.")}</p>
    </section>
    <section className="pbp-talk">
      <h3>{board} <small>{titles && titles.length ? `${index + 1} / ${titles.length}` : ""}</small></h3>
      <div className="pbp-roll" aria-live="off">
        {titles === null ? <p className="pbp-empty">{L("불러오는 중…", "Loading…")}</p>
          : !titles.length ? <p className="pbp-empty">{L("아직 글이 없습니다", "No posts yet")}</p>
          : <ol style={{ transform: `translateY(${-index * 2.4}em)` }}>{titles.map((t, i) => <li key={i} className={i === index ? "is-on" : ""} title={t}>{t}</li>)}</ol>}
      </div>
    </section>
    <Link className="pbp-more" to={`/stock/${encodeURIComponent(item.code)}`}>{L("종목 상세 보기", "Open stock page")} ↗</Link>
  </aside>;
}
