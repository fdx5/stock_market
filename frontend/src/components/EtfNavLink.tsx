import { Link } from "../router";
import DiscussionIcon from "./DiscussionIcon";
import EtfIcon from "./EtfIcon";
import MarketBubbleNavLink from "./MarketBubbleNavLink";

export default function EtfNavLink() {
  return (
    <>
      <Link to="/etf" className="kospi-map-nav-link kospi-map-nav-link--etf"><EtfIcon /> ETF</Link>
      {/* 오늘 브리핑 belongs immediately right of the ETF pill, and this component is the
          only place that can put it there: it renders three pills, so a page inserting
          the brief after `<EtfNavLink />` lands it after 증시버블 instead — which is
          exactly what happened on the ten pages that use this. Owning the order here
          means those pages cannot get it wrong. */}
      <Link to="/market-brief" className="kospi-map-nav-link kospi-map-nav-link--brief">오늘 브리핑</Link>
      <Link
        to="/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK"
        className="kospi-map-nav-link kospi-map-nav-link--discussion"
      >
        <DiscussionIcon /> 종목토론
      </Link>
      <MarketBubbleNavLink />
    </>
  );
}
