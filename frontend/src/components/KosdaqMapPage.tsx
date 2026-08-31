import { api } from "../api/client";
import StockListIcon from "./StockListIcon";
import BattleIcon from "./BattleIcon";
import DiscussionIcon from "./DiscussionIcon";
import EtfIcon from "./EtfIcon";
import MarketBubbleIcon from "./MarketBubbleIcon";
import { MarketOrbitIcon } from "./MarketOrbitNavLink";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import MarketIcon from "./MarketIcon";
import MarketMapPage from "./MarketMapPage";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";

export default function KosdaqMapPage() {
  return (
    <MarketMapPage
      pageTitle="KOSDAQ MAP"
      loadingLabel="코스닥 시총 200개 종목 데이터를 불러오는 중..."
      subtitlePrefix="코스닥 시가총액 상위 200개"
      filePrefix="kosdaq"
      fetchMap={api.kosdaqMap}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={200}
      enhancedSectorView
      navLinks={[
        { to: "/stocks", label: "종목정보", icon: <StockListIcon />, className: "kospi-map-nav-link--stocks" },
        { to: "/map", label: "KOSPI", icon: <MarketIcon /> },
        { to: "/sp500-map", label: "S&P500", icon: <MarketIcon />, className: "kospi-map-nav-link--sp500" },
        { to: "/nasdaq100-map", label: "NASDAQ", icon: <MarketIcon />, className: "kospi-map-nav-link--nasdaq" },
        { to: "/etf", label: "ETF", icon: <EtfIcon />, className: "kospi-map-nav-link--etf" },
        { to: "/market-brief", label: "오늘 브리핑", className: "kospi-map-nav-link--brief" },
        { to: "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", label: "종목토론", icon: <DiscussionIcon />, className: "kospi-map-nav-link--discussion" },
        { to: "/kospi-orbit", label: "증시궤도", icon: <MarketOrbitIcon />, className: "kospi-map-nav-link--orbit" },
        { to: "/market-bubbles", label: "증시버블", icon: <MarketBubbleIcon />, className: "kospi-map-nav-link--bubbles" },
        { to: "/kospi-100", label: "TOP100", icon: <RankIcon />, className: "kospi-map-nav-link--top100" },
        { to: "/ai-prediction", label: "AI예측", icon: <PredictIcon />, className: "kospi-map-nav-link--predict" },
        {
          to: "/global-top100",
          label: "글로벌시총",
          icon: <GlobeRankIcon />,
          className: "kospi-map-nav-link--globaltop100",
        },
        { to: "/fight", label: "시총대결", icon: <BattleIcon />, className: "kospi-map-nav-link--battle" },
        { to: "/news", label: "NEWS", icon: <GlobalNewsIcon />, className: "kospi-map-nav-link--news" },
      ]}
    />
  );
}
