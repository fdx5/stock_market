import StockBoardPage from "./StockBoardPage";

export default function KosdaqBoardPage() {
  return (
    <StockBoardPage
      market="kosdaq"
      pageTitle="KOSDAQ TOP 100"
      subtitle="코스닥 시가총액 상위 100종목을 업종별로"
      loadingLabel="코스닥 상위 100종목을 불러오는 중..."
    />
  );
}
