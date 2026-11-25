export const MARKET_NAMES = { kospi: "코스피", kosdaq: "코스닥", nasdaq100: "나스닥 100" } as const;
export type PublicMarket = keyof typeof MARKET_NAMES;
export function publicMarket(search: string): PublicMarket {
  const value = new URLSearchParams(search).get("market");
  return value && Object.prototype.hasOwnProperty.call(MARKET_NAMES, value) ? value as PublicMarket : "kospi";
}
export function todayPath(market: PublicMarket): string {
  return market === "kospi" ? "/today" : `/today?market=${market}`;
}
export const MOVERS_EDITION = /^\/movers\/(\d{4}-\d{2}-\d{2})\/(0920|1230|1600)\/?$/;
export const US_MOVERS_EDITION = /^\/movers\/us\/(\d{4}-\d{2}-\d{2})\/(2230|0040|0640)\/?$/;
export const HOT_ISSUE_EDITION = /^\/hot-issues\/(\d{4}-\d{2}-\d{2})\/(0700|2200)\/?$/;
const PUBLIC_PATHS = new Set(["/", "/today", "/share-market", "/map", "/kosdaq-map", "/nasdaq100-map", "/sp500-map", "/desk", "/stocks", "/global", "/etf", "/news", "/market-brief", "/hot-issues", "/movers", "/movers/us", "/guides", "/kospi-100", "/kosdaq-100", "/nasdaq-100", "/ranking/trading-value", "/community/kr", "/community/global", "/community/property", "/exchange"]);
/** Share only public routes and enumerated market choices, never the current raw URL. */
export function publicSharePath(path: string, search = ""): string | null {
  const clean = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (!PUBLIC_PATHS.has(clean) && !/^\/etf\/(kr|us)$/.test(clean) && !/^\/stock\/[A-Za-z0-9.-]{1,16}(\/(report|investor|outlook|news))?$/.test(clean)
    && !HOT_ISSUE_EDITION.test(clean) && !MOVERS_EDITION.test(clean) && !US_MOVERS_EDITION.test(clean) && !/^\/guides\/(stock-heatmap|trading-value|etf-comparison)$/.test(clean)
    && !/^\/market-brief\/\d{4}-\d{2}-\d{2}\/(kospi|kosdaq)$/.test(clean)) return null;
  const params = new URLSearchParams(search);
  const code = params.get("code")?.toUpperCase() || "";
  if ((clean === "/desk" && /^\d{6}$/.test(code)) || (clean === "/global" && /^[A-Z][A-Z0-9.-]{0,15}$/.test(code))) return `/stock/${code}`;
  if (clean === "/etf" && params.get("region") === "US") return "/etf?region=US";
  if (clean === "/today") return todayPath(publicMarket(search));
  return clean === "/share-market" && publicMarket(search) !== "kospi" ? `${clean}?market=${publicMarket(search)}` : clean;
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

export function todayMetadata(market: PublicMarket) {
  const name = MARKET_NAMES[market];
  if (market === "nasdaq100") {
    return {
      title: `오늘 ${name} 상승·하락 종목과 업종별 등락률 | KOSPIMAP`,
      description: `오늘 ${name} 지도에 포함된 주요 종목의 상승·하락과 업종별 등락률을 확인하세요. 시장 히트맵을 열어 종목별 시세를 볼 수 있습니다.`,
    };
  }
  return {
    title: `오늘 ${name} 상승·하락 종목과 거래대금 순위 | KOSPIMAP`,
    description: `오늘 ${name} 지도에 포함된 주요 종목의 상승·하락, 거래대금 순위와 업종별 등락률을 확인하세요. 시장 히트맵을 열어 종목별 시세를 볼 수 있습니다.`,
  };
}
