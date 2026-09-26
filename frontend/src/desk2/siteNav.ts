/** The site index: the masthead's menu, and the admin monitor's, from one list so the
 * two cannot drift apart. Its own module so the monitor does not pull in the masthead. */
export const SITE_NAV: { to: string; ko: string; en: string; tag?: string }[] = [
  { to: "/desk", ko: "1면", en: "Front page" },
  { to: "/global", ko: "해외증시", en: "World" },
  { to: "/stocks", ko: "종목정보", en: "Stocks" },
  { to: "/stock/005930", ko: "종목상세", en: "Stock detail" },
  { to: "/map", ko: "코스피 지도", en: "KOSPI map" },
  { to: "/kosdaq-map", ko: "코스닥 지도", en: "KOSDAQ map" },
  { to: "/sp500-map", ko: "S&P500 지도", en: "S&P 500 map" },
  { to: "/nasdaq100-map", ko: "나스닥 지도", en: "NASDAQ map" },
  { to: "/realestate-map", ko: "부동산 지도", en: "Real estate map" },
  { to: "/etf", ko: "ETF", en: "ETF" },
  { to: "/market-brief", ko: "오늘 브리핑", en: "Daily brief" },
  { to: "/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK", ko: "종목토론", en: "Discussions" },
  { to: "/market-bubbles", ko: "증시버블", en: "Bubbles" },
  { to: "/kospi-orbit", ko: "증시궤도", en: "Market orbit" },
  { to: "/kospi-100", ko: "TOP100", en: "TOP 100" },
  { to: "/ai-prediction", ko: "AI예측", en: "AI forecast" },
  { to: "/global-top100", ko: "글로벌시총", en: "Global caps" },
  { to: "/fight", ko: "시총대결", en: "Cap fight" },
  { to: "/news", ko: "뉴스", en: "News" },
];
