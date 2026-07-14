import { api } from "../api/client";
import MarketMapPage from "./MarketMapPage";

export default function KosdaqMapPage() {
  return (
    <MarketMapPage
      pageTitle="KOSDAQ MAP"
      loadingLabel="코스닥 시총 200개 종목 데이터를 불러오는 중..."
      subtitlePrefix="코스닥 시가총액 상위 200개"
      filePrefix="kosdaq"
      fetchMap={api.kosdaqMap}
      tier1Limit={20}
      tier2Limit={50}
      fullLimit={200}
      navLinks={[
        { to: "/map", label: "🗺 KOSPI" },
        { to: "/battle", label: "🔥 시총대결" },
      ]}
    />
  );
}
