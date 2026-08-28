import { lazy, Suspense, useEffect } from "react";
import LoadingState from "./components/LoadingState";
import { useActivityTracking } from "./useActivityTracking";
import { navigate, useRoute } from "./router";
import "./components/marketBriefPrint.css";

// Route-level code splitting: each page only ships the JS it actually needs (e.g. the
// map pages never pull in lightweight-charts, which only Dashboard/IndexChart/
// InvestorTrend use) instead of every route's code landing in one bundle regardless
// of which page a visitor lands on first.
/* The market desk — the stock desk rebuilt around what a reader actually does
   with it, reached through the wormhole off Saturn. It carries everything
   /dashboard carries and reuses the same components to do it, so the two are
   the same information in two arrangements rather than two codebases; what
   differs is the order, the grouping and what is on screen at once. */
const MarketDeskPage = lazy(() => import("./components/MarketDeskPage"));
/* The entrance. "/" is a gateway rather than a dashboard — the stock desk it
   used to be is reached from the star at the centre of the page, and anything
   that means "open a stock" targets /desk?code=.

   The desk moved. Every link on the site — the star and the two stock moons in
   the sky, every page's home link and back link, the footer, and every "open
   this stock" from a map tile, a board card or a prediction row — now points at
   /desk, and the command palette's own "클래식 대시보드" entry is the last
   thing on the site that still points at /dashboard on purpose. Old
   bookmarks, shared links and search results keep sending real traffic there
   regardless — see DashboardRedirect below, which is the whole handling that
   gets any of it onto the desk instead of the retired page.

   Two entrances have been built against that same site map. This is the second
   one: the solar system rendered in WebGL rather than in CSS 3D transforms.
   The first one — components/Hub.tsx, with hub.css and CelestialBody.tsx —
   is deliberately still in the tree but is no longer routed anywhere, so it
   ships in no chunk and is reachable from no URL. It is kept, not deleted, so
   the CSS-3D version stays available to read and to bring back; putting it
   back online is one `else if` here. Note that it is still type-checked, since
   tsconfig includes all of src/.

   Lazy like every other route and, unlike the CSS one, genuinely worth it:
   this chunk pulls in three.js and its post-processing stack. */
const HubType2 = lazy(() => import("./components/HubType2"));
const InvestorTrendPage = lazy(() => import("./components/InvestorTrendPage"));
const IndexChartPage = lazy(() => import("./components/IndexChartPage"));
// The three sibling card boards — top 100 by size, grouped by 업종. All three render
// the same component, so they share a chunk rather than shipping three copies of it.
const KospiBoardPage = lazy(() => import("./components/KospiBoardPage"));
const KosdaqBoardPage = lazy(() => import("./components/KosdaqBoardPage"));
const NasdaqBoardPage = lazy(() => import("./components/NasdaqBoardPage"));
const KospiMapPage = lazy(() => import("./components/KospiMapPage"));
const KosdaqMapPage = lazy(() => import("./components/KosdaqMapPage"));
const Sp500MapPage = lazy(() => import("./components/Sp500MapPage"));
const Nasdaq100MapPage = lazy(() => import("./components/Nasdaq100MapPage"));
const TugOfWarPage = lazy(() => import("./components/TugOfWarPage"));
const GlobalStockPage = lazy(() => import("./components/GlobalStockPage"));
const MarketCapFightPage = lazy(() => import("./components/MarketCapFightPage"));
const GlobalTop100Page = lazy(() => import("./components/GlobalTop100Page"));
const EtfPage = lazy(() => import("./components/EtfPage"));
const NewsPage = lazy(() => import("./components/NewsPage"));
const MarketBriefPage = lazy(() => import("./components/MarketBriefPage"));
const AiPredictionPage = lazy(() => import("./components/AiPredictionPage"));
const PredictionGradingPage = lazy(() => import("./components/PredictionGradingPage"));
// Pulls in lightweight-charts, so it stays out of every other route's bundle.
const DramPriceHistoryPage = lazy(() => import("./components/DramPriceHistoryPage"));
const DiscussionExplorerPage = lazy(() => import("./components/DiscussionExplorerPage"));
const MarketBubblePage = lazy(() => import("./components/MarketBubblePage"));
const MarketBubbleType2 = lazy(() => import("./components/MarketBubbleType2"));
const KospiOrbitPage = lazy(() => import("./components/KospiOrbitPage"));
const StocksPage = lazy(() => import("./components/StocksPage"));
const AdminLoginPage = lazy(() => import("./components/AdminLoginPage"));
const AdminDashboardPage = lazy(() => import("./components/AdminDashboardPage"));
const AdminDbPage = lazy(() => import("./components/AdminDbPage"));
const AdminGrowthPage = lazy(() => import("./components/AdminGrowthPage"));
const AdminLivePage = lazy(() => import("./components/AdminLivePage"));
// The neuron monitor is the one route that pulls in three.js. Lazy like every other
// page, so that ~150KB gzipped lands only when an admin actually opens it and never
// touches a visitor's bundle.
const MonitorPage = lazy(() => import("./components/MonitorPage"));
// Floating "최근 본 종목" rail — docked outside the content column on wide
// desktop viewports, only on the pages in RECENT_DOCK_PATHS below. Lazy and
// wrapped in its own silent Suspense so it never delays the page it floats
// beside, and self-hides on any allowed route without enough gutter room for
// it — see RecentStocksDock.tsx.
const RecentStocksDock = lazy(() => import("./components/RecentStocksDock"));

