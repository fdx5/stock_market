import { useLanguage } from "../../i18n/LanguageContext";
import { Link } from "../../router";
import { finite } from "./stockReturns";
import { stockBrief } from "./stockBriefModel";
import "./stockBrief.css";

export const briefPct = (n: number | null) => n == null || !finite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number | null) => n == null || n === 0 ? "flat" : n > 0 ? "up" : "down";
export type BriefModel = ReturnType<typeof stockBrief>;

function Trend({ model }: { model: BriefModel }) {
  const { recent, low, high } = model;
  const { lang } = useLanguage();
  if (recent.length < 2 || low == null || high == null) return <p className="brief-empty">{lang === "ko" ? "가격 추이를 표시할 일별 자료가 부족합니다." : "More daily prices are needed for the trend."}</p>;
  const span = high - low || 1;
  const path = recent.map((p, i) => `${i ? "L" : "M"}${(i / (recent.length - 1) * 340 + 10).toFixed(1)},${(85 - (p.close - low) / span * 65).toFixed(1)}`).join(" ");
  const direction = tone(recent[recent.length - 1].close - recent[0].close);
  return <div className="brief-trend"><svg viewBox="0 0 360 100" role="img" aria-label={lang === "ko" ? `최근 ${recent.length}거래일 종가 추이` : `Daily closing prices over ${recent.length} sessions`}>
    <path d="M10,85 H350 M10,52 H350 M10,20 H350" className="brief-trend-grid" />
    <path d={path + " L350,94 L10,94 Z"} className={`brief-trend-fill is-${direction}`} />
    <path d={path} className={`brief-trend-line is-${direction}`} />
    <circle cx="350" cy={85 - (recent[recent.length - 1].close - low) / span * 65} r="3.5" className={`is-${direction}`} />
  </svg><div><span>{recent[0].date}</span><span>{recent[recent.length - 1].date}</span></div></div>;
}

