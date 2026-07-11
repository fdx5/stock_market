import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { api, StockSearchResult } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

interface Props {
  onSelect: (stock: StockSearchResult) => void;
}

export default function SearchBar({ onSelect }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const translatedNames = useTranslatedTexts(results.map((r) => r.name));

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
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

  function choose(stock: StockSearchResult) {
    onSelect(stock);
    setQuery(`${stock.name} (${stock.code})`);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      choose(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="search-wrap" ref={containerRef}>
      <input
        className="search-input"
        placeholder={t("종목명 또는 코드 검색 (예: 삼성전자, 005930)")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && (
        <div className="search-dropdown">
          {results.map((r, idx) => (
            <div
              key={r.code}
              className={`search-option ${idx === activeIndex ? "active" : ""}`}
              onMouseDown={() => choose(r)}
            >
              <span className="search-option-name">
                <img
                  className="search-option-logo"
                  src={`https://ssl.pstatic.net/imgstock/fn/real/logo/png/stock/Stock${r.code}.png`}
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
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
