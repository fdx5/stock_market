import { Link } from "../router";
import BattleIcon from "./BattleIcon";
import DashboardIcon from "./DashboardIcon";
import DiscussionIcon from "./DiscussionIcon";
import EtfIcon from "./EtfIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketBubbleNavLink from "./MarketBubbleNavLink";
import MarketIcon from "./MarketIcon";
import NewBadge from "./NewBadge";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import StockListIcon from "./StockListIcon";
import ThemeToggle from "./ThemeToggle";

export default function StockDetailDeskHeader({ market }: { market: "KR" | "US" }) {
  const home = market === "US" ? "/global" : "/desk";
  const discussion = market === "US"
    ? "/discussion-explorer?code=AAPL&name=Apple&market=US&asset=STOCK"
    : "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK";
  return <header className="app-header si-common-header">
    <div className="app-title-row">
      <div className="app-brand"><span className="sr-only">K-Stock Hub 종목 종합정보</span><Link to={home} aria-label={market === "US" ? "글로벌 메인" : "마켓데스크"}><Logo className="app-logo-wide" /></Link></div>
      <div className="app-header-meta"><LanguageToggle /><ThemeToggle /></div>
    </div>
    <div className="app-nav-row">
      <Link to={home} className="kospi-map-nav-link kospi-map-nav-link--home"><DashboardIcon /> {market === "US" ? "글로벌 메인" : "홈"}</Link>
      <Link to="/stocks" className="kospi-map-nav-link kospi-map-nav-link--stocks"><StockListIcon /> 종목정보</Link>
      <Link to="/map" className="kospi-map-nav-link"><MarketIcon /> KOSPI</Link>
      <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq"><MarketIcon /> KOSDAQ</Link>
      <Link to="/sp500-map" className="kospi-map-nav-link kospi-map-nav-link--sp500"><MarketIcon /> S&amp;P500</Link>
      <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq"><MarketIcon /> NASDAQ</Link>
      <Link to="/etf" className="kospi-map-nav-link kospi-map-nav-link--etf"><EtfIcon /> ETF</Link>
      <Link to="/market-brief" className="kospi-map-nav-link kospi-map-nav-link--brief">오늘 브리핑</Link>
      <Link to={discussion} className="kospi-map-nav-link kospi-map-nav-link--discussion"><DiscussionIcon /> 종목토론</Link>
      <MarketBubbleNavLink />
      <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100"><RankIcon /> TOP100</Link>
      <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict"><PredictIcon /> AI예측</Link>
      <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100"><GlobeRankIcon /> 글로벌 순위</Link>
      <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle"><BattleIcon /> 시총 대결</Link>
      <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news"><GlobalNewsIcon /> NEWS</Link>
    </div>
  </header>;
}
