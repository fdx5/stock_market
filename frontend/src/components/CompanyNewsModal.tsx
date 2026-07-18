import { CompanyNewsItem } from "../api/client";
import { useT } from "../i18n/LanguageContext";

// Popup opened from the "[회사명] 주요뉴스" buttons flanking "다시 선택" on the fight
// screen — same backdrop/close/loading/error scaffolding as FightCompanyModal.tsx,
// with a scrollable news-card list as the body instead of a hero band + description.
export default function CompanyNewsModal({
  companyName,
  player,
  items,
  loading,
  error,
  onClose,
}: {
  companyName: string;
  player: "p1" | "p2";
  items: CompanyNewsItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <div className="fight-company-modal-backdrop" onClick={onClose}>
      <div
        className={`fight-company-news-modal fight-company-modal--${player}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="fight-company-modal-close" onClick={onClose} aria-label={t("닫기")}>
          ✕
        </button>

        <div className="fight-company-news-header">
          <span className={`fight-${player}-color`}>{companyName}</span> {t("주요뉴스")}
        </div>

        <div className="fight-company-news-body">
          {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
          {error && <div className="error-state">{t(error)}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="loading-state">{t("최근 뉴스가 없습니다.")}</div>
          )}

          {items.map((item, idx) => (
            <a
              key={idx}
              className="fight-news-card"
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.image_url && <img className="fight-news-card-img" src={item.image_url} alt="" />}
              <div className="fight-news-card-body">
                <div className="fight-news-card-title">{item.title}</div>
                {item.snippet && <div className="fight-news-card-snippet">{item.snippet}</div>}
                <div className="fight-news-card-meta">
                  <span className="fight-news-card-source">{item.source}</span>
                  {item.published && <span className="fight-news-card-date">{item.published}</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
