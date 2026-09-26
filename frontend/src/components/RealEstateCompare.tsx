import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, RealEstateComplexResponse, RealEstateItem, RealEstatePeriod } from "../api/client";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { fullPrice } from "./RealEstatePopup";
import { tradeState, useDialogFocus } from "./realEstateTools";

function ComparisonCard({ item, period, onRemove }: { item: RealEstateItem; period: RealEstatePeriod; onRemove: () => void }) {
  const [data, setData] = useState<RealEstateComplexResponse | null>(null);
  const [key, setKey] = useState(Math.round(item.area));
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { let cancelled = false; setError(false); api.realEstateComplex(item.id, period).then(r => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setError(true); }); return () => { cancelled = true; }; }, [item.id, period, retry]);
  const view = data?.types.find(x => x.key === key) ?? data?.types[0];
  const shown = view ? { ...item, ...view } : item;
  return <article className="re-compare-card"><header><h3>{item.name}</h3><button type="button" aria-label={`${item.name} 비교에서 제외`} onClick={onRemove}>제외</button></header>
    <p>{item.sgg} {item.dong}</p>
    <label>비교할 전용면적<select value={view?.key ?? key} onChange={e => setKey(Number(e.target.value))} disabled={!data}>{data ? data.types.map(t => <option key={t.key} value={t.key}>{t.area}㎡ · {t.pyeong}평</option>) : <option value={key}>{item.area}㎡ · 불러오는 중</option>}</select></label>
    {error && <p role="alert">최신 정보를 불러오지 못했습니다. 저장된 값입니다. <button type="button" onClick={() => setRetry(x => x + 1)}>재시도</button></p>}
    <dl><dt>실거래 기준가</dt><dd>{fullPrice(shown.price)}</dd><dt>마지막 기준 거래</dt><dd>{shown.deal_date}</dd><dt>등락</dt><dd>{tradeState(shown)}</dd><dt>산정 표본</dt><dd>{shown.price_sample_count ?? "—"}건 · {shown.price_basis === "direct" ? "직거래 참고값" : "중개거래"}</dd><dt>기간 거래 · 선택 평형</dt><dd>{shown.trades}건</dd><dt>1년 거래 · 선택 평형</dt><dd>{shown.type_trades_1y ?? "—"}건</dd><dt>준공연도</dt><dd>{item.built ?? "정보 없음"}</dd><dt>전용 3.3㎡당</dt><dd>{fullPrice(Math.round(shown.price / shown.area * 3.3058))}</dd></dl>
  </article>;
}
export default function RealEstateCompare({ items, period, onClose, onRemove }: { items: RealEstateItem[]; period: RealEstatePeriod; onClose: () => void; onRemove: (id: string) => void }) {
  useBodyScrollLock(true);
  const ref = useDialogFocus(onClose);
  return createPortal(<div className="d2 mm app re-map-page re-sheet-portal"><div className="re-compare-scrim" onClick={onClose}><section ref={ref} className="re-compare-dialog" role="dialog" aria-modal="true" aria-labelledby="re-compare-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
    <header className="re-compare-heading"><div><h2 id="re-compare-title">관심 단지 비교</h2><p>평형과 기준 거래일을 함께 비교하세요. {period === "3m" ? "3개월" : period === "6m" ? "6개월" : "1년"} 등락 기준입니다.</p></div><button type="button" onClick={onClose}>닫기</button></header>
    <div className="re-compare-grid">{items.map(item => <ComparisonCard key={item.id} item={item} period={period} onRemove={() => onRemove(item.id)} />)}</div>
  </section></div></div>, document.body);
}
