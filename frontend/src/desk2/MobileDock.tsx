import { useEffect, useState } from "react";
import { StockQuote, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedText } from "../i18n/useTranslatedTexts";
import { dismissMobileBar, useMobileBarDismissed } from "../mobileBarPreference";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { navigate } from "../router";
import StockLogo from "../components/StockLogo";
import { DeskSection } from "./CommandBar";
import { krwPrice, pct, toneOf, useL } from "./lib";

/* The phone's own furniture.
 *
 * On a phone the sticky section index does not fit and the search field is too
 * far from the thumb, so both move to a dock at the bottom of the screen. Above
 * it rides the one-line quote the classic desk's mobile bar carried — the stock
 * named in ?code= (Samsung Electronics by default) — dismissible for the session
 * exactly as before. */

const FOLLOW_MS = 10_000;

export default function MobileDock({
  sections,
  active,
  onJump,
  onFind,
  code,
}: {
  sections: DeskSection[];
  active: string;
  onJump: (id: string) => void;
  onFind: () => void;
  code: string;
}) {
  const { lang } = useLanguage();
  const L = useL();
  const dismissed = useMobileBarDismissed();
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [sheet, setSheet] = useState(false);
  const name = useTranslatedText(quote?.name ?? "");

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    const poll = () =>
      api
        .quote(code)
        .then((q) => !cancelled && setQuote(q))
        .catch(() => {});
    poll();
    const stop = startVisibilityAwareInterval(poll, FOLLOW_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, dismissed]);

  const dockItems = sections.filter((s) => ["d2-front", "d2-index", "d2-rank", "d2-room"].includes(s.id));

  return (
    <div className="d2-dock-wrap">
      {!dismissed && quote && (
        <div className={`d2-follow is-${toneOf(quote.change_pct)}`}>
          <button type="button" className="d2-follow-body" onClick={() => navigate(`/stock/${code}`)}>
            <StockLogo code={code} name={quote.name} className="d2-follow-logo" />
            <b>{name || quote.name}</b>
            <span>{krwPrice(quote.close, lang)}</span>
            <em>{pct(quote.change_pct)}</em>
          </button>
          <button type="button" className="d2-follow-x" onClick={dismissMobileBar} aria-label={L("이번 접속 동안 숨기기", "Hide for this session")}>
            ×
          </button>
        </div>
      )}

      {sheet && (
        <div className="d2-sheet-scrim" onClick={() => setSheet(false)}>
          <nav className="d2-sheet" aria-label={L("지면 목차", "Sections")} onClick={(e) => e.stopPropagation()}>
            <h3>{L("지면 목차", "In this edition")}</h3>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={active === s.id ? "is-on" : ""}
                    onClick={() => {
                      setSheet(false);
                      onJump(s.id);
                    }}
                  >
                    <i>{s.no}</i>
                    {lang === "ko" ? s.ko : s.en}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      )}

      <nav className="d2-dock" aria-label={L("빠른 이동", "Quick navigation")}>
        {dockItems.map((s) => (
          <button key={s.id} type="button" className={active === s.id ? "is-on" : ""} onClick={() => onJump(s.id)}>
            <i>{s.no}</i>
            <span>{lang === "ko" ? s.ko : s.en}</span>
          </button>
        ))}
        <button type="button" className={sheet ? "is-on" : ""} onClick={() => setSheet((v) => !v)}>
          <i>≡</i>
          <span>{L("목차", "Index")}</span>
        </button>
        <button type="button" className="d2-dock-find" onClick={onFind}>
          <i>⌕</i>
          <span>{L("찾기", "Find")}</span>
        </button>
      </nav>
    </div>
  );
}
