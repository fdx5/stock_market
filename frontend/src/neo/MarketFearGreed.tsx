import { useMemo, type CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useAtlasMiniMaps, type AtlasMarket } from "./useAtlasMiniMaps";
import { fearGreed, type Mood } from "./fearGreedModel";
import "./marketFearGreed.css";

const MARKETS: { key: AtlasMarket; ko: string; en: string; to: string }[] = [
  { key: "kospi", ko: "코스피", en: "KOSPI", to: "/map" },
  { key: "kosdaq", ko: "코스닥", en: "KOSDAQ", to: "/kosdaq-map" },
  { key: "nasdaq100", ko: "나스닥 100", en: "NASDAQ 100", to: "/nasdaq100-map" },
];
const LABELS: Record<Mood, [string, string]> = { "extreme-fear": ["극단적 공포", "EXTREME FEAR"], fear: ["공포", "FEAR"], neutral: ["중립", "NEUTRAL"], greed: ["탐욕", "GREED"], "extreme-greed": ["극단적 탐욕", "EXTREME GREED"] };
const COLORS = ["#ff6c83", "#f5ad6d", "#d9c7f4", "#65cfff", "#35e6ad"];
function polar(value: number, radius: number) { const a = Math.PI * (1 - value / 100); return { x: 180 + Math.cos(a) * radius, y: 168 - Math.sin(a) * radius }; }
function arc(start: number, end: number, radius: number) { const a = polar(start, radius), b = polar(end, radius); return `M${a.x},${a.y}A${radius},${radius} 0 0 1 ${b.x},${b.y}`; }
function stamp(value: string | number | null) { const date = value === null ? NaN : +new Date(value); return Number.isFinite(date) ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(date) + " KST" : "—"; }

