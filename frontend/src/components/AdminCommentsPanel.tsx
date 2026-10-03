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
function CommentPanel({ support = false }: { support?: boolean }) {
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => (support ? adminApi.supportComments(200) : adminApi.comments(200)).then((r) => {
      if (cancelled) return;
      setComments(r.items); setError("");
      if ("next_before" in r) setNextBefore(r.next_before as number | null);
    }).catch(err => { handleAuthError(err); if (!cancelled) setError("댓글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."); });
    load();
    const id = support ? null : setInterval(load, 30_000);
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [support]);

  async function loadSupportMore(reset = false) {
    setLoadingMore(true);
    try {
      const result = await adminApi.supportComments(200, reset ? undefined : nextBefore ?? undefined);
      setComments(previous => reset ? result.items : [...(previous ?? []), ...result.items]);
      setNextBefore(result.next_before); setError("");
    } catch (err) { handleAuthError(err); setError("댓글을 불러오지 못했습니다."); }
    finally { setLoadingMore(false); }
  }

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
      .catch(err => { handleAuthError(err); setError("댓글을 삭제하지 못했습니다. 다시 시도해 주세요."); })
      .finally(() => setDeletingKey(null));
  }

  function handleToggleVisibility(c: AdminComment) {
    const key = `${c.source}-${c.id}`;
    if (deletingKey === key) return;
    const nextVisible = !c.visible;
    setComments((prev) => (prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: nextVisible } : x)) : prev));
    adminApi.setCommentVisibility(c.source as CommentSource, c.id, nextVisible).catch((err) => {
      handleAuthError(err);
      setError("전시 상태를 변경하지 못했습니다.");
      setComments((prev) => (prev ? prev.map((x) => (x.source === c.source && x.id === c.id ? { ...x, visible: c.visible } : x)) : prev));
    });
  }

  return (
    <section className="admin-ops-section">
      <h2 className="admin-ops-heading">{support ? "☕ 후원 댓글 관리" : "종목 댓글 관리"} {comments !== null && `(${comments.length})`}</h2>
      {support && <p style={{ marginBottom: 16, fontSize: 13 }}>후원 페이지의 응원 댓글을 별도로 관리합니다. 삭제·미전시 댓글은 후원 페이지에 표시되지 않습니다. <button onClick={() => loadSupportMore(true)} disabled={loadingMore}>새로고침</button></p>}
      {error && <p role="alert">{error}</p>}
      <div className="admin-comments-table">
        <div className="admin-comments-row admin-comments-row--head">
          <span>번호</span>
          <span>{support ? "닉네임" : "종목명"}</span>
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
      {support && nextBefore && <button onClick={() => loadSupportMore()} disabled={loadingMore} style={{ marginTop: 16, minHeight: 44 }}>{loadingMore ? "불러오는 중…" : "이전 후원 댓글 더 보기"}</button>}
    </section>
  );
}

export default function AdminCommentsPanel() {
  const [tab, setTab] = useState<"stock" | "support">("stock");
  return <><div role="tablist" aria-label="댓글 종류" style={{ display: "flex", gap: 12, marginBottom: 20 }}>
    <button id="admin-stock-tab" role="tab" aria-selected={tab === "stock"} aria-controls="admin-comments-panel" onClick={() => setTab("stock")} style={{ minHeight: 44, padding: "8px 16px", fontWeight: tab === "stock" ? 800 : 400 }}>종목 댓글</button>
    <button id="admin-support-tab" role="tab" aria-selected={tab === "support"} aria-controls="admin-comments-panel" onClick={() => setTab("support")} style={{ minHeight: 44, padding: "8px 16px", fontWeight: tab === "support" ? 800 : 400 }}>☕ 후원 댓글</button>
  </div><div id="admin-comments-panel" role="tabpanel" aria-labelledby={tab === "support" ? "admin-support-tab" : "admin-stock-tab"}><CommentPanel key={tab} support={tab === "support"} /></div></>;
}
