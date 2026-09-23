import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { StockUniverseMarket, StockUniverseRow, StockUniverseSort } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { Link, navigate } from "../../router";
import {
  ALL_SECTORS,
  DEFAULT_CODE,
  MARKETS,
  MarketSpec,
  displayName,
  formatChange,
  formatMarketCap,
  formatPercent,
  formatPrice,
  formatVolume,
  marketSpec,
  pageWindow,
  toneOf,
} from "../../stocks/market";
import { useStockDetail, useStockRoster, withLiveClose } from "../../stocks/useStockData";
import { reportStockView, reportStocksEvent } from "../../useActivityTracking";
import { useDocumentTitle } from "../../useDocumentTitle";
import { useBodyScrollLock } from "../../useBodyScrollLock";
import { useMediaQuery } from "../../useMediaQuery";
import { useWatchlist } from "../../useWatchlist";
import StockLogo from "../../components/StockLogo";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, Skel } from "../parts";
import { useL } from "../lib";
import Discussion from "../reader/Discussion";
import News from "../reader/News";
import { useBroadsheet, useFinderHotkey } from "../shell";
import PreviewChart from "./PreviewChart";
import "../pages.css";

/* 종목정보 — the paper's stock tables, with a reading pane beside them.
 *
 * The classic page was a narrow rail of rows beside a detail panel, and most of what
 * a reader wanted to do took one step more than it should: the rail showed four
 * facts a row, the selection lived only in memory (reload, and you were back on
 * 삼성전자 page 1), there was no way from the panel to the company's own page, the
 * keyboard did nothing, and on a phone the panel sat below fifty rows.
 *
 * What changes:
 *  - the list is a real table — rank, name, price, move, size, volume, PER, ROE — so
 *    a row is compared rather than just located;
 *  - market, sector, search, page, sort and the open stock live in the URL, so the
 *    back button, a reload and a shared link all land where the reader was;
 *  - ↑/↓ walk the table and Enter opens the company page;
 *  - the reading pane has a clear way out to the full company page;
 *  - the biggest sectors are one tap away as chips, not buried in a select;
 *  - on a phone the pane opens as a sheet over the list and closes back to it.
 *
 * The data layer is the classic page's own (useStockRoster, useStockDetail): same
 * endpoint, same 10-second refresh, same server-side sector filter, 초성 search and
 * change sort. */

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 180;
const MARKET_KEYS = MARKETS.map((m) => m.key);

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const m = p.get("market") as StockUniverseMarket | null;
  const sort = p.get("sort") as StockUniverseSort | null;
  return {
    market: m && MARKET_KEYS.includes(m) ? m : ("kospi" as StockUniverseMarket),
    page: Math.max(1, Number(p.get("page")) || 1),
    sector: p.get("sector") || ALL_SECTORS,
    q: p.get("q") || "",
    sort: sort === "change_asc" || sort === "change_desc" ? sort : ("default" as StockUniverseSort),
    code: p.get("code") || (m ? null : DEFAULT_CODE),
  };
}

