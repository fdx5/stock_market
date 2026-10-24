import entries from "./serviceCatalog.json";
export type ServiceGroup = "stocks" | "decision" | "funds" | "events" | "macro" | "crypto";
export type Service = typeof entries[number];
export const SERVICES = entries;
export const SERVICE_GROUPS: { id: ServiceGroup; name: string; en: string }[] = [
  { id: "decision", name: "판단 · 실험", en: "Decision labs" }, { id: "stocks", name: "시장 · 종목", en: "Stocks & markets" },
  { id: "funds", name: "ETF · 배당", en: "Funds & income" }, { id: "events", name: "사건 · 근거", en: "Events & evidence" },
  { id: "macro", name: "환율 · 경제 · 채권", en: "Macro & bonds" }, { id: "crypto", name: "디지털 자산", en: "Digital assets" },
];
export const serviceForPath = (path: string) => SERVICES.find(s => s.path === path.split(/[?#]/)[0].replace(/\/$/, ""));
export function serviceLink(path: string, context: { code?: string; market?: string; region?: string } = {}) {
  const query = new URLSearchParams();
  if (context.code && /^[A-Za-z0-9.-]{1,16}$/.test(context.code)) query.set("code", context.code);
  if (context.market && ["kospi", "kosdaq", "nasdaq"].includes(context.market)) query.set("market", context.market);
  if (context.region && ["KR", "US"].includes(context.region)) query.set("region", context.region);
  return path + (query.size ? `?${query}` : "");
}
