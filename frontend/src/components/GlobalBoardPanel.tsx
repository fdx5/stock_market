import { useEffect, useState } from "react";
import { FightComment, api } from "../api/client";
import { generateNickname } from "../data/cheerNames";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

// Discussion board for the global (S&P500/Nasdaq100) stock detail page. There's no
// Naver-style scraped board for foreign tickers, so this is backed by the app's own
// fight_comments table (see /fight/company-comments) instead — the same store
// FightCheerSection.tsx uses for the A-vs-B "cheer" UI, but that component is built
// around a two-sided matchup and doesn't fit a single-stock board, so this is a
// simpler, neutral single-list variant reusing BoardPanel.tsx's comment-list styling.
export default function GlobalBoardPanel({ code, name }: { code: string; name: string }) {
  const t = useT();
  const { lang } = useLanguage();
  const [comments, setComments] = useState<FightComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .companyComments(code)
      .then((res) => {
        if (!cancelled) setComments(res.items);
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

  const translatedTexts = useTranslatedTexts(comments.map((c) => c.text));

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    api
      .postFightComment(code, generateNickname(), trimmed)
      .then((comment) => {
        setComments((prev) => [comment, ...prev]);
        setText("");
      })
      .catch((err: Error) => setError(err.message || "댓글을 등록하지 못했습니다."))
      .finally(() => setPosting(false));
  };

  return (
    <div className="global-board-panel">
      <div className="global-board-input-row">
        <input
          type="text"
          className="cheer-input"
          placeholder={t("의견을 남겨보세요")}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button type="button" className="global-board-submit-btn" disabled={posting} onClick={submit}>
          {t("등록")}
        </button>
      </div>
      {error && <div className="cheer-error">{t(error)}</div>}

      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {!loading && comments.length === 0 && (
        <div className="empty-state">
          {lang === "en" ? `No discussion yet for ${name}.` : `${name} 관련 의견이 아직 없습니다.`}
        </div>
      )}
      {!loading && comments.length > 0 && (
        <ul className="board-comments-list global-board-comments-list">
          {comments.map((c, idx) => (
            <li key={c.id}>
              <div className="board-comment-meta">
                <span className="board-comment-author">{c.username}</span>
                <span className="board-comment-date">{c.created_at.slice(0, 16).replace("T", " ")}</span>
              </div>
              <p className="board-comment-text">{translatedTexts[idx] ?? c.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
