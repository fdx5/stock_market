import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StockSearchResult, api } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { navigate } from "../router";
import { getRecents, toSearchResult } from "../watchlist";

/* ⌘K / Ctrl-K, and the reason it earns its keep on a stock page specifically.
 *
 * This site is a dozen boards — four treemaps, three card boards, the global
 * top 100, the news wall, the AI page, the fight — plus every listed stock. The
 * nav row can hold the boards and does. It cannot hold the stocks, so reaching
 * one means finding the search field, which means knowing where on the page it
 * is, which changes with the route. A reader who checks the same six names
 * every morning should not have to aim at anything.
 *
 * Everything in here is already available: /search for the stocks, the router
 * for the boards, and localStorage's recents for the resting state, so the
 * palette is a keyboard in front of things the page could already do. */

interface Destination {
  key: string;
  label: string;
  hint: string;
  to: string;
}

const DESTINATIONS: Destination[] = [
  { key: "desk", label: "마켓 데스크", hint: "메인", to: "/desk" },
  { key: "dashboard", label: "클래식 대시보드", hint: "메인", to: "/dashboard" },
  { key: "map", label: "KOSPI 지도", hint: "지도", to: "/map" },
  { key: "kosdaq-map", label: "KOSDAQ 지도", hint: "지도", to: "/kosdaq-map" },
  { key: "sp500-map", label: "S&P 500 지도", hint: "지도", to: "/sp500-map" },
  { key: "nasdaq100-map", label: "NASDAQ 100 지도", hint: "지도", to: "/nasdaq100-map" },
  { key: "kospi-100", label: "KOSPI TOP 100", hint: "순위", to: "/kospi-100" },
  { key: "kosdaq-100", label: "KOSDAQ TOP 100", hint: "순위", to: "/kosdaq-100" },
  { key: "global-top100", label: "글로벌 시총 TOP 100", hint: "순위", to: "/global-top100" },
  { key: "ai-prediction", label: "AI 예측", hint: "분석", to: "/ai-prediction" },
  { key: "fight", label: "시총 대결", hint: "분석", to: "/fight" },
  { key: "news", label: "글로벌 뉴스", hint: "뉴스", to: "/news" },
  { key: "hub", label: "태양계 입구", hint: "홈", to: "/" },
];

type Row =
  | { kind: "stock"; stock: StockSearchResult }
  | { kind: "page"; destination: Destination };

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export default function CommandPalette({
  onSelectStock,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /* Opens on ⌘K or Ctrl-K anywhere on the page, and closes on Escape. Bound to
     the window rather than to a field, which is the point of it — but it has to
     step aside when the reader is already typing somewhere, or the shortcut
     would fight the search box and the comment composer for the same keys. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      // A bare "/" is the other convention for this, and it is safe precisely
      // because of the guard above: it only fires when nothing has focus.
      if (event.key === "/" && !typing && !open) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setCursor(0);
      return;
    }
    // Focused on the frame after the dialog paints, or the caret lands in an
    // element that is not on screen yet and the first keystroke is dropped.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  /* Debounced, because this fires a network call per keystroke otherwise and
     the endpoint behind it scrapes. 180ms is under the threshold where a reader
     notices a pause and well above the interval between two keys of the same
     word. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .search(q)
        .then((res) => {
          if (!cancelled) setResults(res.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  /* The resting list: this browser's own trail, most recent first. It is the
     state the palette is in most of the time it is open — somebody who opens it
     to reach a stock they were just looking at should find it there without
     typing. Deduplicated because getRecents already is, but the guard is kept:
     the loop used to merge two lists and would silently start repeating if a
     second source is ever added back. */
  const restingStocks = useMemo(() => {
    const seen = new Set<string>();
    const out: StockSearchResult[] = [];
    for (const stock of getRecents()) {
      if (seen.has(stock.code)) continue;
      seen.add(stock.code);
      out.push(toSearchResult(stock));
      if (out.length >= 6) break;
    }
    return out;
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const stocks = q ? results : restingStocks;
    const pages = q
      ? DESTINATIONS.filter((d) => matches(d.label, q) || matches(d.key, q) || matches(d.to, q))
      : DESTINATIONS.slice(0, 6);
    return [
      ...stocks.map((stock): Row => ({ kind: "stock", stock })),
      ...pages.map((destination): Row => ({ kind: "page", destination })),
    ];
  }, [query, results, restingStocks]);

  // Any change to the list puts the cursor back on the first row — leaving it
  // where it was would have Enter fire whatever happened to slide under it.
  useEffect(() => setCursor(0), [rows.length, query]);

  const run = useCallback(
    (row: Row) => {
      setOpen(false);
      if (row.kind === "stock") onSelectStock(row.stock);
      else navigate(row.destination.to);
    },
    [onSelectStock]
  );

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (rows.length ? (c + 1) % rows.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (rows.length ? (c - 1 + rows.length) % rows.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[cursor];
      if (row) run(row);
    }
  };

  // Keeps the highlighted row in view when the cursor is driven by the keyboard
  // past the edge of the scroll box.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) {
    return (
      <button
        type="button"
        className="desk-cmd-trigger"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        /* Stated rather than left to the caption below, because a narrow deck
           hides that caption outright and the button would otherwise be left
           named by an aria-hidden glyph. */
        aria-label={t("종목 · 페이지 바로가기")}
      >
        <span className="desk-cmd-trigger-icon" aria-hidden="true">
          ⌕
        </span>
        {/* Wrapped rather than bare text so the tablet band in marketDesk.css
            can drop the caption and the shortcut and leave the glyph as the
            whole button. The shortcut is the half worth losing first: it spells
            out ⌘K on the devices least likely to have a ⌘. */}
        <span className="desk-cmd-trigger-label">{t("종목 · 페이지 바로가기")}</span>
        <kbd>⌘K</kbd>
      </button>
    );
  }

  return (
    <div
      className="desk-cmd-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="desk-cmd" role="dialog" aria-modal="true" aria-label={t("종목 · 페이지 바로가기")}>
        <div className="desk-cmd-field">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("종목명, 종목코드, 페이지 이름")}
            aria-label={t("종목명, 종목코드, 페이지 이름")}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>ESC</kbd>
        </div>

        {rows.length === 0 ? (
          <p className="desk-cmd-empty">{t("결과가 없습니다.")}</p>
        ) : (
          <ul className="desk-cmd-list" ref={listRef}>
            {rows.map((row, index) => {
              const active = index === cursor;
              const key = row.kind === "stock" ? `s:${row.stock.code}` : `p:${row.destination.key}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    data-active={active}
                    className={`desk-cmd-row ${active ? "is-active" : ""}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => run(row)}
                  >
                    {row.kind === "stock" ? (
                      <>
                        <span className="desk-cmd-kind">{row.stock.market}</span>
                        <span className="desk-cmd-label">{row.stock.name}</span>
                        <span className="desk-cmd-hint">{row.stock.code}</span>
                      </>
                    ) : (
                      <>
                        <span className="desk-cmd-kind is-page">{t(row.destination.hint)}</span>
                        <span className="desk-cmd-label">{t(row.destination.label)}</span>
                        <span className="desk-cmd-hint">{row.destination.to}</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="desk-cmd-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("이동")}
          </span>
          <span>
            <kbd>↵</kbd> {t("열기")}
          </span>
          <span>
            <kbd>/</kbd> {t("어디서든 열기")}
          </span>
        </div>
      </div>
    </div>
  );
}
