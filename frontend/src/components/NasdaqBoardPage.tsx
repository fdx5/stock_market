import StockBoardPage from "./StockBoardPage";

export default function NasdaqBoardPage() {
  return (
    <StockBoardPage
      market="nasdaq"
      pageTitle="NASDAQ TOP 100"
      subtitle="나스닥100 지수 편입 상위 100종목을 업종별로"
      loadingLabel="나스닥 상위 100종목을 불러오는 중..."
    />
  );
}
