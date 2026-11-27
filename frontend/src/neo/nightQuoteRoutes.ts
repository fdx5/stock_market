import { NEO_GROUPS } from "./navigation";

const menuRoots = NEO_GROUPS.filter(group => ["markets", "rankings", "etfs"].includes(group.id))
  .flatMap(group => group.links.map(([to]) => to.split("?")[0]));
const pages = new Set([...menuRoots, "/etf", "/ranking/us-etf", "/map", "/kospi-map", "/kosdaq-map", "/sp500-map", "/nasdaq100-map", "/community/kr", "/community/global"]);

/** 미국 증시(/global…)·S&P500·나스닥100 지도: NQ day/night badges instead of the KOSPI 200 night quote. */
export const showNasdaqFutures = (path: string) => {
  const base = path.replace(/\/$/, "");
  return ["/sp500-map", "/nasdaq100-map", "/global"].includes(base) || base.startsWith("/global/");
};

/** 관제 홈·국내 증시: NQ day/night badges after the Treasury badge, only while that window trades. */
export const showOpenNasdaqFutures = (path: string) => ["/", "/desk"].includes(path === "/" ? path : path.replace(/\/$/, ""));

export function showNightQuote(path: string, search = "") {
  if (path === "/world-markets") return false;
  if (path.startsWith("/etf/")) return true;
  if (pages.has(path) || menuRoots.some(root => root !== "/" && path.startsWith(`${root}/`))) return true;
  return path.startsWith("/stock/") && new URLSearchParams(search).get("asset")?.toUpperCase() === "ETF";
}
