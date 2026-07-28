import StockBoardPage from "./StockBoardPage";

export default function KospiBoardPage() {
  return (
    <StockBoardPage
      market="kospi"
      pageTitle="KOSPI TOP 100"
      subtitle="코스피 시가총액 상위 100종목을 업종별로"
      loadingLabel="코스피 상위 100종목을 불러오는 중..."
    />
  );
}
