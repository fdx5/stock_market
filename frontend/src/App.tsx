import { lazy, Suspense } from "react";
import { useT } from "./i18n/LanguageContext";
import { useRoute } from "./router";

// Route-level code splitting: each page only ships the JS it actually needs (e.g. the
// map pages never pull in lightweight-charts, which only Dashboard/IndexChart/
// InvestorTrend use) instead of every route's code landing in one bundle regardless
// of which page a visitor lands on first.
const Dashboard = lazy(() => import("./components/Dashboard"));
const InvestorTrendPage = lazy(() => import("./components/InvestorTrendPage"));
const IndexChartPage = lazy(() => import("./components/IndexChartPage"));
const KospiMapPage = lazy(() => import("./components/KospiMapPage"));
const KosdaqMapPage = lazy(() => import("./components/KosdaqMapPage"));
const TugOfWarPage = lazy(() => import("./components/TugOfWarPage"));
const MarketCapFightPage = lazy(() => import("./components/MarketCapFightPage"));
const NewsPage = lazy(() => import("./components/NewsPage"));

function RouteFallback() {
  const t = useT();
  return <div className="loading-state">{t("데이터를 불러오는 중...")}</div>;
}

export default function App() {
  const path = useRoute();

  let page;
  const investorMatch = path.match(/^\/investor\/([^/]+)\/?$/);
  const indexMatch = path.match(/^\/index\/(kospi|kosdaq)\/?$/i);
  if (investorMatch) {
    page = <InvestorTrendPage code={investorMatch[1]} />;
  } else if (indexMatch) {
    page = <IndexChartPage symbol={indexMatch[1].toUpperCase() as "KOSPI" | "KOSDAQ"} />;
  } else if (path === "/map") {
    page = <KospiMapPage />;
  } else if (path === "/kosdaq-map") {
    page = <KosdaqMapPage />;
  } else if (path === "/battle") {
    page = <TugOfWarPage />;
  } else if (path === "/fight") {
    page = <MarketCapFightPage />;
  } else if (path === "/news") {
    page = <NewsPage />;
  } else {
    page = <Dashboard />;
  }

  return <Suspense fallback={<RouteFallback />}>{page}</Suspense>;
}
