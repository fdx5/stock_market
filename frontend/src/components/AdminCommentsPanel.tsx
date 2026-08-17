import { useEffect, useState } from "react";
import { AdminAuthError, AdminComment, CommentSource, adminApi, clearStoredSession } from "../adminApi";
import { navigate } from "../router";

const COMMENT_PREVIEW_LEN = 20;

/** Truncates to a fixed character count (not CSS ellipsis, which truncates by
 * rendered width) so every row's preview is the same length regardless of the
 * comment's actual content — the fixed-width column then never has to reflow. */
function truncateComment(text: string): { preview: string; truncated: boolean } {
  if (text.length <= COMMENT_PREVIEW_LEN) return { preview: text, truncated: false };
  return { preview: `${text.slice(0, COMMENT_PREVIEW_LEN)}...`, truncated: true };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function handleAuthError(err: unknown) {
  if (err instanceof AdminAuthError) {
    clearStoredSession();
    navigate("/admin");
  }
}

/** 댓글 탭. 자주 보는 화면이 아니라서 이 컴포넌트가 마운트될 때(=탭이 열릴 때)만
 * 폴링을 시작한다 — 이전에는 대시보드 전체가 항상 30초마다 조회했다. */
export default function AdminCommentsPanel() {
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => adminApi.comments(200).then((r) => !cancelled && setComments(r.items)).catch(handleAuthError);
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function toggleCommentExpanded(key: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDeleteComment(c: AdminComment) {
    const key = `${c.source}-${c.id}`;
    if (deletingKey === key) return;
    if (!window.confirm("이 댓글을 삭제하시겠습니까? 삭제한 댓글은 복구할 수 없습니다.")) return;
    setDeletingKey(key);
    adminApi
      .deleteComment(c.source as CommentSource, c.id)
      .then(() => setComments((prev) => (prev ? prev.filter((x) => !(x.source === c.source && x.id === c.id)) : prev)))
      .catch(handleAuthError)
      .finally(() => setDeletingKey(null));
  }

  function handleToggleVisibility(c: AdminComment) {
    const key = `${c.source}-${c.id}`;
    if (deletingKey === key) return;
    const nextVisible = !c.visible;
    setComments((prev) => (prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: nextVisible } : x)) : prev));
    adminApi.setCommentVisibility(c.source as CommentSource, c.id, nextVisible).catch((err) => {
      handleAuthError(err);
      setComments((prev) => (prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: c.visible } : x)) : prev));
    });
  }

  return (
    <section className="admin-ops-section">
      <h2 className="admin-ops-heading">댓글 관리 {comments !== null && `(${comments.length})`}</h2>
      <div className="admin-comments-table">
        <div className="admin-comments-row admin-comments-row--head">
          <span>번호</span>
          <span>종목명</span>
          <span>댓글 내용</span>
          <span>작성일시</span>
          <span>전시여부</span>
          <span></span>
        </div>
        {comments === null &&
          [0, 1, 2].map((i) => (
            <div key={i} className="admin-comments-row">
              <span className="admin-skeleton admin-skeleton--row" />
            </div>
          ))}
        {comments?.map((c) => {
          const key = `${c.source}-${c.id}`;
          const { preview, truncated } = truncateComment(c.text);
          const expanded = expandedComments.has(key);
          return (
            <div key={key} className="admin-comments-row-group">
              <div className="admin-comments-row">
                <span className="admin-comments-id">{c.id}</span>
                <span className="admin-comments-stock">{c.stock_name}</span>
                {truncated ? (
                  <button
                    type="button"
                    className="admin-comments-text admin-comments-text--clickable"
                    aria-expanded={expanded}
                    onClick={() => toggleCommentExpanded(key)}
                  >
                    {preview}
                  </button>
                ) : (
                  <span className="admin-comments-text">{preview}</span>
                )}
                <span className="admin-comments-time">{formatDateTime(c.created_at)}</span>
                <button
                  type="button"
                  className={`admin-comments-visibility-btn${c.visible ? "" : " admin-comments-visibility-btn--hidden"}`}
                  onClick={() => handleToggleVisibility(c)}
                >
                  {c.visible ? "전시" : "미전시"}
                </button>
                <button
                  type="button"
                  className="admin-comments-delete-btn"
                  disabled={deletingKey === key}
                  onClick={() => handleDeleteComment(c)}
                >
                  삭제
                </button>
              </div>
              {expanded && <div className="admin-comments-detail-row">{c.text}</div>}
            </div>
          );
        })}
        {comments?.length === 0 && <p className="admin-empty">등록된 댓글이 없습니다.</p>}
      </div>
    </section>
  );
}
