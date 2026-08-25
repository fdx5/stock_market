import { useEffect, useMemo, useState } from "react";
import type { StockUniverseMarket, StockUniverseRow, StockUniverseSort } from "../api/client";
import {
  ALL_SECTORS,
  DEFAULT_CODE,
  DEFAULT_MARKET,
  MarketSpec,
  displayName,
  marketSpec,
} from "../stocks/market";
import { useStockDetail, useStockRoster } from "../stocks/useStockData";
import { reportStockView, reportStocksEvent } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { Link } from "../router";
import NewBadge from "./NewBadge";
import DashboardIcon from "./DashboardIcon";
import EtfNavLink from "./EtfNavLink";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import StockListIcon from "./StockListIcon";
import StockDetailPanel from "./StockDetailPanel";
import StockRosterRail from "./StockRosterRail";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";
import "./stocksPage.css";

/* 종목정보 — a cap-ranked list of a market beside everything about one of its names.
 *
 * This component owns exactly three pieces of state (market, page, selected code) and
 * nothing else. The rail renders from them, the detail panel renders from the selected
 * row, and both refresh themselves on the 10s cadence in useStockData. Keeping the
 * fetching in hooks and the state here is what makes the selection rules below small
 * enough to state plainly:
 *
 *   - the page opens on KOSPI / 삼성전자, per spec;
 *   - changing market or page never clears the selection, because the panel is a
 *     reading surface and turning the page under it to find the next thing to read is
 *     a normal thing to do;
 *   - but a selection that has never resolved to a row must resolve to *something*, so
 *     the first roster that arrives without the wanted code selects its first row.
 */

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 180;

