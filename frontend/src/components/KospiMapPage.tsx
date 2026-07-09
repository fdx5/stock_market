import { api } from "../api/client";
import MarketMapPage from "./MarketMapPage";

export default function KospiMapPage() {
  return (
    <MarketMapPage
      pageTitle="KOSPI MAP"
      loadingLabel="시총 500개 종목 데이터를 불러오는 중..."
      subtitlePrefix="코스피 시가총액 상위 500개"
      fetchMap={api.marketMap}
      tier1Limit={20}
      tier2Limit={100}
      fullLimit={500}
      navLinks={[
        { to: "/kosdaq-map", label: "🟢 KOSDAQ MAP" },
        { to: "/battle", label: "🔥 시총 대결" },
      ]}
    />
  );
}
