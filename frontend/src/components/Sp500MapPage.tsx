import { api } from "../api/client";
import BattleIcon from "./BattleIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import MarketIcon from "./MarketIcon";
import MarketMapPage from "./MarketMapPage";
import PredictIcon from "./PredictIcon";

export default function Sp500MapPage() {
  return (
    <MarketMapPage
      pageTitle="S&P500 MAP"
      loadingLabel="S&P500 종목 데이터를 불러오는 중..."
      subtitlePrefix="S&P500 지수 구성 500개"
      filePrefix="sp500"
      fetchMap={api.sp500Map}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={503}
      market="us"
      marcapLabel="지수 내 비중"
      navLinks={[
        { to: "/map", label: "KOSPI", icon: <MarketIcon /> },
        { to: "/kosdaq-map", label: "KOSDAQ", icon: <MarketIcon />, className: "kospi-map-nav-link--kosdaq" },
        { to: "/nasdaq100-map", label: "NASDAQ100", icon: <MarketIcon />, className: "kospi-map-nav-link--nasdaq" },
        { to: "/ai-prediction", label: "AI 예측", icon: <PredictIcon />, className: "kospi-map-nav-link--predict" },
        { to: "/fight", label: "시총대결", icon: <BattleIcon />, className: "kospi-map-nav-link--battle" },
        { to: "/news", label: "NEWS", icon: <GlobalNewsIcon />, className: "kospi-map-nav-link--news" },
      ]}
    />
  );
}
