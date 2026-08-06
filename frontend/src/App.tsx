import { lazy, Suspense } from "react";
import LoadingState from "./components/LoadingState";
import { useActivityTracking } from "./useActivityTracking";
import { useRoute } from "./router";

// Route-level code splitting: each page only ships the JS it actually needs (e.g. the
// map pages never pull in lightweight-charts, which only Dashboard/IndexChart/
// InvestorTrend use) instead of every route's code landing in one bundle regardless
// of which page a visitor lands on first.
const Dashboard = lazy(() => import("./components/Dashboard"));
/* The entrance. "/" is a gateway rather than a dashboard — the stock desk it
   used to be lives at /dashboard and is reached from the star at the centre of
   the page. Anything that means "open a stock" targets /dashboard?code=.

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
const NewsPage = lazy(() => import("./components/NewsPage"));
const AiPredictionPage = lazy(() => import("./components/AiPredictionPage"));
const PredictionGradingPage = lazy(() => import("./components/PredictionGradingPage"));
const AdminLoginPage = lazy(() => import("./components/AdminLoginPage"));
const AdminDashboardPage = lazy(() => import("./components/AdminDashboardPage"));
const AdminDbPage = lazy(() => import("./components/AdminDbPage"));
// The neuron monitor is the one route that pulls in three.js. Lazy like every other
// page, so that ~150KB gzipped lands only when an admin actually opens it and never
// touches a visitor's bundle.
const MonitorPage = lazy(() => import("./components/MonitorPage"));

export default function App() {
  const path = useRoute();
  useActivityTracking(path);

  let page;
  const investorMatch = path.match(/^\/investor\/([^/]+)\/?$/);
  const indexMatch = path.match(/^\/index\/(kospi|kosdaq)\/?$/i);
  if (investorMatch) {
    page = <InvestorTrendPage code={investorMatch[1]} />;
  } else if (indexMatch) {
    page = <IndexChartPage symbol={indexMatch[1].toUpperCase() as "KOSPI" | "KOSDAQ"} />;
  } else if (path === "/dashboard") {
    page = <Dashboard />;
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
  } else if (path === "/news") {
    page = <NewsPage />;
  } else if (path === "/ai-prediction") {
    page = <AiPredictionPage />;
  } else if (path === "/ai-prediction/grading") {
    page = <PredictionGradingPage />;
  } else if (path === "/admin") {
    page = <AdminLoginPage />;
  } else if (path === "/admin/dashboard") {
    page = <AdminDashboardPage />;
  } else if (path === "/admin/monitor") {
    page = <MonitorPage />;
  } else if (path === "/admin/db") {
    page = <AdminDbPage />;
  } else {
    // "/" and anything unrecognised land on the entrance rather than dropping
    // straight into the stock desk. "/type2" lands here too — it was this
    // page's address while it was being built alongside the old entrance, and
    // is kept working so that any link made in the meantime still resolves.
    page = <HubType2 />;
  }

  // The fallback stays silent for its first 2.5s (see LoadingState): a cached route
  // chunk resolves in milliseconds, and the old fallback made every navigation flash a
  // loading line before the page it was standing in for even had a chance to render.
  return <Suspense fallback={<LoadingState />}>{page}</Suspense>;
}
