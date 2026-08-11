import { IndexQuote, MarketInvestorSummary } from "../api/client";
import { Lang, useLanguage, useT } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useMarketIndices } from "../useMarketIndices";

/* The two index numbers, compact, in the sticky command bar.
 *
 * The pulse row already draws these in full, tiles and investor flows and all,
 * and this is deliberately the same numbers again — which is only worth the
 * space because of where it sits. The command bar is sticky; the pulse row is
 * not. Scrolled down into the chart or the discussion, the index is the single
 * piece of context that has left the screen, and "is my stock down because the
 * market is down" is the question a reader asks at exactly that moment.
 *
 * It costs no extra traffic: both this and the full board read the same
 * module-level poll. See useMarketIndices.
 *
 * Each cell is a link to that index's own chart page, which the classic desk
 * reaches only from the tile in the pulse row — so the sticky bar is also the
 * shortest route to it from anywhere on the page. */

function formatFlow(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  if (lang === "en") {
    if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}T`;
    return `${sign}${(abs / 10).toFixed(1)}B`;
  }
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

function Cell({
  quote,
  investor,
  label,
  to,
}: {
  quote: IndexQuote | null;
  investor: MarketInvestorSummary | null;
  label: string;
  to: string;
}) {
  const t = useT();
  const { lang } = useLanguage();

  if (!quote) {
    return (
      <div className="desk-idx-cell" aria-hidden="true">
        <span className="desk-idx-label">{t(label)}</span>
        <span className="skeleton" style={{ width: 78, height: 17 }} />
        <span className="skeleton" style={{ width: 54, height: 12 }} />
      </div>
    );
  }

  const tone = quote.change > 0 ? "up" : quote.change < 0 ? "down" : "flat";
  const arrow = quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : "—";

  return (
    <Link to={to} className={`desk-idx-cell desk-idx-cell--link is-${tone}`}>
      <span className="desk-idx-label">{t(label)}</span>
      <span className="desk-idx-value">
        {quote.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`desk-idx-delta change-${tone}`}>
        <i aria-hidden="true">{arrow}</i>
        {Math.abs(quote.change).toFixed(2)} ({quote.change_pct >= 0 ? "+" : ""}
        {quote.change_pct}%)
      </span>
      {/* Whose money moved it. The full board below spells out all three
          investor groups; up here only the foreign line, because it is the one
          a KR reader treats as the day's driver and the only one that fits. */}
      {investor && (
        <span className="desk-idx-flow">
          {t("외국인")}{" "}
          <b className={investor.foreign_amount >= 0 ? "change-up" : "change-down"}>
            {formatFlow(investor.foreign_amount, lang)}
          </b>
        </span>
      )}
    </Link>
  );
}

export default function DeskIndexStrip() {
  const t = useT();
  const { kospi, kosdaq, kospiInvestor, kosdaqInvestor } = useMarketIndices();
  const status = kospi?.market_status ?? kosdaq?.market_status ?? null;
  const open = status === "OPEN";

  return (
    <div className="desk-idx" role="group" aria-label={t("코스피 · 코스닥 지수")}>
      <Cell quote={kospi} investor={kospiInvestor} label="코스피" to="/index/kospi" />
      <span className="desk-idx-sep" aria-hidden="true" />
      <Cell quote={kosdaq} investor={kosdaqInvestor} label="코스닥" to="/index/kosdaq" />
      {status && (
        <span className={`desk-idx-session ${open ? "is-open" : ""}`}>
          <i aria-hidden="true" />
          {open ? t("장중") : t("장마감")}
        </span>
      )}
    </div>
  );
}
