import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, StockSearchResult } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { usePopularStocks } from "../usePopularStocks";
import { useWatchlist } from "../useWatchlist";
import StockIcon from "./StockIcon";

interface Props {
  onSelect: (stock: StockSearchResult) => void;
}

const SUGGESTION_LIMIT = 6;

interface SuggestionGroup {
  key: string;
  label: string;
  icon: string;
  items: StockSearchResult[];
}

export default function SearchBar({ onSelect }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites, recents } = useWatchlist();
  const popular = usePopularStocks(SUGGESTION_LIMIT);

  // iPadOS Safari hands focus back to the last-focused form control whenever it
  // re-shows a page — bfcache back/forward, a reopened tab, session restore. On the
  // dashboard that control is this box, so simply landing on the page threw the
  // on-screen keyboard over the content before the visitor had touched anything.
  // Focus arriving with no prior gesture on the page is never the visitor asking for
  // the keyboard, so it gets handed straight back. Both real routes in — tapping the
  // box, or tabbing to it — are preceded by a pointerdown/keydown, which is what this
  // watches for, so neither is affected.
  const userGestureRef = useRef(false);

  useEffect(() => {
    const mark = () => {
      userGestureRef.current = true;
    };
    // Capture phase, so the gesture is recorded before the focus it causes arrives.
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    // Focus restored before this component mounted fires no onFocus for us to catch,
    // so the same rule is applied once to whatever already holds it.
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }
    const handle = setTimeout(() => {
      api
        .search(trimmed)
        .then((data) => {
          setResults(data);
          setOpen(data.length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {
          setResults([]);
          setOpen(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Shown when the box is focused but empty — the old behaviour was a dead
  // dropdown until the visitor typed. Favourites first (an explicit choice), then
  // their own history, then what everyone else is watching. A stock already listed
  // in a higher group is skipped rather than repeated down the list.
  const suggestionGroups = useMemo<SuggestionGroup[]>(() => {
    const seen = new Set<string>();
    const take = (items: StockSearchResult[]) => {
      const picked: StockSearchResult[] = [];
      for (const item of items) {
        if (seen.has(item.code)) continue;
        seen.add(item.code);
        picked.push(item);
        if (picked.length >= SUGGESTION_LIMIT) break;
      }
      return picked;
    };

    const groups: SuggestionGroup[] = [
      { key: "favorites", label: t("관심종목"), icon: "★", items: take(favorites) },
      { key: "recents", label: t("최근 본 종목"), icon: "🕘", items: take(recents) },
      {
        key: "popular",
        label: t("실시간 인기"),
        icon: "🔥",
        items: take(
          (popular ?? []).map((item) => ({ code: item.code, name: item.name, market: item.market }))
        ),
      },
    ];
    return groups.filter((group) => group.items.length > 0);
  }, [favorites, recents, popular, t]);

  const isSuggesting = query.trim().length === 0;
  // One flat list behind the grouped rendering, so arrow keys walk the whole
  // dropdown in visual order regardless of which group a row belongs to.
  const navigable = isSuggesting ? suggestionGroups.flatMap((group) => group.items) : results;
  const translatedNames = useTranslatedTexts(navigable.map((r) => r.name));

  function choose(stock: StockSearchResult) {
    onSelect(stock);
    setQuery(`${stock.name} (${stock.code})`);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, navigable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      choose(navigable[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && navigable.length > 0;
  let flatIndex = -1;

  return (
    <div className="search-wrap" ref={containerRef}>
      <input
        ref={inputRef}
        className="search-input"
        placeholder={t("종목명 또는 코드 검색 (예: 삼성전자, 005930)")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          if (!userGestureRef.current) {
            e.target.blur();
            return;
          }
          setOpen(true);
        }}
      />
      {showDropdown && (
        <div className="search-dropdown">
          {isSuggesting
            ? suggestionGroups.map((group) => (
                <div key={group.key} className="search-group">
                  <div className="search-group-label">
                    <span aria-hidden="true">{group.icon}</span>
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <div
                        key={`${group.key}-${item.code}`}
                        className={`search-option ${idx === activeIndex ? "active" : ""}`}
                        onMouseDown={() => choose(item)}
                      >
                        <span className="search-option-name">
                          <StockIcon className="search-option-logo" code={item.code} />
                          {translatedNames[idx] ?? item.name}
                        </span>
                        <span className="code">{item.code}</span>
                      </div>
                    );
                  })}
                </div>
              ))
            : results.map((r, idx) => (
                <div
                  key={r.code}
                  className={`search-option ${idx === activeIndex ? "active" : ""}`}
                  onMouseDown={() => choose(r)}
                >
                  <span className="search-option-name">
                    <StockIcon className="search-option-logo" code={r.code} />
                    {translatedNames[idx] ?? r.name}
                  </span>
                  <span className="code">{r.code}</span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
