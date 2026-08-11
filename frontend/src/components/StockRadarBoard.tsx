import { useEffect, useRef, useState } from "react";
import { StockQuote, StockSearchResult, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { wonSuffix } from "../i18n/format";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { usePopularStocks } from "../usePopularStocks";
import { StoredStock, getRecents, subscribeWatchlist } from "../watchlist";
import StockLogo from "./StockLogo";

/* 종목 레이더 — what the room is looking at, and what you were looking at.
 *
 * Two tabs over the same row shape. 실시간 인기 is the most-viewed stocks across
 * every visitor in the last 24 hours, which is the one number on this page that
 * is about the crowd rather than about the market; 최근 본 종목 is this browser's
 * own trail. Both already existed as chips in the quick-access strip up in the
 * command deck — a chip is a name and a link, and the question somebody has
 * while looking at a ranked list of stocks is what they are *doing*. So it is
 * the same two lists with a live price against each row.
 *
 * Capped, and the cap is the design constraint rather than a tidiness rule:
 * each row is its own /quote call, so a long list is a long list of requests
 * every fifteen seconds from every open tab. Eight is enough to be a board and
 * few enough that the poll costs about what the stock header already costs. */

const POLL_MS = 15_000;
const MAX_ROWS = 8;

type Mode = "popular" | "recents";

export default function StockRadarBoard({
  onSelect,
  activeCode,
  market,
}: {
  onSelect: (stock: StockSearchResult) => void;
  activeCode?: string;
  /* Which side of the world this board is on.
   *
   * Undefined is the KR desk: the combined popular ranking, and every recent the
   * browser holds. "US" is the global desk, where the brief is that no KR market
   * information appears at all — so the ranking is asked for US-only (the backend
   * filters a deeper pool; see /search/popular) and the recents are filtered to
   * US tickers, since that list mixes both markets by construction. */
  market?: "US";
}) {
  const t = useT();
  const { lang } = useLanguage();
  const [mode, setMode] = useState<Mode>("popular");
  const [recents, setRecents] = useState<StoredStock[]>(() => getRecents());
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const popular = usePopularStocks(MAX_ROWS, market);

  useEffect(() => subscribeWatchlist(() => setRecents(getRecents())), []);

  /* The rows, normalised to one shape so the list below does not care which tab
     produced them. `rank` is only meaningful on the popular tab — it is the
     crowd's ordering, and on a personal trail a number would imply a ranking
     that is really just recency. */
  const rows: { code: string; name: string; market: string; rank: number | null }[] =
    mode === "popular"
      ? (popular ?? []).slice(0, MAX_ROWS).map((item, index) => ({
          code: item.code,
          name: item.name,
          market: item.market,
          rank: index + 1,
        }))
      : recents
          .filter((item) => (market === "US" ? item.market === "US" : true))
          .slice(0, MAX_ROWS)
          .map((item) => ({
            code: item.code,
            name: item.name,
            market: item.market,
            rank: null,
          }));

  const names = useTranslatedTexts(rows.map((row) => row.name));
  const loadingPopular = mode === "popular" && popular === null;

  // A stable key, so the poll re-runs when the *set* of codes changes rather
  // than on every render that hands it a freshly built array.
  const codeKey = rows.map((r) => r.code).join(",");
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;

  useEffect(() => {
    if (!codeKey) return;
    const codes = codeKey.split(",");
    let cancelled = false;

    const poll = () => {
      for (const code of codes) {
        (market === "US" ? api.usStockQuote(code) : api.quote(code))
          .then((quote) => {
            if (cancelled) return;
            setQuotes((prev) => ({ ...prev, [code]: quote as StockQuote }));
          })
          .catch(() => {
            // One row failing keeps its last price rather than emptying the board.
          });
      }
    };

    poll();
    const stop = startVisibilityAwareInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [codeKey, market]);

  return (
    <section className="desk-radar" aria-labelledby="desk-radar-title">
      <div className="desk-card-head">
        <h3 id="desk-radar-title">{t("종목 레이더")}</h3>
        <div className="desk-seg" role="tablist" aria-label={t("종목 레이더")}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "popular"}
            className={mode === "popular" ? "is-on" : ""}
            onClick={() => setMode("popular")}
          >
            🔥 {t("실시간 인기")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "recents"}
            className={mode === "recents" ? "is-on" : ""}
            onClick={() => setMode("recents")}
          >
            {t("최근 본 종목")}
          </button>
        </div>
      </div>

      {rows.length === 0 && !loadingPopular ? (
        <p className="desk-radar-empty">
          {mode === "popular"
            ? t("아직 집계된 인기 종목이 없습니다.")
            : t("최근 살펴본 종목이 여기에 쌓입니다.")}
        </p>
      ) : (
        <ul className="desk-radar-list">
          {loadingPopular
            ? Array.from({ length: 6 }, (_, i) => (
                <li key={`s-${i}`}>
                  <span className="desk-radar-row is-skeleton" aria-hidden="true">
                    <span className="skeleton" style={{ height: 15 }} />
                  </span>
                </li>
              ))
            : rows.map((row, index) => {
                const quote = quotes[row.code];
                const changePct = quote?.change_pct;
                const tone =
                  changePct === undefined ? "flat" : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
                return (
                  <li key={row.code}>
                    <button
                      type="button"
                      className={`desk-radar-row is-${tone} ${activeCode === row.code ? "is-active" : ""}`}
                      onClick={() =>
                        onSelect({ code: row.code, name: row.name, market: row.market })
                      }
                      title={`${row.name} (${row.code})`}
                    >
                      {row.rank !== null ? (
                        <span className={`desk-radar-rank ${row.rank <= 3 ? "is-top" : ""}`}>
                          {row.rank}
                        </span>
                      ) : (
                        <span className="desk-radar-rank is-blank" aria-hidden="true" />
                      )}
                      <StockLogo code={row.code} className="desk-radar-logo" />
                      <span className="desk-radar-name">{names[index] ?? row.name}</span>
                      {quote ? (
                        <>
                          <span className="desk-radar-price">
                            {market === "US"
                              ? `$${quote.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                              : `${quote.close.toLocaleString()}${wonSuffix(lang)}`}
                          </span>
                          <span className={`desk-radar-pct change-${tone}`}>
                            {quote.change_pct >= 0 ? "+" : ""}
                            {quote.change_pct}%
                          </span>
                        </>
                      ) : (
                        <span className="skeleton desk-radar-skeleton" aria-hidden="true" />
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
