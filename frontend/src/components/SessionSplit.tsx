import type { ExtendedHours } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { pct } from "../mapTile";

/** The two legs behind an extended-hours price.
 *
 * Outside regular US hours every US surface on this site shows the pre/post print and
 * a change measured from the previous regular close — so one number now carries two
 * different things at once: what the stock did while the exchange was open, and what
 * it has done since. A name that closed up 1% and then dropped 6% on earnings shows a
 * single −5%, and without this line a reader has no way to tell that apart from a name
 * that simply had a bad session.
 *
 * Renders nothing during regular hours, and for anything with no extended session of
 * its own — so a KR card or an FX row can mount it unconditionally.
 */
export default function SessionSplit({ quote, className = "" }: { quote: ExtendedHours; className?: string }) {
  const t = useT();
  const { session, regular_close, regular_change_pct, extended_change_pct } = quote;

  if ((session !== "pre" && session !== "post") || extended_change_pct == null) return null;

  return (
    <span className={`session-split${className ? ` ${className}` : ""}`}>
      {/* Pre-market has no regular leg to report — today's session hasn't run, and the
          backend sends null rather than 0.00% to say so. */}
      {regular_close != null && regular_change_pct != null && (
        <span className="session-split-leg">
          {t("정규장")}{" "}
          <span className="session-split-price">
            ${regular_close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>{" "}
          <b data-dir={regular_change_pct >= 0 ? "up" : "down"}>{pct(regular_change_pct)}</b>
        </span>
      )}
      <span className="session-split-leg">
        {session === "pre" ? t("프리장") : t("애프터장")}{" "}
        <b data-dir={extended_change_pct >= 0 ? "up" : "down"}>{pct(extended_change_pct)}</b>
      </span>
    </span>
  );
}
