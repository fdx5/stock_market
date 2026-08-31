import { useLanguage } from "../i18n/LanguageContext";
import { type VisitorCounts, useVisitorCount } from "../useVisitorCount";

export default function VisitorBadge({ compact = false, counts }: { compact?: boolean; counts?: VisitorCounts }) {
  const { lang } = useLanguage();
  const localCounts = useVisitorCount(counts === undefined);
  const { current, total } = counts ?? localCounts;
  const currentText = current === null ? "-" : current.toLocaleString();
  const totalText = total === null ? "-" : total.toLocaleString();
  const label = lang === "en" ? `${currentText} online, ${totalText} visits` : `접속 ${currentText}명, 방문 ${totalText}명`;
  return (
    <span className={`visitor-badge${compact ? " visitor-badge--compact" : ""}`} aria-label={label} title={label}>
      <span className="visitor-badge-dot" />
      {compact && <span className="visitor-badge-person" aria-hidden="true">♟</span>}
      {compact ? currentText : lang === "en" ? `${currentText} online` : `접속 ${currentText}명`}
      <span className="visitor-badge-sep">·</span>
      {compact && <span className="visitor-badge-eye" aria-hidden="true">◉</span>}
      {compact ? totalText : lang === "en" ? `${totalText} visits` : `방문 ${totalText}명`}
    </span>
  );
}
