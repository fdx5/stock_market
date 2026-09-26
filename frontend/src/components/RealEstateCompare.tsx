import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, RealEstateComplexResponse, RealEstateItem, RealEstatePeriod } from "../api/client";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { fullPrice } from "./RealEstatePopup";
import { tradeState, useDialogFocus } from "./realEstateTools";

/** What a card shows, reported up so the dialog can mark the extremes across cards. */
type Shown = { price: number; change: number | null };
type Direction = "up" | "down" | "flat" | "none";

const direction = (change: number | null): Direction =>
  change === null ? "none" : change > 0 ? "up" : change < 0 ? "down" : "flat";
const ARROW: Record<Direction, string> = { up: "▲", down: "▼", flat: "―", none: "" };
const signedPrice = (manwon: number) => `${manwon > 0 ? "+" : manwon < 0 ? "−" : "±"}${fullPrice(Math.abs(manwon))}`;

function ComparisonCard({ item, period, tags, onShown, onRemove }: {
  item: RealEstateItem; period: RealEstatePeriod; tags: string[];
  onShown: (id: string, shown: Shown) => void; onRemove: () => void;
}) {
  const [data, setData] = useState<RealEstateComplexResponse | null>(null);
  const [key, setKey] = useState(Math.round(item.area));
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { let cancelled = false; setError(false); api.realEstateComplex(item.id, period).then(r => { if (!cancelled) setData(r); }).catch(() => { if (!cancelled) setError(true); }); return () => { cancelled = true; }; }, [item.id, period, retry]);
  const view = data?.types.find(x => x.key === key) ?? data?.types[0];
  const shown = view ? { ...item, ...view } : item;
  useEffect(() => { onShown(item.id, { price: shown.price, change: shown.change_pct }); }, [item.id, shown.price, shown.change_pct, onShown]);
  const dir = direction(shown.change_pct);
  const perPyeong = Math.round(shown.price / shown.area * 3.3058);
  const diff = shown.change_pct !== null && shown.base_price ? shown.price - shown.base_price : null;
  return <article className={`re-compare-card is-${dir}`}>
    <header><div><h3>{item.name}</h3><p>{item.sgg} {item.dong} · {item.built ? `${item.built}년 준공` : "준공연도 정보 없음"}</p></div><button type="button" aria-label={`${item.name} 비교에서 제외`} onClick={onRemove}>제외</button></header>
    {tags.length > 0 && <ul className="re-compare-tags">{tags.map(t => <li key={t}>{t}</li>)}</ul>}
    <label>비교할 전용면적<select value={view?.key ?? key} onChange={e => setKey(Number(e.target.value))} disabled={!data}>{data ? data.types.map(t => <option key={t.key} value={t.key}>{t.area}㎡ · {t.pyeong}평</option>) : <option value={key}>{item.area}㎡ · 불러오는 중</option>}</select></label>
    {error && <p role="alert">최신 정보를 불러오지 못했습니다. 저장된 값입니다. <button type="button" onClick={() => setRetry(x => x + 1)}>재시도</button></p>}
    <div className="re-compare-price">
      <span>실거래 기준가</span>
      <strong>{fullPrice(shown.price)}</strong>
      <small>{shown.deal_date} 기준 · 3.3㎡당 <b>{fullPrice(perPyeong)}</b></small>
    </div>
    <div className={`re-compare-change is-${dir}`}>
      <strong>{ARROW[dir] && <span aria-hidden="true">{ARROW[dir]} </span>}{tradeState(shown)}</strong>
      {diff !== null && <span>{signedPrice(diff)}</span>}
      {diff !== null && shown.base_price && <small>{fullPrice(shown.base_price)}{shown.base_date ? ` (${shown.base_date})` : ""} 대비</small>}
    </div>
    <dl>
      <div><dt>기간 거래</dt><dd><b>{shown.trades}</b>건</dd></div>
      <div><dt>1년 거래</dt><dd><b>{shown.type_trades_1y ?? "—"}</b>건</dd></div>
      <div><dt>산정 표본</dt><dd><b>{shown.price_sample_count ?? "—"}</b>건 · {shown.price_basis === "direct" ? "직거래 참고값" : "중개거래"}</dd></div>
    </dl>
  </article>;
}
export default function RealEstateCompare({ items, period, onClose, onRemove }: { items: RealEstateItem[]; period: RealEstatePeriod; onClose: () => void; onRemove: (id: string) => void }) {
  useBodyScrollLock(true);
  const ref = useDialogFocus(onClose);
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [report] = useState(() => (id: string, next: Shown) =>
    setShown(prev => prev[id]?.price === next.price && prev[id]?.change === next.change ? prev : { ...prev, [id]: next }));
  // Tags only mean something between two or more cards.
  const rows = items.map(x => ({ id: x.id, ...(shown[x.id] ?? { price: x.price, change: x.change_pct }) }));
  const tags = (id: string) => {
    if (rows.length < 2) return [];
    const out: string[] = [];
    const prices = rows.map(r => r.price);
    const row = rows.find(r => r.id === id)!;
    if (row.price === Math.max(...prices)) out.push("최고가");
    if (row.price === Math.min(...prices)) out.push("최저가");
    const rising = rows.filter(r => r.change !== null && r.change > 0);
    if (rising.length && row.change === Math.max(...rising.map(r => r.change!))) out.push("상승 1위");
    return out;
  };
  return createPortal(<div className="d2 mm app re-map-page re-sheet-portal"><div className="re-compare-scrim" onClick={onClose}><section ref={ref} className="re-compare-dialog" role="dialog" aria-modal="true" aria-labelledby="re-compare-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
    <header className="re-compare-heading"><div><h2 id="re-compare-title">관심 단지 비교</h2><p>평형과 기준 거래일을 함께 비교하세요. {period === "3m" ? "3개월" : period === "6m" ? "6개월" : "1년"} 등락 기준입니다.</p></div><button type="button" onClick={onClose}>닫기</button></header>
    <div className="re-compare-grid">{items.map(item => <ComparisonCard key={item.id} item={item} period={period} tags={tags(item.id)} onShown={report} onRemove={() => onRemove(item.id)} />)}</div>
  </section></div></div>, document.body);
}
