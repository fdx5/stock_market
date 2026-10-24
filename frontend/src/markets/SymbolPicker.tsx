import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, StockSearchResult } from "../api/client";
import { DiscoveryMarket, DiscoveryRow } from "./discoveryModel";
import "./symbolPicker.css";
import { reportResearchEvent } from "../useActivityTracking";

export function symbolMarket(stock: StockSearchResult): DiscoveryMarket {
  const market = stock.market.toUpperCase();
  return market.includes("KOSDAQ") ? "kosdaq" : market.includes("KOSPI") || /^\d{6}$/.test(stock.code) ? "kospi" : "nasdaq";
}
export function boardSymbols(rows: DiscoveryRow[]): StockSearchResult[] {
  return rows.map(row => ({ code: row.code, name: row.name, market: row.market === "nasdaq" ? "US" : row.market.toUpperCase(), asset_type: "STOCK" }));
}
export function BoardSymbolPicker({ rows, value, onSelect, label = "기준 종목 검색" }: { rows: DiscoveryRow[]; value: string; onSelect: (id: string) => void; label?: string }) {
  const current = rows.find(row => row.id === value);
  const [query, setQuery] = useState(current?.code ?? "");
  const options = useMemo(() => boardSymbols(rows), [rows]);
  useEffect(() => { setQuery(current?.code ?? ""); }, [current?.code]);
  return <SymbolPicker label={label} value={query} onChange={setQuery} options={options} hint="현재 시장 TOP 100 표본 안에서 이름·코드로 검색하세요." onSelect={item => { const row = rows.find(row => row.code === item.code && row.market === symbolMarket(item)); if (row) onSelect(row.id); }} />;
}
type Props = {
  label: string; value: string; onChange: (query: string) => void; onSelect: (stock: StockSearchResult) => void;
  options?: StockSearchResult[]; asset?: "STOCK" | "ETF"; region?: "KR" | "US"; hint?: string; disabled?: boolean;
};

export default function SymbolPicker({ label, value, onChange, onSelect, options, asset = "STOCK", region, hint, disabled }: Props) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [cursor, setCursor] = useState(-1), [revision, retry] = useState(0);
  const [picked, setPicked] = useState<StockSearchResult | null>(null);
  const [remote, setRemote] = useState<{ query: string; items: StockSearchResult[]; loading?: boolean; error?: boolean }>({ query: "", items: [] });
  const query = value.trim();
  useEffect(() => {
    if (options || !query || !open) return;
    const abort = new AbortController(); let alive = true;
    setRemote({ query, items: [], loading: true });
    const timer = window.setTimeout(() => {
      void api.search(query, abort.signal, asset === "ETF").then(items => {
        if (alive) { setRemote({ query, items: Array.isArray(items) ? items.filter(item => typeof item.code === "string" && typeof item.name === "string" && typeof item.market === "string" && /^[A-Za-z0-9.-]{1,16}$/.test(item.code)) : [] }); if (!items?.length) reportResearchEvent("search_empty"); }
      }).catch(() => { if (alive) { setRemote({ query, items: [], error: true }); reportResearchEvent("search_error"); } });
    }, 180);
    return () => { alive = false; abort.abort(); window.clearTimeout(timer); };
  }, [query, open, options, asset, revision]);
  useEffect(() => { setCursor(-1); }, [query]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const items = useMemo(() => {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const source = options ?? (remote.query === query ? remote.items : []);
    const seen = new Set<string>();
    return source.filter(item => {
      if (asset === "ETF" ? item.asset_type !== "ETF" : item.asset_type === "ETF") return false;
      const us = symbolMarket(item) === "nasdaq", key = `${us ? "US" : "KR"}:${item.code}`;
      if (region && us !== (region === "US") || seen.has(key)) return false;
      if (options && !terms.every(term => `${item.name} ${item.code}`.toLocaleLowerCase().includes(term))) return false;
      seen.add(key); return true;
    }).slice(0, 12);
  }, [options, remote, query, asset, region]);
  const expanded = !disabled && open && (!!query || !!options);
  const loading = !options && remote.query === query && remote.loading;
  const error = !options && remote.query === query && remote.error;
  const selected = picked?.code === value ? picked : options?.find(item => item.code === value);
  const choose = (stock: StockSearchResult) => {
    reportResearchEvent("symbol_select", stock);
    setPicked(stock); setOpen(false); setCursor(-1); onChange(stock.code); onSelect(stock);
  };
  useEffect(() => { if (cursor >= 0) root.current?.querySelector(`#${CSS.escape(`${id}-option-${cursor}`)}`)?.scrollIntoView({ block: "nearest" }); }, [cursor, id]);
  return <div className="rs-field rs-symbol-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label htmlFor={`${id}-input`}>{label}</label>
    <div className="rs-symbol-input"><span aria-hidden="true">⌕</span><input id={`${id}-input`} ref={input} disabled={disabled} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && cursor >= 0 && items[cursor] ? `${id}-option-${cursor}` : undefined} aria-describedby={`${id}-help`} autoComplete="off" spellCheck={false} value={value} placeholder={asset === "ETF" ? "ETF 이름 또는 코드 검색" : "종목명 또는 코드 검색"} maxLength={80} onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true); setCursor(-1); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setCursor(index => Math.max(0, Math.min(items.length - 1, event.key === "ArrowDown" ? index + 1 : index < 0 ? items.length - 1 : index - 1))); }
      else if (event.key === "Enter" && expanded && items.length) { event.preventDefault(); choose(items[cursor >= 0 ? cursor : 0]); }
      else if (event.key === "Enter" && !/^[A-Za-z0-9.-]{1,16}$/.test(value)) { event.preventDefault(); setOpen(true); }
      else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    }} /></div>
    <small id={`${id}-help`} className="rs-symbol-help">{selected ? <><b>{selected.name}</b> · {selected.code} · {selected.market}{selected.asset_type === "ETF" ? " · ETF" : ""}</> : hint ?? (options ? "현재 표본 안에서 이름·코드로 검색하세요." : asset === "ETF" ? `${region === "US" ? "미국" : "국내"} ETF 이름으로 검색하거나 코드를 직접 입력하세요.` : "예: 삼성전자, SK하이닉스, AAPL · 코드를 직접 입력해도 됩니다.")}</small>
    {expanded && <div className="rs-symbol-popup"><ul id={`${id}-list`} role="listbox" aria-label={`${label} 검색 결과`} aria-busy={!!loading}>{items.map((stock, index) => <li role="option" aria-selected={cursor === index} id={`${id}-option-${index}`} key={`${stock.market}:${stock.code}`} className={cursor === index ? "is-active" : ""} onPointerDown={event => event.preventDefault()} onClick={() => choose(stock)}><strong>{stock.name}</strong><span>{stock.code}<small>{stock.market}{stock.asset_type === "ETF" ? " · ETF" : ""}</small></span></li>)}</ul><div className="rs-symbol-status" role="status">{loading ? "검색 중…" : error ? <>검색을 불러오지 못했습니다. 코드를 직접 입력하거나 <button type="button" onClick={() => retry(n => n + 1)}>다시 검색</button>하세요.</> : !items.length ? options ? "현재 TOP 100 표본에 일치하는 종목이 없습니다." : "일치하는 종목이 없습니다. 이름·코드 또는 선택한 시장을 확인하세요." : "↑ ↓ 이동 · Enter 선택 · Esc 닫기"}</div></div>}
  </div>;
}
