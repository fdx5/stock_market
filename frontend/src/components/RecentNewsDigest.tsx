import { useState } from "react";
import type { NewsItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const RECENT_DAYS = 3;
const MAX_ITEMS = 6;
const VISIBLE_ITEMS = 3;

// Arbitrary varied widths so the loading placeholder reads as text lines rather
// than a row of identical bars.
const NEWS_SKELETON_WIDTHS = ["92%", "78%", "85%"];

function parseNaverDate(text: string): number {
  // Naver's item-news date format is "YYYY.MM.DD HH:mm". Unparseable dates are treated
  // as unknown (0) rather than "now", so they're excluded by the cutoff below instead
  // of incorrectly counting as recent.
  const match = text.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, y, mo, d, h, mi] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
}

export default function RecentNewsDigest({
  items,
  name,
  loading,
}: {
  items: NewsItem[];
  name: string;
  loading: boolean;
}) {
  const { lang } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => parseNaverDate(item.date) >= cutoff).slice(0, MAX_ITEMS);
  const hasFolded = recent.length > VISIBLE_ITEMS;
  const visible = expanded ? recent : recent.slice(0, VISIBLE_ITEMS);

  const translatedTitles = useTranslatedTexts(recent.map((item) => item.title));
  const translatedPress = useTranslatedTexts(recent.map((item) => item.press));

  return (
    <div className="card news-digest-card">
      <div className="news-digest-header">
        {lang === "en" ? `📰 News Digest (Last ${RECENT_DAYS} Days)` : `📰 최근 ${RECENT_DAYS}일 뉴스 요약`}
      </div>
      {loading ? (
        <ul className="news-digest-list" aria-hidden="true">
          {NEWS_SKELETON_WIDTHS.map((w, i) => (
            <li key={i}>
              <div className="skeleton" style={{ height: 13, width: w }} />
            </li>
          ))}
        </ul>
      ) : recent.length === 0 ? (
        <div className="empty-state">
          {lang === "en"
            ? `No news for ${name} in the last ${RECENT_DAYS} days.`
            : `${name} 관련 최근 ${RECENT_DAYS}일 내 뉴스가 없습니다.`}
        </div>
      ) : (
        <>
          <ul className="news-digest-list">
            {visible.map((item, idx) => (
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
          {hasFolded && (
            <button
              type="button"
              className="news-digest-toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? (lang === "en" ? "Show less" : "간략히 보기") : lang === "en" ? "Show more" : "더보기"}
              <span className={`fold-toggle-arrow ${expanded ? "up" : ""}`} aria-hidden="true">
                ▼
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
