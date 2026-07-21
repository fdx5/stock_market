import { useState } from "react";
import { CompanyNewsItem, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";

// Doubles as both the "recent news" and "related news" spot on the global stock page:
// Bing News RSS (see api.fightNews) already returns "latest coverage of this company",
// so there's no separate KR-style recent-digest vs. full-search-results distinction to
// preserve here — one list serves both roles. Reuses the fight-news-* CSS classes
// CompanyNewsModal.tsx already defines (they're plain, unscoped selectors, not nested
// under the modal backdrop) so this needs no new styling for the card/article view.
export default function GlobalNewsList({
  code,
  name,
  items,
  loading,
}: {
  code: string;
  name: string;
  items: CompanyNewsItem[];
  loading: boolean;
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
      .fightArticle(item.link, code, lang)
      .then((res) => setParagraphs(res.paragraphs))
      .catch(() => setParagraphs(null))
      .finally(() => setArticleLoading(false));
  };

  if (selected) {
    return (
      <div className="fight-company-news-body">
        <button type="button" className="fight-news-back-btn" onClick={() => setSelected(null)}>
          ← {t("목록으로")}
        </button>

        {selected.image_url && <img className="fight-news-detail-img" src={selected.image_url} alt="" />}
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

        <a className="fight-news-original-link" href={selected.link} target="_blank" rel="noopener noreferrer">
          {t("원문에서 보기")} ↗
        </a>
      </div>
    );
  }

  // The modifier marks the list view specifically: inside the /global side panel it
  // scrolls within a capped box (see styles.css) so switching tabs doesn't change the
  // page height. The article view above deliberately keeps flowing with the page —
  // a capped reader would scroll its own "목록으로" button out of reach.
  return (
    <div className="fight-company-news-body fight-company-news-body--list">
      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {!loading && items.length === 0 && (
        <div className="empty-state">
          {lang === "en" ? `No recent news for ${name}.` : `${name} 관련 최근 뉴스가 없습니다.`}
        </div>
      )}
      {items.map((item, idx) => (
        <button key={idx} type="button" className="fight-news-card" onClick={() => openArticle(item)}>
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
  );
}
