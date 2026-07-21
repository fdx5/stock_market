import { RefObject, useEffect, useState } from "react";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { wonSuffix } from "../i18n/format";
import { dismissMobileBar, useMobileBarDismissed } from "../mobileBarPreference";
import { StoredStock } from "../watchlist";
import FavoriteButton from "./FavoriteButton";
import StockIcon from "./StockIcon";

interface Props {
  /** The in-page stock header. While any part of it is on screen this bar stays
   * hidden — it exists only to carry that header's information once it's gone. */
  anchorRef: RefObject<HTMLElement | null>;
  stock: StoredStock;
  displayName: string;
  close: number;
  change: number;
  changePct: number;
}

export default function MobileStockBar({ anchorRef, stock, displayName, close, change, changePct }: Props) {
  const { lang } = useLanguage();
  const t = useT();
  const dismissed = useMobileBarDismissed();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = anchorRef.current;
    if (!target) return;
    // An IntersectionObserver rather than a scroll listener: no per-frame work on
    // the main thread while the visitor scrolls a page that's already animating
    // charts and a ticker.
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [anchorRef, stock.code]);

  const tone = change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat";

  // Unmounted rather than hidden, so nothing inside it stays in the tab order or keeps
  // observing while it's dismissed for the session.
  if (dismissed) return null;

  return (
    <div className={`mobile-stock-bar ${visible ? "is-visible" : ""}`} aria-hidden={!visible}>
      <div className="mobile-stock-bar-id">
        <StockIcon className="mobile-stock-bar-logo" code={stock.code} />
        <span className="mobile-stock-bar-name">{displayName}</span>
      </div>
      <div className={`mobile-stock-bar-price ${tone}`}>
        <span className="mobile-stock-bar-close">
          {close.toLocaleString()}
          {wonSuffix(lang)}
        </span>
        <span className="mobile-stock-bar-change">
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toLocaleString()} ({changePct >= 0 ? "+" : ""}
          {changePct}%)
        </span>
      </div>
      <FavoriteButton stock={stock} className="mobile-stock-bar-star" />
      <button
        type="button"
        className="mobile-stock-bar-dismiss"
        onClick={dismissMobileBar}
        aria-label={t("이번 접속 동안 숨기기")}
        title={t("이번 접속 동안 숨기기")}
      >
        ×
      </button>
    </div>
  );
}
