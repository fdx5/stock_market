import { Link } from "../router";
import MarketBubbleIcon from "./MarketBubbleIcon";

export default function MarketBubbleNavLink() {
  return (
    <Link to="/market-bubbles" className="kospi-map-nav-link kospi-map-nav-link--bubbles">
      <MarketBubbleIcon /> 증시버블 <span className="market-bubble-new" aria-label="신규">N</span>
    </Link>
  );
}
