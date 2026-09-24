import { useEffect } from "react";
import { RealEstateItem } from "../api/client";
import { useBodyScrollLock } from "../useBodyScrollLock";
import RealEstatePopup, { PopupContext } from "./RealEstatePopup";

/* The 부동산 맵's complex card on a touch screen. There is no hover there, so a tap on
 * a tile used to jump straight into the next region and the reader never saw what
 * they had tapped. A tap now opens this sheet with the same card the desktop hover
 * shows, and moving into the complex's 구 or 동 is a button inside it. */
export default function RealEstateSheet({
  item,
  ctx,
  goLabel,
  onGo,
  onClose,
}: {
  item: RealEstateItem;
  ctx: PopupContext;
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
          <RealEstatePopup item={item} ctx={{ ...ctx, clickHint: null }} />
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
