import type { EtfItem } from "../../api/client";

export type EtfRegion = "KR" | "US";
export const SORTS = ["turnover", "volume", "change", "d20", "d60", "d120", "ytd", "surge", "pos52", "name"] as const;
export type EtfSort = typeof SORTS[number];
export type EtfScreen = "all" | "rising" | "falling" | "plain" | "geared";
export interface EtfChoices {
  q: string; category: string; sort: EtfSort; direction: "desc" | "asc";
  view: "table" | "card"; screen: EtfScreen; compare: string[];
}
export const etfPath = (region: EtfRegion) => `/etf/${region.toLowerCase()}`;
export function readEtfChoices(search: string): EtfChoices {
  const p = new URLSearchParams(search);
  const sort = SORTS.includes(p.get("sort") as EtfSort) ? p.get("sort") as EtfSort : "turnover";
  return {
    q: (p.get("q") ?? "").slice(0, 100), category: p.get("category") ?? "", sort,
    direction: p.get("dir") === "asc" ? "asc" : p.get("dir") === "desc" ? "desc" : sort === "name" ? "asc" : "desc",
    view: p.get("view") === "card" ? "card" : "table",
    screen: ["rising", "falling", "plain", "geared"].includes(p.get("screen") ?? "") ? p.get("screen") as EtfScreen : "all",
    compare: [...new Set((p.get("compare") ?? "").split(",").filter(code => /^[A-Za-z0-9.-]{1,16}$/.test(code)))].slice(0, 4),
  };
}
export function etfUrl(region: EtfRegion, choices: EtfChoices) {
  const p = new URLSearchParams();
  if (choices.q) p.set("q", choices.q);
  if (choices.category) p.set("category", choices.category);
  if (choices.sort !== "turnover") p.set("sort", choices.sort);
  if (choices.direction !== (choices.sort === "name" ? "asc" : "desc")) p.set("dir", choices.direction);
  if (choices.view !== "table") p.set("view", choices.view);
  if (choices.screen !== "all") p.set("screen", choices.screen);
  if (choices.compare.length) p.set("compare", choices.compare.join(","));
  return `${etfPath(region)}${p.size ? `?${p}` : ""}`;
}
export const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
export const isGeared = (e: EtfItem) => /레버리지|인버스|Ultra|Bear|Bull|Leverag|Inverse|\b-?[23]x\b/i.test(`${e.name} ${e.benchmark}`);
export const volumeRatio = (e: EtfItem) => finite(e.average_volume) && e.average_volume > 0 && finite(e.volume) ? e.volume / e.average_volume : null;
export const position52 = (e: EtfItem) => finite(e.week52_low) && finite(e.week52_high) && e.week52_high > e.week52_low && finite(e.close)
  ? Math.min(100, Math.max(0, (e.close - e.week52_low) / (e.week52_high - e.week52_low) * 100)) : null;
export function sortValue(e: EtfItem, sort: EtfSort): number | null {
  const value = sort === "change" ? e.change_pct : sort === "surge" ? volumeRatio(e) : sort === "pos52" ? position52(e)
    : ["d20", "d60", "d120", "ytd"].includes(sort) ? e.returns[sort as keyof EtfItem["returns"]]
    : sort === "volume" ? e.volume : e.turnover;
  return finite(value) ? value : null;
}
export function selectEtfs(items: EtfItem[], choices: EtfChoices): EtfItem[] {
  const q = choices.q.trim().toLocaleLowerCase();
  return items.filter(e => (!choices.category || e.category === choices.category)
    && `${e.name} ${e.code} ${e.benchmark} ${e.category}`.toLocaleLowerCase().includes(q)
    && (choices.screen === "all" || choices.screen === "rising" && e.change_pct > 0 || choices.screen === "falling" && e.change_pct < 0
      || choices.screen === "geared" && isGeared(e) || choices.screen === "plain" && !isGeared(e)))
    .sort((a, b) => {
      const direction = choices.direction === "asc" ? 1 : -1;
      if (choices.sort === "name") return a.name.localeCompare(b.name, "ko") * direction || a.code.localeCompare(b.code);
      const av = sortValue(a, choices.sort), bv = sortValue(b, choices.sort);
      // Missing history always follows available values, including ascending order.
      if (av === null || bv === null) return av === bv ? a.code.localeCompare(b.code) : av === null ? 1 : -1;
      return (av - bv) * direction || a.code.localeCompare(b.code);
    });
}
export function popularEtfs(items: EtfItem[], metric: "turnover" | "volume" = "turnover") {
  return items.filter(e => finite(e[metric]) && e[metric] > 0).slice().sort((a, b) => b[metric] - a[metric] || a.code.localeCompare(b.code)).slice(0, 4);
}
export function summarizeEtfs(items: EtfItem[]) {
  const categories = new Map<string, { count: number; turnover: number; change: number; priced: number }>();
  let up = 0, down = 0, flat = 0, total = 0;
  for (const e of items) {
    if (finite(e.change_pct)) { if (e.change_pct > 0) up++; else if (e.change_pct < 0) down++; else flat++; }
    const turnover = finite(e.turnover) ? Math.max(0, e.turnover) : 0;
    total += turnover;
    const c = categories.get(e.category) ?? { count: 0, turnover: 0, change: 0, priced: 0 };
    c.count++; c.turnover += turnover;
    if (finite(e.change_pct)) { c.change += e.change_pct; c.priced++; }
    categories.set(e.category, c);
  }
  return { up, down, flat, total, categories: [...categories].map(([name, c]) => ({ name, count: c.count, turnover: c.turnover,
    average: c.priced ? c.change / c.priced : null, share: total ? c.turnover / total * 100 : 0 })).sort((a, b) => b.turnover - a.turnover) };
}
