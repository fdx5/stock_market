import { api } from "../api/client";
import BattleIcon from "./BattleIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import MarketIcon from "./MarketIcon";
import MarketMapPage from "./MarketMapPage";

export default function Nasdaq100MapPage() {
  return (
    <MarketMapPage
      pageTitle="NASDAQ100 MAP"
      loadingLabel="나스닥100 종목 데이터를 불러오는 중..."
      subtitlePrefix="나스닥100 지수 구성 100개"
      filePrefix="nasdaq100"
      fetchMap={api.nasdaq100Map}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={103}
      market="us"
      marcapLabel="지수 내 비중"
      navLinks={[
        { to: "/sp500-map", label: "S&P500", icon: <MarketIcon />, className: "kospi-map-nav-link--sp500" },
        { to: "/map", label: "KOSPI", icon: <MarketIcon /> },
        { to: "/kosdaq-map", label: "KOSDAQ", icon: <MarketIcon />, className: "kospi-map-nav-link--kosdaq" },
        { to: "/fight", label: "시총대결", icon: <BattleIcon />, className: "kospi-map-nav-link--battle" },
        { to: "/news", label: "NEWS", icon: <GlobalNewsIcon />, className: "kospi-map-nav-link--news" },
      ]}
    />
  );
}
