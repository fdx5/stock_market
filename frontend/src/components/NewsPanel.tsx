import type { NewsItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

export default function NewsPanel({ items, name }: { items: NewsItem[]; name: string }) {
  const { lang } = useLanguage();
  const translatedTitles = useTranslatedTexts(items.map((item) => item.title));
  const translatedPress = useTranslatedTexts(items.map((item) => item.press));

  return (
    <div className="news-panel">
      {items.length === 0 ? (
        <div className="empty-state">
          {lang === "en" ? `Couldn't load recent news for ${name}.` : `${name} 관련 최근 뉴스를 가져오지 못했습니다.`}
        </div>
      ) : (
        <div className="news-list">
          {items.map((item, idx) => (
            <a key={idx} className="news-item" href={item.link} target="_blank" rel="noreferrer">
              <div className="title">{translatedTitles[idx] ?? item.title}</div>
              <div className="meta">
                <span>{translatedPress[idx] ?? item.press}</span>
                <span>{item.date}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
