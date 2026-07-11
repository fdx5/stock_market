import type { NewsItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const RECENT_DAYS = 3;
const MAX_ITEMS = 6;

function parseNaverDate(text: string): number {
  // Naver's item-news date format is "YYYY.MM.DD HH:mm". Unparseable dates are treated
  // as unknown (0) rather than "now", so they're excluded by the cutoff below instead
  // of incorrectly counting as recent.
  const match = text.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, y, mo, d, h, mi] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
}

export default function RecentNewsDigest({ items, name }: { items: NewsItem[]; name: string }) {
  const { lang } = useLanguage();
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => parseNaverDate(item.date) >= cutoff).slice(0, MAX_ITEMS);

  const translatedTitles = useTranslatedTexts(recent.map((item) => item.title));
  const translatedPress = useTranslatedTexts(recent.map((item) => item.press));

  return (
    <div className="card news-digest-card">
      <div className="news-digest-header">
        {lang === "en" ? `📰 News Digest (Last ${RECENT_DAYS} Days)` : `📰 최근 ${RECENT_DAYS}일 뉴스 요약`}
      </div>
      {recent.length === 0 ? (
        <div className="empty-state">
          {lang === "en"
            ? `No news for ${name} in the last ${RECENT_DAYS} days.`
            : `${name} 관련 최근 ${RECENT_DAYS}일 내 뉴스가 없습니다.`}
        </div>
      ) : (
        <ul className="news-digest-list">
          {recent.map((item, idx) => (
            <li key={idx}>
              <a href={item.link} target="_blank" rel="noreferrer">
                {translatedTitles[idx] ?? item.title}
              </a>
              <span className="news-digest-meta">
                {" "}
                · {translatedPress[idx] ?? item.press} · {item.date.slice(5)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
