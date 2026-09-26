import { RealEstateItem } from "../api/client";

export default function RealEstateLeaderEvidence({ item }: { item: RealEstateItem }) {
  const leader = item.leader;
  if (!leader) return <p className="re-leader-evidence">선택 지역의 순위 자료를 확인할 수 없습니다.</p>;
  const score = (value: number | null) => value == null ? "미관측" : value.toFixed(1);
  return <details className="re-leader-evidence">
    <summary>{leader.scope_label && `${leader.scope_label} · `}{leader.rank ? `지역 대표단지 ${leader.rank}위 · ${score(leader.score)}점` : "순위 산정 보류"}{leader.status === "provisional" ? " · 잠정평가" : ""} · 자료 신뢰도 {leader.confidence === "high" ? "높음" : "제한적"}</summary>
    {!!leader.rank && <p>가격 우위 {score(leader.price_score)} · 상위권 지속성 {score(leader.persistence_score)} · 거래 수요 {score(leader.demand_score)} (각 100점, 비교 단지 수 보정)</p>}
    {leader.reasons?.map(reason => <p key={reason}>{reason}</p>)}
    {leader.bands.map(b => <p key={b.band}>전용 {b.band}㎡급 · 비교 {b.peers}개 단지 · 최근 {b.window_months}개월 {b.sample_count}건<br />
      {b.source === "rights" ? "분양·입주권" : "아파트 매매"} · {b.price_basis === "direct" ? "직거래 참고값" : "중개거래"}{b.last_trade ? ` · ${b.last_trade}` : ""}<br />
      과거 8분기 중 비교 가능 {b.quarters}분기, 가격 상위 10% {b.top_quarters}분기 · 1년 거래 {b.annual_count}건 / 거래 발생 {b.active_months}개월</p>)}
    <p>선택 지역 전체의 실거래 기반 평가입니다. 평형을 바꿔도 단지 점수는 유지됩니다. 입지·학군·세대수·재건축 기대는 미반영이며, 공식 인증이나 미래 가격 예측이 아닙니다.</p>
  </details>;
}
