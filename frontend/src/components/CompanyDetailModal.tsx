import { GlobalTop20Item } from "../api/client";
import { useT } from "../i18n/LanguageContext";

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
  const t = useT();

  return (
    <div className="company-modal-backdrop" onClick={onClose}>
      <div className="company-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="company-modal-close" onClick={onClose} aria-label={t("닫기")}>
          ✕
        </button>

        <div className="company-modal-header">
          {item.logo_url && <img className="company-modal-logo" src={item.logo_url} alt={item.name} />}
          <div>
            <div className="company-modal-name">
              {item.name} {item.flag_url && <img className="company-modal-flag" src={item.flag_url} alt={item.country} />}
            </div>
            <div className="company-modal-sub">
              {t("세계 시총")} {item.rank}{t("위")} · {item.country}
            </div>
          </div>
        </div>

        {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
        {error && <div className="error-state">{t(error)}</div>}
        {description && <p className="company-modal-desc">{description}</p>}
      </div>
    </div>
  );
}