/** The one handling old /dashboard traffic gets: straight to the desk, query
 * string carried along as-is (?code=/&name= are exactly what MarketDeskPage
 * itself reads off /desk). Rendered instead of <Dashboard/> so a visitor who
 * still has the old URL bookmarked never sees the retired page, even briefly
 * — Dashboard's own chunk is never requested for this path. */
function DashboardRedirect() {
  useEffect(() => {
    navigate(`/desk${window.location.search}`);
  }, []);
  return null;
}

const PUBLIC_PAGE_SEO: Record<string, { title: string; description: string }> = {
  "/": {
    title: "K-Stock Hub | 코스피·코스닥·미국 주식 시세와 ETF",
    description: "코스피·코스닥·미국 증시 시세와 시가총액 맵, 주식·ETF 거래대금 순위, 뉴스와 종목토론을 한눈에 확인하세요.",
  },
  "/desk": {
    title: "오늘의 주식 시황과 실시간 시세 | K-Stock Hub",
    description: "코스피·코스닥 시장 현황, 국내외 주식 실시간 시세, 거래대금·상승·하락 종목 순위와 주요 뉴스를 확인하세요.",
  },
  "/map": {
    title: "코스피 시가총액 맵·주식 히트맵 | K-Stock Hub",
    description: "코스피 상위 500개 종목을 시가총액 비중과 등락률로 표현한 실시간 주식 히트맵입니다. 업종별 시장 흐름을 한눈에 확인하세요.",
  },
  "/kosdaq-map": {
    title: "코스닥 시가총액 맵·주식 히트맵 | K-Stock Hub",
    description: "코스닥 주요 종목의 시가총액 비중과 등락률을 업종별 히트맵으로 비교하고 오늘의 시장 흐름을 확인하세요.",
  },
  "/sp500-map": {
    title: "S&P500 시가총액 맵·미국 주식 히트맵 | K-Stock Hub",
    description: "S&P500 종목의 시가총액 비중과 등락률을 한눈에 비교하는 미국 주식 시장 히트맵입니다.",
  },
  "/nasdaq100-map": {
    title: "나스닥100 시가총액 맵·미국 증시 | K-Stock Hub",
    description: "나스닥100 주요 기술주의 시가총액 비중과 등락률을 실시간 주식 히트맵으로 확인하세요.",
  },
  "/etf": {
    title: "국내·미국 ETF 순위와 거래대금 | K-Stock Hub",
    description: "국내 ETF와 미국 ETF의 시세, 등락률, 수익률과 거래대금 순위를 검색하고 비교하세요.",
  },
  "/kospi-100": {
    title: "코스피 시가총액·거래대금 순위 TOP 100 | K-Stock Hub",
    description: "코스피 종목의 시가총액, 거래대금, 상승률과 하락률 순위를 빠르게 비교하세요.",
  },
  "/kosdaq-100": {
    title: "코스닥 시가총액·거래대금 순위 TOP 100 | K-Stock Hub",
    description: "코스닥 종목의 시가총액, 거래대금, 상승률과 하락률 순위를 확인하세요.",
  },
  "/nasdaq-100": {
    title: "나스닥 종목 시세와 순위 TOP 100 | K-Stock Hub",
    description: "나스닥 주요 종목의 주가, 시가총액, 거래량과 등락률 순위를 비교하세요.",
  },
  "/global-top100": {
    title: "세계 기업 시가총액 순위 TOP 100 | K-Stock Hub",
    description: "글로벌 기업 시가총액 순위와 국가·업종별 주요 기업 정보를 한눈에 확인하세요.",
  },
  "/discussion-explorer": {
    title: "주식·ETF 종목토론 | K-Stock Hub",
    description: "국내외 주식과 ETF의 최근 게시글과 댓글을 3D 공간에서 탐색하고 종목별 투자자 의견을 확인하세요.",
  },
  "/market-bubbles": {
    title: "증시버블 · 시가총액 TOP 20 | K-Stock Hub",
    description: "코스피·코스닥·나스닥 시가총액 상위 20개 종목의 현재가와 등락률을 움직이는 버블로 확인하세요.",
  },
  "/market-bubbles2": {
    title: "증시버블 NEO · 3D 은하 시가총액 | K-Stock Hub",
    description: "코스피·코스닥·나스닥 시가총액 TOP 20을 심우주 은하에서 탐험하세요. 워프 이동, 시네마 투어, 레이더 탐색과 실시간 버스트 이펙트로 종목 흐름을 확인할 수 있습니다.",
  },
  "/kospi-orbit": {
    title: "코스피 증시궤도 · 업종과 주도주 3D 시각화 | K-Stock Hub",
    description: "코스피 시가총액과 등락률을 3D 항성계로 탐색하고 오늘의 주도 업종, 급등주와 거래 집중 종목을 한눈에 확인하세요.",
  },
  "/kosdaq-orbit": {
    title: "코스닥 증시궤도 · 업종과 주도주 3D 시각화 | K-Stock Hub",
    description: "코스닥 주요 종목의 시가총액과 등락률을 3D 궤도로 비교하고 강한 업종과 오늘의 주도주를 빠르게 확인하세요.",
  },
  "/nasdaq100-orbit": {
    title: "나스닥100 증시궤도 · 미국 주식 3D 시각화 | K-Stock Hub",
    description: "나스닥100 시가총액과 등락률을 3D 우주에서 탐색하고 미국 증시 주도 업종과 강한 종목을 한눈에 확인하세요.",
  },
  "/ai-prediction": {
    title: "AI 주가 예측과 종목 분석 | K-Stock Hub",
    description: "국내 주식과 미국 주식의 AI 예측 결과, 근거 지표와 과거 예측 채점 결과를 확인하세요.",
  },
  "/news": {
    title: "오늘의 국내외 증시 뉴스 | K-Stock Hub",
    description: "국내 증시와 미국 증시에 영향을 주는 주요 글로벌 경제·기업 뉴스를 한곳에서 확인하세요.",
  },
  "/market-brief": {
    title: "오늘 브리핑 | K-Stock Hub",
    description: "오늘 코스피·코스닥 종가, 외국인·기관 수급, 거래대금, 상승 종목 비중과 업종 흐름을 분석한 데이터 기반 오늘 브리핑입니다.",
  },
  "/fight": {
    title: "기업 시가총액 비교·시총대결 | K-Stock Hub",
    description: "국내외 주요 기업의 시가총액과 기업 정보를 직관적으로 비교하세요.",
  },
  "/dram-price": {
    title: "D램·메모리 반도체 가격 추이 | K-Stock Hub",
    description: "D램 현물가격과 메모리 반도체 가격 변화를 기간별 차트로 확인하세요.",
  },
};

