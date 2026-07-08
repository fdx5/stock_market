import { useEffect, useState } from "react";
import { BoardDetail, BoardPost, api } from "../api/client";

const PAGE_SIZE = 10;

type DetailState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: BoardDetail };

export default function BoardPanel({ code, name }: { code: string; name: string }) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [naverPage, setNaverPage] = useState(1);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNid, setExpandedNid] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

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

  const handleShowMore = () => {
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
          return;
        }
        setPosts((prev) => [...prev, ...res.items]);
        setNaverPage(nextPage);
        setVisibleCount((v) => v + PAGE_SIZE);
      })
      .catch(() => {
        // Leave the list as-is; the more-button stays put so the user can retry.
      })
      .finally(() => setLoadingMore(false));
  };

  const visiblePosts = posts.slice(0, visibleCount);
  const hasMore = visibleCount < posts.length || (!exhausted && naverPage < 20);

  const toggleExpand = (nid: string) => {
    if (expandedNid === nid) {
      setExpandedNid(null);
      return;
    }
    setExpandedNid(nid);
    if (details[nid]) return; // already fetched (or in flight) — reuse it

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
  };

  return (
    <div className="card board-panel">
      <h2>{name} 종목토론방</h2>

      {loading && <div className="loading-state">게시글을 불러오는 중...</div>}
      {error && <div className="error-state">{error}</div>}

      {!loading && !error && (
        <>
          {visiblePosts.length === 0 ? (
            <div className="empty-state">게시글이 없습니다.</div>
          ) : (
            <div className="board-list">
              {visiblePosts.map((post) => {
                const isExpanded = expandedNid === post.nid;
                const detailState = details[post.nid];
                return (
                  <div key={post.nid} className="board-row-wrap">
                    <button
                      type="button"
                      className={`board-row ${isExpanded ? "expanded" : ""}`}
                      onClick={() => toggleExpand(post.nid)}
                    >
                      <span className="board-row-title">{post.title}</span>
                      <span className="board-row-meta">
                        <span className="board-row-author">{post.author}</span>
                        <span className="board-row-date">{post.date}</span>
                        <span className="board-row-stat" title="조회">
                          조회 {post.views.toLocaleString()}
                        </span>
                        <span className="board-row-stat" title="공감/비공감">
                          👍{post.likes} 👎{post.dislikes}
                        </span>
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="board-detail">
                        {(!detailState || detailState.status === "loading") && (
                          <div className="loading-state">불러오는 중...</div>
                        )}
                        {detailState?.status === "error" && (
                          <div className="error-state">{detailState.message}</div>
                        )}
                        {detailState?.status === "ready" && (
                          <div className="board-detail-body">
                            {detailState.detail.blocks.length === 0 ? (
                              <p className="board-detail-text">(본문 없음)</p>
                            ) : (
                              detailState.detail.blocks.map((block, idx) =>
                                block.type === "image" ? (
                                  <img key={idx} className="board-detail-image" src={block.src} alt="" />
                                ) : (
                                  <p key={idx} className="board-detail-text">
                                    {block.text}
                                  </p>
                                )
                              )
                            )}
                          </div>
                        )}
                        <a
                          className="board-detail-link"
                          href={`https://finance.naver.com/item/board_read.naver?code=${code}&nid=${post.nid}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          네이버에서 새 창으로 보기 ↗
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
              {loadingMore ? "불러오는 중..." : "더보기"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
