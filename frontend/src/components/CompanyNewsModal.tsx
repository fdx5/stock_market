import { useState } from "react";
import { CompanyNewsItem, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";

// Popup opened from the "[회사명] 주요뉴스" buttons flanking "다시 선택" on the fight
// screen — same backdrop/close/loading/error scaffolding as FightCompanyModal.tsx.
// Two internal views: a scrollable news-card list, and (once a card is clicked) an
// in-place article-detail view fetched + translated on demand, so reading a story
// never has to leave the app via an external link.
export default function CompanyNewsModal({
  companyName,
  companyCode,
  player,
  items,
  loading,
  error,
  onClose,
}: {
  companyName: string;
  companyCode: string;
  player: "p1" | "p2";
  items: CompanyNewsItem[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useLanguage();

  const [selected, setSelected] = useState<CompanyNewsItem | null>(null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);

  const openArticle = (item: CompanyNewsItem) => {
    setSelected(item);
    setParagraphs(null);
    setArticleLoading(true);
    api
      .fightArticle(item.link, companyCode, lang)
      .then((res) => setParagraphs(res.paragraphs))
      .catch(() => setParagraphs(null))
      .finally(() => setArticleLoading(false));
  };

  const backToList = () => {
    setSelected(null);
    setParagraphs(null);
  };

  return (
    <div className="fight-company-modal-backdrop" onClick={onClose}>
      <div
        className={`fight-company-news-modal fight-company-modal--${player}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="fight-company-modal-close" onClick={onClose} aria-label={t("닫기")}>
          ✕
        </button>

        {selected ? (
          <>
            <div className="fight-company-news-header fight-company-news-header--detail">
              <button type="button" className="fight-news-back-btn" onClick={backToList}>
                ← {t("목록으로")}
              </button>
            </div>

            <div className="fight-company-news-body">
              {selected.image_url && (
                <img className="fight-news-detail-img" src={selected.image_url} alt="" />
              )}
              <div className="fight-news-detail-title">{selected.title}</div>
              <div className="fight-news-card-meta">
                <span className="fight-news-card-source">{selected.source}</span>
                {selected.published && <span className="fight-news-card-date">{selected.published}</span>}
              </div>

              {articleLoading && <div className="loading-state">{t("불러오는 중...")}</div>}

              {!articleLoading && paragraphs && (
                <div className="fight-news-detail-body">
                  {paragraphs.map((p, idx) => (
                    <p key={idx}>{p}</p>
                  ))}
                </div>
              )}

              {!articleLoading && !paragraphs && (
                <>
                  {selected.snippet && <p className="fight-news-detail-fallback-snippet">{selected.snippet}</p>}
                  <div className="fight-news-detail-fallback-note">
                    {t("본문을 불러오지 못했습니다. 원문에서 확인해 주세요.")}
                  </div>
                </>
              )}

              <a
                className="fight-news-original-link"
                href={selected.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("원문에서 보기")} ↗
              </a>
            </div>
          </>
        ) : (
          <>
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
                <button
                  key={idx}
                  type="button"
                  className="fight-news-card"
                  onClick={() => openArticle(item)}
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
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
