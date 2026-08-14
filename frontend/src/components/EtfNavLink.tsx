import { Link } from "../router";
import EtfIcon from "./EtfIcon";

export default function EtfNavLink() {
  return (
    <>
      <Link to="/etf" className="kospi-map-nav-link kospi-map-nav-link--etf"><EtfIcon /> ETF</Link>
      <Link
        to="/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK"
        className="kospi-map-nav-link kospi-map-nav-link--discussion"
      >
        종목토론
      </Link>
    </>
  );
}
