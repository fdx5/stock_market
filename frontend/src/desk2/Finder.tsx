import { useEffect, useMemo, useRef, useState } from "react";
import { StockSearchResult, api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { navigate } from "../router";
import { usePopularStocks } from "../usePopularStocks";
import { useWatchlist } from "../useWatchlist";
import { clearRecents } from "../watchlist";
import StockLogo from "../components/StockLogo";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { useL } from "./lib";

/* 찾기 — the search field and the ⌘K palette, as one thing.
 *
 * The classic desk had both: a search box in the command bar with its own
 * dropdown of recents and popular names, and a separate palette on ⌘K that
 * searched the same stocks plus the site's boards. Two ways of doing one job,
 * with two different sets of keys. Here there is one sheet. It opens from the
 * search field, from ⌘K / Ctrl-K, or from "/", and before a key is typed it is
 * already useful: this browser's recent stocks, what everyone is looking at, and
 * every board on the site. Typing narrows all three at once.
 *
 * ETFs are searched as well now — the classic box left them out, and a reader
 * typing "KODEX" found nothing. */

interface Destination {
  key: string;
  ko: string;
  en: string;
  group: string;
  to: string;
}

const DESTINATIONS: Destination[] = [
  { key: "desk2", ko: "클래식 마켓 데스크", en: "Classic market desk", group: "메인", to: "/desk2" },
  { key: "stocks", ko: "종목정보", en: "Stocks", group: "메인", to: "/stocks" },
  { key: "brief", ko: "오늘 브리핑", en: "Daily brief", group: "메인", to: "/market-brief" },
  { key: "map", ko: "코스피 지도", en: "KOSPI map", group: "지도", to: "/map" },
  { key: "kosdaq-map", ko: "코스닥 지도", en: "KOSDAQ map", group: "지도", to: "/kosdaq-map" },
  { key: "sp500-map", ko: "S&P 500 지도", en: "S&P 500 map", group: "지도", to: "/sp500-map" },
  { key: "nasdaq100-map", ko: "나스닥 100 지도", en: "NASDAQ 100 map", group: "지도", to: "/nasdaq100-map" },
  { key: "realestate-map", ko: "부동산 지도 · 아파트 실거래가", en: "Real estate map", group: "지도", to: "/realestate-map" },
  { key: "kospi-orbit", ko: "증시 궤도", en: "Market orbit", group: "지도", to: "/kospi-orbit" },
  { key: "bubbles", ko: "증시 버블", en: "Market bubbles", group: "지도", to: "/market-bubbles" },
  { key: "kospi-100", ko: "코스피 TOP 100", en: "KOSPI TOP 100", group: "순위", to: "/kospi-100" },
  { key: "kosdaq-100", ko: "코스닥 TOP 100", en: "KOSDAQ TOP 100", group: "순위", to: "/kosdaq-100" },
  { key: "nasdaq-100", ko: "나스닥 TOP 100", en: "NASDAQ TOP 100", group: "순위", to: "/nasdaq-100" },
  { key: "global-top100", ko: "글로벌 시총 TOP 100", en: "Global market cap TOP 100", group: "순위", to: "/global-top100" },
  { key: "etf", ko: "ETF 마켓", en: "ETF market", group: "순위", to: "/etf" },
  { key: "kospi-index", ko: "코스피 지수 차트", en: "KOSPI index chart", group: "분석", to: "/index/kospi" },
  { key: "kosdaq-index", ko: "코스닥 지수 차트", en: "KOSDAQ index chart", group: "분석", to: "/index/kosdaq" },
  { key: "ai", ko: "AI 예측", en: "AI forecast", group: "분석", to: "/ai-prediction" },
  { key: "grading", ko: "AI 예측 채점표", en: "Forecast grading", group: "분석", to: "/ai-prediction/grading" },
  { key: "fight", ko: "시총 대결", en: "Market-cap fight", group: "분석", to: "/fight" },
  { key: "dram", ko: "D램 가격 이력", en: "DRAM price history", group: "분석", to: "/dram-price" },
  { key: "global", ko: "해외 주식 데스크", en: "Global desk", group: "분석", to: "/global" },
  { key: "discussion", ko: "종목 토론", en: "Discussions", group: "커뮤니티", to: "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK" },
  { key: "news", ko: "글로벌 뉴스", en: "Global news", group: "커뮤니티", to: "/news" },
  { key: "hub", ko: "태양계 입구", en: "Solar-system entrance", group: "홈", to: "/" },
];

type Row =
  | { kind: "stock"; stock: StockSearchResult; tag?: string }
  | { kind: "page"; dest: Destination };

export default function Finder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useLanguage();
  const L = useL();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { recents } = useWatchlist();
  const popular = usePopularStocks(8);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setCursor(0);
      return;
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .search(q, controller.signal, true)
        .then((res) => setResults(res.slice(0, 12)))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const q = query.trim().toLowerCase();
  const pages = useMemo(
    () => DESTINATIONS.filter((d) => !q || d.ko.toLowerCase().includes(q) || d.en.toLowerCase().includes(q) || d.to.includes(q)),
    [q]
  );

  /* One flat list for the arrow keys, in the order the sections are drawn. */
  const rows: Row[] = useMemo(() => {
    if (q) {
      return [
        ...results.map((stock) => ({ kind: "stock" as const, stock })),
        ...pages.slice(0, 8).map((dest) => ({ kind: "page" as const, dest })),
      ];
    }
    return [
      ...recents.slice(0, 6).map((s) => ({ kind: "stock" as const, stock: { code: s.code, name: s.name, market: s.market }, tag: "recent" })),
      ...(popular ?? []).map((s) => ({ kind: "stock" as const, stock: { code: s.code, name: s.name, market: s.market }, tag: "popular" })),
      ...pages.map((dest) => ({ kind: "page" as const, dest })),
    ];
  }, [q, results, pages, recents, popular]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = (row: Row) => {
    onClose();
    if (row.kind === "page") {
      navigate(row.dest.to);
      return;
    }
    const etf = row.stock.asset_type === "ETF";
    navigate(`/stock/${encodeURIComponent(row.stock.code)}${etf ? "?asset=ETF" : ""}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[cursor];
      if (row) choose(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  let index = -1;
  const stockRow = (row: Extract<Row, { kind: "stock" }>, rank?: number) => {
    index += 1;
    const i = index;
    const isEtf = row.stock.asset_type === "ETF";
    return (
      <button
        key={`${row.tag ?? "s"}-${row.stock.code}-${i}`}
        type="button"
        data-row={i}
        className={`d2-find-row ${cursor === i ? "is-cursor" : ""}`}
        onMouseMove={() => setCursor(i)}
        onClick={() => choose(row)}
      >
        {rank !== undefined && <span className="d2-find-rank">{rank}</span>}
        <StockLogo code={row.stock.code} name={row.stock.name} className="d2-find-logo" assetType={isEtf ? "etf" : "stock"} />
        <span className="d2-find-name">{row.stock.name}</span>
        <span className="d2-find-meta">
          {row.stock.code}
          <em>{isEtf ? "ETF" : row.stock.market}</em>
        </span>
      </button>
    );
  };
  const pageRow = (dest: Destination) => {
    index += 1;
    const i = index;
    return (
      <button
        key={`p-${dest.key}`}
        type="button"
        data-row={i}
        className={`d2-find-row d2-find-row--page ${cursor === i ? "is-cursor" : ""}`}
        onMouseMove={() => setCursor(i)}
        onClick={() => choose({ kind: "page", dest })}
      >
        <span className="d2-find-name">{lang === "ko" ? dest.ko : dest.en}</span>
        <span className="d2-find-meta">{dest.to.split("?")[0]}</span>
      </button>
    );
  };

  const recentRows = rows.filter((r): r is Extract<Row, { kind: "stock" }> => r.kind === "stock" && r.tag === "recent");
  const popularRows = rows.filter((r): r is Extract<Row, { kind: "stock" }> => r.kind === "stock" && r.tag === "popular");
  const resultRows = rows.filter((r): r is Extract<Row, { kind: "stock" }> => r.kind === "stock" && !r.tag);
  const pageRows = rows.filter((r): r is Extract<Row, { kind: "page" }> => r.kind === "page");

  return (
    <div className="d2-find-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="d2-find" role="dialog" aria-modal="true" aria-label={L("종목·메뉴 찾기", "Find a stock or page")} onKeyDown={onKeyDown}>
        <div className="d2-find-field">
          <span className="d2-find-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L("종목명, 종목코드, 티커 또는 메뉴 이름", "Company, code, ticker or page")}
            aria-label={L("검색어", "Search")}
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <span className="d2-find-spin" aria-hidden="true" />}
          <button type="button" className="d2-find-close" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="d2-find-body" ref={listRef}>
          {q ? (
            <>
              <section>
                <h3>{L("종목 · ETF", "Stocks · ETFs")}</h3>
                {resultRows.length > 0 ? (
                  resultRows.map((r) => stockRow(r))
                ) : (
                  <p className="d2-find-empty">{searching ? L("찾는 중…", "Searching…") : L("일치하는 종목이 없습니다.", "No matching stock.")}</p>
                )}
              </section>
              {pageRows.length > 0 && (
                <section>
                  <h3>{L("페이지", "Pages")}</h3>
                  {pageRows.map((r) => pageRow(r.dest))}
                </section>
              )}
            </>
          ) : (
            <>
              {recentRows.length > 0 && (
                <section>
                  <h3>
                    {L("최근 본 종목", "Recently viewed")}
                    <button type="button" className="d2-find-clear" onClick={clearRecents}>
                      {L("기록 삭제", "Clear")}
                    </button>
                  </h3>
                  {recentRows.map((r) => stockRow(r))}
                </section>
              )}
              <section>
                <h3>{L("지금 많이 찾는 종목", "Most viewed right now")}</h3>
                {popular === null ? <p className="d2-find-empty">{L("집계 중…", "Loading…")}</p> : popularRows.map((r, i) => stockRow(r, i + 1))}
              </section>
              <section className="d2-find-pages">
                <h3>{L("바로가기", "Go to")}</h3>
                <div>{pageRows.map((r) => pageRow(r.dest))}</div>
              </section>
            </>
          )}
        </div>

        <footer className="d2-find-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {L("이동", "move")}
          </span>
          <span>
            <kbd>Enter</kbd> {L("열기", "open")}
          </span>
          <span>
            <kbd>Esc</kbd> {L("닫기", "close")}
          </span>
          <span className="d2-find-foot-hint">
            <kbd>⌘</kbd>
            <kbd>K</kbd> · <kbd>/</kbd> {L("어디서나 열기", "open anywhere")}
          </span>
        </footer>
      </div>
    </div>
  );
}
