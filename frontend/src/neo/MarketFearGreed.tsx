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
function stamp(value: string | number | null) { const date = value === null ? NaN : +new Date(value); return Number.isFinite(date) ? new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(date) + " KST" : "—"; }

export default function MarketFearGreed() {
  const snapshots = useAtlasMiniMaps(), { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const readings = useMemo(() => MARKETS.map(market => ({ ...market, snapshot: snapshots[market.key], reading: fearGreed(snapshots[market.key].items) })), [snapshots]);
  return <section className="ng-fear-greed" aria-labelledby="ng-fear-greed-h">
    <header className="ng-fg-heading"><h2 id="ng-fear-greed-h">{L("시장의 온도, 공포와 탐욕", "Market temperature · Fear & Greed")}</h2><span className="ng-fg-model">{L("당일 등락 기반 · 자체 산출", "DAILY RETURNS · KOSPIMAP MODEL")}</span></header>
    <div className="ng-fg-grid">{readings.map(({ key, ko, en, to, snapshot, reading: r }) => {
      const color = r.mood ? COLORS[["extreme-fear", "fear", "neutral", "greed", "extreme-greed"].indexOf(r.mood)] : "var(--text-muted)";
      const mood = r.mood ? L(...LABELS[r.mood]) : snapshot.settled ? L("시세 부족", "Unavailable") : L("확인 중", "Loading");
      return <article key={key} className="ng-fg-card" style={{ "--fg-color": color } as CSSProperties}>
        <Link to={to} className="ng-fg-market" aria-label={L(`${ko} 공포·탐욕 ${r.score ?? "확인 중"}, ${mood}. 종목지도 보기`, `${en} Fear & Greed ${r.score ?? "unavailable"}, ${mood}. View market map`)} title={`${L(ko, en)} · ${mood} · ${r.asOf ? L("시세 기준 ", "Quotes as of ") : L("수집 기준 ", "Fetched ")}${stamp(r.asOf ?? snapshot.generatedAt)}`}>
          <div className="ng-fg-market-name"><h3>{L(ko, en)}</h3><span className={snapshot.delayed ? "is-delayed" : ""}>{snapshot.delayed ? L("갱신 지연", "DELAYED") : L("공포 · 탐욕", "FEAR · GREED")}</span></div>
          <div className="ng-fg-mini"><div className={`ng-fg-scale${r.score === null ? " is-unavailable" : ""}`} aria-hidden="true">{r.score !== null && <i style={{ left: `${r.score}%` }} />}</div><b>{mood}</b></div>
          <strong className="ng-fg-score">{r.score ?? "—"}<small>/100</small></strong><span className="ng-fg-open" aria-hidden="true">↗</span>
        </Link>
      </article>;
    })}</div>
    <details className="ng-fg-method"><summary>{L("지수는 어떻게 계산하나요?", "How is this index calculated?")}</summary><div><p>{L("KOSPIMAP이 주요 60종목의 당일 등락으로 계산하는 시장심리 참고 지표입니다. 코스피·코스닥은 시가총액, 나스닥 100은 지수 편입 비중을 가중치로 사용합니다. 시장 전체나 투자자 설문을 대표하는 공식 지수는 아닙니다.", "A KOSPIMAP sentiment proxy calculated from daily returns of 60 leading stocks. Weights use market cap for KOSPI/KOSDAQ and index weight for NASDAQ 100. It is not an official whole-market or investor-survey index.")}</p><p>{L("시장 확산 = 100 × (상승 종목 + 보합 종목 × 0.5) ÷ 유효 종목. 가격 모멘텀 = 50 + 50 × tanh(가중 등락률 ÷ 3). 최종 점수 = 시장 확산 55% + 가격 모멘텀 45% (반올림). 등락률의 단위는 %이며 3은 자체 모델의 고정 척도입니다.", "Breadth = 100 × (advancers + 0.5 × flat stocks) / verified stocks. Momentum = 50 + 50 × tanh(weighted return / 3), where return is in percent and 3 is a model-specific scale. Score = round(55% breadth + 45% momentum).")}</p><p>{L("0–24 극단적 공포 · 25–44 공포 · 45–55 중립 · 56–75 탐욕 · 76–100 극단적 탐욕. 유효 종목 48개 이상·시세 확인 비율 80% 이상일 때만 산출하며, 장 마감 후에는 마지막 제공 시세를 사용합니다. 모든 종목에 시세 시각이 있으면 가장 이른 시각을 표시하고, 그 외에는 수집 시각을 구분해 표시합니다.", "0–24 extreme fear · 25–44 fear · 45–55 neutral · 56–75 greed · 76–100 extreme greed. Requires at least 48 verified stocks and 80% coverage. Closed markets retain their latest session. The oldest input quote timestamp is shown when all timestamps are available; otherwise the fetch timestamp is identified separately.")}</p></div></details>
  </section>;
}
