import { Link } from "../router";
import { useL } from "./lib";
import CoffeeIcon from "./CoffeeIcon";
import "./coffeeSupport.css";

export default function CoffeeSupportLink() {
  const L = useL();
  const label = L("커피 한 잔 후원하기", "Buy us a coffee");
  return <Link to="/support" className="d2-coffee-link" aria-label={label} title={label}>
    <CoffeeIcon /><span>{label}</span>
  </Link>;
}
