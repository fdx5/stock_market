import { useEffect, useMemo, useState } from "react";
import { api, RealEstateFacts, RealEstateItem, RealEstatePeriod, RealEstateTypeView } from "../api/client";
import { useBodyScrollLock } from "../useBodyScrollLock";
import RealEstatePopup, { OtherType, PopupContext } from "./RealEstatePopup";

/* The 부동산 맵's pinned complex card — a bottom sheet on a phone or tablet, a centred
 * dialog on a desktop. It opens on a click or tap on a tile, shows what the hover
 * card shows, and adds what a hover card cannot hold: a 평형 selector that re-lays
 * the whole card out for the chosen 평형, and the button into the complex's 구 or 동.
 *
 * The map only carries the 대표 평형; the other 평형 are fetched once, when the card
 * opens (GET /api/realestate/complex). */

const PYEONG = 3.3058;

/** The 대표 평형's key among the fetched ones: the one whose area rounds the same. */
function representativeKey(item: RealEstateItem, views: RealEstateTypeView[]): number | null {
  if (views.length === 0) return null;
  const exact = views.find((v) => v.key === Math.round(item.area));
  if (exact) return exact.key;
  return views.reduce((best, v) => (Math.abs(v.area - item.area) < Math.abs(best.area - item.area) ? v : best)).key;
}

export default function RealEstateSheet({
  item,
  ctx,
  period,
  goLabel,
  onGo,
  onClose,
}: {
  item: RealEstateItem;
  ctx: PopupContext;
  period: RealEstatePeriod;
  /** e.g. "도곡동 지도로 이동"; null when the map is already at the complex's 동. */
  goLabel: string | null;
  onGo: () => void;
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [views, setViews] = useState<RealEstateTypeView[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .realEstateComplex(item.id, period)
      .then((res) => {
        if (cancelled) return;
        setViews(res.types);
        setSelected(representativeKey(item, res.types));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, period]);

  // 세대수·주차 come from K-apt through their own request, so a slow or missing
  // lookup never holds up the 평형 data.
  const [facts, setFacts] = useState<RealEstateFacts | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFacts(null);
    api
      .realEstateFacts(item.id)
      .then((res) => {
        if (!cancelled) setFacts(res);
      })
      .catch((e: Error) => {
        if (!cancelled) setFacts({ id: item.id, matched: false, households: null, parking: null, parking_per_household: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const view = views.find((v) => v.key === selected) ?? null;
  const repKey = useMemo(() => representativeKey(item, views), [item, views]);

  // The card reads the selected 평형 wherever it reads the 대표 평형; the complex-wide
  // figures (name, 준공, 1년 거래 건수, rank) stay the item's.
  const shown: RealEstateItem = view ? { ...item, ...view, trades_1y: item.trades_1y } : item;
  const others: OtherType[] | undefined = views.length
    ? views
        .filter((v) => v.key !== selected)
        .map((v) => ({ key: v.key, area: v.area, price: v.price, date: v.deal_date, trades_1y: v.trades_1y }))
    : undefined;

  const selector = (
    <div className="re-sheet-select">
      <label htmlFor="re-sheet-pyeong">평형</label>
      <select
        id="re-sheet-pyeong"
        value={selected ?? ""}
        disabled={loading || views.length < 2}
        onChange={(e) => setSelected(Number(e.target.value))}
      >
        {views.length === 0 && (
          <option value="">
            전용 {Math.round(item.area)}㎡ ({item.pyeong}평){loading ? " · 불러오는 중…" : ""}
          </option>
        )}
        {views.map((v) => (
          <option key={v.key} value={v.key}>
            전용 {v.area}㎡ ({(v.area / PYEONG).toFixed(1)}평) · {v.key === repKey ? "대표 · " : ""}1년 {v.trades_1y}건
          </option>
        ))}
      </select>
      {failed && <span className="re-sheet-select-note">다른 평형을 불러오지 못했습니다</span>}
      {!loading && !failed && views.length === 1 && <span className="re-sheet-select-note">거래된 평형이 하나뿐입니다</span>}
    </div>
  );

  return (
    <div className="re-sheet-scrim" onClick={onClose}>
      <section
        className="re-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} 상세 정보`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="re-sheet-grip" aria-hidden="true" />
        <button type="button" className="re-sheet-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <div className="re-sheet-body re-pop-tip">
          <RealEstatePopup
            item={shown}
            ctx={{ ...ctx, clickHint: null }}
            selector={selector}
            others={others}
            onPickType={views.length ? setSelected : undefined}
            facts={facts}
          />
        </div>
        <footer className="re-sheet-actions">
          {goLabel && (
            <button type="button" className="re-sheet-go" onClick={onGo}>
              {goLabel}
            </button>
          )}
          <button type="button" className="re-sheet-dismiss" onClick={onClose}>
            닫기
          </button>
        </footer>
      </section>
    </div>
  );
}
