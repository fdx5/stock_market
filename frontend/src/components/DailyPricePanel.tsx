import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { DailyPricePoint, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { MOBILE_QUERY, useMediaQuery } from "../useMediaQuery";

const PAGE_SIZE = 20;

/** KRW figures are read in 만/억/조 by a Korean audience and in K/M/B/T by an English
 * one — and either way the raw digits (6,657,322,513,333) are far too wide for the
 * eight columns this table has to fit into a side rail. */
function compactKrw(value: number, lang: "ko" | "en"): string {
  if (lang === "en") {
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return Math.round(value).toLocaleString();
  }
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}조`;
  if (value >= 1e8) return `${Math.round(value / 1e8).toLocaleString()}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}만`;
  return Math.round(value).toLocaleString();
}

/** US rows carry dollars, which have no 억/조 reading — always the K/M/B/T scale. */
function compactUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

function compactCount(value: number, lang: "ko" | "en"): string {
  if (lang === "en") {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toLocaleString();
  }
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}만`;
  return value.toLocaleString();
}

/** "2026-07-24" -> "07.24" — the year is dropped because the table is read as a run of
 * recent sessions, and repeated on every row it would cost a column's worth of width
 * for no information. The full date stays in each cell's `title`. */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${month}.${day}` : date;
}

type Market = "KR" | "US";

/** Prices print to 2 decimals in USD and as whole won in KRW. */
function formatPrice(value: number, market: Market): string {
  return market === "US"
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(value).toLocaleString();
}

function changeClass(change: number): string {
  return change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat";
}

/**
 * The 일별 시세 table — one row per session, newest first.
 *
 * Paging is deliberately split by device: a phone auto-loads the next page when the
 * end of the list scrolls into view (an IntersectionObserver on the sentinel below the
 * rows), while desktop keeps an explicit 더보기 button. On desktop the list sits in a
 * height-capped, independently scrolling rail beside the chart — auto-loading there
 * would make that rail grow without the visitor ever asking it to.
 */
export default function DailyPricePanel({ code, market = "KR" }: { code: string; market?: Market }) {
  const t = useT();
  const { lang } = useLanguage();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [rows, setRows] = useState<DailyPricePoint[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guards the auto-load path against firing twice for the same page: the observer can
  // re-trigger while a request is already in flight (state hasn't committed yet), and
  // `loadingMore` alone is a render behind.
  const inFlightRef = useRef(false);
  // A stock switch has to invalidate any page still in flight for the previous code,
  // otherwise its rows would append onto the new stock's list.
  const codeRef = useRef(code);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  // Index of the first row a "더보기" click added, parked here until the rows it refers
  // to have actually rendered — see the effect below.
  const pendingRevealIndex = useRef<number | null>(null);

  const fetchPage = useCallback(
    (offset: number) => (market === "US" ? api.usDailyPrices(code, offset, PAGE_SIZE) : api.dailyPrices(code, offset, PAGE_SIZE)),
    [code, market]
  );

  useEffect(() => {
    codeRef.current = code;
    let cancelled = false;
    setRows([]);
    setHasMore(false);
    setError(null);
    setLoading(true);
    inFlightRef.current = false;
    pendingRevealIndex.current = null;

    fetchPage(0)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setHasMore(res.has_more);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "일별 시세를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPage, code]);

  const loadMore = useCallback((reveal = false) => {
    if (inFlightRef.current || !hasMore) return;
    inFlightRef.current = true;
    const requestedFor = codeRef.current;
    const offset = rows.length;
    // Desktop's list is a capped scroller and the button sits below it, so appending
    // rows moves nothing on screen — the click would read as having done nothing.
    // The mobile path is already scroll-driven and must not be yanked.
    if (reveal) pendingRevealIndex.current = offset;
    setLoadingMore(true);

    fetchPage(offset)
      .then((res) => {
        if (codeRef.current !== requestedFor) return;
        setRows((prev) => [...prev, ...res.items]);
        setHasMore(res.has_more);
      })
      .catch(() => {
        // Leaves the list as-is; the button (or the next scroll) can retry.
        pendingRevealIndex.current = null;
      })
      .finally(() => {
        inFlightRef.current = false;
        if (codeRef.current === requestedFor) setLoadingMore(false);
      });
  }, [fetchPage, hasMore, rows.length]);

  useEffect(() => {
    const revealIndex = pendingRevealIndex.current;
    if (revealIndex === null) return;
    pendingRevealIndex.current = null;
    const target = rows[revealIndex];
    if (!target) return;
    // "nearest" rather than "start": the row only has to become visible, and the
    // sticky header would otherwise cover it.
    rowRefs.current.get(target.date)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [rows]);

  useEffect(() => {
    if (!isMobile || !hasMore || loading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // The rows keep their own capped scroller on a phone (same reasoning as
    // .board-list: the panel should stay one section of the page, not become the
    // page), so the sentinel is watched against that scroller rather than the
    // viewport — with the viewport as root it would sit permanently off-screen below
    // the cap and never fire. The small margin pre-fetches about two rows early so
    // the next page is usually already in place at the bottom instead of a spinner.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: scrollerRef.current, rootMargin: "80px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isMobile, hasMore, loading, loadMore]);

  if (loading) return <div className="daily-price-status">{t("불러오는 중...")}</div>;
  if (error) return <div className="daily-price-status error-state">{t(error)}</div>;
  if (rows.length === 0) return <div className="daily-price-status">{t("일별 시세가 없습니다.")}</div>;

  const money = (value: number) => (market === "US" ? compactUsd(value) : compactKrw(value, lang));

  return (
    <div className="daily-price-panel">
      <div className="daily-price-wrap" ref={scrollerRef}>
        {/* Four header columns, not eight. All eight requested figures are here, but
            the last four ride a second line per session (below) — see the widths note
            on .daily-price-table in styles.css for why eight columns cannot fit the
            side rail at any viewport width. */}
        <table className="daily-price-table">
          <thead>
            <tr>
              <th scope="col">{t("일자")}</th>
              <th scope="col">{t("주가")}</th>
              <th scope="col">{t("대비")}</th>
              <th scope="col">{t("거래량")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.date}>
                <tr
                  className="daily-price-row-main"
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.date, el);
                    else rowRefs.current.delete(row.date);
                  }}
                >
                  <td className="daily-price-date" title={row.date}>
                    {shortDate(row.date)}
                  </td>
                  <td className="daily-price-close">{formatPrice(row.close, market)}</td>
                  <td className={changeClass(row.change)}>
                    <span className="daily-price-change-abs">
                      {row.change > 0 ? "▲" : row.change < 0 ? "▼" : ""}
                      {formatPrice(Math.abs(row.change), market)}
                    </span>
                    <span className="daily-price-change-pct">
                      {row.change > 0 ? "+" : ""}
                      {row.change_pct}%
                    </span>
                  </td>
                  <td>{compactCount(row.volume, lang)}</td>
                </tr>
                {/* Carries its own labels rather than borrowing the header above: these
                    four have no column of their own, so unlabelled they would be four
                    anonymous numbers. Wraps instead of overflowing when the rail is at
                    its narrowest. */}
                <tr className="daily-price-row-sub">
                  <td colSpan={4}>
                    <div className="daily-price-sub-fields">
                      {/* Abbreviated labels (시/고/저/대금, O/H/L/Val) so all four fields
                          hold one line even at the rail's 281px floor — the full names
                          would push them to 308px and wrap. Spelled out in `title`. */}
                      <span className="daily-price-field" title={t("시가")}>
                        <i>{t("시")}</i>
                        {formatPrice(row.open, market)}
                      </span>
                      <span className="daily-price-field" title={t("고가")}>
                        <i>{t("고")}</i>
                        <b className="change-up">{formatPrice(row.high, market)}</b>
                      </span>
                      <span className="daily-price-field" title={t("저가")}>
                        <i>{t("저")}</i>
                        <b className="change-down">{formatPrice(row.low, market)}</b>
                      </span>
                      <span className="daily-price-field" title={t("거래대금")}>
                        <i>{t("대금")}</i>
                        {money(row.value)}
                      </span>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {/* Inside the scroller, below the last row: this is the "you have reached the
            end of the list" marker the mobile auto-load watches for. */}
        {isMobile && hasMore && <div className="daily-price-sentinel" ref={sentinelRef} aria-hidden="true" />}
      </div>

      {/* Not the exchange's own 거래대금 (no free feed publishes it per-session) — said
          plainly rather than left for the reader to discover by cross-checking. */}
      <div className="daily-price-note">{t("거래대금은 거래량 × 평균가 기준 추정치입니다.")}</div>

      {hasMore &&
        (isMobile ? (
          loadingMore && (
            <div className="daily-price-status">
              <span className="board-more-spinner" aria-hidden="true" />
              {t("불러오는 중...")}
            </div>
          )
        ) : (
          <button type="button" className="board-more-btn" onClick={() => loadMore(true)} disabled={loadingMore}>
            {loadingMore && <span className="board-more-spinner" aria-hidden="true" />}
            {loadingMore ? t("불러오는 중...") : t("더보기")}
          </button>
        ))}
    </div>
  );
}
