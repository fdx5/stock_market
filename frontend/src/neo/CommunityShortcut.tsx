import { Link } from "../router";
import { useLanguage } from "../i18n/LanguageContext";
import NeoIcon from "./NeoIcon";
import "./communityLinks.css";

export default function CommunityShortcut({ board }: { board: "kr" | "global" | "property" }) {
  const { lang } = useLanguage();
  const label = lang === "ko" ? ({ kr: "국내 증시", global: "해외 증시", property: "부동산" })[board] + " 커뮤니티" : ({ kr: "Korea", global: "Global", property: "Property" })[board] + " community";
  return <Link className="ng-community-shortcut" to={`/community/${board}`}><NeoIcon name="news" /><span>{label}</span><span className="ng-research-new" aria-label={lang === "ko" ? "신규" : "New"}>N</span><b aria-hidden="true">↗</b></Link>;
}
