import { api } from "../api/client";
import BattleIcon from "./BattleIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import MarketIcon from "./MarketIcon";
import MarketMapPage from "./MarketMapPage";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";

export default function KospiMapPage() {
  return (
    <MarketMapPage
      pageTitle="KOSPI MAP"
      loadingLabel="시총 500개 종목 데이터를 불러오는 중..."
      subtitlePrefix="코스피 시가총액 상위 500개"
      filePrefix="kospi"
      fetchMap={api.marketMap}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={500}
      navLinks={[
        { to: "/kosdaq-map", label: "KOSDAQ", icon: <MarketIcon />, className: "kospi-map-nav-link--kosdaq" },
        { to: "/sp500-map", label: "S&P500", icon: <MarketIcon />, className: "kospi-map-nav-link--sp500" },
        { to: "/nasdaq100-map", label: "NASDAQ100", icon: <MarketIcon />, className: "kospi-map-nav-link--nasdaq" },
        { to: "/kospi-100", label: "TOP 100", icon: <RankIcon />, className: "kospi-map-nav-link--top100" },
        { to: "/ai-prediction", label: "AI 예측", icon: <PredictIcon />, className: "kospi-map-nav-link--predict" },
        { to: "/fight", label: "시총대결", icon: <BattleIcon />, className: "kospi-map-nav-link--battle" },
        { to: "/news", label: "NEWS", icon: <GlobalNewsIcon />, className: "kospi-map-nav-link--news" },
      ]}
    />
  );
}