export default function StockInsights({ model: m, code, isEtf, report = false, receivedAt, quoteUnavailable = false }: { model: BriefModel; code: string; isEtf: boolean; report?: boolean; receivedAt: string | null; quoteUnavailable?: boolean }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const stockUrl = `/stock/${encodeURIComponent(code)}${isEtf ? "?asset=ETF" : ""}`;
  const reportUrl = `/stock/${encodeURIComponent(code)}/report${isEtf ? "?asset=ETF" : ""}`;
  const rsiState = m.rsi == null ? L("자료 미제공", "Unavailable") : m.rsi >= 70 ? L("70 이상 · 과열 구간", "70+ · overbought zone") : m.rsi <= 30 ? L("30 이하 · 침체 구간", "30 or lower · oversold zone") : L("30–70 · 중립 구간", "30–70 · neutral zone");
  const peer = m.peers;
  const span = peer ? Math.max(1, Math.abs(peer.own), Math.abs(peer.average)) : 1;
  return <section className="stock-insights" id="sk-insights" aria-labelledby="stock-insights-title">
    <header className="brief-head"><div><p>{L("숫자와 근거", "NUMBERS & EVIDENCE")}</p><h2 id="stock-insights-title">{report ? L("한눈에 보는 분석", "Analysis at a glance") : L("지금 확인할 핵심", "The essentials")}</h2></div>{!report && <Link to={reportUrl} className="brief-report-link">{L("한 장 보고서", "One-page report")} ↗</Link>}</header>
    <div className="brief-basis"><span>{L("일별 지표 기준", "Daily indicators as of")} <b>{m.latest?.date ?? L("자료 미제공", "Unavailable")}</b></span><span>{m.priceKind === "quote" ? L("가격: 수신 시세", "Price: received quote") : L("가격: 일별 종가", "Price: daily close")}</span>{receivedAt && <span>{L("시세 조회 확인", "Quote response received")} {new Date(receivedAt).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US", { hour12: false })}</span>}{quoteUnavailable && <strong className="brief-pending">{L("시세 갱신 대기", "Quote refresh pending")}</strong>}</div>
    <dl className="brief-metrics">
      <div><dt>{L("전일 대비", "Daily change")}</dt><dd className={`is-${tone(m.day)}`} data-brief-metric="day">{briefPct(m.day)}</dd><small>{m.priceKind === "quote" ? L("수신 시세 기준", "Received quote basis") : L("일별 시세 기준", "Daily price basis")}</small></div>
      <div><dt>{L("1개월 수익률", "1-month return")}</dt><dd className={`is-${tone(m.month.value)}`} data-brief-metric="month">{briefPct(m.month.value)}</dd><small>{L("21거래일 · 일별 종가", "21 sessions · daily close")}</small></div>
      <div><dt>{L("거래량 / 20일 평균", "Volume / 20-day average")}</dt><dd data-brief-metric="volume">{m.volumeRatio == null ? "—" : `${m.volumeRatio.toFixed(2)}×`}</dd><small>{L("최근 일별 거래량 기준", "Latest daily volume basis")}</small></div>
      <div><dt>RSI 14</dt><dd data-brief-metric="rsi">{m.rsi?.toFixed(1) ?? "—"}</dd><small>{rsiState}</small></div>
    </dl>
    <div className="brief-reading"><div><h3>{L("최근 가격의 흐름", "Recent price trend")}</h3><Trend model={m} /></div><div className="brief-observations"><h3>{L("확인된 변화", "Observed changes")}</h3><ul>
      <li>{m.month.value == null ? L("1개월 수익률은 일별 종가가 22개 이상 쌓이면 표시됩니다.", "The 1-month return needs at least 22 daily closes.") : L(`${m.month.start} → ${m.month.end} 종가 기준 ${briefPct(m.month.value)}.`, `Daily close from ${m.month.start} to ${m.month.end}: ${briefPct(m.month.value)}.`)}</li>
      <li>{m.distance20 == null ? L("20일 이동평균 비교 자료가 없습니다.", "20-day moving average unavailable.") : L(`최근 종가는 20일 이동평균 대비 ${briefPct(m.distance20)}입니다.`, `Latest daily close is ${briefPct(m.distance20)} from its 20-day average.`)}</li>
      <li>{m.volumeRatio == null ? L("거래량 평균 비교 자료가 없습니다.", "Volume average unavailable.") : L(`최근 일별 거래량은 20일 평균의 ${m.volumeRatio.toFixed(2)}배입니다.`, `Latest daily volume is ${m.volumeRatio.toFixed(2)} times its 20-day average.`)}</li>
    </ul></div></div>
    <div className="brief-peers"><div className="brief-peer-head"><h3>{isEtf ? L("비교 기준", "Comparison basis") : L("동일 업종의 흐름", "Sector context")}</h3>{peer && <span>{peer.sector} · {peer.count}{L("개 비교 종목", " comparison stocks")}</span>}</div>
      {peer ? <><div className="brief-peer-bars">{[{ label: L("이 종목", "This stock"), value: peer.own }, { label: L("비교군 평균", "Peer average"), value: peer.average }].map((row) => <div key={row.label}><span>{row.label}</span><div className="brief-bar-track" aria-hidden="true"><i className={`is-${tone(row.value)}`} style={row.value >= 0 ? { left: "50%", width: `${Math.abs(row.value) / span * 48}%` } : { right: "50%", width: `${Math.abs(row.value) / span * 48}%` }} /></div><b className={`is-${tone(row.value)}`}>{briefPct(row.value)}</b></div>)}</div><p className="brief-peer-result">{L("비교군 대비", "Relative to peers")} <b className={`is-${tone(peer.relative)}`}>{peer.relative > 0 ? "+" : ""}{peer.relative.toFixed(2)}%p</b><span>{L("동일 조회 묶음 · 같은 거래 세션 · 본 종목 제외 단순 평균", "Same response cohort and trading session · equal-weighted, excluding this stock")}</span></p></> : <p className="brief-empty">{isEtf ? L("ETF는 주식 업종 평균 대신 아래 기간 수익률을 기준으로 확인합니다.", "For ETFs, use the period returns below rather than a stock-sector average.") : L("동일 업종 비교 자료가 아직 없습니다.", "Sector comparison is currently unavailable.")}</p>}
      {peer?.asOf && <p className="brief-empty">{L("업종 조회 기준", "Peer snapshot as of")} {new Date(peer.asOf).toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", hour12: false })} (KST)</p>}
    </div>
    <footer className="brief-foot"><p>{L("조회 확인 시각은 실제 거래 시각과 다릅니다. 시세와 일별 지표는 서로 다른 기준으로 제공됩니다.", "Response time differs from trade time. Quotes and daily indicators use separate bases.")}</p><nav aria-label={L("분석 근거", "Analysis evidence")}><Link to={`${stockUrl}#sk-chart`}>{L("가격 원표·차트", "Price chart")} ↗</Link><Link to={`${stockUrl}#sk-tech`}>{L("지표 상세", "Indicators")} ↗</Link>{!isEtf && <Link to={`${stockUrl}#sk-peers`}>{L("업종 비교 원표", "Peer table")} ↗</Link>}</nav></footer>
  </section>;
}
