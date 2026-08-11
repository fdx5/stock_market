import { useEffect, useRef, useState } from "react";
import { StockQuote, StockSearchResult, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { wonSuffix } from "../i18n/format";
import { startVisibilityAwareInterval } from "../pollVisibility";
import {
  StoredStock,
  getFavorites,
  getRecents,
  subscribeWatchlist,
  toSearchResult,
} from "../watchlist";
import StockIcon from "./StockIcon";

/* The reader's own list, priced live.
 *
 * The stars and the recents already existed — FavoriteButton writes them and
 * StockQuickAccess draws them as a row of chips — but a chip is a name and a
 * link, and the question somebody stars a stock in order to ask is "what is it
 * doing". So this is the same list with a price against it, polled.
 *
 * Deliberately capped, and the cap is the whole design constraint: each row is
 * its own /quote call, so twenty stars would be twenty requests every fifteen
 * seconds from every open tab. Eight is enough to be a watchlist and few enough
 * that the poll costs about what the stock detail header already costs. The
 * rest of the stars stay reachable in the quick-access row above. */

const POLL_MS = 15_000;
const MAX_ROWS = 8;

type Mode = "favorites" | "recents";

export default function WatchlistBoard({
  onSelect,
  activeCode,
}: {
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const [mode, setMode] = useState<Mode>("favorites");
  const [favorites, setFavorites] = useState<StoredStock[]>(() => getFavorites());
  const [recents, setRecents] = useState<StoredStock[]>(() => getRecents());
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});

  useEffect(() => {
    const sync = () => {
      setFavorites(getFavorites());
      setRecents(getRecents());
    };
    return subscribeWatchlist(sync);
  }, []);

  /* Falls back to the recents tab on a first visit rather than showing an empty
     star list with nothing in it — somebody who has never starred anything has
     usually still looked at something, and an empty panel teaches nothing. Only
     on mount: flipping the tab out from under a reader who chose it would be
     worse than the empty state it avoids. */
  const decidedRef = useRef(false);
  useEffect(() => {
    if (decidedRef.current) return;
    if (favorites.length === 0 && recents.length > 0) setMode("recents");
    if (favorites.length > 0 || recents.length > 0) decidedRef.current = true;
  }, [favorites, recents]);

  const rows = (mode === "favorites" ? favorites : recents).slice(0, MAX_ROWS);
  // A stable key for the effect below, so it re-runs when the *set* of codes
  // changes and not on every re-render that hands it a fresh array.
  const codeKey = rows.map((r) => r.code).join(",");

  useEffect(() => {
    if (!codeKey) return;
    const codes = codeKey.split(",");
    let cancelled = false;

    const poll = () => {
      for (const code of codes) {
        api
          .quote(code)
          .then((quote) => {
            if (cancelled) return;
            setQuotes((prev) => ({ ...prev, [code]: quote }));
          })
          .catch(() => {
            // One row failing keeps its last price rather than emptying the list.
          });
      }
    };

    poll();
    const stop = startVisibilityAwareInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [codeKey]);

  return (
    <section className="desk-watch" aria-labelledby="desk-watch-title">
      <div className="desk-card-head">
        <h3 id="desk-watch-title">{t("내 종목")}</h3>
        <div className="desk-seg" role="tablist" aria-label={t("내 종목")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "favorites"}
            className={mode === "favorites" ? "is-on" : ""}
            onClick={() => {
              decidedRef.current = true;
              setMode("favorites");
            }}
          >
            ★ {t("관심")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "recents"}
            className={mode === "recents" ? "is-on" : ""}
            onClick={() => {
              decidedRef.current = true;
              setMode("recents");
            }}
          >
            {t("최근")}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="desk-watch-empty">
          {mode === "favorites"
            ? t("종목 상세에서 ★를 누르면 여기에 모입니다.")
            : t("최근 살펴본 종목이 여기에 쌓입니다.")}
        </p>
      ) : (
        <ul className="desk-watch-list">
          {rows.map((stock) => {
            const quote = quotes[stock.code];
            const changePct = quote?.change_pct;
            const tone =
              changePct === undefined ? "flat" : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
            return (
              <li key={stock.code}>
                <button
                  type="button"
                  className={`desk-watch-row is-${tone} ${activeCode === stock.code ? "is-active" : ""}`}
                  onClick={() => onSelect(toSearchResult(stock))}
                >
                  <StockIcon code={stock.code} className="desk-watch-logo" />
                  <span className="desk-watch-name">{stock.name || stock.code}</span>
                  {quote ? (
                    <>
                      <span className="desk-watch-price">
                        {quote.close.toLocaleString()}
                        {wonSuffix(lang)}
                      </span>
                      <span className={`desk-watch-pct change-${tone}`}>
                        {quote.change_pct >= 0 ? "+" : ""}
                        {quote.change_pct}%
                      </span>
                    </>
                  ) : (
                    <span className="skeleton desk-watch-skeleton" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
