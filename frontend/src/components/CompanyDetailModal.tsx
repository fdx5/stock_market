import { GlobalTop20Item } from "../api/client";

export default function CompanyDetailModal({
  item,
  description,
  loading,
  error,
  onClose,
}: {
  item: GlobalTop20Item;
  description: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="company-modal-backdrop" onClick={onClose}>
      <div className="company-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="company-modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <div className="company-modal-header">
          {item.logo_url && <img className="company-modal-logo" src={item.logo_url} alt={item.name} />}
          <div>
            <div className="company-modal-name">
              {item.name} {item.flag_url && <img className="company-modal-flag" src={item.flag_url} alt={item.country} />}
            </div>
            <div className="company-modal-sub">
              세계 시총 {item.rank}위 · {item.country}
            </div>
          </div>
        </div>

        {loading && <div className="loading-state">불러오는 중...</div>}
        {error && <div className="error-state">{error}</div>}
        {description && <p className="company-modal-desc">{description}</p>}
      </div>
    </div>
  );
}
