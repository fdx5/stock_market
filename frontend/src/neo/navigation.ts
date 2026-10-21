export const NEO_GROUPS = [
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
  { id: "explore", ko: "탐험 · 커뮤니티", en: "Explore", icon: "orbit", links: [
    ["/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", "종목 토론", "Discussions"], ["/kospi-orbit", "코스피 궤도", "KOSPI orbit"], ["/kosdaq-orbit", "코스닥 궤도", "KOSDAQ orbit"], ["/nasdaq100-orbit", "나스닥 궤도", "NASDAQ orbit"], ["/market-bubbles", "증시 버블", "Market bubbles"], ["/market-bubbles2", "증시 버블 NEO", "Market bubbles NEO"], ["/drone-explore", "3D 드론 탐험", "Drone explorer"], ["/hub", "태양계 입구", "Solar entrance"], ["/support", "커피 한 잔 후원", "Support KOSPIMAP"], ["/desk2", "클래식 데스크", "Classic desk"],
  ] },
] as const;
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
