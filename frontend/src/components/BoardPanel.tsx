import { useEffect, useRef, useState } from "react";
import { BoardComment, BoardDetail, BoardPost, api } from "../api/client";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";

const PAGE_SIZE = 10;

type DetailState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: BoardDetail };
type CommentsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: BoardComment[] };

export default function BoardPanel({ code, name }: { code: string; name: string }) {
  const { lang } = useLanguage();
  const t = useT();
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [naverPage, setNaverPage] = useState(1);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNid, setExpandedNid] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [comments, setComments] = useState<Record<string, CommentsState>>({});
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingRevealIndex = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPosts([]);
    setNaverPage(1);
    setVisibleCount(PAGE_SIZE);
    setExpandedNid(null);
    setExhausted(false);
    setDetails({});
    setComments({});

    api
      .board(code, 1)
      .then((res) => {
        if (cancelled) return;
        setPosts(res.items);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "게시글을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  // After "더보기" adds rows, the scroll position doesn't move on its own —
  // scroll the first newly revealed row into view so it's obvious something loaded.
  useEffect(() => {
    const revealIndex = pendingRevealIndex.current;
    if (revealIndex === null) return;
    pendingRevealIndex.current = null;
    const target = posts[revealIndex];
    if (!target) return;
    rowRefs.current.get(target.nid)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [posts, visibleCount]);

  const handleShowMore = () => {
    pendingRevealIndex.current = visibleCount;

    if (visibleCount < posts.length) {
      // Naver's board page already returns 20 rows at a time — the first "더보기"
      // click just reveals rows already fetched, no request needed.
      setVisibleCount((v) => v + PAGE_SIZE);
      return;
    }

    const nextPage = naverPage + 1;
    setLoadingMore(true);
    api
      .board(code, nextPage)
      .then((res) => {
        if (res.items.length === 0) {
          setExhausted(true);
          pendingRevealIndex.current = null;
          return;
        }
        setPosts((prev) => [...prev, ...res.items]);
        setNaverPage(nextPage);
        setVisibleCount((v) => v + PAGE_SIZE);
      })
      .catch(() => {
        // Leave the list as-is; the more-button stays put so the user can retry.
        pendingRevealIndex.current = null;
      })
      .finally(() => setLoadingMore(false));
  };

  const visiblePosts = posts.slice(0, visibleCount);
  const hasMore = visibleCount < posts.length || (!exhausted && naverPage < 20);

  const translatedTitles = useTranslatedTexts(visiblePosts.map((p) => p.title));

  const expandedDetail = expandedNid ? details[expandedNid] : undefined;
  const expandedBlocks = expandedDetail?.status === "ready" ? expandedDetail.detail.blocks : [];
  const translatedBlockTexts = useTranslatedTexts(expandedBlocks.map((b) => (b.type === "text" ? b.text ?? "" : "")));

  const expandedComments = expandedNid ? comments[expandedNid] : undefined;
  const expandedCommentItems = expandedComments?.status === "ready" ? expandedComments.items : [];
  const translatedCommentTexts = useTranslatedTexts(expandedCommentItems.map((c) => c.text));

  const toggleExpand = (nid: string) => {
    if (expandedNid === nid) {
      setExpandedNid(null);
      return;
    }
    setExpandedNid(nid);

    if (!details[nid]) {
      setDetails((prev) => ({ ...prev, [nid]: { status: "loading" } }));
      api
        .boardDetail(code, nid)
        .then((detail) => {
          setDetails((prev) => ({ ...prev, [nid]: { status: "ready", detail } }));
        })
        .catch((err: Error) => {
          setDetails((prev) => ({
            ...prev,
            [nid]: { status: "error", message: err.message || "게시글을 불러오지 못했습니다." },
          }));
        });
    }

    if (!comments[nid]) {
      setComments((prev) => ({ ...prev, [nid]: { status: "loading" } }));
      api
        .boardComments(code, nid)
        .then((res) => {
          setComments((prev) => ({ ...prev, [nid]: { status: "ready", items: res.items } }));
        })
        .catch((err: Error) => {
          setComments((prev) => ({
            ...prev,
            [nid]: { status: "error", message: err.message || "댓글을 불러오지 못했습니다." },
          }));
        });
    }
  };

  return (
    <div className="board-panel">
      {loading && <div className="loading-state">{t("게시글을 불러오는 중...")}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {!loading && !error && (
        <>
          {visiblePosts.length === 0 ? (
            <div className="empty-state">
              {lang === "en" ? `No board posts for ${name}.` : `${name} 관련 게시글이 없습니다.`}
            </div>
          ) : (
            <div className="board-list">
              {visiblePosts.map((post, postIdx) => {
                const isExpanded = expandedNid === post.nid;
                const detailState = details[post.nid];
                const commentState = comments[post.nid];
                return (
                  <div
                    key={post.nid}
                    className="board-row-wrap"
                    ref={(el) => {
                      if (el) rowRefs.current.set(post.nid, el);
                      else rowRefs.current.delete(post.nid);
                    }}
                  >
                    <button
                      type="button"
                      className={`board-row ${isExpanded ? "expanded" : ""}`}
                      onClick={() => toggleExpand(post.nid)}
                    >
                      <span className="board-row-title">{translatedTitles[postIdx] ?? post.title}</span>
                      <span className="board-row-meta">
                        <span className="board-row-author">{post.author}</span>
                        <span className="board-row-date">{post.date}</span>
                        <span className="board-row-stat" title={t("조회")}>
                          {t("조회")} {post.views.toLocaleString()}
                        </span>
                        <span className="board-row-stat" title={t("공감/비공감")}>
                          👍{post.likes} 👎{post.dislikes}
                        </span>
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="board-detail">
                        {(!detailState || detailState.status === "loading") && (
                          <div className="loading-state">{t("불러오는 중...")}</div>
                        )}
                        {detailState?.status === "error" && (
                          <div className="error-state">{t(detailState.message)}</div>
                        )}
                        {detailState?.status === "ready" && (
                          <div className="board-detail-body">
                            {detailState.detail.blocks.length === 0 ? (
                              <p className="board-detail-text">{t("(본문 없음)")}</p>
                            ) : (
                              detailState.detail.blocks.map((block, idx) =>
                                block.type === "image" ? (
                                  <img key={idx} className="board-detail-image" src={block.src} alt="" />
                                ) : (
                                  <p key={idx} className="board-detail-text">
                                    {translatedBlockTexts[idx] ?? block.text}
                                  </p>
                                )
                              )
                            )}
                          </div>
                        )}

                        <div className="board-comments">
                          <div className="board-comments-header">
                            {t("댓글")}
                            {commentState?.status === "ready" && ` ${commentState.items.length}`}
                          </div>
                          {(!commentState || commentState.status === "loading") && (
                            <div className="loading-state">{t("불러오는 중...")}</div>
                          )}
                          {commentState?.status === "error" && (
                            <div className="error-state">{t(commentState.message)}</div>
                          )}
                          {commentState?.status === "ready" && (
                            <>
                              {commentState.items.length === 0 ? (
                                <p className="board-comments-empty">{t("아직 댓글이 없습니다.")}</p>
                              ) : (
                                <ul className="board-comments-list">
                                  {commentState.items.map((comment, idx) => (
                                    <li key={comment.id || idx}>
                                      <div className="board-comment-meta">
                                        <span className="board-comment-author">{comment.author}</span>
                                        <span className="board-comment-date">{comment.written_at.slice(0, 16).replace("T", " ")}</span>
                                      </div>
                                      <p className="board-comment-text">
                                        {translatedCommentTexts[idx] ?? comment.text}
                                      </p>
                                      <span className="board-comment-stat">
                                        👍{comment.likes} 👎{comment.dislikes}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )}
                        </div>

                        <a
                          className="board-detail-link"
                          href={`https://finance.naver.com/item/board_read.naver?code=${code}&nid=${post.nid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("네이버에서 새 창으로 보기 ↗")}
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasMore && (
            <button type="button" className="board-more-btn" onClick={handleShowMore} disabled={loadingMore}>
              {loadingMore && <span className="board-more-spinner" aria-hidden="true" />}
              {loadingMore ? t("불러오는 중...") : t("더보기")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