export default function StocksPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  const initial = useMemo(readUrl, []);
  const [market, setMarket] = useState<StockUniverseMarket>(initial.market);
  const [page, setPage] = useState(initial.page);
  const [sector, setSector] = useState(initial.sector);
  const [search, setSearch] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [sort, setSort] = useState<StockUniverseSort>(initial.sort);
  const [selected, setSelected] = useState<StockUniverseRow | null>(null);
  const [wanted, setWanted] = useState<string | null>(initial.code);
  const [tab, setTab] = useState<"talk" | "news">("talk");
  const [sheet, setSheet] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const narrow = useMediaQuery("(max-width: 960px)");
  const tableRef = useRef<HTMLDivElement>(null);
  const { recents } = useWatchlist();
  useFinderHotkey(setFinderOpen);
  useBodyScrollLock(narrow && sheet);

  const spec: MarketSpec = useMemo(() => marketSpec(market), [market]);
  const roster = useStockRoster(market, page, PAGE_SIZE, sector, query, sort);
  const detail = useStockDetail(selected, spec.currency === "USD");
  useDocumentTitle(selected ? `${displayName(selected)} 종목정보 | K-Stock Hub` : "종목정보 | K-Stock Hub");

  useEffect(() => {
    if (search === query) return;
    const t = window.setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search, query]);

  /* Keep the URL in step, without adding a history entry per keystroke. */
  useEffect(() => {
    const p = new URLSearchParams();
    if (market !== "kospi") p.set("market", market);
    if (page > 1) p.set("page", String(page));
    if (sector !== ALL_SECTORS) p.set("sector", sector);
    if (query) p.set("q", query);
    if (sort !== "default") p.set("sort", sort);
    if (selected) p.set("code", selected.code);
    const next = `/stocks${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [market, page, sector, query, sort, selected]);

  /* Fill an empty pane from the page that just arrived. */
  useEffect(() => {
    if (selected || !roster.page) return;
    const hit = wanted ? roster.page.items.find((r) => r.code === wanted) : undefined;
    const next = hit ?? roster.page.items[0];
    if (next) {
      setSelected(next);
      setWanted(null);
    }
  }, [selected, wanted, roster.page]);

  /* Keep the open row's own numbers fresh with the 10s refresh. */
  useEffect(() => {
    if (!selected || !roster.page) return;
    const fresh = roster.page.items.find((r) => r.code === selected.code);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [roster.page, selected]);

  useEffect(() => setTab("talk"), [selected?.code]);

  const changeMarket = (next: StockUniverseMarket) => {
    if (next === market) return;
    reportStocksEvent({ action: "market_switch", market: next, detail: marketSpec(next).label });
    setMarket(next);
    setPage(1);
    setSearch("");
    setQuery("");
    setSector(ALL_SECTORS);
    setSort("default");
    setSelected(null);
    setWanted(null);
  };
  const changeSector = (next: string) => {
    if (next === sector) return;
    reportStocksEvent({ action: "sector_filter", market, detail: next === ALL_SECTORS ? "전체" : next });
    setSector(next);
    setPage(1);
  };
  const changePage = (next: number) => {
    reportStocksEvent({ action: "page_change", market, detail: `${next}페이지` });
    setPage(next);
    tableRef.current?.scrollTo({ top: 0 });
  };
  const cycleSort = () => {
    setSort((s) => (s === "default" ? "change_desc" : s === "change_desc" ? "change_asc" : "default"));
    setPage(1);
  };
  const choose = (row: StockUniverseRow, openSheet = true) => {
    if (row.code !== selected?.code) {
      reportStocksEvent({ action: "stock_select", market, code: row.code, name: displayName(row) });
      reportStockView(row.code, displayName(row));
    }
    setSelected(row);
    setWanted(null);
    if (openSheet && narrow) setSheet(true);
  };
  const detailHref = (row: StockUniverseRow) => `/stock/${encodeURIComponent(row.code)}${spec.assetType === "etf" ? "?asset=ETF" : ""}`;

  const rows = roster.page?.items ?? [];
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.code === selected?.code);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        choose(next, false);
        tableRef.current?.querySelector<HTMLElement>(`[data-code="${next.code}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      navigate(detailHref(selected));
    }
  };

  const sectors = roster.page?.sectors ?? [];
  const allCount = sectors.reduce((s, x) => s + x.count, 0);
  const topSectors = sectors.slice(0, 8);
  const totalPages = roster.page?.total_pages ?? 1;
  const etf = spec.assetType === "etf";
  // PER/ROE ride along on the market-cap scrape and are sometimes missing for a
  // whole market; a column of dashes says nothing, so it is only set when it has data.
  const ratios = !etf && rows.some((r) => r.per != null || r.roe != null);

  const close = detail?.quote?.close ?? selected?.close ?? null;
  const change = detail?.quote?.change ?? selected?.change ?? null;
  const changePct = detail?.quote?.change_pct ?? selected?.change_pct ?? null;
  const tone = toneOf(changePct);

  const pane = selected ? (
    <section className={`st-pane is-${tone}`} aria-label={displayName(selected)}>
      <header className="st-pane-head">
        <StockLogo code={selected.code} name={displayName(selected)} className="st-pane-logo" assetType={spec.assetType} />
        <div>
          <p className="sk-kicker">
            <span>{spec.label}</span>
            {selected.sector && <span>{selected.sector}</span>}
            <span>
              {etf ? L("거래대금", "Turnover") : L("시총", "Cap")} {selected.rank}
              {L("위", "")}
            </span>
          </p>
          <h2>
            {displayName(selected)} <small className="st-pane-code">{selected.code}</small>
          </h2>
        </div>
        <div className={`st-pane-price is-${tone}`}>
          <b>
            {formatPrice(close, spec.currency)}
            <small>{spec.currency === "KRW" ? L("원", "KRW") : "USD"}</small>
          </b>
          <span>
            {formatChange(change, spec.currency)} <em>{formatPercent(changePct)}</em>
          </span>
        </div>
        {sheet && (
          <button type="button" className="st-sheet-close" onClick={() => setSheet(false)} aria-label={L("닫기", "Close")}>
            ×
          </button>
        )}
      </header>
      <dl className="st-pane-facts">
        <div>
          <dt>{etf ? L("거래대금", "Turnover") : L("시가총액", "Market cap")}</dt>
          <dd>{formatMarketCap(selected.marcap, spec.currency)}</dd>
        </div>
        <div>
          <dt>{L("거래량", "Volume")}</dt>
          <dd>{formatVolume(selected.volume)}</dd>
        </div>
        <div>
          <dt>{etf ? L("자산", "Asset") : "PER"}</dt>
          <dd>{etf ? "ETF" : selected.per != null && Number.isFinite(selected.per) ? selected.per.toFixed(2) : "—"}</dd>
        </div>
        <div>
          <dt>{etf ? L("시장", "Market") : "ROE"}</dt>
          <dd>{etf ? spec.caption : selected.roe != null && Number.isFinite(selected.roe) ? `${selected.roe.toFixed(2)}%` : "—"}</dd>
        </div>
      </dl>
      {/* The chart is a glance here — the reading below is what the pane is for;
          the full chart is one click away on the company page. */}
      <PreviewChart compact points={withLiveClose(detail?.history ?? [], close)} tone={tone} currency={spec.currency} loading={detail?.historyLoading ?? true} />
      <Link to={detailHref(selected)} className="st-pane-cta">
        <span>{L("종목면 전체 보기", "Open the full company page")}</span>
        <small>{L("차트 · 지표 · 수급 · 호가 · 뉴스 · 토론", "Chart · indicators · flows · depth · news · talk")}</small>
        <b aria-hidden="true">→</b>
      </Link>
      <Marker
        className="st-pane-tabs"
        options={[
          { id: "talk", label: L("종목토론", "Discussion") },
          { id: "news", label: L("뉴스", "News") },
        ]}
        value={tab}
        onChange={(t) => {
          reportStocksEvent({ action: "tab_switch", market, code: selected.code, name: displayName(selected), detail: t === "talk" ? "종목토론" : "뉴스" });
          setTab(t);
        }}
        label={L("상세 탭", "Detail tabs")}
      />
      <div className="st-pane-body">
        {tab === "talk" ? (
          <Discussion key={`d-${selected.code}`} code={selected.code} name={displayName(selected)} source={spec.discussion} track={market} sheet />
        ) : (
          <News key={`n-${selected.code}`} code={selected.code} name={displayName(selected)} source={spec.news} track={market} />
        )}
      </div>
    </section>
  ) : (
    <section className="st-pane st-pane--empty">
      <Skel h={40} w="60%" />
      <Skel h={30} w="40%" />
      <Skel h={220} />
    </section>
  );

  return (
    <div className="d2 st" lang={lang}>
      <a className="d2-skip" href="#st-table">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "종목정보", en: "Stocks", taglineKo: "시장의 모든 종목을 한 표에 — 고르고, 견주고, 펼쳐 보기", taglineEn: "Every listed name in one table — pick, compare, open" }}
      />

      <div className="d2-cmd st-bar" data-d2-sticky>
        <div className="d2-cmd-inner st-bar-inner">
          <Marker
            className="st-markets"
            options={MARKETS.map((m) => ({
              id: m.key,
              label: (
                <>
                  <img src={`/img/flag/${m.flag}.svg`} alt="" />
                  {m.label}
                </>
              ),
            }))}
            value={market}
            onChange={changeMarket}
            label={L("시장", "Market")}
          />
          <label className="st-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={L(`${spec.label}에서 찾기 · 초성 가능 (ㅅㅅㅈㅈ)`, `Search ${spec.label}`)}
              aria-label={L("종목명 검색", "Search by name")}
              autoComplete="off"
              spellCheck={false}
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label={L("검색어 지우기", "Clear")}>
                ×
              </button>
            )}
          </label>
          <button type="button" className="d2-cmd-find" onClick={() => setFinderOpen(true)}>
            <span className="d2-cmd-find-glyph" aria-hidden="true">
              ⌕
            </span>
            <span className="d2-cmd-find-text">{L("전체 시장 찾기", "Search all markets")}</span>
            <kbd>/</kbd>
          </button>
        </div>
      </div>

      <main className="d2-main st-main">
        <div className="st-filters">
          <div className="st-chips" role="group" aria-label={L("업종", "Sector")}>
            <button type="button" className={sector === ALL_SECTORS ? "is-on" : ""} onClick={() => changeSector(ALL_SECTORS)}>
              {L("전체", "All")}
              {allCount > 0 && <small>{allCount.toLocaleString()}</small>}
            </button>
            {topSectors.map((s) => (
              <button key={s.sector} type="button" className={sector === s.sector ? "is-on" : ""} onClick={() => changeSector(s.sector)}>
                {s.sector}
                <small>{s.count}</small>
              </button>
            ))}
            {sectors.length > topSectors.length && (
              <select value={topSectors.some((s) => s.sector === sector) || sector === ALL_SECTORS ? "" : sector} onChange={(e) => e.target.value && changeSector(e.target.value)} aria-label={L("업종 더 보기", "More sectors")}>
                <option value="">{L(`업종 더 보기 (${sectors.length - topSectors.length})`, `More sectors (${sectors.length - topSectors.length})`)}</option>
                {sectors.slice(topSectors.length).map((s) => (
                  <option key={s.sector} value={s.sector}>
                    {s.sector} ({s.count})
                  </option>
                ))}
              </select>
            )}
          </div>
          {recents.length > 0 && (
            <nav className="sk-recents st-recents" aria-label={L("최근 본 종목", "Recently viewed")}>
              <span>{L("최근 본 종목", "Recent")}</span>
              {recents.slice(0, 8).map((r) => (
                <Link key={r.code} to={`/stock/${r.code}`}>
                  {r.name}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="st-grid">
          <section className="st-list" aria-label={L("종목 시세표", "Stock table")}>
            <header className="st-list-head">
              <h2>
                {spec.label} <small>{spec.caption}</small>
              </h2>
              <p>
                {query || sector !== ALL_SECTORS ? L("검색 결과", "Results") : etf ? L("거래대금순", "By turnover") : L("시가총액순", "By market cap")}
                {roster.page && (
                  <b>
                    {roster.page.total.toLocaleString()}
                    {L("종목", " names")}
                  </b>
                )}
                <span className="st-hint">{L("↑↓ 이동 · Enter 종목면", "↑↓ move · Enter opens")}</span>
              </p>
            </header>
            <div className="st-table-wrap" id="st-table" ref={tableRef} tabIndex={0} onKeyDown={onKeys} role="region" aria-label={L("종목 표 — 방향키로 이동", "Stock table — use arrow keys")}>
              <table className="st-table">
                <thead>
                  <tr>
                    <th className="is-rank">#</th>
                    <th className="is-name">{L("종목", "Name")}</th>
                    <th>{L("현재가", "Price")}</th>
                    <th aria-sort={sort === "change_desc" ? "descending" : sort === "change_asc" ? "ascending" : undefined}>
                      <button type="button" className={sort !== "default" ? "is-sorted" : ""} onClick={cycleSort} title={L("전체 종목을 등락률로 정렬", "Sort the whole market by change")}>
                        {L("등락률", "Change")}
                        <i aria-hidden="true">{sort === "change_desc" ? "↓" : sort === "change_asc" ? "↑" : "↕"}</i>
                      </button>
                    </th>
                    <th className="is-opt">{etf ? L("거래대금", "Turnover") : L("시가총액", "Market cap")}</th>
                    <th className="is-opt">{L("거래량", "Volume")}</th>
                    {ratios && <th className="is-opt2">PER</th>}
                    {ratios && <th className="is-opt2">ROE</th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.loading &&
                    Array.from({ length: 14 }, (_, i) => (
                      <tr key={i} aria-hidden="true">
                        <td colSpan={8}>
                          <Skel h={16} />
                        </td>
                      </tr>
                    ))}
                  {!roster.loading && roster.error && (
                    <tr>
                      <td colSpan={8} className="d2-empty">
                        {roster.error}
                      </td>
                    </tr>
                  )}
                  {!roster.loading && !roster.error && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="d2-empty">
                        {query ? L(`"${query}" 검색 결과가 없습니다.`, `Nothing matches "${query}".`) : L("해당하는 종목이 없습니다.", "No names here.")}
                      </td>
                    </tr>
                  )}
                  {!roster.loading &&
                    rows.map((r) => {
                      const t = toneOf(r.change_pct);
                      const on = r.code === selected?.code;
                      return (
                        <tr key={r.code} data-code={r.code} className={on ? "is-on" : ""} onClick={() => choose(r)} aria-selected={on}>
                          <td className="is-rank">{r.rank}</td>
                          <td className="is-name">
                            <span className="st-name">
                              <StockLogo code={r.code} name={displayName(r)} className={`st-logo${r.logo_dark ? " is-plate" : ""}`} assetType={spec.assetType} />
                              <span>
                                <b>{displayName(r)}</b>
                                <small>
                                  {r.code}
                                  {r.sector && ` · ${r.sector}`}
                                </small>
                              </span>
                            </span>
                          </td>
                          <td className="d2-num">{formatPrice(r.close, spec.currency)}</td>
                          <td className={`d2-num is-${t}`}>{formatPercent(r.change_pct)}</td>
                          <td className="d2-num is-opt">{formatMarketCap(r.marcap, spec.currency)}</td>
                          <td className="d2-num is-opt">{formatVolume(r.volume)}</td>
                          {ratios && <td className="d2-num is-opt2">{r.per != null && Number.isFinite(r.per) ? r.per.toFixed(1) : "—"}</td>}
                          {ratios && <td className="d2-num is-opt2">{r.roe != null && Number.isFinite(r.roe) ? `${r.roe.toFixed(1)}%` : "—"}</td>}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <nav className="st-pager" aria-label={L("페이지", "Pages")}>
              <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} aria-label={L("이전 페이지", "Previous page")}>
                ←
              </button>
              <ol>
                {pageWindow(page, totalPages).map((p, i) =>
                  p == null ? (
                    <li key={`g${i}`} aria-hidden="true">
                      …
                    </li>
                  ) : (
                    <li key={p}>
                      <button type="button" className={p === page ? "is-on" : ""} aria-current={p === page ? "page" : undefined} onClick={() => changePage(p)}>
                        {p}
                      </button>
                    </li>
                  )
                )}
              </ol>
              <button type="button" disabled={page >= totalPages} onClick={() => changePage(page + 1)} aria-label={L("다음 페이지", "Next page")}>
                →
              </button>
            </nav>
          </section>

          {!narrow && <div className="st-pane-col">{pane}</div>}
        </div>
      </main>

      {narrow && sheet && (
        <div className="st-sheet" role="dialog" aria-modal="true" aria-label={selected ? displayName(selected) : ""}>
          {pane}
        </div>
      )}

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
