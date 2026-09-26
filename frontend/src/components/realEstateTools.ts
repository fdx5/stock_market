import { useEffect, useRef, useState } from "react";
import { RealEstateItem } from "../api/client";

export function tradeState(item: RealEstateItem): string {
  return item.change_pct === null ? item.trades > 0 ? "비교 기준 부족" : "기간 거래 없음" : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
}
export function daysSince(date: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00+09:00`).getTime()) / 86400000));
}
export function useDialogFocus(close: () => void) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea, [tabindex="0"]';
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>(selector) ?? []).filter(x => x.getClientRects().length > 0);
    (focusable()[0] ?? element)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const list = focusable();
      if (!list.length) { event.preventDefault(); element?.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !element?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return ref;
}

export function useSavedEstates() {
  const [saved, setSaved] = useState<RealEstateItem[]>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem("re_saved_v1") ?? "[]");
      return Array.isArray(raw) ? raw.filter(x => x && typeof x.id === "string" && typeof x.name === "string" && Array.isArray(x.history)).slice(0, 100) : [];
    } catch { return []; }
  });
  const [storageError, setStorageError] = useState("");
  const toggle = (item: RealEstateItem) => {
    setSaved(previous => {
      const exists = previous.some(x => x.id === item.id);
      if (!exists && previous.length >= 100) { setStorageError("관심 단지는 100개까지 저장할 수 있습니다."); return previous; }
      const next = exists ? previous.filter(x => x.id !== item.id) : [item, ...previous];
      try { localStorage.setItem("re_saved_v1", JSON.stringify(next)); setStorageError(""); }
      catch { setStorageError("이 브라우저에서는 영구 저장할 수 없어 이번 방문 동안만 유지됩니다."); }
      return next;
    });
  };
  return { saved, toggle, storageError };
}

export const FILTER_DEFAULTS = { q: "", price_min: "", price_max: "", area_min: "", area_max: "", built_min: "", min_trades: "", recent_days: "", sort: "price_desc" };
export type EstateFilters = typeof FILTER_DEFAULTS;
export function readEstateFilters(): EstateFilters {
  const q = new URLSearchParams(location.search);
  const filters = { ...FILTER_DEFAULTS };
  for (const key of Object.keys(filters) as (keyof EstateFilters)[]) {
    const value = q.get(key);
    if (value !== null) {
      if (key === "q") filters[key] = value.slice(0, 80);
      else if (key === "sort") { if (["price_desc", "price_asc", "change_desc", "trades_desc", "date_desc", "name"].includes(value)) filters[key] = value; }
      else if (value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) filters[key] = value;
    }
  }
  return filters;
}
export function csvDownload(items: RealEstateItem[], region: string, period: string, generated: string) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    ["조회 지역", region, "기간", period, "자료 생성", generated, "현재 표시 결과만 내보냄"],
    ["단지명", "지역", "전용면적(㎡)", "실거래 기준가(만원)", "기준 거래일", "등락률(%)", "기간 거래(선택 평형)", "비교 상태", "산정 표본", "가격 기준"],
    ...items.map(x => [x.name, `${x.sgg} ${x.dong}`, x.area, x.price, x.deal_date, x.change_pct, x.trades, tradeState(x), x.price_sample_count, x.price_basis === "direct" ? "직거래 참고값" : "중개거래"]),
  ];
  const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(r => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `부동산_${region}_${period}.csv`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
