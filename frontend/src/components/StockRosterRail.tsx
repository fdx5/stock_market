import type { StockUniversePage, StockUniverseRow } from "../api/client";
import {
  ALL_SECTORS,
  MARKETS,
  MarketSpec,
  displayName,
  formatMarketCap,
  formatPercent,
  formatPrice,
  pageWindow,
  toneOf,
} from "../stocks/market";
import StockLogo from "./StockLogo";

/* The left rail: one market's cap ranking, 50 rows at a time.
 *
 * Every row is the same four facts in the same four places — rank, identity, price,
 * move — because the rail's job is to be scanned, not read. The one thing allowed to
 * vary is colour, and only on the move.
 *
 * Row content is deliberately not conditional on market. The backend hands over one
 * normalised shape (services/stock_universe_page.py), so a KOSPI row and an S&P 500
 * row differ here only by the currency their numbers are printed in.
 */

interface Props {
  spec: MarketSpec;
  data: StockUniversePage | null;
  loading: boolean;
  error: string;
  page: number;
  sector: string;
  /** The raw input value, not the debounced term the roster was fetched with — the box
   *  has to echo every keystroke back immediately whatever the request is doing. */
  search: string;
  searching: boolean;
  selectedCode: string;
  onMarketChange: (market: MarketSpec) => void;
  onSelect: (row: StockUniverseRow) => void;
  onPageChange: (page: number) => void;
  onSectorChange: (sector: string) => void;
  onSearchChange: (value: string) => void;
}

export default function StockRosterRail({
  spec,
  data,
  loading,
  error,
  page,
  sector,
  search,
  searching,
  selectedCode,
  onMarketChange,
  onSelect,
  onPageChange,
  onSectorChange,
  onSearchChange,
}: Props) {
  const totalPages = data?.total_pages ?? 1;
  const rows = data?.items ?? [];
  const allCount = (data?.sectors ?? []).reduce((sum, option) => sum + option.count, 0);

  return (
    <section className="su-rail" aria-label="종목 목록">
      <header className="su-rail-head">
        <div className="su-rail-title">
          <h1>종목정보</h1>
          <p>
            {search || sector !== ALL_SECTORS ? "검색 결과" : "시가총액순"}
            {data ? <em>{data.total.toLocaleString()}종목</em> : null}
          </p>
        </div>
        <nav className="su-tabs" role="tablist" aria-label="시장 선택" data-track="self">
          {MARKETS.map((market) => (
            <button
              key={market.key}
              type="button"
              role="tab"
              aria-selected={market.key === spec.key}
              className={market.key === spec.key ? "is-active" : ""}
              onClick={() => onMarketChange(market)}
            >
              <strong>{market.label}</strong>
              <small>{market.caption}</small>
            </button>
          ))}
        </nav>
      </header>

      {/* The 업종 filter sits under the market tabs and above the column heads, because
          it narrows what those heads label. Server-side (see the endpoint): filtering 50
          rows client-side would search one page of a ten-page market and call it a
          market. */}
      <div className="su-rail-filter" data-track="self">
        <label className="su-sector-filter">
          <span>업종</span>
          <select value={sector} onChange={(e) => onSectorChange(e.target.value)} aria-label="업종 필터">
            {/* The whole market's count, summed from the sector options — `data.total`
                is the *filtered* total, so reading it here would relabel 전체 as 55
                the moment 반도체/전자 was chosen. */}
            <option value={ALL_SECTORS}>전체{allCount ? ` (${allCount.toLocaleString()})` : ""}</option>
            {(data?.sectors ?? []).map((option) => (
              <option key={option.sector} value={option.sector}>
                {option.sector} ({option.count})
              </option>
            ))}
          </select>
        </label>
        {sector !== ALL_SECTORS && (
          <button type="button" className="su-sector-clear" onClick={() => onSectorChange(ALL_SECTORS)}>
            필터 해제
          </button>
        )}
      </div>

      {/* Name search, under the 업종 filter and narrowing within it. Server-side like the
          sector, and for the same reason: the client holds 50 of 500 rows, so searching
          them would search one page and call it the market. */}
      <div className="su-rail-search" data-track="self">
        <span className="su-rail-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="종목명 검색 · 초성 가능 (ㅅㅅㅈㅈ)"
          aria-label="종목명 검색"
          // Korean IMEs compose a syllable across several keystrokes; the browser fires
          // `change` on the composed value either way, and letting the field manage its
          // own composition is what makes 초성 typing work at all.
          autoComplete="off"
          spellCheck={false}
        />
        {searching && <i className="su-rail-search-spin" aria-hidden="true" />}
        {search && (
          <button type="button" className="su-rail-search-clear" aria-label="검색어 지우기" onClick={() => onSearchChange("")}>
            ×
          </button>
        )}
      </div>

      <div className="su-rail-columns" aria-hidden="true">
        <span>종목</span>
        <span>현재가</span>
        <span>등락률</span>
      </div>

      <div className="su-rail-scroll" data-track="self">
        {loading && (
          <ul className="su-rail-list su-rail-list--skeleton">
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i}>
                <span className="su-skeleton su-skeleton--logo" />
                <span className="su-skeleton su-skeleton--text" />
                <span className="su-skeleton su-skeleton--num" />
              </li>
            ))}
          </ul>
        )}
        {!loading && error && <p className="su-rail-message">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="su-rail-message">
            {search
              ? `"${search}" 검색 결과가 없습니다.`
              : sector === ALL_SECTORS
                ? "표시할 종목이 없습니다."
                : "이 업종에 해당하는 종목이 없습니다."}
          </p>
        )}

        {!loading && rows.length > 0 && (
          <ul className="su-rail-list">
            {rows.map((row) => {
              const tone = toneOf(row.change_pct);
              const selected = row.code === selectedCode;
              return (
                <li key={row.code}>
                  <button
                    type="button"
                    className={`su-row su-row--${tone}${selected ? " is-selected" : ""}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(row)}
                  >
                    <span className="su-row-rank">{row.rank}</span>
                    <StockLogo
                      code={row.code}
                      name={displayName(row)}
                      className={`su-row-logo${row.logo_dark ? " su-logo-plate" : ""}`}
                    />
                    <span className="su-row-identity">
                      <strong>{displayName(row)}</strong>
                      <small>
                        {row.code}
                        {row.sector ? <i>{row.sector}</i> : null}
                      </small>
                    </span>
                    <span className="su-row-price">
                      <strong>{formatPrice(row.close, spec.currency)}</strong>
                      <small>{formatMarketCap(row.marcap, spec.currency)}</small>
                    </span>
                    <span className="su-row-change">{formatPercent(row.change_pct)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <nav className="su-pager" aria-label="종목 목록 페이지" data-track="self">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="이전 페이지">
          ‹
        </button>
        <ol>
          {pageWindow(page, totalPages).map((entry, index) =>
            entry == null ? (
              <li key={`gap-${index}`} className="su-pager-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={entry}>
                <button
                  type="button"
                  className={entry === page ? "is-active" : ""}
                  aria-current={entry === page ? "page" : undefined}
                  onClick={() => onPageChange(entry)}
                >
                  {entry}
                </button>
              </li>
            ),
          )}
        </ol>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="다음 페이지"
        >
          ›
        </button>
      </nav>
    </section>
  );
}