export default function MarketFearGreed() {
  const snapshots = useAtlasMiniMaps(), { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const readings = useMemo(() => MARKETS.map(market => ({ ...market, snapshot: snapshots[market.key], reading: fearGreed(snapshots[market.key].items) })), [snapshots]);
  return <section className="ng-fear-greed" aria-labelledby="ng-fear-greed-h">
    <header className="ng-fg-heading"><div><span className="ng-kicker">MARKET EMOTION / 0—100</span><h2 id="ng-fear-greed-h">{L("시장의 온도, 공포와 탐욕", "The temperature of the market")}</h2><p>{L("코스피 · 코스닥 · 나스닥 100 공포·탐욕 지수", "KOSPI · KOSDAQ · NASDAQ 100 Fear & Greed")}</p></div><span className="ng-fg-model">{L("당일 등락 기반 · 자체 산출", "DAILY RETURNS · KOSPIMAP MODEL")}</span></header>
    <div className="ng-fg-grid">{readings.map(({ key, ko, en, to, snapshot, reading: r }, index) => {
      const color = r.mood ? COLORS[["extreme-fear", "fear", "neutral", "greed", "extreme-greed"].indexOf(r.mood)] : "var(--text-muted)";
      const marker = r.score === null ? null : polar(r.score, 130);
      return <article key={key} className="ng-fg-card" style={{ "--fg-color": color } as CSSProperties} aria-label={`${L(ko, en)} ${L("공포 탐욕 지수", "Fear and Greed")} ${r.score ?? L("확인 중", "unavailable")}`}>
        <header><div><span>0{index + 1} / SENTIMENT</span><h3>{L(ko, en)}</h3><small>{en}</small></div><span className={`ng-fg-state${snapshot.delayed ? " is-delayed" : ""}`}><i />{snapshot.delayed ? L("갱신 지연", "DELAYED") : r.score === null ? L("데이터 확인 중", "WAITING") : L("시세 기반", "QUOTE BASED")}</span></header>
        <div className="ng-fg-dial"><svg viewBox="0 0 360 204" aria-hidden="true">
          <path d={arc(0, 100, 149)} fill="none" stroke="currentColor" strokeOpacity=".1" strokeDasharray="1 7" />
          <path d={arc(0, 100, 110)} fill="none" stroke="currentColor" strokeOpacity=".12" />
          {[0, 25, 50, 75, 100].map(value => { const a = polar(value, 151), b = polar(value, 158); return <path key={value} d={`M${a.x},${a.y}L${b.x},${b.y}`} stroke="currentColor" strokeOpacity=".4" />; })}
          {Array.from({ length: 50 }, (_, i) => <path key={i} d={arc(i * 2 + .25, i * 2 + 1.6, 130)} fill="none" stroke={COLORS[Math.min(4, Math.floor(i / 10))]} strokeWidth="13" opacity={r.score === null ? .16 : .7} />)}
          <path d={arc(2, 98, 92)} fill="none" stroke="currentColor" strokeOpacity=".08" strokeDasharray="2 5" />
          {marker && <g className="ng-fg-marker"><circle cx={marker.x} cy={marker.y} r="13" fill={color} fillOpacity=".12" stroke={color} strokeOpacity=".3" /><circle cx={marker.x} cy={marker.y} r="5" fill="#f8f6ff" stroke={color} strokeWidth="2" /></g>}
          <text x="35" y="195" textAnchor="middle" className="ng-fg-axis">0</text><text x="180" y="29" textAnchor="middle" className="ng-fg-axis">50</text><text x="325" y="195" textAnchor="middle" className="ng-fg-axis">100</text>
        </svg><div className="ng-fg-readout"><span>FEAR &amp; GREED</span><strong>{r.score ?? "—"}<small>/ 100</small></strong><b>{r.mood ? L(...LABELS[r.mood]) : L("산출 대기", "Awaiting data")}</b></div></div>
        <div className="ng-fg-poles"><span>{L("공포", "FEAR")}</span><span>{L("탐욕", "GREED")}</span></div>
        <div className="ng-fg-signals">{[[L("시장 확산", "Breadth"), r.breadth], [L("가격 모멘텀", "Momentum"), r.momentum]].map(([label, value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: typeof value === "number" ? `${value}%` : "0%" }} /></div><b>{typeof value === "number" ? Math.round(value) : "—"}</b></div>)}</div>
        <div className="ng-fg-breadth"><span>{L("상승", "Up")} <b>{r.count ? r.up : "—"}</b></span><span>{L("하락", "Down")} <b>{r.count ? r.down : "—"}</b></span><span>{L("보합", "Flat")} <b>{r.count ? r.flat : "—"}</b></span><span>{L("가중 등락", "Wtd return")} <b>{r.weightedReturn === null ? "—" : `${r.weightedReturn > 0 ? "+" : ""}${r.weightedReturn.toFixed(2)}%`}</b></span></div>
        <footer><span>{r.asOf ? L("시세 기준 ", "Quotes as of ") : L("수집 기준 ", "Fetched ")}{stamp(r.asOf ?? snapshot.generatedAt)}<small>{L(`주요 ${r.total || 60}종목 · 유효 ${r.count}종목`, `Top ${r.total || 60} · ${r.count} verified`)}</small></span><Link to={to} aria-label={L(`${ko} 종목지도 보기`, `View ${en} market map`)}>↗</Link></footer>
        {r.score === null && snapshot.settled && <p className="ng-fg-unavailable">{L("유효한 시세가 부족해 지수를 표시하지 않습니다.", "Not enough verified quotes to calculate a score.")}</p>}
      </article>;
    })}</div>
    <details className="ng-fg-method"><summary>{L("지수는 어떻게 계산하나요?", "How is this index calculated?")}</summary><div><p>{L("KOSPIMAP이 주요 60종목의 당일 등락으로 계산하는 시장심리 참고 지표입니다. 코스피·코스닥은 시가총액, 나스닥 100은 지수 편입 비중을 가중치로 사용합니다. 시장 전체나 투자자 설문을 대표하는 공식 지수는 아닙니다.", "A KOSPIMAP sentiment proxy calculated from daily returns of 60 leading stocks. Weights use market cap for KOSPI/KOSDAQ and index weight for NASDAQ 100. It is not an official whole-market or investor-survey index.")}</p><p>{L("시장 확산 = 100 × (상승 종목 + 보합 종목 × 0.5) ÷ 유효 종목. 가격 모멘텀 = 50 + 50 × tanh(가중 등락률 ÷ 3). 최종 점수 = 시장 확산 55% + 가격 모멘텀 45% (반올림). 등락률의 단위는 %이며 3은 자체 모델의 고정 척도입니다.", "Breadth = 100 × (advancers + 0.5 × flat stocks) / verified stocks. Momentum = 50 + 50 × tanh(weighted return / 3), where return is in percent and 3 is a model-specific scale. Score = round(55% breadth + 45% momentum).")}</p><p>{L("0–24 극단적 공포 · 25–44 공포 · 45–55 중립 · 56–75 탐욕 · 76–100 극단적 탐욕. 유효 종목 48개 이상·시세 확인 비율 80% 이상일 때만 산출하며, 장 마감 후에는 마지막 제공 시세를 사용합니다. 모든 종목에 시세 시각이 있으면 가장 이른 시각을 표시하고, 그 외에는 수집 시각을 구분해 표시합니다.", "0–24 extreme fear · 25–44 fear · 45–55 neutral · 56–75 greed · 76–100 extreme greed. Requires at least 48 verified stocks and 80% coverage. Closed markets retain their latest session. The oldest input quote timestamp is shown when all timestamps are available; otherwise the fetch timestamp is identified separately.")}</p></div></details>
  </section>;
}
