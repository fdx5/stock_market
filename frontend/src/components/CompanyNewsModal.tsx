import { useState } from "react";
import { CompanyNewsItem, api } from "../api/client";
import { formatNewsDate } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useBodyScrollLock } from "../useBodyScrollLock";

// Skeleton placeholders shown while the list/article fetch is in flight — the news
// list depends on a Bing RSS fetch plus (for foreign items) a batched translation
// call, and the article view fetches+extracts+translates the full page on click, so
// both can take a couple of seconds; a shimmering shape reads as "still working"
// much better than a static "불러오는 중..." line sitting alone in an empty modal.
function NewsListSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="fight-news-card fight-news-skeleton" aria-hidden="true">
          <div className="fight-news-skeleton-img" />
          <div className="fight-news-card-body">
            <div className="fight-news-skeleton-line fight-news-skeleton-line--title" />
            <div className="fight-news-skeleton-line fight-news-skeleton-line--title-short" />
            <div className="fight-news-skeleton-line fight-news-skeleton-line--meta" />
          </div>
        </div>
      ))}
    </>
  );
}

// The image/title/meta above this are already known (they came from the list item
// the user clicked) — only the full article body still needs fetching, so the
// skeleton represents just that: a handful of paragraph-shaped placeholder lines.
function ArticleBodySkeleton() {
  return (
    <div className="fight-news-detail-body fight-news-skeleton" aria-hidden="true">
      <div className="fight-news-skeleton-line fight-news-skeleton-line--para" />
      <div className="fight-news-skeleton-line fight-news-skeleton-line--para" />
      <div className="fight-news-skeleton-line fight-news-skeleton-line--para-short" />
      <div className="fight-news-skeleton-line fight-news-skeleton-line--para" />
      <div className="fight-news-skeleton-line fight-news-skeleton-line--para-short" />
    </div>
  );
}

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
  useBodyScrollLock(true);

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
                {selected.published && (
                  <span className="fight-news-card-date">{formatNewsDate(selected.published, lang)}</span>
                )}
              </div>

              {articleLoading && <ArticleBodySkeleton />}

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
              {loading && <NewsListSkeleton />}
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
                      {item.published && (
                        <span className="fight-news-card-date">{formatNewsDate(item.published, lang)}</span>
                      )}
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
