import { api } from "../api/client";
import MarketMapPage from "./MarketMapPage";

export default function KospiMapPage() {
  return (
    <MarketMapPage
      pageTitle="KOSPI MAP"
      loadingLabel="시총 500개 종목 데이터를 불러오는 중..."
      subtitlePrefix="코스피 시가총액 상위 500개"
      filePrefix="kospi"
      fetchMap={api.marketMap}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={500}
      navLinks={[
        { to: "/kosdaq-map", label: "🟢 KOSDAQ" },
        { to: "/battle", label: "🔥 시총대결" },
      ]}
    />
  );
}
