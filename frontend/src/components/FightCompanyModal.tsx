import { GlobalTop20Item } from "../api/client";
import { useT } from "../i18n/LanguageContext";
import CompanyLogo from "./CompanyLogo";

// Company showcase popup opened from clicking a fighter's CEO photo on the fight
// screen — composed from the same assets already used elsewhere on this page (CEO
// portrait, company logo, flagship product photo, translated description), just
// laid out as a dedicated "company card" instead of scattered across the arena.
export default function FightCompanyModal({
  item,
  player,
  ceoName,
  ceoPhoto,
  productImage,
  description,
  loading,
  error,
  onClose,
}: {
  item: GlobalTop20Item;
  player: "p1" | "p2";
  ceoName?: string;
  ceoPhoto: string | null;
  productImage: string | null;
  description: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <div className="fight-company-modal-backdrop" onClick={onClose}>
      <div
        className={`fight-company-modal fight-company-modal--${player}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="fight-company-modal-close" onClick={onClose} aria-label={t("닫기")}>
          ✕
        </button>

        <div
          className="fight-company-modal-hero"
          style={productImage ? { backgroundImage: `url(${productImage})` } : undefined}
        >
          <div className="fight-company-modal-hero-scrim" />
          {ceoPhoto && <img className="fight-company-modal-ceo" src={ceoPhoto} alt={ceoName ?? item.name} />}
          <div className="fight-company-modal-logo-badge">
            <CompanyLogo item={item} className="fight-logo-img" />
          </div>
          <div className="fight-company-modal-hero-text">
            <div className="fight-company-modal-company">{item.name}</div>
            {ceoName && <div className="fight-company-modal-ceo-name">CEO · {ceoName}</div>}
          </div>
        </div>

        <div className="fight-company-modal-body">
          <div className="fight-company-modal-meta">
            {item.flag_url && <img className="fight-company-modal-flag" src={item.flag_url} alt={item.country} />}
            <span>
              {t("세계 시총")} {item.rank}
              {t("위")} · {item.country}
            </span>
          </div>

          {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
          {error && <div className="error-state">{t(error)}</div>}
          {description && <p className="fight-company-modal-desc">{description}</p>}
        </div>
      </div>
    </div>
  );
}
