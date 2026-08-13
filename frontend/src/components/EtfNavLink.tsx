import { Link } from "../router";
import EtfIcon from "./EtfIcon";

export default function EtfNavLink() {
  return <Link to="/etf" className="kospi-map-nav-link kospi-map-nav-link--etf"><EtfIcon /> ETF</Link>;
}
