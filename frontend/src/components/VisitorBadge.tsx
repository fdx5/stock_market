import { useLanguage } from "../i18n/LanguageContext";
import { useVisitorCount } from "../useVisitorCount";

export default function VisitorBadge() {
  const { lang } = useLanguage();
  const { current, total } = useVisitorCount();
  const currentText = current === null ? "-" : current.toLocaleString();
  const totalText = total === null ? "-" : total.toLocaleString();

  return (
    <span className="visitor-badge">
      <span className="visitor-badge-dot" />
      {lang === "en" ? `${currentText} online` : `접속 ${currentText}명`}
      <span className="visitor-badge-sep">·</span>
      {lang === "en" ? `${totalText} visits` : `방문 ${totalText}명`}
    </span>
  );
}
