import { useEffect, useState } from "react";
import { GlobalDiscussionPost, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const PAGE_SIZE = 10;

function formatWrittenAt(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

// The exact Naver suffix (.O for Nasdaq, .K otherwise — see
// global_discussion_fetcher.resolve_naver_suffix) is resolved server-side per ticker;
// this outbound "view on Naver" link always tries .O, which Naver's own page just
// 404s past gracefully if wrong — acceptable for an optional external link.
function naverDiscussionUrl(code: string): string {
  return `https://m.stock.naver.com/worldstock/stock/${code}.O/discussion`;
}

// Discussion board for the global (S&P500/Nasdaq100) stock detail page — a read-only
// mirror of Naver's own world-stock discussion board (see backend
// global_discussion_fetcher.py), not this app's own comment store. There's no posting
// form since these are someone else's posts on Naver's platform; a link out to the
// real page covers anyone who wants to reply. Fetched 10 at a time (Naver's own
// offset-cursor pagination) with a "더보기" button instead of one large upfront page,
// since the first page needs to paint fast.
export default function GlobalBoardPanel({ code, name }: { code: string; name: string }) {
  const t = useT();
  const { lang } = useLanguage();
  const [posts, setPosts] = useState<GlobalDiscussionPost[]>([]);
  const [nextOffset, setNextOffset] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPosts([]);
    setNextOffset(null);
    api
      .globalDiscussion(code, PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setPosts(res.items);
        setNextOffset(res.next_offset);
      })
      .catch(() => {
        // The board is a nice-to-have — leave it empty on failure rather than
        // blocking the rest of the page.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const translatedTexts = useTranslatedTexts(posts.map((p) => p.text));

  function loadMore() {
    if (!nextOffset || loadingMore) return;
    setLoadingMore(true);
    api
      .globalDiscussion(code, PAGE_SIZE, nextOffset)
      .then((res) => {
        setPosts((prev) => [...prev, ...res.items]);
        setNextOffset(res.next_offset);
      })
      .catch(() => {
        // A failed "load more" just leaves the button clickable to retry.
      })
      .finally(() => setLoadingMore(false));
  }

  return (
    <div className="global-board-panel">
      <a
        href={naverDiscussionUrl(code)}
        target="_blank"
        rel="noopener noreferrer"
        className="global-board-source-link"
      >
        {t("네이버 종목토론방에서 보기")} ↗
      </a>

      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {!loading && posts.length === 0 && (
        <div className="empty-state">
          {lang === "en" ? `No discussion yet for ${name}.` : `${name} 관련 토론 글이 아직 없습니다.`}
        </div>
      )}
      {!loading && posts.length > 0 && (
        <>
          <ul className="board-comments-list global-board-comments-list">
            {posts.map((p, idx) => (
              <li key={p.id} className={p.is_reply ? "global-board-reply" : undefined}>
                <div className="board-comment-meta">
                  <span className="board-comment-author">{p.author}</span>
                  <span className="board-comment-date">{formatWrittenAt(p.written_at)}</span>
                </div>
                {p.title && <p className="global-board-post-title">{p.title}</p>}
                <p className="board-comment-text">{translatedTexts[idx] ?? p.text}</p>
              </li>
            ))}
          </ul>
          {nextOffset && (
            <button
              type="button"
              className="global-board-more-btn"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? t("불러오는 중...") : t("더보기")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
