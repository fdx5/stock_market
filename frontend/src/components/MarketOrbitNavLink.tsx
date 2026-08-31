import { Link } from "../router";

export function MarketOrbitIcon() {
  return (
    <span className="market-orbit-nav-icon" aria-hidden="true">
      <i />
    </span>
  );
}

export default function MarketOrbitNavLink() {
  return (
    <Link
      to="/kospi-orbit"
      className="kospi-map-nav-link kospi-map-nav-link--orbit"
    >
      <MarketOrbitIcon />
      증시궤도
    </Link>
  );
}