export default function StocksPage() {
  const [market, setMarket] = useState<StockUniverseMarket>(DEFAULT_MARKET);
  const [page, setPage] = useState(1);
  const [sector, setSector] = useState<string>(ALL_SECTORS);
  // Two values, not one. `search` is what the box shows and updates on every keystroke;
  // `query` is what the roster is actually fetched with, and lags it by SEARCH_DEBOUNCE_MS.
  // Fetching on every keystroke would put a request behind each of the four that compose
  // 삼성 — and a Korean IME emits one per jamo, so it is worse than it looks.
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<StockUniverseSort>("default");
  const [selected, setSelected] = useState<StockUniverseRow | null>(null);
  // What to select once a roster arrives, when there is no row in hand yet. Starts as
  // the spec's 삼성전자 and becomes null the moment a real row is chosen.
  const [wantedCode, setWantedCode] = useState<string | null>(DEFAULT_CODE);

  const spec: MarketSpec = useMemo(() => marketSpec(market), [market]);
  const roster = useStockRoster(market, page, PAGE_SIZE, sector, query, sort);

  // Debounce the box into the query. Short enough that it still reads as live typing —
  // the roster is a slice of a cached snapshot, so the response itself is immediate.
  useEffect(() => {
    if (search === query) return;
    const timer = window.setTimeout(() => {
      setQuery(search);
      // A different result set is a different list; staying on page 6 of the old one
      // would land past the end of almost any search.
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, query]);
  const detail = useStockDetail(selected, spec.currency === "USD");

  useDocumentTitle(
    selected ? `${selected.name} 종목정보 | K-Stock Hub` : "종목정보 | K-Stock Hub",
  );

  // Fill an empty panel from whatever roster page just loaded: the wanted code if this
  // page has it, otherwise the biggest name on it. Gated on `selected` being empty
  // rather than on `wantedCode` being set — the panel is only ever empty on first load
  // and on a market switch, and both need a row, but only the first has a code in mind.
  // (Gating on `wantedCode` left the S&P 500 tab showing a full rail beside a blank
  // panel, because switching market clears the code by design.)
  useEffect(() => {
    if (selected || !roster.page) return;
    const wanted = wantedCode ? roster.page.items.find((row) => row.code === wantedCode) : undefined;
    const next = wanted ?? roster.page.items[0];
    if (next) {
      setSelected(next);
      setWantedCode(null);
    }
  }, [selected, wantedCode, roster.page]);

  // Keep the open stock's own numbers in step with the rail's 10s refresh. Without
  // this the panel's fallbacks (market cap, PER, volume — the fields no quote carries)
  // stay frozen at whatever they were when it was opened.
  useEffect(() => {
    if (!selected || !roster.page) return;
    const fresh = roster.page.items.find((row) => row.code === selected.code);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [roster.page, selected]);

  const changeMarket = (next: MarketSpec) => {
    if (next.key === market) return;
    reportStocksEvent({ action: "market_switch", market: next.key, detail: next.label });
    setMarket(next.key);
    setPage(1);
    // A search is as market-specific as the 업종 labels are: "엔비디아" finds nothing on
    // KOSPI, and carrying it over would land the reader on an empty rail.
    setSearch("");
    setQuery("");
    // 업종 labels are per-market ("반도체/전자" is not an S&P 500 sector), so a filter
    // cannot survive the switch — carrying it over would silently produce an empty rail.
    setSector(ALL_SECTORS);
    setSort("default");
    // Drop the current row so the effect above adopts the new market's first name.
    // Keeping it would leave a KOSPI panel open under an S&P 500 rail.
    setSelected(null);
    setWantedCode(null);
  };

  const changeSector = (next: string) => {
    if (next === sector) return;
    reportStocksEvent({ action: "sector_filter", market, detail: next === ALL_SECTORS ? "전체" : next });
    setSector(next);
    // A filtered roster is a different list with a different length; staying on page 7
    // of it would land past the end of most sectors.
    setPage(1);
  };

  const changePage = (next: number) => {
    reportStocksEvent({ action: "page_change", market, detail: `${next}페이지` });
    setPage(next);
  };

  const changeSort = () => {
    setSort((current) => current === "change_asc" ? "change_desc" : "change_asc");
    setPage(1);
  };

  const selectRow = (row: StockUniverseRow) => {
    // Two events on purpose, and they answer different questions. The click feeds the
    // admin's 종목정보 action ranking (what do people do on this page); the stock_view
    // feeds the site-wide 인기 종목 ranking, which is a register of deliberate interest
    // in a company and already collects search selections and market-map tile clicks —
    // picking a name out of this rail is the same act.
    reportStocksEvent({ action: "stock_select", market, code: row.code, name: displayName(row) });
    reportStockView(row.code, displayName(row));
    setSelected(row);
    setWantedCode(null);
  };

  return (
    // A column that owns the viewport: the nav is fixed at the top and the two panels
    // divide what is left. Measuring the chrome instead of subtracting an assumed
    // height is what keeps the panels reaching the bottom of the window on every
    // screen — this page's whole premise is that both columns are on screen at once.
    <div className="app su-shell">
      <header className="app-header su-shell-head">
        <div className="app-title-row">
          <Link to="/" className="app-brand" aria-label="K-Stock Hub">
            <Logo className="app-logo-wide" />
          </Link>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        {/* The same row, in the same order, as every other page — with this page's own
            pill marked active rather than omitted, so the row does not reflow when a
            reader arrives here from one of them. */}
        <div className="app-nav-row">
          <Link to="/desk" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> 홈
          </Link>
          <Link to="/stocks" className="kospi-map-nav-link kospi-map-nav-link--stocks is-active">
            <StockListIcon /> 종목정보 <NewBadge />
          </Link>
          <Link to="/map" className="kospi-map-nav-link">
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          <Link to="/sp500-map" className="kospi-map-nav-link kospi-map-nav-link--sp500">
            <MarketIcon /> S&P500
          </Link>
          <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq">
            <MarketIcon /> NASDAQ100
          </Link>
          <EtfNavLink />
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> AI 예측
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> 글로벌 시총
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
          <VisitorBadge />
        </div>
      </header>

      <div className="su-page">
      <StockRosterRail
        spec={spec}
        data={roster.page}
        loading={roster.loading}
        error={roster.error}
        page={page}
        sector={sector}
        search={search}
        searching={search !== query || (roster.loading && Boolean(query))}
        sort={sort}
        selectedCode={selected?.code ?? ""}
        onMarketChange={changeMarket}
        onSelect={selectRow}
        onPageChange={changePage}
        onSectorChange={changeSector}
        onSearchChange={setSearch}
        onSortChange={changeSort}
      />
      {detail ? (
        <StockDetailPanel spec={spec} detail={detail} />
      ) : (
        <section className="su-detail su-detail--empty" aria-label="종목 상세 정보">
          <div className="su-empty">
            <span className="su-empty-mark" aria-hidden="true" />
            <p>왼쪽에서 종목을 선택하세요.</p>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
