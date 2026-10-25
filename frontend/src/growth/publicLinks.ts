export const MARKET_NAMES = { kospi: "코스피", kosdaq: "코스닥", nasdaq100: "나스닥 100" } as const;
export type PublicMarket = keyof typeof MARKET_NAMES;
export function publicMarket(search: string): PublicMarket {
  const value = new URLSearchParams(search).get("market");
  return value && Object.prototype.hasOwnProperty.call(MARKET_NAMES, value) ? value as PublicMarket : "kospi";
}
const PUBLIC_PATHS = new Set(["/", "/today", "/share-market", "/map", "/kosdaq-map", "/nasdaq100-map", "/sp500-map", "/desk", "/stocks", "/global", "/etf", "/news", "/market-brief", "/guides", "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/ranking/trading-value"]);
/** Share only public routes and enumerated market choices, never the current raw URL. */
export function publicSharePath(path: string, search = ""): string | null {
  const clean = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (!PUBLIC_PATHS.has(clean) && !/^\/stock\/[A-Za-z0-9.-]{1,16}(\/(report|investor|outlook|news))?$/.test(clean)
    && !/^\/guides\/(stock-heatmap|trading-value|etf-comparison)$/.test(clean)
    && !/^\/market-brief\/\d{4}-\d{2}-\d{2}\/(kospi|kosdaq)$/.test(clean)) return null;
  return ["/today", "/share-market"].includes(clean) && publicMarket(search) !== "kospi" ? `${clean}?market=${publicMarket(search)}` : clean;
}
export function publicShareUrl(path: string, search = "", source: "copy" | "native" = "copy"): string | null {
  const safe = publicSharePath(path, search);
  if (!safe) return null;
  const url = new URL(safe, "https://kospimap.com");
  url.searchParams.set("utm_source", source === "native" ? "native_share" : "link_copy");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "free_distribution");
  return url.href;
}
export const GROWTH_SEO: Record<string, { title: string; description: string }> = {
  "/today": { title: "오늘 증시 한눈에 · 코스피·코스닥 상승·하락·거래 집중 | K-Stock Hub", description: "코스피·코스닥·나스닥 100 지도 표본의 상승·하락 종목, 거래 집중과 업종 흐름을 실제 시세로 비교하세요. 시장 카드 공유와 RSS 구독을 제공합니다." },
  "/share-market": { title: "증시 카드 공유·시장 위젯 퍼가기 | K-Stock Hub", description: "실제 시장 요약 카드를 내려받고, 외부 사이트용 증시 위젯과 공유 링크를 만들어 보세요." },
};
