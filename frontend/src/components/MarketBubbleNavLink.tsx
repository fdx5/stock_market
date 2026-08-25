import { Link } from "../router";
import MarketBubbleIcon from "./MarketBubbleIcon";
import MarketOrbitNavLink from "./MarketOrbitNavLink";

export default function MarketBubbleNavLink() {
  return (
    <>
      <MarketOrbitNavLink />
      <Link to="/market-bubbles" className="kospi-map-nav-link kospi-map-nav-link--bubbles">
        <MarketBubbleIcon /> 증시버블
      </Link>
    </>
  );
}
