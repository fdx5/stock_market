import { Link } from "../router";
import MarketBubbleIcon from "./MarketBubbleIcon";
import NewBadge from "./NewBadge";

export default function MarketBubbleNavLink() {
  return (
    <Link to="/market-bubbles" className="kospi-map-nav-link kospi-map-nav-link--bubbles">
      <MarketBubbleIcon /> 증시버블 <NewBadge />
    </Link>
  );
}
