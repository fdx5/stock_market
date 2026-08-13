import { useT } from "../i18n/LanguageContext";
import { Link } from "../router";
import BattleIcon from "./BattleIcon";
import DashboardIcon from "./DashboardIcon";
import EtfIcon from "./EtfIcon";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";

export default function Footer() {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer-top">
        <Link to="/" className="app-brand app-footer-brand" aria-label="K-Stock Hub">
          <Logo className="app-footer-logo" />
        </Link>
        <p className="app-footer-tagline">
          {t("실시간 시세, 시가총액 맵, 시총 대결까지 한눈에 보는 국내 증시 허브.")}
        </p>
        <nav className="app-footer-links">
          <Link to="/desk" className="app-footer-market-link app-footer-market-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
          <Link to="/map" className="app-footer-market-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="app-footer-market-link app-footer-market-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          <Link to="/sp500-map" className="app-footer-market-link app-footer-market-link--sp500">
            <MarketIcon /> S&P500
          </Link>
          <Link to="/nasdaq100-map" className="app-footer-market-link app-footer-market-link--nasdaq">
            <MarketIcon /> NASDAQ100
          </Link>
          <Link to="/etf" className="app-footer-market-link app-footer-market-link--etf">
            <EtfIcon /> ETF
          </Link>
          <Link
            to="/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK"
            className="app-footer-market-link app-footer-market-link--discussion"
          >
            <span className="discussion-nav-n" aria-hidden="true">N</span> 종목토론탐험
          </Link>
          <Link to="/kospi-100" className="app-footer-market-link app-footer-market-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/ai-prediction" className="app-footer-market-link app-footer-market-link--predict">
            <PredictIcon /> {t("AI 예측")}
          </Link>
          <Link to="/global-top100" className="app-footer-market-link app-footer-market-link--globaltop100">
            <GlobeRankIcon /> {t("글로벌 시총")}
          </Link>
          <Link to="/fight" className="app-footer-market-link app-footer-market-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="app-footer-market-link app-footer-market-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          <a
            href="https://chs2147.github.io/mini-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer-mini-apps"
          >
            <img src="/img/mini_app.webp" alt="" className="mini-apps-icon" />
            Mini Apps
          </a>
        </nav>
      </div>
      <div className="app-footer-bottom">
        <p className="app-footer-disclaimer">
          {t(
            "본 서비스에서 제공하는 시세 및 데이터는 투자 참고용이며, 실제 매매 판단의 근거로 사용할 수 없습니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다."
          )}
        </p>
        <p className="app-footer-copy">
          © {year} K-Stock Hub
          <Link to="/admin" className="app-footer-admin-link" aria-label="Admin" title="Admin">
            ⚙
          </Link>
        </p>
      </div>
    </footer>
  );
}
