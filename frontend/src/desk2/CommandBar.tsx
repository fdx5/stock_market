import { ReactNode } from "react";
import { IndexQuote, MarketInvestorSummary } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useMarketIndices } from "../useMarketIndices";
import { Skel } from "./parts";
import { eok, useL } from "./lib";

/* The bar that stays.
 *
 * Three things, because these are the three a reader loses when they scroll:
 * where they are on the page (the section index, which doubles as the
 * scrollspy), how the market is doing (both indices and the foreign flow under
 * each — "is my stock down because the market is down" is asked mid-scroll),
 * and the search. */

export interface DeskSection {
  id: string;
  no: string;
  ko: string;
  en: string;
}

function MiniIndex({ quote, investor, label, to }: { quote: IndexQuote | null; investor: MarketInvestorSummary | null; label: string; to: string }) {
  const { lang } = useLanguage();
  if (!quote) {
    return (
      <span className="d2-cmd-idx">
        <small>{label}</small>
        <Skel w={64} h={14} />
      </span>
    );
  }
  const tone = quote.change > 0 ? "up" : quote.change < 0 ? "down" : "flat";
  return (
    <Link to={to} className={`d2-cmd-idx is-${tone}`}>
      <small>{label}</small>
      <b>{quote.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
      <span className="d2-cmd-idx-ch">
        {quote.change_pct > 0 ? "+" : quote.change_pct < 0 ? "−" : ""}
        {Math.abs(quote.change_pct).toFixed(2)}%
      </span>
      {investor && (
        <span className={`d2-cmd-idx-flow is-${investor.foreign_amount >= 0 ? "up" : "down"}`}>
          {lang === "ko" ? "외" : "F"} {eok(investor.foreign_amount, lang)}
        </span>
      )}
    </Link>
  );
}

export default function CommandBar({
  sections,
  active,
  onJump,
  onFind,
  market,
}: {
  sections: DeskSection[];
  active: string;
  onJump: (id: string) => void;
  onFind: () => void;
  /** Replaces the two KR index readings, for a page about another market. */
  market?: ReactNode;
}) {
  const { lang } = useLanguage();
  const L = useL();
  const { kospi, kosdaq, kospiInvestor, kosdaqInvestor } = useMarketIndices();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="d2-cmd" data-d2-sticky>
      <div className="d2-cmd-inner">
        <nav className="d2-cmd-index" aria-label={L("지면 목차", "Sections")}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={active === s.id ? "is-on" : ""}
              aria-current={active === s.id ? "true" : undefined}
              onClick={() => onJump(s.id)}
            >
              <i>{s.no}</i>
              <span>{lang === "ko" ? s.ko : s.en}</span>
            </button>
          ))}
        </nav>
        <div className="d2-cmd-market">
          {market ?? (
            <>
              <MiniIndex quote={kospi} investor={kospiInvestor} label={L("코스피", "KOSPI")} to="/index/kospi" />
              <MiniIndex quote={kosdaq} investor={kosdaqInvestor} label={L("코스닥", "KOSDAQ")} to="/index/kosdaq" />
            </>
          )}
        </div>
        <button type="button" className="d2-cmd-find" onClick={onFind} aria-label={L("종목·메뉴 찾기", "Find a stock or page")}>
          <span className="d2-cmd-find-glyph" aria-hidden="true">
            ⌕
          </span>
          <span className="d2-cmd-find-text">{L("종목·메뉴 찾기", "Find stock or page")}</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>
    </div>
  );
}
