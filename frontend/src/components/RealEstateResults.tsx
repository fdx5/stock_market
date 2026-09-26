import { RealEstateItem } from "../api/client";
import { daysSince, tradeState } from "./realEstateTools";
import { fullPrice } from "./RealEstatePopup";

export default function RealEstateResults({ items, saved, compared, onOpen, onSave, onCompare }: {
  items: RealEstateItem[]; saved: RealEstateItem[]; compared: RealEstateItem[];
  onOpen: (item: RealEstateItem) => void; onSave: (item: RealEstateItem) => void; onCompare: (item: RealEstateItem) => void;
}) {
  return <div className="re-results-wrap"><table className="re-results-table"><caption className="re-sr-only">현재 조건에 맞는 아파트. 가격은 선택 평형의 실거래 기준가입니다.</caption>
    <thead><tr><th scope="col">단지</th><th scope="col">전용면적</th><th scope="col">실거래 기준가</th><th scope="col">등락</th><th scope="col">최근 기준 거래</th><th scope="col">기간 거래</th><th scope="col">저장·비교</th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td data-label="단지"><button type="button" className="re-result-name" onClick={() => onOpen(item)}>{item.name}</button><small>{item.sgg} {item.dong}{item.built ? ` · ${item.built}년` : ""}</small></td>
      <td data-label="전용면적">{item.area}㎡<small>전용 {item.pyeong}평</small></td>
      <td data-label="기준가"><strong>{fullPrice(item.price)}</strong><small>{item.price_sample_count ? `${item.price_sample_count}건 기준` : "산정 표본 확인 중"}{item.price_basis === "direct" ? " · 직거래" : ""}</small></td>
      <td data-label="등락" className={item.change_pct === null ? "" : item.change_pct > 0 ? "re-up" : item.change_pct < 0 ? "re-down" : ""}>{tradeState(item)}</td>
      <td data-label="최근 거래">{item.deal_date}<small>{daysSince(item.deal_date) > 180 ? "최근 거래 오래됨" : `${daysSince(item.deal_date)}일 전`}</small></td>
      <td data-label="기간 거래">{item.trades}건</td>
      <td data-label="저장·비교"><div className="re-row-actions"><button type="button" aria-label={`${item.name} 관심 저장`} aria-pressed={saved.some(x => x.id === item.id)} onClick={() => onSave(item)}>{saved.some(x => x.id === item.id) ? "★ 저장됨" : "☆ 관심"}</button><button type="button" aria-label={`${item.name} 비교 선택`} aria-pressed={compared.some(x => x.id === item.id)} onClick={() => onCompare(item)}>{compared.some(x => x.id === item.id) ? "✓ 비교" : "+ 비교"}</button></div></td>
    </tr>)}</tbody>
  </table></div>;
}
