import { RealEstateItem } from "../api/client";

export default function RealEstateLeaderEvidence({ item }: { item: RealEstateItem }) {
  const leader = item.leader;
  if (!leader) return null;
  return <details className="re-leader-evidence">
    <summary>지역 대표단지 {leader.rank}위 · {leader.score.toFixed(1)}점 · 자료 신뢰도 {leader.confidence === "high" ? "높음" : "제한적"}</summary>
    <p>가격 우위 {leader.price_score.toFixed(1)} · 상위권 지속성 {leader.persistence_score.toFixed(1)} · 거래 수요 {leader.demand_score.toFixed(1)} (각 100점, 비교 단지 수 보정)</p>
    {leader.bands.map(b => <p key={b.band}>전용 {b.band}㎡급 · 비교 {b.peers}개 단지 · 최근 {b.window_months}개월 {b.sample_count}건<br />
      과거 8분기 중 비교 가능 {b.quarters}분기, 가격 상위 10% {b.top_quarters}분기 · 1년 거래 {b.annual_count}건 / 거래 발생 {b.active_months}개월</p>)}
    <p>선택 지역 전체의 실거래 기반 평가입니다. 평형을 바꿔도 단지 점수는 유지됩니다. 입지·학군·세대수·재건축 기대는 미반영이며, 공식 인증이나 미래 가격 예측이 아닙니다.</p>
  </details>;
}
