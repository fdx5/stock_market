import { NEO_GROUPS } from "./navigation";

// Major destinations reuse the site's canonical URLs and bilingual labels.
const routes: Record<string, string[]> = {
  markets: ["/", "/desk", "/global", "/world-markets", "/pulse-board", "/hot-issues", "/stocks", "/kospi", "/kosdaq", "/nasdaq"],
  maps: ["/map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map", "/realestate-map"],
  etfs: ["/etf/kr", "/etf/us"],
  intelligence: ["/market-brief", "/news", "/ai-prediction", "/ai-prediction/grading", "/investors", "/investment-videos", "/dram-price", "/guides"],
  rankings: ["/kospi-100", "/kosdaq-100", "/nasdaq-100", "/global-top100", "/fight", "/battle", "/index/kospi", "/index/kosdaq"],
  assets: ["/prices/usd-krw", "/prices/bitcoin", "/prices/ethereum", "/prices/xrp", "/prices/wti", "/prices/gold", "/prices/silver"],
  explore: ["/community/kr", "/community/global", "/community/property", "/discussion-explorer", "/kospi-orbit", "/kosdaq-orbit", "/nasdaq100-orbit", "/drone-explore", "/market-bubbles", "/hub", "/support"],
};
export const MOBILE_MENU_GROUPS = Object.entries(routes).map(([id, paths]) => {
  const group = NEO_GROUPS.find(value => value.id === id)!;
  return { ...group, links: group.links.filter(([to]) => paths.includes(to.split("?")[0])) };
});
export const MOBILE_SHORTCUTS = [
  { to: "/desk", ko: "국내 증시", en: "Korea desk", icon: "chart" },
  { to: "/global", ko: "미국 증시", en: "US desk", icon: "globe" },
  { to: "/map", ko: "시장 지도", en: "Market maps", icon: "map" },
  { to: "/hot-issues", ko: "오늘의 핫이슈", en: "Hot issues", icon: "bolt" },
] as const;
const exactPaths = new Set(MOBILE_MENU_GROUPS.flatMap(group => group.links.map(([to]) => to.split("?")[0])));
export const menuLinkActive = (to: string, path: string) => {
  const target = to.split("?")[0];
  return path === target || target !== "/" && path.startsWith(`${target}/`) &&
    !exactPaths.has(path);
};
export const filterMobileMenu = (search: string) => {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, "");
  const query = normalize(search);
  return MOBILE_MENU_GROUPS.map(group => ({ ...group, links: group.links.filter(([to, ko, en]) =>
    !query || normalize(`${ko} ${en} ${to}`).includes(query) || normalize(`${group.ko} ${group.en}`).includes(query)) })).filter(group => group.links.length);
};
