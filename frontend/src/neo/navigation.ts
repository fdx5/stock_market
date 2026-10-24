import { SERVICES } from "../markets/catalog";
const BASE_NEO_GROUPS = [
  { id: "markets", ko: "마켓 워크스페이스", en: "Markets", icon: "chart", links: [
    ["/", "관제 홈", "Command home"], ["/desk", "국내 증시", "Korea desk"], ["/global", "미국 증시", "US desk"], ["/stocks", "종목 탐색", "Stock explorer"], ["/etf", "ETF 마켓", "ETF market"],
  ] },
  { id: "maps", ko: "시장 지도", en: "Market maps", icon: "map", links: [
    ["/map", "코스피 맵", "KOSPI map"], ["/kosdaq-map", "코스닥 맵", "KOSDAQ map"], ["/sp500-map", "S&P 500 맵", "S&P 500 map"], ["/nasdaq100-map", "나스닥 100 맵", "NASDAQ 100 map"], ["/realestate-map", "부동산 실거래", "Real estate"],
  ] },
  { id: "intelligence", ko: "인텔리전스", en: "Intelligence", icon: "spark", links: [
    ["/market-brief", "오늘 브리핑", "Daily briefing"], ["/news", "마켓 뉴스", "Market news"], ["/ai-prediction", "AI 예측", "AI forecast"], ["/ai-prediction/grading", "예측 채점표", "Forecast results"], ["/investors", "거물 포트폴리오", "Investor portfolios"], ["/investment-videos", "투자 영상", "Video briefing"], ["/dram-price", "D램 가격", "DRAM prices"],
  ] },
  { id: "rankings", ko: "순위 · 비교", en: "Rankings", icon: "layers", links: [
    ["/kospi-100", "코스피 TOP 100", "KOSPI TOP 100"], ["/kosdaq-100", "코스닥 TOP 100", "KOSDAQ TOP 100"], ["/nasdaq-100", "나스닥 TOP 100", "NASDAQ TOP 100"], ["/global-top100", "글로벌 시가총액", "Global market caps"], ["/fight", "시가총액 대결", "Market-cap battle"], ["/battle", "시장 줄다리기", "Market tug of war"], ["/index/kospi", "코스피 지수", "KOSPI chart"], ["/index/kosdaq", "코스닥 지수", "KOSDAQ chart"],
  ] },
  { id: "assets", ko: "환율 · 가상자산 · 원자재", en: "FX · crypto · commodities", icon: "chart", links: [
    ["/prices/usd-krw", "원/달러 환율", "USD/KRW"], ["/prices/bitcoin", "비트코인", "Bitcoin"], ["/prices/ethereum", "이더리움", "Ethereum"], ["/prices/xrp", "리플 XRP", "XRP"], ["/prices/wti", "WTI 유가 선물", "WTI futures"], ["/prices/gold", "금 선물", "Gold futures"], ["/prices/silver", "은 선물", "Silver futures"],
  ] },
  { id: "explore", ko: "탐험 · 커뮤니티", en: "Explore", icon: "orbit", links: [
    ["/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", "종목 토론", "Discussions"], ["/kospi-orbit", "코스피 궤도", "KOSPI orbit"], ["/kosdaq-orbit", "코스닥 궤도", "KOSDAQ orbit"], ["/nasdaq100-orbit", "나스닥 궤도", "NASDAQ orbit"], ["/drone-explore", "드론 탐험", "Drone explorer"], ["/market-bubbles", "증시 버블", "Market bubbles"], ["/market-bubbles2", "증시 버블 NEO", "Market bubbles NEO"], ["/hub", "태양계 입구", "Solar entrance"], ["/support", "커피 한 잔 후원", "Support KOSPIMAP"], ["/desk2", "클래식 데스크", "Classic desk"],
  ] },
 ] as const;
const RESEARCH_SECTION: Record<string,string> = {
  "/markets":"markets", "/market-inside":"markets", "/stock-context":"markets", "/etf-overlap":"markets", "/etf-tradeoffs":"markets", "/dividend-reality":"markets",
  "/stock-tradeoffs":"rankings", "/recovery-lab":"rankings", "/market-radar":"rankings", "/stock-screener":"rankings", "/stock-compare":"rankings", "/sector-strength":"rankings", "/global-peers":"rankings", "/sector-replay":"rankings",
  "/currency-lens":"assets", "/rate-paths":"assets", "/commodity-impact":"assets", "/macro-context":"assets", "/yield-curve-lab":"assets", "/bond-tradeoffs":"assets", "/crypto-inside":"assets", "/crypto-liquidity":"assets", "/derivatives-context":"assets",
};
export const NEO_GROUPS = BASE_NEO_GROUPS.map(group => ({...group, links:[...group.links, ...SERVICES.filter(s => (RESEARCH_SECTION[s.path] ?? "intelligence") === group.id).map(s => [s.path,s.name,s.name] as const)]}));
export function routeLabel(path: string, lang: "ko" | "en") {
  const link = NEO_GROUPS.flatMap(group => [...group.links]).find(link => link[0].split("?")[0] === path);
  if (link) return link[lang === "ko" ? 1 : 2];
  if (path.startsWith("/stock/")) return lang === "ko" ? "종목 분석" : "Stock intelligence";
  if (path.startsWith("/investor")) return lang === "ko" ? "투자자 분석" : "Investor intelligence";
  if (path.startsWith("/market-brief/")) return lang === "ko" ? "마켓 브리핑" : "Market briefing";
  if (path.startsWith("/admin")) return lang === "ko" ? "관리 워크스페이스" : "Administration";
  return lang === "ko" ? "마켓 인텔리전스" : "Market intelligence";
}
export function neoRouteFamily(path: string) {
  if (/^\/(drone-explore|drive|hub|type2|market-bubbles2?|.*-orbit|discussion-explorer)(\/|$)/.test(path)) return "immersive";
  if (/map$/.test(path)) return "map";
  if (/^\/stock\//.test(path)) return "stock";
  if (/^\/(news|market-brief|investment-videos|investors)(\/|$)/.test(path)) return "editorial";
  return "workspace";
}

export function neoHeaderCurrentTone(path: string, search = ""): "gold" | "violet" {
  const intelligence = NEO_GROUPS.find(group => group.id === "intelligence")!;
  const inIntelligence = intelligence.links.some(([to]) => path === to || path.startsWith(`${to}/`)) || path.startsWith("/investor/");
  const inEtf = path === "/etf" || path.startsWith("/etf/") || (path.startsWith("/stock/") && new URLSearchParams(search).get("asset")?.toUpperCase() === "ETF");
  return neoRouteFamily(path) === "map" || inEtf || inIntelligence ? "violet" : "gold";
}