// Pages the recent-stocks dock is allowed on — the reader-facing "browsing a
// stock or a ranking" surfaces, not the maps, battles, admin tools or the two
// full-bleed 3D pages. Deliberately an explicit allowlist rather than "every
// page with an .app column": that would also cover the map pages, /battle,
// /ai-prediction/grading and friends, none of which were asked for.
const RECENT_DOCK_PATHS = new Set([
  "/desk", "/global", "/etf", "/kospi-100", "/kosdaq-100", "/nasdaq-100",
  "/ai-prediction", "/global-top100", "/fight", "/news",
]);

export default function App() {
  const path = useRoute();
  const briefMatch = path.match(/^\/market-brief\/(\d{4}-\d{2}-\d{2})\/(kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco|\d{6})\/?$/i);
  const stockMatch = path.match(/^\/stock\/(\d{6})\/?$/);
  useActivityTracking(path);

  useEffect(() => {
    let canonicalPath = path === "/type2" ? "/" : path;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code")?.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 16) || "";
    const keepsStockCode = code && ["/desk", "/global", "/discussion-explorer"].includes(canonicalPath);
    const canonicalName = params.get("name")?.replace(/[<>\r\n]/g, "").trim().slice(0, 80) || "";
    if (canonicalPath === "/desk" && /^\d{6}$/.test(code)) canonicalPath = `/stock/${code}`;
    const canonicalQuery = keepsStockCode && !canonicalPath.startsWith("/stock/")
      ? `?code=${encodeURIComponent(code)}${canonicalName ? `&name=${encodeURIComponent(canonicalName)}` : ""}`
      : "";
    const canonicalUrl = `https://kospi-predictor.onrender.com${canonicalPath}${canonicalQuery}`;
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);

    const seo = briefMatch
      ? PUBLIC_PAGE_SEO["/market-brief"]
      : stockMatch || canonicalPath.startsWith("/stock/")
        ? PUBLIC_PAGE_SEO["/desk"]
        : PUBLIC_PAGE_SEO[canonicalPath];
    if (!seo) return;
    const name = canonicalName || code;
    const briefRaw = briefMatch ? briefMatch[2].toUpperCase() : "";
    const nameMap: Record<string, string> = {
      "SAMSUNG": "삼성전자", "005930": "삼성전자",
      "HYNIX": "SK하이닉스", "000660": "SK하이닉스",
      "HYUNDAI": "현대차", "005380": "현대차",
      "SKSQUARE": "SK스퀘어", "402340": "SK스퀘어",
      "SEMCO": "삼성전기", "009150": "삼성전기",
    };
    const displayMarketName = nameMap[briefRaw] || briefRaw;
    const briefTitle = briefMatch
      ? `${briefMatch[1]} ${displayMarketName} 오늘 브리핑 | K-Stock Hub`
      : "";
    const stockPageCode = stockMatch?.[1] || (canonicalPath.startsWith("/stock/") ? code : "");
    const title = briefTitle || (stockPageCode ? `${name || stockPageCode} 주가·차트·종목정보 | K-Stock Hub` : keepsStockCode && name ? `${name} 주가·차트·종목정보 | K-Stock Hub` : seo.title);
    const description = briefMatch
      ? `${briefMatch[1]} ${displayMarketName} 종가, 외국인·기관 수급, 거래대금과 핵심 이슈 및 확인할 사항을 분석한 오늘 브리핑입니다.`
      : stockPageCode ? `${name || stockPageCode}(${stockPageCode}) 현재가, 등락률, 차트, 외국인·기관 수급과 최신 종목 정보를 확인하세요.`
      : keepsStockCode && name ? `${name}(${code}) 현재가, 등락률, 차트와 최신 종목 정보를 확인하세요.` : seo.description;
    document.title = title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute("content", description);
    document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.setAttribute("content", briefMatch ? "article" : "website");
    document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.setAttribute("content", title);
    document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')?.setAttribute("content", description);
    const image = briefMatch
      ? `https://kospi-predictor.onrender.com/market-brief/og/${briefMatch[1]}/${briefMatch[2].toLowerCase()}.png`
      : "https://kospi-predictor.onrender.com/img/kospi-map-preview.png";
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.setAttribute("content", image);
    document.querySelector<HTMLMetaElement>('meta[property="og:image:secure_url"]')?.setAttribute("content", image);
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.setAttribute("content", image);
    const imageAlt = briefMatch
      ? `${briefMatch[1]} ${displayMarketName} 오늘 브리핑 핵심 지표`
      : "K-Stock Hub 시장 데이터";
    document.querySelector<HTMLMetaElement>('meta[property="og:image:alt"]')?.setAttribute("content", imageAlt);
    document.querySelector<HTMLMetaElement>('meta[name="twitter:image:alt"]')?.setAttribute("content", imageAlt);
  }, [path]);

  let page;
  const investorMatch = path.match(/^\/investor\/([^/]+)\/?$/);
  const indexMatch = path.match(/^\/index\/(kospi|kosdaq)\/?$/i);
  if (investorMatch) {
    page = <InvestorTrendPage code={investorMatch[1]} />;
  } else if (indexMatch) {
    page = <IndexChartPage symbol={indexMatch[1].toUpperCase() as "KOSPI" | "KOSDAQ"} />;
  } else if (path === "/dashboard") {
    page = <DashboardRedirect />;
  } else if (path === "/desk") {
    page = <MarketDeskPage />;
  } else if (stockMatch) {
    page = <MarketDeskPage key={stockMatch[1]} initialCode={stockMatch[1]} />;
  } else if (path === "/stocks") {
    page = <StocksPage />;
  } else if (path === "/kospi-100") {
    page = <KospiBoardPage />;
  } else if (path === "/kosdaq-100") {
    page = <KosdaqBoardPage />;
  } else if (path === "/nasdaq-100") {
    page = <NasdaqBoardPage />;
  } else if (path === "/map") {
    page = <KospiMapPage />;
  } else if (path === "/kosdaq-map") {
    page = <KosdaqMapPage />;
  } else if (path === "/sp500-map") {
    page = <Sp500MapPage />;
  } else if (path === "/nasdaq100-map") {
    page = <Nasdaq100MapPage />;
  } else if (path === "/global") {
    page = <GlobalStockPage />;
  } else if (path === "/battle") {
    page = <TugOfWarPage />;
  } else if (path === "/fight") {
    page = <MarketCapFightPage />;
  } else if (path === "/global-top100") {
    page = <GlobalTop100Page />;
  } else if (path === "/etf") {
    page = <EtfPage />;
  } else if (path === "/news") {
    page = <NewsPage />;
  } else if (path === "/market-brief") {
    page = <MarketBriefPage />;
  } else if (briefMatch) {
    const raw = briefMatch[2].toUpperCase();
    const codeMap: Record<string, string> = {
      "005930": "SAMSUNG", "SAMSUNG": "SAMSUNG",
      "000660": "HYNIX", "HYNIX": "HYNIX",
      "005380": "HYUNDAI", "HYUNDAI": "HYUNDAI",
      "402340": "SKSQUARE", "SKSQUARE": "SKSQUARE",
      "009150": "SEMCO", "SEMCO": "SEMCO",
      "KOSPI": "KOSPI", "KOSDAQ": "KOSDAQ",
    };
    const normalized = codeMap[raw] || raw;
    page = (
      <MarketBriefPage
        initialDate={briefMatch[1]}
        initialMarket={normalized}
      />
    );
  } else if (path === "/ai-prediction") {
    page = <AiPredictionPage />;
  } else if (path === "/ai-prediction/grading") {
    page = <PredictionGradingPage />;
  } else if (path === "/dram-price") {
    page = <DramPriceHistoryPage />;
  } else if (path === "/discussion-explorer") {
    page = <DiscussionExplorerPage />;
  } else if (path === "/market-bubbles") {
    page = <MarketBubblePage />;
  } else if (path === "/market-bubbles2") {
    page = <MarketBubbleType2 />;
  } else if (path === "/kospi-orbit") {
    page = <KospiOrbitPage key="kospi-orbit" />;
  } else if (path === "/kosdaq-orbit") {
    page = <KospiOrbitPage key="kosdaq-orbit" market="kosdaq" />;
  } else if (path === "/nasdaq100-orbit" || path === "/sp500-orbit") {
    page = <KospiOrbitPage key="nasdaq100-orbit" market="nasdaq100" />;
  } else if (path === "/admin") {
    page = <AdminLoginPage />;
  } else if (path === "/admin/dashboard") {
    page = <AdminDashboardPage />;
  } else if (path === "/admin/monitor") {
    page = <MonitorPage />;
  } else if (path === "/admin/db") {
    page = <AdminDbPage />;
  } else if (path === "/admin/growth") {
    page = <AdminGrowthPage />;
  } else if (path === "/admin/live") {
    page = <AdminLivePage />;
  } else {
    // "/" and anything unrecognised land on the entrance rather than dropping
    // straight into the stock desk. "/type2" lands here too — it was this
    // page's address while it was being built alongside the old entrance, and
    // is kept working so that any link made in the meantime still resolves.
    page = <HubType2 />;
  }

  // /stock/:code is the canonical URL for the market desk (see the canonicalPath
  // rewrite above), so it counts as "/desk" for the dock's allowlist too.
  const showRecentDock = RECENT_DOCK_PATHS.has(path) || !!stockMatch;

  // The fallback stays silent for its first 2.5s (see LoadingState): a cached route
  // chunk resolves in milliseconds, and the old fallback made every navigation flash a
  // loading line before the page it was standing in for even had a chance to render.
  return (
    <>
      <Suspense fallback={<LoadingState />}>{page}</Suspense>
      {showRecentDock && (
        <Suspense fallback={null}>
          <RecentStocksDock />
        </Suspense>
      )}
    </>
  );
}
