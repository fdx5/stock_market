import type { MarketSession } from "../api/client";
import { useT } from "../i18n/LanguageContext";

/** Marks a price as coming from outside regular US trading hours.
 *
 * Without it the page would show a pre-market print exactly like a regular-session
 * one — the number would be right but the reader would have no way to know it was
 * struck in thin extended-hours trading, or that its change is measured against the
 * previous regular close. Renders nothing during regular hours, and for every
 * instrument that has no extended session at all. */
export default function SessionBadge({
  session,
  compact = false,
}: {
  session: MarketSession | undefined;
  compact?: boolean;
}) {
  const t = useT();
  if (session !== "pre" && session !== "post") return null;

  const label = session === "pre" ? t("프리장") : t("애프터장");
  return (
    <span className={`session-badge is-${session} ${compact ? "is-compact" : ""}`} title={t("미국 정규장 시간외 거래")}>
      <span className="session-badge-dot" aria-hidden="true" />
      {compact ? (session === "pre" ? "PRE" : "AFT") : label}
    </span>
  );
}
